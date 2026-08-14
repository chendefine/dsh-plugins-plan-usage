/**
 * dsh-plan-usage 的 Host 半：注册 `GET /api/plan-usage`（并行拉取各套餐用量，
 * 当前支持 OpenCode Go、GLM Coding Plan 的两个渠道（国际版 Z.AI / 智谱）
 * 与 Kimi Code 会员套餐额度）与 `GET/POST /api/plan-usage/config`（读写插件配置）。
 *
 * 配置持久化使用 `plan-usage` 设置命名空间（in-process 读写，不依赖 harness 的
 * 配置客户端白名单），浏览器端通过插件自己的 /config 路由读写，因此本插件
 * 无需修改 harness 源码即可在「设置 → 插件 → 插件配置」里提供配置卡片。
 *
 * 每个套餐（渠道）的 API Key 解析优先级相同：
 * 1. 插件配置里该套餐的 `apiKey`（若留空则跳过）；
 * 2. 「设置 → 模型」写入的对应凭据（OpenCode Go 为 OPENCODE_GO_API_KEY /
 *    OPENCODE_API_KEY；GLM Z.AI 依次尝试 ZAI_API_KEY / Z_AI_API_KEY /
 *    GLM_ZAI_API_KEY；GLM 智谱依次尝试 ZHIPU_API_KEY / ZHIPUAI_API_KEY /
 *    GLM_API_KEY / BIGMODEL_API_KEY；Kimi Code 依次尝试 KIMI_CODE_API_KEY /
 *    KIMI_API_KEY，命中第一个非空值）；
 * 两者都为空时该套餐返回 `no-key`，由浏览器胶囊提示用户设置。
 *
 * Kimi Code 的月度会员额度走可选的 `kimi-auth` Cookie（网页接口，逆向、非官方）：
 * 插件配置里的 `kimiCodeCookie` 或凭据 `KIMI_AUTH_TOKEN`；未配置或获取失败时
 * 只返回周限与 5 小时窗口（渲染层自动跳过缺失窗口），不影响角标主流程。
 *
 * 纯 JS、零运行时依赖：能力通过 `ctx` 获取，schema 通过 @deepseek-ai/schemastery
 * 与 @deepseek-ai/dsh-settings 声明（二者由 profile 的 node_modules 提升解析）。
 */

import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

/** 已接入的套餐（渠道）定义：id 同时用作配置键名与 wire 标识。 */
const PLANS = [
  { id: 'opencode-go', name: 'OpenCode Go' },
  { id: 'glm-zai', name: 'GLM Z.AI' },
  { id: 'glm-zhipu', name: 'GLM 智谱' },
  { id: 'kimi-code', name: 'Kimi Code' },
]

/**
 * 每个套餐在配置扁平键中的字段名（enabled 开关 / apiKey 密钥；kimi-code 额外
 * 有可选 `cookie` 字段，即 kimi-auth 网页会话 Cookie）。
 * `glm-zai` 复用 v0.2 的 `glmEnabled` / `glmApiKey` 遗留键：v0.2 只有单个
 * GLM 入口且实测为国际版 Z.AI 的 Key，直接归到 Z.AI 渠道。
 */
const PLAN_FIELDS = {
  'opencode-go': { enabled: 'opencodeGoEnabled', apiKey: 'apiKey' },
  'glm-zai': { enabled: 'glmEnabled', apiKey: 'glmApiKey' },
  'glm-zhipu': { enabled: 'glmZhipuEnabled', apiKey: 'glmZhipuApiKey' },
  'kimi-code': { enabled: 'kimiCodeEnabled', apiKey: 'kimiCodeApiKey', cookie: 'kimiCodeCookie' },
}

