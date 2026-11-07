/** Plugin configuration: defaults plus a defensive normalizer. */

export const DEFAULT_CONFIG = {
  apiBase: 'https://api.bgm.tv',
  userAgent: 'dsh-bangumi-account/0.1.0 (https://github.com/dsh-local/dsh-bangumi-account)',
  proxy: '',
  includeNsfw: false,
  includePrivate: false,
  includeComments: true,
  allowWrite: false,
  syncIntervalHours: 6,
  cacheSubjectTtlDays: 7,
  requestIntervalMs: 300,
}

function bool(value, fallback) {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

function num(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

/** Normalize the row config, falling back to defaults for absent or invalid fields. */
export function resolveConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const apiBase = typeof source.apiBase === 'string' && source.apiBase.trim()
    ? source.apiBase.trim().replace(/\/+$/, '')
    : DEFAULT_CONFIG.apiBase
  const userAgent = typeof source.userAgent === 'string' && source.userAgent.trim()
    ? source.userAgent.trim()
    : DEFAULT_CONFIG.userAgent
  return {
    apiBase,
    userAgent,
    proxy: typeof source.proxy === 'string' ? source.proxy.trim() : '',
    includeNsfw: bool(source.includeNsfw, DEFAULT_CONFIG.includeNsfw),
    includePrivate: bool(source.includePrivate, DEFAULT_CONFIG.includePrivate),
    includeComments: bool(source.includeComments, DEFAULT_CONFIG.includeComments),
    allowWrite: bool(source.allowWrite, DEFAULT_CONFIG.allowWrite),
    syncIntervalHours: num(source.syncIntervalHours, DEFAULT_CONFIG.syncIntervalHours, 0, 720),
    cacheSubjectTtlDays: num(source.cacheSubjectTtlDays, DEFAULT_CONFIG.cacheSubjectTtlDays, 0, 90),
    requestIntervalMs: num(source.requestIntervalMs, DEFAULT_CONFIG.requestIntervalMs, 0, 5000),
  }
}
