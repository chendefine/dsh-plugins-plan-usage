/**
 * dsh-plan-usage 的浏览器半：
 *   1. 在 shell.overlay 右下角渲染套餐用量角标（当前支持 OpenCode Go、
 *      GLM Coding Plan 的两个渠道（国际版 Z.AI / 智谱）与 Kimi Code），
 *      胶囊每个套餐一行展示 5小时/周限/月限 三个窗口，展开面板按套餐分区
 *      显示进度条；
 *   2. 在「设置 → 插件 → 插件配置」注册配置卡片：一个「启用套餐用量角标」全局
 *      开关，以及每个套餐各自的开关与 API Key 输入框（write-only 密钥）；
 *      Kimi Code 额外有可选的 kimi-auth Cookie 输入框（用于月度会员额度）。
 *
 * 配置卡片不依赖 harness 的设置命名空间白名单：控制器通过插件自己的
 * `GET/POST /api/plan-usage/config` 路由读写配置（Host 半用 in-process 的
 * settings 命名空间持久化），因此无需修改 harness 源码。
 *
 * 由 client-modules 注册表以「闭包工厂」形式提供给浏览器：React 与
 * `@deepseek-ai/dsh-client-ui-primitives`（折叠箭头图标）通过加载器模块表
 * （platform module）注入。卡片外观逐项复刻 harness 自带插件（终端、Agent
 * 循环、网页搜索）的 PluginCard/fields 设计——折叠头部、未保存徽标、底部
 * 按钮（放弃修改/保存/保存中…）与配色全部一致；伪类（hover/focus-visible）
 * 通过 apply 注入的一枚局部样式表实现，其余内联样式，避免 CSS 构建。
 */
