/**
 * dsh-plan-usage 的浏览器半：在 shell.overlay 右下角渲染用量角标。
 *
 * 由 client-modules 注册表以「闭包工厂」形式提供给浏览器：React 通过加载器
 * 模块表（platform module）注入，其余全部本地内联。内联样式避免 CSS 构建。
 */
window.__ModuleLoader__.load({ id: 'dsh-plan-usage', factory: (require) => {
var module = { exports: {} }
var exports = module.exports
var React = require('react')
var h = React.createElement

var WINDOWS = [
  { key: 'rollingUsage', label: '5小时' },
  { key: 'weeklyUsage', label: '周限' },
  { key: 'monthlyUsage', label: '月限' },
]

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

function PlanUsageBadge() {
  var stateHook = React.useState({ loading: true })
  var state = stateHook[0]
  var setState = stateHook[1]
  var openHook = React.useState(false)
  var open = openHook[0]
  var setOpen = openHook[1]

  React.useEffect(function () {
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
  }, [])

  var data = state && state.ok ? state.data : null
  var dotColor = 'var(--dsw-alias-label-secondary)'
  var text = '…'
  var pillTitle = 'OpenCode Go 用量'
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
    text = '未配置 Key'
    pillTitle = state.message || '未配置 OpenCode Go API Key'
  } else {
    text = '获取失败'
    pillTitle = state.message || '获取失败'
  }

  var pill = h('button', { style: pillStyle, type: 'button', onClick: function () { setOpen(!open) }, title: pillTitle },
    h('span', { style: Object.assign({}, dotStyle, { background: dotColor }) }),
    h('span', { style: labelStyle }, 'OpenCode Go'),
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
      h('div', { style: panelTitleStyle }, 'OpenCode Go 用量'),
      rows,
      note,
    )
  }

  return h('div', { style: rootStyle }, pill, panel)
}

var inject = ['slots']

function apply(ctx) {
  ctx.slots.inject('shell.overlay', function () {
    return ctx.slots.register({ name: 'shell.overlay', id: 'plan-usage', order: 0 }, PlanUsageBadge)
  })
}

module.exports = { name: 'plan-usage', inject: inject, apply: apply }
return module.exports
} })
