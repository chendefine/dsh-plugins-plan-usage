/**
 * dsh-plan-usage 的浏览器半：
 *   1. 在 shell.overlay 右下角渲染 OpenCode Go 用量角标；
 *   2. 在「设置 → 插件 → 插件配置」注册配置卡片：一个「启用 OpenCode Go」开关，
 *      启用时显示 API Key 输入框（write-only 密钥）。
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

/**
 * 面向用户的通用名称：不绑定具体套餐提供方（当前为 OpenCode Go，
 * 未来接入更多套餐时无需逐个改文案）。
 */
var PLAN_NAME = '套餐用量'

/**
 * 已接入的套餐。当前仅 OpenCode Go；后续每接入一个套餐，在这里追加一项，
 * 并在配置卡片中为每个套餐提供自己的开关与 API Key（见配置卡片注释）。
 */
var PLANS = [
  { id: 'opencode-go', name: 'OpenCode Go' },
]

/** 当前套餐（单套餐阶段取第一项；多套餐时角标按套餐分别标注）。 */
var CURRENT_PLAN = PLANS[0]

/** 胶囊与展开面板的展示名：标注当前套餐，如「OpenCode Go 用量」。 */
var PLAN_USAGE_NAME = CURRENT_PLAN.name + ' 用量'

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
var pillStyle = { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 999, background: 'var(--dsw-alias-bg-layer-2)', border: '1px solid var(--dsw-alias-border-l1)', boxShadow: '0 2px 12px rgba(0,0,0,0.18)', cursor: 'pointer', color: 'var(--dsw-alias-label-primary)', fontSize: 12, lineHeight: 1, userSelect: 'none', whiteSpace: 'nowrap' }
var dotStyle = { width: 8, height: 8, borderRadius: '50%', flex: 'none' }
var labelStyle = { fontWeight: 600 }
var valueStyle = { fontVariantNumeric: 'tabular-nums' }
var panelStyle = { position: 'absolute', right: 0, bottom: 'calc(100% + 10px)', minWidth: 232, padding: 12, borderRadius: 12, background: 'var(--dsw-alias-bg-overlay)', border: '1px solid var(--dsw-alias-border-l1)', boxShadow: '0 8px 28px rgba(0,0,0,0.22)', color: 'var(--dsw-alias-label-primary)', fontSize: 12 }
var panelTitleStyle = { fontWeight: 600, margin: '0 0 10px', fontSize: 13 }
var rowStyle = { display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0' }
var rowLabelStyle = { width: 44, flex: 'none', color: 'var(--dsw-alias-label-secondary)' }
var barStyle = { flex: 1, height: 6, borderRadius: 3, background: 'var(--dsw-alias-border-l1)', overflow: 'hidden' }
var barFillStyle = { display: 'block', height: '100%', borderRadius: 3, transition: 'width 0.2s ease' }
var rowPctStyle = { width: 36, textAlign: 'right', flex: 'none', fontVariantNumeric: 'tabular-nums' }
var rowResetStyle = { color: 'var(--dsw-alias-label-secondary)', fontSize: 11 }
var noteStyle = { color: 'var(--dsw-alias-label-secondary)', fontSize: 11, marginTop: 6 }

function PlanUsageBadge(props) {
  // 配置开关：关闭时整颗角标隐藏。
  var settingsSnap = React.useSyncExternalStore(props.settings.subscribe, props.settings.getSnapshot)
  var enabled = !settingsSnap || settingsSnap.enabled !== false

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
  }, [enabled])

  if (enabled === false || (state && state.error === 'disabled')) return null

  var data = state && state.ok ? state.data : null
  var dotColor = 'var(--dsw-alias-label-secondary)'
  var text = '…'
  var pillTitle = PLAN_USAGE_NAME
  if (state && state.loading) {
    text = '…'
  } else if (data) {
    var worst = -1
    var parts = []
    var labeled = []
    for (var i = 0; i < WINDOWS.length; i++) {
      var w = WINDOWS[i]
      var v = data[w.key]
      if (v && typeof v.percent === 'number') {
        if (v.percent > worst) worst = v.percent
        parts.push(v.percent + '%')
        labeled.push(w.label + ' ' + v.percent + '%')
      }
    }
    if (parts.length === 0) {
      text = '—'
    } else {
      dotColor = toneColor(worst)
      text = parts.join(' ')
      pillTitle = labeled.join(' ')
    }
  } else if (state && state.error === 'no-key') {
    text = '请设置 Key'
    pillTitle = state.message || '未配置 OpenCode Go API Key'
  } else {
    text = '获取失败'
    pillTitle = state.message || '获取失败'
  }

  var pill = h('button', { style: pillStyle, type: 'button', onClick: function () { setOpen(!open) }, title: pillTitle },
    h('span', { style: Object.assign({}, dotStyle, { background: dotColor }) }),
    h('span', { style: labelStyle }, CURRENT_PLAN.name),
    h('span', { style: valueStyle }, text),
  )

  var panel = null
  if (open) {
    var rows = data ? WINDOWS.map(function (w) {
      var v = data[w.key]
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
    }) : null
    var note = !data
      ? h('div', { style: noteStyle }, (state && state.message) || '无法获取用量')
      : (data.useBalance ? h('div', { style: noteStyle }, '超出限额后将使用 Zen 余额') : null)
    panel = h('div', { style: panelStyle },
      h('div', { style: panelTitleStyle }, PLAN_USAGE_NAME),
      rows,
      note,
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
 * 维护分阶段草稿（保存才写入）。同时为角标提供 `enabled` 快照。
 */
function PlanUsageController(ctx) {
  var listeners = new Set()
  var snapshot = {
    available: false, writable: true,
    enabled: true, apiKeyConfigured: false,
    apiKeyDraft: '', apiKeyClear: false,
    dirty: false, saving: false, failed: false,
  }

  var loaded = false
  var enabled = true
  var writable = true
  var apiKeyConfigured = false
  var enabledDraft = undefined
  var apiKeyDraft = ''
  var apiKeyClear = false
  var saving = false
  var failed = false

  function applyData(data) {
    if (!data) return
    enabled = data.enabled !== false
    writable = data.writable !== false
    apiKeyConfigured = data.apiKeyConfigured === true
    loaded = true
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
    var checked = enabledDraft !== undefined ? enabledDraft : enabled
    var dirty = enabledDraft !== undefined || apiKeyClear || apiKeyDraft.trim() !== ''
    return {
      available: loaded,
      writable: writable,
      enabled: checked,
      apiKeyConfigured: apiKeyConfigured,
      apiKeyDraft: apiKeyDraft,
      apiKeyClear: apiKeyClear,
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
    if (apiKeyClear) payload.clearKey = true
    else {
      var key = apiKeyDraft.trim()
      if (key !== '') payload.apiKey = key
    }
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
        apiKeyDraft = ''
        apiKeyClear = false
        saving = false
        failed = !(result && result.ok)
        if (result && result.ok) applyData(result.data)
        publish()
      })
      .catch(function () {
        enabledDraft = undefined
        apiKeyDraft = ''
        apiKeyClear = false
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
    setApiKey: function (text) { apiKeyDraft = text; apiKeyClear = false; failed = false; publish() },
    clearApiKey: function () { apiKeyClear = true; apiKeyDraft = ''; failed = false; publish() },
    discard: function () {
      enabledDraft = undefined
      apiKeyDraft = ''
      apiKeyClear = false
      failed = false
      publish()
    },
    save: save,
  }
}

/**
 * 配置卡片：结构与交互逐项复刻 harness 的 PluginCard——
 * 头部按钮折叠/展开（chevron 旋转、aria-expanded），未保存徽标，只读提示，
 * 底部「放弃修改 / 保存 / 保存中…」按钮及失败提示；按钮与字段配色、字号、
 * 圆角均取同一套 dsw 令牌。
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
        h('span', { style: descriptionStyle }, '在 Web 对话框右下角显示套餐用量角标。'),
      ),
      dirty ? h('span', { style: pendingStyle }, '未保存') : null,
      h('span', { style: open ? chevronOpenStyle : chevronStyle }, h(P.IconChevronDownOutline14, { size: 14 })),
    ),
    open
      ? h('div', { style: bodyStyle },
        !snap.writable ? h('p', { style: readOnlyStyle, role: 'status' }, '本部署的设置为只读。') : null,
        // 当前仅接入 OpenCode Go 一个套餐：开关与 API Key 都是该套餐专属的，
        // 因此标注套餐名。后续支持多个套餐时，这里将按套餐拆成多个区块，
        // 每个套餐对应自己的开关与 API Key 配置项。
        h('div', { style: fieldStyle },
          h('label', { style: checkboxRowStyle },
            h('input', {
              type: 'checkbox',
              checked: snap.enabled,
              disabled: disabled,
              onChange: function (e) { c.setEnabled(e.target.checked) },
            }),
            h('span', { style: fieldLabelStyle }, '启用 OpenCode Go 用量角标'),
          ),
          h('p', { style: hintStyle }, '关闭后右下角角标不再显示。'),
        ),
        snap.enabled
          ? h('div', { style: fieldSplitStyle },
            h('div', { style: fieldHeadStyle },
              h('label', { style: fieldLabelStyle, htmlFor: 'plan-usage-api-key' }, 'OpenCode Go API Key（可选）'),
              h('span', { style: badgesStyle },
                h('span', { style: snap.apiKeyConfigured ? badgeStyle : badgeMutedStyle }, snap.apiKeyConfigured ? '已配置' : '未配置'),
                snap.apiKeyConfigured
                  ? h('button', { type: 'button', style: resetStyle, className: 'dsh-plan-usage-reset', disabled: disabled, onClick: function () { c.clearApiKey() } }, '清除')
                  : null,
              ),
            ),
            h('input', {
              id: 'plan-usage-api-key',
              type: 'password',
              autoComplete: 'off',
              style: inputStyle,
              className: 'dsh-plan-usage-input',
              value: snap.apiKeyDraft,
              placeholder: '留空则使用「设置 → 模型」中的 opencode-go API Key',
              disabled: disabled,
              onChange: function (e) { c.setApiKey(e.target.value) },
            }),
            h('p', { style: hintStyle }, '此处填写的 Key 优先级高于「设置 → 模型」中的 opencode-go Key；两边都未设置时，角标会提示配置。'),
          )
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