/** 各套餐的用量端点、鉴权方式（是否 Bearer 前缀）与凭据候选（模型配置名）。 */
const PLAN_SOURCES = {
  'opencode-go': {
    endpoint: 'https://opencode.ai/zen/go/v1/usage',
    bearer: true,
    refs: ['OPENCODE_GO_API_KEY', 'OPENCODE_API_KEY'],
  },
  // GLM Coding Plan monitor 接口：Authorization 直接携带 Key，不带 Bearer 前缀。
  'glm-zai': {
    endpoint: 'https://api.z.ai/api/monitor/usage/quota/limit',
    bearer: false,
    refs: ['ZAI_API_KEY', 'Z_AI_API_KEY', 'GLM_ZAI_API_KEY'],
  },
  'glm-zhipu': {
    endpoint: 'https://open.bigmodel.cn/api/monitor/usage/quota/limit',
    bearer: false,
    refs: ['ZHIPU_API_KEY', 'ZHIPUAI_API_KEY', 'GLM_API_KEY', 'BIGMODEL_API_KEY'],
  },
  // Kimi Code 官方用量接口：Kimi Code 控制台创建的 API Key（sk-kimi-xxx），
  // Bearer 鉴权；返回周限（usage）+ 5 小时频限窗口（limits）+ 会员等级。
  'kimi-code': {
    endpoint: 'https://api.kimi.com/coding/v1/usages',
    bearer: true,
    refs: ['KIMI_CODE_API_KEY', 'KIMI_API_KEY'],
    ua: 'KimiCLI/1.6',
  },
}

// Kimi 会员月度额度的网页接口（逆向、非官方，需要 kimi-auth Cookie）：
// 返回 subscriptionBalance（amountUsedRatio / kimiCodeUsedRatio / expireTime）。
const KIMI_SUBSCRIPTION_STATS_URL =
  'https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats'

// Kimi 网页接口要求的浏览器类请求头（与 kimi.com 控制台保持一致）。
const KIMI_WEB_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
  Origin: 'https://www.kimi.com',
  Referer: 'https://www.kimi.com/code/console',
  'x-msh-platform': 'web',
  'connect-protocol-version': '1',
}

/** 插件配置的设置命名空间（仅作为本插件的持久化存储，不经 wire 暴露）。 */
const NS = settingsNamespace('plan-usage')

export const name = 'plan-usage'
export const inject = ['webServer', 'settings']

/**
 * 插件配置 schema（apiKey/cookie 均为 write-only 密钥，绝不通过 wire 返回）：
 * - `enabled` 全局开关，关闭后角标整体隐藏；
 * - `apiKey` 为 v0.1 遗留键名，即 OpenCode Go 的插件级 Key；
 * - `opencodeGoEnabled` / `glmEnabled` / `glmZhipuEnabled` / `kimiCodeEnabled`
 *   各套餐（渠道）开关；
 * - `glmApiKey` / `glmZhipuApiKey` / `kimiCodeApiKey` 各套餐的插件级 Key；
 * - `kimiCodeCookie` 为 Kimi 会员月度额度的可选 kimi-auth 会话 Cookie。
 */
