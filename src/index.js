/** Host entry: wires config, storage, grant, API, sync, tools, and routes. */
import { resolveConfig } from './config.js'
import { createStore } from './store.js'
import { createGrant } from './grant.js'
import { createHttpClient, resolveProxy } from './http.js'
import { createApi } from './api.js'
import { createSync } from './sync.js'
import { TOOL_FACTORIES } from './tools.js'
import { sanitize } from './sanitize.js'
import { createRoutes, ROUTE_PREFIX } from './routes.js'

export const name = 'dsh-bangumi-account'
export const inject = ['tools', 'webServer']

export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)
  const store = createStore()

  let httpClient = null
  let proxyInfo = { proxy: '', source: 'unresolved' }
  const ensureHttp = async () => {
    if (!httpClient) {
      const resolved = await resolveProxy(config.proxy)
      proxyInfo = { proxy: resolved.proxy, source: resolved.source }
      httpClient = createHttpClient({ userAgent: config.userAgent, proxy: resolved.proxy })
    }
    return httpClient
  }
  const http = { requestJson: async (...args) => (await ensureHttp()).requestJson(...args) }
  const api = createApi({ http, apiBase: config.apiBase, requestIntervalMs: config.requestIntervalMs })
  const grant = createGrant({ ctx, store, http })
  const sync = createSync({ api, store, grant, config })

  const deps = {
    api,
    config,
    grant,
    store,
    sync,
    getProfile: () => sync.current(),
    getProxyInfo: () => proxyInfo,
  }

  for (const [toolName, factory] of Object.entries(TOOL_FACTORIES)) {
    // The write tool exists only when the owner turned it on.
    if (toolName === 'bangumi_update' && !config.allowWrite) continue
    const definition = factory(deps)
    const execute = definition.execute.bind(definition)
    definition.execute = async (args, exec) => sanitize(await execute(args, exec))
    ctx.effect(() => ctx.tools.register(definition))
  }

  async function saveConfig(patch) {
    const editor = typeof ctx.get === 'function' ? ctx.get('configEditor') : undefined
    const entry = ctx.fiber?.entry
    if (!editor || !entry) {
      return { ok: false, code: 'NO_EDITOR', message: '当前 profile 不支持保存配置，请直接编辑 cordis.patch.yml' }
    }
    try {
      await editor.edit(entry, (current) => ({ ...current, ...patch }))
      return { ok: true }
    } catch (error) {
      return { ok: false, code: 'SAVE_FAILED', message: error instanceof Error ? error.message : String(error) }
    }
  }

  const handler = createRoutes({ ...deps, saveConfig })
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler }))

  // Startup: load cached profile, resolve the proxy, catch up on a stale sync.
  ctx.effect(() => {
    let cancelled = false
    void (async () => {
      // Resolve the proxy up front so the settings page can show the network path
      // before the first API call.
      await ensureHttp().catch(() => null)
      await sync.load().catch(() => null)
      const meta = await store.readMeta().catch(() => null)
      const snapshot = await grant.snapshot().catch(() => ({ signedIn: false }))
      if (cancelled || !snapshot.signedIn) return
      if (!(config.syncIntervalHours > 0)) return
      const due = !meta?.lastSyncAt || Date.now() - meta.lastSyncAt > config.syncIntervalHours * 3600000
      if (!due) return
      // Run in the background; the settings page polls /state for progress.
      void sync.run().catch(() => undefined)
    })()
    return () => { cancelled = true }
  })

  ctx.effect(() => () => {
    try { httpClient?.close() } catch { /* already disposed */ }
  })
}
