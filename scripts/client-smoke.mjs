/**
 * Render the settings section without a browser: a tiny React stub invokes
 * every function component in the tree, so a typo or bad hook call throws here
 * instead of blanking the real settings page.
 *
 * Run: node scripts/client-smoke.mjs
 */
const element = (type, props, ...children) => ({ type, props: { ...(props || {}), children } })
const stateQueue = []

const React = {
  createElement: element,
  Fragment: Symbol('Fragment'),
  useState(initial) {
    return stateQueue.length > 0 ? [stateQueue.shift(), () => {}] : [initial, () => {}]
  },
  useEffect() {},
  useCallback(fn) { return fn },
  useMemo(fn) { return fn() },
  useRef(value) { return { current: value } },
}

let registrations = []
const ctx = {
  locale: undefined,
  slots: {
    inject(_slot, factory) { factory() },
    register(options, Component) { registrations.push({ options, Component }) },
  },
}

globalThis.window = {
  __ModuleLoader__: { load(module) { globalThis.__loaded = module } },
  confirm: () => true,
  open: () => {},
}
Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true })
globalThis.document = { visibilityState: 'visible' }
globalThis.fetch = async () => ({ ok: true, json: async () => ({}) })

await import('../client/client.js')
const loaded = globalThis.__loaded
if (!loaded) throw new Error('client module did not call __ModuleLoader__.load')

const mod = loaded.factory((name) => {
  if (name === 'react') return React
  throw new Error('unexpected require: ' + name)
})
// Reading an uninjected service through the cordis context proxy throws
// ("cannot get property "locale" without inject") and fails the whole web
// boot, so the declared injection list is part of the contract.
for (const service of ['slots', 'locale']) {
  if (!Array.isArray(mod.inject) || !mod.inject.includes(service)) {
    throw new Error(`plugin must inject "${service}" (inject: ${JSON.stringify(mod.inject)})`)
  }
}
mod.apply(ctx)

if (registrations.length !== 1) throw new Error('expected one slot registration, got ' + registrations.length)
const { options, Component } = registrations[0]
if (options.id !== 'bangumi') throw new Error('unexpected section id: ' + options.id)
if (typeof options.label !== 'function' || !options.label()) throw new Error('label is not localized text')
console.log('ok   module loaded, section registered as', options.id, '->', options.label())

function renderTree(node, depth = 0) {
  if (node === null || node === undefined || node === false) return 0
  if (typeof node === 'string' || typeof node === 'number') return 1
  if (Array.isArray(node)) return node.reduce((count, child) => count + renderTree(child, depth), 0)
  if (typeof node.type === 'function') {
    return renderTree(node.type({ ...(node.props || {}) }), depth + 1)
  }
  if (node.type === React.Fragment) return renderTree(node.props.children, depth + 1)
  return 1 + renderTree(node.props && node.props.children, depth + 1)
}

function renderState(label, state, draft) {
  stateQueue.length = 0
  stateQueue.push(state)
  if (draft) {
    // state, error, notice, busy, token, showPreview, draft
    stateQueue.push('', '', '', '', false, draft)
  }
  const nodes = renderTree(React.createElement(Component, {}))
  console.log(`ok   ${label}: rendered ${nodes} nodes`)
  return nodes
}

const unsigned = renderState('signed-out view', null)
if (unsigned < 5) throw new Error('signed-out view rendered too little')

const signedState = {
  signedIn: true,
  method: 'pat',
  username: 'tester',
  nickname: '测试',
  avatar: null,
  lastSyncAt: Date.now() - 7200000,
  counts: { total: 412, byType: { anime: 301, book: 55, game: 40, music: 10, real: 6 } },
  profileVersion: 'abc123def456',
  profileBrief: '主人的 Bangumi：收藏 412 部；打分偏宽容；偏爱标签 科幻、原创。',
  profileHasData: true,
  sync: { phase: 'idle', running: false, done: 0, total: 0 },
  proxy: { proxy: 'http://127.0.0.1:7897', source: 'system' },
  config: {
    apiBase: 'https://api.bgm.tv',
    userAgent: 'ua/1.0',
    proxy: '',
    includeNsfw: false,
    includePrivate: false,
    includeComments: true,
    allowWrite: false,
    syncIntervalHours: 6,
  },
  data: { files: {} },
}
const signed = renderState('signed-in view', signedState, {
  includeNsfw: false, includePrivate: false, includeComments: true, allowWrite: false,
  apiBase: 'https://api.bgm.tv', userAgent: 'ua/1.0', proxy: '', syncIntervalHours: 6,
})
if (signed < 5) throw new Error('signed-in view rendered too little')

const failedState = {
  ...signedState,
  expired: true,
  sync: { phase: 'error', running: false, done: 0, total: 0, error: { code: 'TOKEN_EXPIRED', message: '令牌已过期' } },
}
const failed = renderState('sync-failure view', failedState, {
  includeNsfw: false, includePrivate: false, includeComments: true, allowWrite: false,
  apiBase: 'https://api.bgm.tv', userAgent: 'ua/1.0', proxy: '', syncIntervalHours: 6,
})
if (failed < 5) throw new Error('failure view rendered too little')

const runningState = {
  ...signedState,
  sync: { phase: 'listing', running: true, done: 120, total: 412 },
}
const running = renderState('syncing view', runningState, null)
if (running < 5) throw new Error('syncing view rendered too little')

console.log('\nALL PASS')