const Config = z.object({
  enabled: z.boolean().default(true),
  apiKey: z.string().role('secret'),
  opencodeGoEnabled: z.boolean().default(true),
  glmEnabled: z.boolean().default(true),
  glmApiKey: z.string().role('secret'),
  glmZhipuEnabled: z.boolean().default(true),
  glmZhipuApiKey: z.string().role('secret'),
  kimiCodeEnabled: z.boolean().default(true),
  kimiCodeApiKey: z.string().role('secret'),
  kimiCodeCookie: z.string().role('secret'),
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

/** 依次尝试一组凭据名，命中第一个非空值（含环境变量与 .env 回退）。 */
async function resolveCredentialApiKey(ctx, refs) {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) return undefined
  for (const ref of refs) {
    try {
      const hit = await credentials.resolve(ref)
      if (hit !== undefined && hit.value && hit.value.length > 0) return hit.value
    } catch (err) {
      // 未命中就试下一个。
    }
  }
  return undefined
}

/** 按「插件配置 > 模型配置（凭据库）」解析某套餐的 API Key。 */
async function resolvePlanApiKey(ctx, cfg, planId) {
  const keyField = PLAN_FIELDS[planId].apiKey
  const pluginKey = typeof cfg[keyField] === 'string' && cfg[keyField].length > 0
    ? cfg[keyField]
    : undefined
  if (pluginKey !== undefined) return pluginKey
  return resolveCredentialApiKey(ctx, PLAN_SOURCES[planId].refs)
}

/** 配置的浏览器视图：只含非敏感字段（密钥的值永不返回）。 */
function configView(ctx, cfg) {
  const settings = ctx.get('settings')
  const plans = {}
  for (const plan of PLANS) {
    const fields = PLAN_FIELDS[plan.id]
    const key = cfg[fields.apiKey]
    plans[plan.id] = {
      enabled: cfg[fields.enabled] !== false,
      apiKeyConfigured: typeof key === 'string' && key.length > 0,
      cookieConfigured: fields.cookie !== undefined
        && typeof cfg[fields.cookie] === 'string' && cfg[fields.cookie].length > 0,
    }
  }
  return {
    enabled: cfg.enabled !== false,
    plans,
    writable: settings !== undefined && settings.writable === true,
  }
}

/** 读取请求体（node IncomingMessage 异步迭代）。 */
async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * 通过 shell 执行 curl 拉取 JSON。opts：
 * - `auth`：Authorization 凭据（API Key 或 kimi-auth JWT），缺省不带该头；
 * - `bearer`：false 时 Authorization 直接携带裸值（GLM monitor），默认 true；
 * - `cookie`：附加 `Cookie: kimi-auth=<value>` 头（Kimi 网页接口）；
 * - `method`/`body`：method 为 'POST' 时以 JSON body 发 POST；
 * - `headers`：附加请求头 {name: value}。
 * 额外用 `-w` 捕获 HTTP 状态码：非 200 且响应体无业务错误结构时按 HTTP 错误返回。
 */
async function curlJson(shell, url, opts) {
  opts = opts || {}
  const auth = typeof opts.auth === 'string' && opts.auth.length > 0 ? opts.auth : undefined
  const cookie = typeof opts.cookie === 'string' && opts.cookie.length > 0 ? opts.cookie : undefined
  const parts = ['curl -sS -m 10']
  if (auth !== undefined) {
    const prefix = opts.bearer === false ? '' : 'Bearer '
    parts.push('-H "Authorization: ' + prefix + '$PLAN_USAGE_KEY"')
  }
  if (cookie !== undefined) parts.push('-H "Cookie: kimi-auth=$PLAN_USAGE_COOKIE"')
  parts.push('-H "Accept: application/json"')
  const headers = opts.headers != null && typeof opts.headers === 'object' ? opts.headers : null
  if (headers !== null) {
    for (const name of Object.keys(headers)) {
      parts.push('-H "' + name + ': ' + headers[name] + '"')
    }
  }
  if (opts.method === 'POST') {
    parts.push('-X POST -H "Content-Type: application/json" -d "$PLAN_USAGE_BODY"')
  }
  parts.push('-w "\\n__DSH_HTTP__%{http_code}" "' + url + '"')
  const command = parts.join(' ')
  const env = {}
  if (auth !== undefined) env.PLAN_USAGE_KEY = auth
  if (cookie !== undefined) env.PLAN_USAGE_COOKIE = cookie
  if (opts.body !== undefined) env.PLAN_USAGE_BODY = opts.body
  const spec = shell.resolve({
    command,
    env,
    timeoutMs: 15000,
    stdoutMaxBytes: 16384,
  })
  const result = await shell.run(spec)
  const raw = result && result.stdout && typeof result.stdout.text === 'string'
    ? result.stdout.text
    : ''
  // 剥离 -w 追加的状态码标记（标记不可能出现在合法 JSON 里）。
  const m = raw.match(/__DSH_HTTP__(\d{3})\s*$/)
  const status = m !== null ? parseInt(m[1], 10) : null
  const body = m !== null ? raw.slice(0, m.index).trim() : raw.trim()
  if (result.exitCode !== 0 || body.length === 0) {
    return { err: { error: 'curl', message: 'upstream request failed' } }
  }
  let data
  try {
    data = JSON.parse(body)
  } catch (err) {
    return { err: { error: 'parse', message: 'invalid upstream response' } }
  }
  // 上游错误体：OpenCode Go 用 `{type:'error', error:{...}}`，GLM monitor 用
  // `{error:{code,message}}` 或 `{code:<非200>, msg}`，统一映射。
  if (data != null && typeof data === 'object') {
    const e = data.type === 'error' || (data.error != null && typeof data.error === 'object')
      ? data.error
      : null
    if (e != null) {
      return {
        err: {
          error: e && e.type ? e.type : 'api',
          message: e && e.message ? e.message : 'API error',
        },
      }
    }
    if (typeof data.code === 'number' && data.code !== 200) {
      return {
        err: {
          error: 'api',
          message: typeof data.msg === 'string' && data.msg ? data.msg : 'API error (code ' + data.code + ')',
        },
      }
    }
  }
  // 响应体没有业务错误结构但 HTTP 状态非 200（如 Kimi 接口的 401/403）。
  if (status !== null && status !== 200) {
    return { err: { error: 'http', message: 'upstream HTTP ' + status } }
  }
  if (data == null || typeof data !== 'object') {
    return { err: { error: 'empty', message: 'empty response' } }
  }
  return { data }
}

/** 把字符串/数字统一转成数字；无法解析返回 null。 */
function toNum(v) {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim())
    if (Number.isFinite(n)) return n
  }
  return null
}