window.__ModuleLoader__.load({ id: 'dsh-plan-usage', factory: (require) => {
var module = { exports: {} }
var exports = module.exports
var React = require('react')
var P = require('@deepseek-ai/dsh-client-ui-primitives')
var h = React.createElement

// ===========================================================================
// 用量角标
// ===========================================================================

var WINDOWS = [
  { key: 'rollingUsage', label: '5小时' },
  { key: 'weeklyUsage', label: '周限' },
  { key: 'monthlyUsage', label: '月限' },
]

/** 面向用户的通用名称：不绑定具体套餐提供方。 */
var PLAN_NAME = '套餐用量'

/**
 * 已接入的套餐（渠道）：id 与 Host 半的 wire 标识一致。每接入一个套餐，在这里追加
 * 一项（credentialHint 用于配置卡片的占位/提示文案）。GLM 分为两个渠道：
 * `glm-zai` 国际版 Z.AI 与 `glm-zhipu` 智谱开放平台，各自独立开关与 API Key。
 * `kimi-code` 额外有 `cookieHint`：配置卡片据此渲染可选的 kimi-auth Cookie 输入框
 * （月度会员额度增强，未配置时角标只显示 5小时/周限）。
 */
var PLANS = [
  { id: 'opencode-go', name: 'OpenCode Go', credentialHint: 'opencode-go' },
  { id: 'glm-zai', name: 'GLM Z.AI', credentialHint: 'ZAI' },
  { id: 'glm-zhipu', name: 'GLM 智谱', credentialHint: 'ZHIPU / GLM' },
  { id: 'kimi-code', name: 'Kimi Code', credentialHint: 'KIMI_CODE', cookieHint: 'kimi-auth' },
]

function planMeta(id) {
  for (var i = 0; i < PLANS.length; i++) {
    if (PLANS[i].id === id) return PLANS[i]
  }
  return { id: id, name: id, credentialHint: id }
}

function fmtReset(sec) {
  if (sec == null || !(sec > 0)) return ''
  if (sec < 60) return Math.round(sec) + ' 秒'
  if (sec < 3600) return Math.round(sec / 60) + ' 分钟'
  if (sec < 86400) return Math.round(sec / 3600) + ' 小时'
  return Math.round(sec / 86400) + ' 天'
}

function toneColor(p) {
  if (p >= 90) return 'var(--dsw-alias-state-error-primary)'
  if (p >= 50) return 'var(--dsw-alias-state-warn-primary)'
  return 'var(--dsw-alias-state-success-primary)'
}

var rootStyle = { position: 'fixed', right: 16, bottom: 16, zIndex: 1000, pointerEvents: 'auto', fontFamily: 'inherit' }
// 胶囊外形自适应：只有一行时保持圆弧（borderRadius 999）；多行时改为圆角矩形。
var pillStyle = { display: 'flex', flexDirection: 'column', gap: 3, padding: '8px 12px', background: 'var(--dsw-alias-bg-layer-2)', border: '1px solid var(--dsw-alias-border-l1)', boxShadow: '0 2px 12px rgba(0,0,0,0.18)', cursor: 'pointer', color: 'var(--dsw-alias-label-primary)', fontSize: 12, userSelect: 'none' }
var pillRowStyle = { display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', lineHeight: 1.4 }
var pillSegStyle = { display: 'inline-flex', alignItems: 'center', gap: 6 }
var dotStyle = { width: 8, height: 8, borderRadius: '50%', flex: 'none' }
var capNameStyle = { flex: 'none', minWidth: 84, fontWeight: 600 }
// 用量值列固定宽度：保证各行百分比右缘对齐（最宽场景如 "100% 100% 100%" 也放得下）。
var capValueStyle = { flex: 'none', width: 96, fontVariantNumeric: 'tabular-nums' }
var valueStyle = { fontVariantNumeric: 'tabular-nums' }
var panelStyle = { position: 'absolute', right: 0, bottom: 'calc(100% + 10px)', minWidth: 232, padding: 12, borderRadius: 12, background: 'var(--dsw-alias-bg-overlay)', border: '1px solid var(--dsw-alias-border-l1)', boxShadow: '0 8px 28px rgba(0,0,0,0.22)', color: 'var(--dsw-alias-label-primary)', fontSize: 12 }
var panelTitleStyle = { fontWeight: 600, margin: '0 0 10px', fontSize: 13 }
var sectionTitleStyle = { fontWeight: 600, margin: '10px 0 4px', fontSize: 12 }
var rowStyle = { display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0' }
var rowLabelStyle = { width: 44, flex: 'none', color: 'var(--dsw-alias-label-secondary)' }
var barStyle = { flex: 1, height: 6, borderRadius: 3, background: 'var(--dsw-alias-border-l1)', overflow: 'hidden' }
var barFillStyle = { display: 'block', height: '100%', borderRadius: 3, transition: 'width 0.2s ease' }
// 列宽全部固定（label/bar/百分比/剩余时间），保证各行进度条与文字逐列对齐。
var rowPctStyle = { width: 40, textAlign: 'right', flex: 'none', fontVariantNumeric: 'tabular-nums' }
var rowResetStyle = { width: 48, flex: 'none', color: 'var(--dsw-alias-label-secondary)', fontSize: 11 }
var noteStyle = { color: 'var(--dsw-alias-label-secondary)', fontSize: 11, marginTop: 6 }
var sectionNoteStyle = { color: 'var(--dsw-alias-label-secondary)', fontSize: 11, margin: '2px 0 6px' }

/** 某套餐最差窗口的百分比；无任何窗口数据返回 -1。 */
function worstPercent(plan) {
  var worst = -1
  for (var i = 0; i < WINDOWS.length; i++) {
    var v = plan[WINDOWS[i].key]
    if (v && typeof v.percent === 'number' && v.percent > worst) worst = v.percent
  }
  return worst
}

function PlanUsageBadge(props) {
  // 配置开关：全局关闭时整颗角标隐藏；套餐级开关决定取数/展示范围。
  var settingsSnap = React.useSyncExternalStore(props.settings.subscribe, props.settings.getSnapshot)
  var enabled = !settingsSnap || settingsSnap.enabled !== false
  var planKey = ''
  if (settingsSnap && settingsSnap.plans) {
    for (var pi = 0; pi < PLANS.length; pi++) {
      var ps = settingsSnap.plans[PLANS[pi].id]
      planKey += ps && ps.enabled === false ? '0' : '1'
    }
  }

  var stateHook = React.useState({ loading: true })
  var state = stateHook[0]
  var setState = stateHook[1]
  var openHook = React.useState(false)
  var open = openHook[0]
  var setOpen = openHook[1]

  React.useEffect(function () {
    if (enabled === false) return
    var alive = true
    var inFlight = false
    function load() {
      if (inFlight) return
      inFlight = true
      fetch('/api/plan-usage')
        .then(function (r) { return r.json() })
        .then(function (result) {
          if (alive) setState(result && typeof result === 'object' ? result : { ok: false, error: 'empty' })
        })
        .catch(function () { if (alive) setState({ ok: false, error: 'rpc' }) })
        .finally(function () { inFlight = false })
    }
    load()
    var timer = setInterval(load, 60000)
    return function () { alive = false; clearInterval(timer) }
  }, [enabled, planKey])

  if (enabled === false || (state && state.error === 'disabled')) return null

  // 只展示当前仍启用的套餐（禁用后旧数据一并丢弃）。
  var data = state && state.ok ? state.data : null
  var plans = data && Array.isArray(data.plans) ? data.plans : []
  if (settingsSnap && settingsSnap.plans) {
    plans = plans.filter(function (p) {
      var ps = settingsSnap.plans[p.id]
      return ps === undefined || ps.enabled !== false
    })
  }

  // 胶囊：多行，每个套餐一行，依次展示 5小时/周限/月限 三个窗口的百分比
  // （缺失的窗口按 0% 计）；无数据的套餐在该行标注状态（请设置 Key / 获取失败）。
  var capsuleRows = []
  var pillTitle = PLAN_NAME
  for (var i = 0; i < plans.length; i++) {
    var plan = plans[i]
    var meta = planMeta(plan.id)
    var worst = worstPercent(plan)
    if (worst >= 0) {
      var values = WINDOWS.map(function (w) {
        var v = plan[w.key]
        return (v && typeof v.percent === 'number' ? v.percent : 0) + '%'
      })
      capsuleRows.push({ dot: toneColor(worst), label: meta.name, values: values })
    } else if (plan.error === 'no-key') {
      capsuleRows.push({ dot: null, label: meta.name, values: ['请设置 Key'] })
    } else {
      capsuleRows.push({ dot: null, label: meta.name, values: ['获取失败'] })
    }
  }
  var dotColor = 'var(--dsw-alias-label-secondary)'
  var text = '…'
  if (state && state.loading) {
    text = '…'
  } else if (capsuleRows.length > 0) {
    text = capsuleRows.map(function (r) { return r.label + ' ' + r.values.join(' ') }).join('\n')
    pillTitle = text
  } else if (state && state.error) {
    text = '获取失败'
    pillTitle = state.message || '获取失败'
  } else {
    text = '—'
  }

  var pill = h('button', {
    style: Object.assign({}, pillStyle, { borderRadius: capsuleRows.length > 1 ? 12 : 999 }),
    type: 'button',
    onClick: function () { setOpen(!open) },
    title: pillTitle,
  },
    capsuleRows.length > 0
      ? capsuleRows.map(function (r, idx) {
        return h('span', { style: pillRowStyle, key: idx },
          h('span', { style: Object.assign({}, dotStyle, { background: r.dot || dotColor }) }),
          h('span', { style: capNameStyle }, r.label),
          h('span', { style: capValueStyle }, r.values.join(' ')),
        )
      })
      : h('span', { style: pillSegStyle },
        h('span', { style: Object.assign({}, dotStyle, { background: dotColor }) }),
        h('span', { style: valueStyle }, text),
      ),
  )

  var panel = null
  if (open) {
    var sections = plans.map(function (plan) {
      var meta = planMeta(plan.id)
      var title = meta.name + ' 用量' + (plan.level ? ' · ' + plan.level : '')
      var inner
      if (plan.error) {
        inner = h('div', { style: sectionNoteStyle }, plan.message || '无法获取用量')
      } else {
        // 只渲染有数据的窗口：套餐没有的窗口（如某些 GLM 套餐无周限）不占行。
        var rows = WINDOWS
          .filter(function (w) { return plan[w.key] != null })
          .map(function (w) {
          var v = plan[w.key]
          var pct = v && typeof v.percent === 'number' ? v.percent : 0
          var limited = v && v.status === 'rate-limited'
          var reset = ''
          if (v && typeof v.resetsAt === 'string' && v.resetsAt.length > 0) {
            reset = fmtReset((Date.parse(v.resetsAt) - Date.now()) / 1000)
          } else if (v && typeof v.resetInSec === 'number') {
            reset = fmtReset(v.resetInSec)
          }
          var fill = Object.assign({}, barFillStyle, { width: Math.max(0, Math.min(100, pct)) + '%', background: toneColor(limited ? 100 : pct) })
          return h('div', { style: rowStyle, key: w.key },
            h('span', { style: rowLabelStyle }, w.label),
            h('span', { style: barStyle }, h('span', { style: fill })),
            h('span', { style: rowPctStyle }, pct + '%'),
            h('span', { style: rowResetStyle }, reset),
          )
        })
        // 套餐级脚注：OpenCode Go 的 Zen 余额提示；Kimi Code 未取到月度窗口时
        // 区分「未配置 Cookie」与「Cookie 过期/获取失败」两种情况。
        var notes = []
        if (plan.useBalance) notes.push('超出限额后将使用 Zen 余额')
        if (plan.monthlyUsage == null && meta.cookieHint) {
          var kimiSnap = settingsSnap && settingsSnap.plans ? settingsSnap.plans['kimi-code'] : null
          notes.push(kimiSnap && kimiSnap.cookieConfigured
            ? '月度会员额度获取失败（' + meta.cookieHint + ' Cookie 可能已过期）'
            : '配置 ' + meta.cookieHint + ' Cookie 可显示月度会员额度')
        }
        inner = h('div', {},
          rows,
          notes.map(function (note, ni) {
            return h('div', { style: sectionNoteStyle, key: 'note' + ni }, note)
          }),
        )
      }
      return h('div', { key: plan.id },
        h('div', { style: sectionTitleStyle }, title),
        inner,
      )
    })
    panel = h('div', { style: panelStyle },
      h('div', { style: panelTitleStyle }, PLAN_NAME),
      sections,
    )
  }

  return h('div', { style: rootStyle }, pill, panel)
}

// ===========================================================================
// 配置卡片（设置 → 插件 → 插件配置）
// ===========================================================================

// 卡片外观与 harness 自带的插件卡片（PluginCard.module.css / fields.module.css）
// 逐项一致：折叠头部 + 未保存徽标 + 底部按钮，全部使用同一套 dsw 设计令牌。
// 伪类规则（:hover / :focus-visible）无法内联，由 apply 注入的局部样式表承担。

var cardStyle = { listStyle: 'none', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12, background: 'var(--dsw-alias-bg-layer-3)', transition: 'border-color .16s, background .16s' }
var cardOpenStyle = { background: 'var(--dsw-alias-bg-layer-2)', borderColor: 'var(--dsw-alias-label-dimmed)' }
var headerStyle = { width: '100%', appearance: 'none', border: 0, background: 'none', font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 12 }
var headTextStyle = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }
var nameStyle = { fontSize: 15, fontWeight: 600, lineHeight: 1.4, color: 'var(--dsw-alias-label-primary)' }
var descriptionStyle = { fontSize: 13, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' }
var chevronStyle = { flex: 'none', display: 'inline-flex', color: 'var(--dsw-alias-label-tertiary)', transition: 'transform .16s' }
var chevronOpenStyle = Object.assign({}, chevronStyle, { transform: 'rotate(180deg)' })
var pendingStyle = { flex: 'none', borderRadius: 999, padding: '1px 8px', fontSize: 11, lineHeight: '17px', fontWeight: 500, whiteSpace: 'nowrap', background: 'var(--dsw-alias-bg-module-platform)', color: 'var(--dsw-alias-label-secondary)' }
var bodyStyle = { borderTop: '1px solid var(--dsw-alias-border-l2)', margin: '0 16px', paddingBottom: 8 }
var readOnlyStyle = { margin: '12px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' }
var fieldStyle = { display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 0' }
var fieldSplitStyle = Object.assign({}, fieldStyle, { borderTop: '1px solid var(--dsw-alias-border-l2)' })
var fieldHeadStyle = { display: 'flex', alignItems: 'center', gap: 8 }
var fieldLabelStyle = { flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: 'var(--dsw-alias-label-primary)' }
var checkboxRowStyle = { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }
var badgesStyle = { display: 'inline-flex', alignItems: 'center', gap: 8 }
var badgeStyle = { borderRadius: 999, padding: '1px 8px', fontSize: 11, lineHeight: '17px', whiteSpace: 'nowrap', fontWeight: 500, background: 'var(--dsw-alias-bg-module-platform)', color: 'var(--dsw-alias-label-secondary)' }
var badgeMutedStyle = { borderRadius: 999, padding: '1px 8px', fontSize: 11, lineHeight: '17px', whiteSpace: 'nowrap', color: 'var(--dsw-alias-label-tertiary)' }
var resetStyle = { border: 'none', background: 'none', padding: 0, font: 'inherit', fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer' }
var inputStyle = { width: '100%', boxSizing: 'border-box', height: 34, padding: '0 12px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-3)', font: 'inherit', fontSize: 13, lineHeight: 1.5, color: 'var(--dsw-alias-label-primary)' }
var hintStyle = { margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' }
var footerStyle = { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '12px 0 4px', borderTop: '1px solid var(--dsw-alias-border-l2)' }
var failedStyle = { flex: 1, minWidth: 0, margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-error)' }
var btnBaseStyle = { appearance: 'none', border: '1px solid transparent', borderRadius: 8, padding: '5px 14px', font: 'inherit', fontSize: 13, lineHeight: 1.5, cursor: 'pointer' }
var discardBtnStyle = Object.assign({}, btnBaseStyle, { borderColor: 'var(--dsw-alias-border-l2)', background: 'none', color: 'var(--dsw-alias-label-secondary)' })
var saveBtnStyle = Object.assign({}, btnBaseStyle, { background: 'var(--dsw-alias-label-primary)', color: 'var(--dsw-alias-bg-layer-3)' })
var btnDisabledStyle = { opacity: 0.4, cursor: 'default' }

/** 折叠头部与按钮的伪类规则：与 PluginCard.module.css / fields.module.css 一致。 */
var CARD_CSS = [
  '.dsh-plan-usage-card:hover { border-color: var(--dsw-alias-label-dimmed); }',
  '.dsh-plan-usage-header:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }',
  '.dsh-plan-usage-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }',
  '.dsh-plan-usage-discard:hover:not(:disabled) { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-dimmed); }',
  '.dsh-plan-usage-reset:hover:not(:disabled) { color: var(--dsw-alias-label-primary); }',
  '.dsh-plan-usage-input:focus-visible { outline: none; border-color: var(--dsw-alias-brand-primary); }',
].join('\n')

/**
 * 配置卡片控制器：通过插件自己的 `GET/POST /api/plan-usage/config` 读写配置，
 * 维护分阶段草稿（保存才写入）。同时为角标提供 `enabled` 全局开关与
 * `plans.<id>.enabled` 套餐开关快照。
 */
function PlanUsageController(ctx) {
  var listeners = new Set()
  var snapshot = {
    available: false, writable: true,
    enabled: true, dirty: false, saving: false, failed: false,
    plans: {},
  }

  var loaded = false
  var enabled = true
  var writable = true
  var enabledDraft = undefined
  var saving = false
  var failed = false

  // id -> { enabled, apiKeyConfigured, cookieConfigured, enabledDraft,
  //          apiKeyDraft, apiKeyClear, cookieDraft, cookieClear }
  var planState = {}

  function planStore(id) {
    var st = planState[id]
    if (st === undefined) {
      st = { enabled: true, apiKeyConfigured: false, cookieConfigured: false }
      planState[id] = st
    }
    return st
  }

  function applyData(data) {
    if (!data) return
    enabled = data.enabled !== false
    writable = data.writable !== false
    loaded = true
    var plans = data.plans && typeof data.plans === 'object' ? data.plans : {}
    for (var i = 0; i < PLANS.length; i++) {
      var ps = plans[PLANS[i].id]
      if (!ps) continue
      var st = planStore(PLANS[i].id)
      st.enabled = ps.enabled !== false
      st.apiKeyConfigured = ps.apiKeyConfigured === true
      st.cookieConfigured = ps.cookieConfigured === true
    }
  }

  function load() {
    return fetch('/api/plan-usage/config')
      .then(function (r) { return r.json() })
      .then(function (result) {
        if (result && result.ok) applyData(result.data)
        publish()
      })
      .catch(function () { publish() })
  }

  function project() {
    var dirty = enabledDraft !== undefined
    var plans = {}
    for (var i = 0; i < PLANS.length; i++) {
      var plan = PLANS[i]
      var st = planStore(plan.id)
      var checked = st.enabledDraft !== undefined ? st.enabledDraft : st.enabled
      var planDirty = st.enabledDraft !== undefined || st.apiKeyClear
        || (typeof st.apiKeyDraft === 'string' && st.apiKeyDraft.trim() !== '')
        || st.cookieClear
        || (typeof st.cookieDraft === 'string' && st.cookieDraft.trim() !== '')
      if (planDirty) dirty = true
      plans[plan.id] = {
        enabled: checked,
        apiKeyConfigured: st.apiKeyConfigured === true,
        apiKeyDraft: typeof st.apiKeyDraft === 'string' ? st.apiKeyDraft : '',
        apiKeyClear: st.apiKeyClear === true,
        cookieConfigured: st.cookieConfigured === true,
        cookieDraft: typeof st.cookieDraft === 'string' ? st.cookieDraft : '',
        cookieClear: st.cookieClear === true,
      }
    }
    return {
      available: loaded,
      writable: writable,
      enabled: enabledDraft !== undefined ? enabledDraft : enabled,
      plans: plans,
      dirty: dirty,
      saving: saving,
      failed: failed,
    }
  }

  function publish() {
    snapshot = project()
    var arr = Array.from(listeners)
    for (var i = 0; i < arr.length; i++) arr[i]()
  }

  // 周期刷新，跟随 settings.yaml 的外部改动（如直接编辑文档）。
  ctx.effect(function () {
    var timer = setInterval(load, 60000)
    return function () { clearInterval(timer) }
  }, 'plan-usage: config refresh')

  function save() {
    if (saving) return Promise.resolve()
    var payload = {}
    if (enabledDraft !== undefined) payload.enabled = enabledDraft
    var plans = {}
    for (var i = 0; i < PLANS.length; i++) {
      var plan = PLANS[i]
      var st = planStore(plan.id)
      var entry = {}
      if (st.enabledDraft !== undefined) entry.enabled = st.enabledDraft
      if (st.apiKeyClear) entry.clearKey = true
      else {
        var key = typeof st.apiKeyDraft === 'string' ? st.apiKeyDraft.trim() : ''
        if (key !== '') entry.apiKey = key
      }
      if (st.cookieClear) entry.clearCookie = true
      else {
        var cookie = typeof st.cookieDraft === 'string' ? st.cookieDraft.trim() : ''
        if (cookie !== '') entry.cookie = cookie
      }
      if (Object.keys(entry).length > 0) plans[plan.id] = entry
    }
    if (Object.keys(plans).length > 0) payload.plans = plans
    if (Object.keys(payload).length === 0) return Promise.resolve()

    saving = true
    failed = false
    publish()
    return fetch('/api/plan-usage/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json() })
      .then(function (result) {
        enabledDraft = undefined
        for (var i = 0; i < PLANS.length; i++) {
          var st = planStore(PLANS[i].id)
          st.enabledDraft = undefined
          st.apiKeyDraft = ''
          st.apiKeyClear = false
          st.cookieDraft = ''
          st.cookieClear = false
        }
        saving = false
        failed = !(result && result.ok)
        if (result && result.ok) applyData(result.data)
        publish()
      })
      .catch(function () {
        enabledDraft = undefined
        for (var i = 0; i < PLANS.length; i++) {
          var st = planStore(PLANS[i].id)
          st.enabledDraft = undefined
          st.apiKeyDraft = ''
          st.apiKeyClear = false
          st.cookieDraft = ''
          st.cookieClear = false
        }
        saving = false
        failed = true
        publish()
      })
  }

  load()
  publish()

  return {
    getSnapshot: function () { return snapshot },
    subscribe: function (fn) { listeners.add(fn); return function () { listeners.delete(fn) } },
    setEnabled: function (v) { enabledDraft = !!v; failed = false; publish() },
    setPlanEnabled: function (id, v) { planStore(id).enabledDraft = !!v; failed = false; publish() },
    setPlanApiKey: function (id, text) { planStore(id).apiKeyDraft = text; planStore(id).apiKeyClear = false; failed = false; publish() },
    clearPlanApiKey: function (id) { planStore(id).apiKeyClear = true; planStore(id).apiKeyDraft = ''; failed = false; publish() },
    setPlanCookie: function (id, text) { planStore(id).cookieDraft = text; planStore(id).cookieClear = false; failed = false; publish() },
    clearPlanCookie: function (id) { planStore(id).cookieClear = true; planStore(id).cookieDraft = ''; failed = false; publish() },
    discard: function () {
      enabledDraft = undefined
      for (var i = 0; i < PLANS.length; i++) {
        var st = planStore(PLANS[i].id)
        st.enabledDraft = undefined
        st.apiKeyDraft = ''
        st.apiKeyClear = false
        st.cookieDraft = ''
        st.cookieClear = false
      }
      failed = false
      publish()
    },
    save: save,
  }
}

/** 单个套餐的配置区块：开关 + （启用时）API Key 输入；Kimi Code 额外有 Cookie 输入。 */
function PlanBlock(props) {
  var c = props.controller
  var plan = props.plan
  var snap = props.snap
  var disabled = props.disabled
  var planSnap = snap.plans[plan.id] || { enabled: true, apiKeyConfigured: false, apiKeyDraft: '', apiKeyClear: false, cookieConfigured: false, cookieDraft: '', cookieClear: false }
  return h('div', { style: fieldSplitStyle },
    h('label', { style: checkboxRowStyle },
      h('input', {
        type: 'checkbox',
        checked: planSnap.enabled,
        disabled: disabled,
        onChange: function (e) { c.setPlanEnabled(plan.id, e.target.checked) },
      }),
      h('span', { style: fieldLabelStyle }, '启用 ' + plan.name + ' 用量角标'),
    ),
    planSnap.enabled
      ? h('div', {},
        h('div', { style: Object.assign({}, fieldHeadStyle, { marginTop: 6 }) },
          h('label', { style: fieldLabelStyle, htmlFor: 'plan-usage-' + plan.id + '-api-key' }, plan.name + ' API Key（可选）'),
          h('span', { style: badgesStyle },
            h('span', { style: planSnap.apiKeyConfigured ? badgeStyle : badgeMutedStyle }, planSnap.apiKeyConfigured ? '已配置' : '未配置'),
            planSnap.apiKeyConfigured
              ? h('button', { type: 'button', style: resetStyle, className: 'dsh-plan-usage-reset', disabled: disabled, onClick: function () { c.clearPlanApiKey(plan.id) } }, '清除')
              : null,
          ),
        ),
        h('input', {
          id: 'plan-usage-' + plan.id + '-api-key',
          type: 'password',
          autoComplete: 'off',
          style: inputStyle,
          className: 'dsh-plan-usage-input',
          value: planSnap.apiKeyDraft,
          placeholder: '留空则使用「设置 → 模型」中的 ' + plan.credentialHint + ' API Key',
          disabled: disabled,
          onChange: function (e) { c.setPlanApiKey(plan.id, e.target.value) },
        }),
        h('p', { style: hintStyle }, '此处填写的 Key 优先级高于「设置 → 模型」中的 ' + plan.credentialHint + ' Key；两边都未设置时，角标会提示配置。'),
        plan.cookieHint
          ? h('div', {},
            h('div', { style: Object.assign({}, fieldHeadStyle, { marginTop: 6 }) },
              h('label', { style: fieldLabelStyle, htmlFor: 'plan-usage-' + plan.id + '-cookie' }, plan.name + ' ' + plan.cookieHint + ' Cookie（可选）'),
              h('span', { style: badgesStyle },
                h('span', { style: planSnap.cookieConfigured ? badgeStyle : badgeMutedStyle }, planSnap.cookieConfigured ? '已配置' : '未配置'),
                planSnap.cookieConfigured
                  ? h('button', { type: 'button', style: resetStyle, className: 'dsh-plan-usage-reset', disabled: disabled, onClick: function () { c.clearPlanCookie(plan.id) } }, '清除')
                  : null,
              ),
            ),
            h('input', {
              id: 'plan-usage-' + plan.id + '-cookie',
              type: 'password',
              autoComplete: 'off',
              style: inputStyle,
              className: 'dsh-plan-usage-input',
              value: planSnap.cookieDraft,
              placeholder: '留空则读取环境变量 KIMI_AUTH_TOKEN',
              disabled: disabled,
              onChange: function (e) { c.setPlanCookie(plan.id, e.target.value) },
            }),
            h('p', { style: hintStyle }, '用于获取 Kimi 会员月度额度；可在 kimi.com 浏览器开发者工具中复制 ' + plan.cookieHint + ' Cookie 值，过期后需重新复制。'),
          )
          : null,
      )
      : null,
  )
}

/**
 * 配置卡片：结构与交互逐项复刻 harness 的 PluginCard——
 * 头部按钮折叠/展开（chevron 旋转、aria-expanded），未保存徽标，只读提示，
 * 底部「放弃修改 / 保存 / 保存中…」按钮及失败提示；按钮与字段配色、字号、
 * 圆角均取同一套 dsw 令牌。展开区按套餐拆成多个区块，各配自己的开关与 Key。
 */
function PlanUsageConfigCard(props) {
  var c = props.settings
  var snap = React.useSyncExternalStore(c.subscribe, c.getSnapshot)
  var openHook = React.useState(false)
  var open = openHook[0]
  var setOpen = openHook[1]
  if (!snap.available) return null
  var disabled = !snap.writable
  var dirty = snap.dirty
  var saving = snap.saving
  var saveDisabled = !dirty || saving || disabled

  var card = h('li', { style: open ? Object.assign({}, cardStyle, cardOpenStyle) : cardStyle, className: 'dsh-plan-usage-card' },
    h('button', {
      type: 'button',
      style: headerStyle,
      className: 'dsh-plan-usage-header',
      'aria-expanded': open,
      'aria-label': (open ? '收起设置：' : '展开设置：') + PLAN_NAME,
      onClick: function () { setOpen(!open) },
    },
      h('span', { style: headTextStyle },
        h('span', { style: nameStyle }, PLAN_NAME),
        h('span', { style: descriptionStyle }, '在 Web 对话框右下角显示套餐用量角标（OpenCode Go / GLM Z.AI / GLM 智谱 / Kimi Code）。'),
      ),
      dirty ? h('span', { style: pendingStyle }, '未保存') : null,
      h('span', { style: open ? chevronOpenStyle : chevronStyle }, h(P.IconChevronDownOutline14, { size: 14 })),
    ),
    open
      ? h('div', { style: bodyStyle },
        !snap.writable ? h('p', { style: readOnlyStyle, role: 'status' }, '本部署的设置为只读。') : null,
        h('div', { style: fieldStyle },
          h('label', { style: checkboxRowStyle },
            h('input', {
              type: 'checkbox',
              checked: snap.enabled,
              disabled: disabled,
              onChange: function (e) { c.setEnabled(e.target.checked) },
            }),
            h('span', { style: fieldLabelStyle }, '启用套餐用量角标'),
          ),
          h('p', { style: hintStyle }, '关闭后右下角角标不再显示。'),
        ),
        snap.enabled
          ? PLANS.map(function (plan) {
            return h(PlanBlock, { key: plan.id, controller: c, plan: plan, snap: snap, disabled: disabled })
          })
          : null,
        h('div', { style: footerStyle },
          snap.failed ? h('p', { style: failedStyle, role: 'status' }, '本部署没有接受这些值，已保留供你修改。') : null,
          h('button', {
            type: 'button',
            style: Object.assign({}, discardBtnStyle, (!dirty || saving) ? btnDisabledStyle : {}),
            className: 'dsh-plan-usage-btn dsh-plan-usage-discard',
            disabled: !dirty || saving,
            onClick: function () { c.discard() },
          }, '放弃修改'),
          h('button', {
            type: 'button',
            style: Object.assign({}, saveBtnStyle, saveDisabled ? btnDisabledStyle : {}),
            className: 'dsh-plan-usage-btn dsh-plan-usage-save',
            disabled: saveDisabled,
            onClick: function () { c.save() },
          }, saving ? '保存中…' : '保存'),
        ),
      )
      : null,
  )
  return card
}

// ===========================================================================
// apply
// ===========================================================================

var inject = ['slots']

function apply(ctx) {
  var controller = new PlanUsageController(ctx)

  // 折叠头部 / 按钮的伪类规则（:hover、:focus-visible）无法内联，注入一枚
  // 局部样式表；随插件停用一并移除。
  ctx.effect(function () {
    var el = document.createElement('style')
    el.setAttribute('data-plugin', 'plan-usage')
    el.textContent = CARD_CSS
    document.head.appendChild(el)
    return function () { if (el.parentNode) el.parentNode.removeChild(el) }
  }, 'plan-usage: card styles')

  ctx.slots.inject('shell.overlay', function () {
    return ctx.slots.register({
      name: 'shell.overlay',
      id: 'plan-usage',
      order: 0,
      inject: function () { return { settings: controller } },
    }, PlanUsageBadge)
  })

  ctx.slots.inject('settings.plugin.item', function () {
    return ctx.slots.register({
      name: 'settings.plugin.item',
      id: 'plan-usage',
      order: 30,
      inject: function () { return { settings: controller } },
    }, PlanUsageConfigCard)
  })
}

module.exports = { name: 'plan-usage', inject: inject, apply: apply }
return module.exports
} })
