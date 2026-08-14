/**
 * dsh-plan-usage 的 Host 半：注册 `GET /api/plan-usage`（拉取 OpenCode Go 用量）
 * 与 `GET/POST /api/plan-usage/config`（读写插件配置）。
 *
 * 配置持久化使用 `plan-usage` 设置命名空间（in-process 读写，不依赖 harness 的
 * 配置客户端白名单），浏览器端通过插件自己的 /config 路由读写，因此本插件
 * 无需修改 harness 源码即可在「设置 → 插件 → 插件配置」里提供配置卡片。
 *
 * API Key 的解析优先级：
 * 1. 插件配置里的 `apiKey`（若留空则跳过）；
 * 2. 「设置 → 模型」写入的 `OPENCODE_GO_API_KEY` / `OPENCODE_API_KEY` 凭据；
 * 两者都为空时返回 `no-key`，由浏览器胶囊提示用户设置。
 *
 * 纯 JS、零运行时依赖：能力通过 `ctx` 获取，schema 通过 @deepseek-ai/schemastery
 * 与 @deepseek-ai/dsh-settings 声明（二者由 profile 的 node_modules 提升解析）。
 */

import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

const ENDPOINT = 'https://opencode.ai/zen/go/v1/usage'
const REFS = ['OPENCODE_GO_API_KEY', 'OPENCODE_API_KEY']

/** 插件配置的设置命名空间（仅作为本插件的持久化存储，不经 wire 暴露）。 */
const NS = settingsNamespace('plan-usage')

export const name = 'plan-usage'
export const inject = ['webServer', 'settings']

/** 插件配置 schema（`apiKey` 为 write-only 密钥，绝不通过 wire 返回）。 */
const Config = z.object({
  enabled: z.boolean().default(true),
  apiKey: z.string().role('secret'),
})

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** 归一化一个用量窗口，兼容线上结构（percent/resetsAt）与旧结构（usagePercent/resetInSec）。 */
function norm(raw) {
  if (raw == null || typeof raw !== 'object') return null
  const percent = typeof raw.percent === 'number'
    ? raw.percent
    : (typeof raw.usagePercent === 'number' ? raw.usagePercent : null)
  return {
    status: typeof raw.status === 'string' ? raw.status : null,
    percent,
    resetsAt: typeof raw.resetsAt === 'string' ? raw.resetsAt : null,
    resetInSec: typeof raw.resetInSec === 'number' ? raw.resetInSec : null,
  }
}

/** 依次尝试两个凭据名，命中第一个非空值。 */
async function resolveCredentialApiKey(ctx) {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) return undefined
  for (const ref of REFS) {
    try {
      const hit = await credentials.resolve(ref)
      if (hit !== undefined && hit.value && hit.value.length > 0) return hit.value
    } catch (err) {
      // 未命中就试下一个。
    }
  }
  return undefined
}

/** 配置的浏览器视图：只含非敏感字段（密钥的值永不返回）。 */
function configView(ctx, cfg) {
  const settings = ctx.get('settings')
  return {
    enabled: cfg.enabled !== false,
    apiKeyConfigured: typeof cfg.apiKey === 'string' && cfg.apiKey.length > 0,
    writable: settings !== undefined && settings.writable === true,
  }
}

/** 读取请求体（node IncomingMessage 异步迭代）。 */
async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