/**
 * 归一化 Kimi Code /usages 响应：
 * - `usage` → 周限（订阅日每 7 天刷新，limit/used/remaining/resetTime）；
 * - `limits[]` 中 300 分钟窗口（找不到则取第一个）→ 5 小时频限；
 * - 响应不含月度会员额度（那是 Kimi 会员订阅的独立维度，需 Cookie 接口）。
 * 返回 { rollingUsage, weeklyUsage, monthlyUsage: null }。
 */
function normKimi(payload) {
  const obj = payload != null && typeof payload === 'object' ? payload : {}
  const detailWindow = (d) => {
    if (d == null || typeof d !== 'object') return null
    const limit = toNum(d.limit)
    let used = toNum(d.used)
    if (used === null && limit !== null) {
      const remaining = toNum(d.remaining)
      if (remaining !== null) used = limit - remaining
    }
    if (limit === null || limit <= 0 || used === null) return null
    // 百分比四舍五入取整（周限 / 5小时 / 月限一致，均无小数）。
    const percent = Math.round((Math.max(0, Math.min(limit, used)) / limit) * 100)
    return {
      status: null,
      percent,
      resetsAt: typeof d.resetTime === 'string' && d.resetTime.length > 0 ? d.resetTime : null,
      resetInSec: null,
    }
  }
  const windows = { rollingUsage: null, weeklyUsage: null, monthlyUsage: null }
  const usage = obj.usage != null && typeof obj.usage === 'object' ? obj.usage : null
  if (usage !== null) windows.weeklyUsage = detailWindow(usage)
  const limits = Array.isArray(obj.limits) ? obj.limits : []
  let fiveHour = null
  for (const item of limits) {
    if (item == null || typeof item !== 'object') continue
    const w = item.window != null && typeof item.window === 'object' ? item.window : {}
    if (w.duration === 300 && String(w.timeUnit || '').indexOf('MINUTE') !== -1) {
      fiveHour = item
      break
    }
  }
  if (fiveHour === null && limits.length > 0) fiveHour = limits[0]
  if (fiveHour !== null) {
    const detail = fiveHour.detail != null && typeof fiveHour.detail === 'object'
      ? fiveHour.detail
      : null
    windows.rollingUsage = detailWindow(detail)
  }
  return windows
}

/**
 * 归一化 Kimi GetSubscriptionStats 响应中的月度会员额度：
 * subscriptionBalance.amountUsedRatio（0..1 或已是百分数），expireTime 为重置时间。
 * 取不到返回 null。
 */
