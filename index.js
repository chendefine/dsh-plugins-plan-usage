/**
 * dsh-plan-usage 的 Host 半：注册 `GET /api/plan-usage`，
 * 解析 OpenCode Go 的 API Key，并通过 shell(curl) 拉取用量后以 JSON 返回。
 *
 * 纯 JS、零运行时依赖：所有能力都通过 `ctx` 获取（webServer / shell /
 * credentials 服务），因此无需构建、无需 `prepare`。
 */

const ENDPOINT = 'https://opencode.ai/zen/go/v1/usage'
const REFS = ['OPENCODE_GO_API_KEY', 'OPENCODE_API_KEY']

export const name = 'plan-usage'
export const inject = ['webServer']

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
async function resolveApiKey(ctx) {
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

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/plan-usage',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        json(res, 405, { ok: false, error: 'method', message: 'method not allowed' })
        return
      }
      const shell = ctx.get('shell')
      if (shell === undefined) {
        json(res, 503, { ok: false, error: 'no-shell', message: 'shell service unavailable' })
        return
      }
      const apiKey = await resolveApiKey(ctx)
      if (apiKey === undefined) {
        json(res, 200, { ok: false, error: 'no-key', message: 'OPENCODE_GO_API_KEY not configured' })
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
}