export function apply(ctx, config) {
  // 组合层配置（cordis.yml 中的 plan-usage 行）作为 base 层；用户层由设置文档覆盖。
  const entry = config != null && typeof config === 'object' ? config : {}
  // 直接注册设置命名空间：`settings` 作为硬依赖，注册发生在 apply 内同步完成。
  const scope = ctx.settings.register(NS, Config, { base: entry })
  const current = () => scope.get()

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/plan-usage',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        json(res, 405, { ok: false, error: 'method', message: 'method not allowed' })
        return
      }
      const cfg = current() || {}
      if (cfg.enabled === false) {
        json(res, 200, { ok: false, error: 'disabled', message: '套餐用量已停用' })
        return
      }
      const shell = ctx.get('shell')
      if (shell === undefined) {
        json(res, 503, { ok: false, error: 'no-shell', message: 'shell service unavailable' })
        return
      }
      // 优先级：插件配置 apiKey > 模型配置（凭据库）里的 opencode-go key。
      let apiKey = typeof cfg.apiKey === 'string' && cfg.apiKey.length > 0 ? cfg.apiKey : undefined
      if (apiKey === undefined) apiKey = await resolveCredentialApiKey(ctx)
      if (apiKey === undefined) {
        json(res, 200, {
          ok: false,
          error: 'no-key',
          message: '未配置 OpenCode Go API Key，请到「设置 → 插件」或「设置 → 模型」中配置',
        })
        return
      }
      const command = 'curl -sS -m 10 -H "Authorization: Bearer $PLAN_USAGE_KEY" -H "Accept: application/json" "' + ENDPOINT + '"'
      try {
        const spec = shell.resolve({
          command,
          env: { PLAN_USAGE_KEY: apiKey },
          timeoutMs: 15000,
          stdoutMaxBytes: 16384,
        })
        const result = await shell.run(spec)
        const body = result && result.stdout && typeof result.stdout.text === 'string'
          ? result.stdout.text.trim()
          : ''
        if (result.exitCode !== 0 || body.length === 0) {
          json(res, 502, { ok: false, error: 'curl', message: 'upstream request failed' })
          return
        }
        let data
        try {
          data = JSON.parse(body)
        } catch (err) {
          json(res, 502, { ok: false, error: 'parse', message: 'invalid upstream response' })
          return
        }
        if (data != null && typeof data === 'object' && data.type === 'error') {
          const e = data.error
          json(res, 502, {
            ok: false,
            error: e && e.type ? e.type : 'api',
            message: e && e.message ? e.message : 'OpenCode API error',
          })
          return
        }
        if (data == null || typeof data !== 'object') {
          json(res, 502, { ok: false, error: 'empty', message: 'empty response' })
          return
        }
        const u = data.usage != null && typeof data.usage === 'object' ? data.usage : data
        json(res, 200, {
          ok: true,
          data: {
            useBalance: data.useBalance === true,
            rollingUsage: norm(u.rolling != null ? u.rolling : data.rollingUsage),
            weeklyUsage: norm(u.weekly != null ? u.weekly : data.weeklyUsage),
            monthlyUsage: norm(u.monthly != null ? u.monthly : data.monthlyUsage),
          },
        })
      } catch (err) {
        json(res, 502, { ok: false, error: 'exec', message: 'upstream request failed' })
      }
    },
  }), 'plan-usage: route')

  // 配置读写路由：浏览器端配置卡片通过它读写，绕开 harness 的配置客户端白名单。
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/plan-usage/config',
    handler: async (req, res) => {
      if (req.method === 'GET') {
        json(res, 200, { ok: true, data: configView(ctx, current() || {}) })
        return
      }
      if (req.method !== 'POST') {
        json(res, 405, { ok: false, error: 'method', message: 'method not allowed' })
        return
      }
      let input
      try {
        input = JSON.parse(await readBody(req))
      } catch (err) {
        json(res, 400, { ok: false, error: 'bad-json', message: 'invalid JSON body' })
        return
      }
      if (input == null || typeof input !== 'object') {
        json(res, 400, { ok: false, error: 'bad-json', message: 'expected a JSON object' })
        return
      }
      try {
        if (input.enabled !== undefined) await scope.update({ enabled: input.enabled === true })
        if (input.clearKey === true) {
          await ctx.settings.mutate(NS, [{ op: 'unset', path: ['apiKey'] }])
        } else if (typeof input.apiKey === 'string' && input.apiKey.trim() !== '') {
          await scope.update({ apiKey: input.apiKey.trim() })
        }
        json(res, 200, { ok: true, data: configView(ctx, current() || {}) })
      } catch (err) {
        json(res, 400, {
          ok: false,
          error: 'rejected',
          message: err && err.message ? err.message : String(err),
        })
      }
    },
  }), 'plan-usage: config route')
}