function normKimiMonthly(payload) {
  const obj = payload != null && typeof payload === 'object' ? payload : {}
  const bal = obj.subscriptionBalance != null && typeof obj.subscriptionBalance === 'object'
    ? obj.subscriptionBalance
    : null
  if (bal === null) return null
  let ratio = typeof bal.amountUsedRatio === 'number'
    ? bal.amountUsedRatio
    : (typeof bal.kimiCodeUsedRatio === 'number' ? bal.kimiCodeUsedRatio : null)
  if (ratio === null || !Number.isFinite(ratio)) return null
  const percent = ratio >= 0 && ratio <= 1 ? ratio * 100 : ratio
  return {
    status: null,
    // 月限只保留整数百分比（周限/5小时保留 1 位小数）。
    percent: Math.round(Math.max(0, Math.min(100, percent))),
    resetsAt: typeof bal.expireTime === 'string' && bal.expireTime.length > 0 ? bal.expireTime : null,
    resetInSec: null,
  }
}

/** 解析 Kimi 网页会话 Cookie（kimi-auth JWT）：插件配置 > 凭据库 KIMI_AUTH_TOKEN。 */
async function resolvePlanCookie(ctx, cfg) {
  const field = PLAN_FIELDS['kimi-code'].cookie
  const pluginValue = typeof cfg[field] === 'string' && cfg[field].length > 0
    ? cfg[field]
    : undefined
  if (pluginValue !== undefined) return pluginValue
  return resolveCredentialApiKey(ctx, ['KIMI_AUTH_TOKEN'])
}

/** 拉取某套餐的用量：OpenCode Go 为 usage 结构（+useBalance），GLM 渠道为 quota/limit 结构（+level）。 */
async function fetchPlan(ctx, shell, cfg, plan) {
  const source = PLAN_SOURCES[plan.id]
  const apiKey = await resolvePlanApiKey(ctx, cfg, plan.id)
  if (apiKey === undefined) {
    return Object.assign({}, plan, {
      error: 'no-key',
      message: '未配置 ' + plan.name + ' API Key，请到「设置 → 插件」或「设置 → 模型」中配置',
    })
  }
  try {
    const { data, err } = await curlJson(shell, source.endpoint, {
      auth: apiKey,
      bearer: source.bearer,
      headers: source.ua ? { 'User-Agent': source.ua } : undefined,
    })
    if (err !== undefined) return Object.assign({}, plan, err)
    if (plan.id === 'opencode-go') {
      const u = data.usage != null && typeof data.usage === 'object' ? data.usage : data
      return Object.assign({}, plan, {
        useBalance: data.useBalance === true,
        rollingUsage: norm(u.rolling != null ? u.rolling : data.rollingUsage),
        weeklyUsage: norm(u.weekly != null ? u.weekly : data.weeklyUsage),
        monthlyUsage: norm(u.monthly != null ? u.monthly : data.monthlyUsage),
      })
    }
    if (plan.id === 'kimi-code') {
      const windows = normKimi(data)
      const membership = data.user != null && data.user.membership != null
        ? data.user.membership
        : null
      const out = Object.assign({}, plan, {
        level: membership != null && typeof membership.level === 'string' ? membership.level : null,
      }, windows)
      // 月度会员额度（可选增强）：需要 kimi-auth Cookie；失败只丢月度窗口，
      // 不阻断周限与 5 小时数据。
      const cookie = await resolvePlanCookie(ctx, cfg)
      if (cookie !== undefined) {
        try {
          const stats = await curlJson(shell, KIMI_SUBSCRIPTION_STATS_URL, {
            auth: cookie,
            cookie,
            method: 'POST',
            body: '{}',
            headers: KIMI_WEB_HEADERS,
          })
          if (stats.err === undefined) {
            const monthly = normKimiMonthly(stats.data)
            if (monthly !== null) out.monthlyUsage = monthly
          }
        } catch (statsErr) {
          // 忽略：月度额度只是增强信息。
        }
      }
      return out
    }
    const { windows, level } = normGlm(data)
    return Object.assign({}, plan, { level }, windows)
  } catch (err) {
    return Object.assign({}, plan, { error: 'exec', message: 'upstream request failed' })
  }
}

/** 归一化 GLM quota/limit 响应：TOKENS_LIMIT(3,5) → 5小时，(6,1) → 周限；TIME_LIMIT → 月限。 */
function normGlm(payload) {
  const obj = payload != null && typeof payload === 'object' ? payload : {}
  const inner = obj.data != null && typeof obj.data === 'object' ? obj.data : obj
  const limits = Array.isArray(inner.limits) ? inner.limits : []
  const windows = { rollingUsage: null, weeklyUsage: null, monthlyUsage: null }
  for (const item of limits) {
    if (item == null || typeof item !== 'object') continue
    const type = typeof item.type === 'string' ? item.type : null
    const percent = typeof item.percentage === 'number' ? item.percentage : null
    const resetInSec = typeof item.nextResetTime === 'number' && item.nextResetTime > 0
      ? Math.max(0, (item.nextResetTime - Date.now()) / 1000)
      : null
    const window = { status: null, percent, resetsAt: null, resetInSec }
    if (type === 'TOKENS_LIMIT') {
      const slot = item.unit === 3 && item.number === 5
        ? 'rollingUsage'
        : item.unit === 6 && item.number === 1 ? 'weeklyUsage' : null
      if (slot !== null) windows[slot] = window
    } else if (type === 'TIME_LIMIT') {
      // TIME_LIMIT 即 MCP 工具用量（1 个月窗口）。
      windows.monthlyUsage = window
    }
  }
  return {
    windows,
    level: typeof inner.level === 'string' ? inner.level : null,
  }
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
      const enabledPlans = PLANS.filter((plan) => cfg[PLAN_FIELDS[plan.id].enabled] !== false)
      if (enabledPlans.length === 0) {
        json(res, 200, { ok: false, error: 'disabled', message: '套餐用量已停用' })
        return
      }
      const shell = ctx.get('shell')
      if (shell === undefined) {
        json(res, 503, { ok: false, error: 'no-shell', message: 'shell service unavailable' })
        return
      }
      // 各套餐（渠道）独立取数：一个套餐缺 Key/失败不影响其他套餐。
      const plans = await Promise.all(enabledPlans.map((plan) => fetchPlan(ctx, shell, cfg, plan)))
      json(res, 200, { ok: true, data: { plans } })
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
      // 每套餐更新：{ [planId]: { enabled?, apiKey?, clearKey? } }，未知套餐拒绝。
      const planUpdates = {}
      if (input.plans !== undefined) {
        if (typeof input.plans !== 'object' || Array.isArray(input.plans)) {
          json(res, 400, { ok: false, error: 'bad-plans', message: 'plans must be an object keyed by plan id' })
          return
        }
        for (const key of Object.keys(input.plans)) {
          if (!PLAN_FIELDS[key]) {
            json(res, 400, { ok: false, error: 'unknown-plan', message: 'unknown plan id: ' + key })
            return
          }
          const up = input.plans[key]
          if (up == null || typeof up !== 'object') {
            json(res, 400, { ok: false, error: 'bad-plan', message: 'plan update must be an object' })
            return
          }
          planUpdates[key] = up
        }
      }
      try {
        if (input.enabled !== undefined) await scope.update({ enabled: input.enabled === true })
        for (const plan of PLANS) {
          const up = planUpdates[plan.id]
          if (up === undefined) continue
          const fields = PLAN_FIELDS[plan.id]
          if (up.enabled !== undefined) await scope.update({ [fields.enabled]: up.enabled === true })
          if (up.clearKey === true) {
            await ctx.settings.mutate(NS, [{ op: 'unset', path: [fields.apiKey] }])
          } else if (typeof up.apiKey === 'string' && up.apiKey.trim() !== '') {
            await scope.update({ [fields.apiKey]: up.apiKey.trim() })
          }
          // 可选会话 Cookie（目前仅 kimi-code：月度会员额度）。
          if (fields.cookie !== undefined) {
            if (up.clearCookie === true) {
              await ctx.settings.mutate(NS, [{ op: 'unset', path: [fields.cookie] }])
            } else if (typeof up.cookie === 'string' && up.cookie.trim() !== '') {
              await scope.update({ [fields.cookie]: up.cookie.trim() })
            }
          }
        }
        // 兼容旧客户端（v0.1）：顶层 apiKey / clearKey 视作 opencode-go 套餐的更新。
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
