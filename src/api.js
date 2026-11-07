/** Bangumi v0 API surface used by this plugin. */
import { HttpError } from './http.js'

export class ApiError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = details.status
    this.hint = details.hint
  }
}

const STATUS_CODES = {
  400: ['BAD_REQUEST', '请求参数不被接受'],
  401: ['UNAUTHORIZED', '令牌无效或已过期'],
  403: ['FORBIDDEN', '没有权限（可能缺少写权限）'],
  404: ['NOT_FOUND', '没有找到'],
  429: ['RATE_LIMITED', '请求太频繁'],
  500: ['UPSTREAM', 'Bangumi 服务端异常'],
  502: ['UPSTREAM', 'Bangumi 服务端异常'],
  503: ['UPSTREAM', 'Bangumi 服务端异常'],
  504: ['UPSTREAM', 'Bangumi 服务端超时'],
}

export function toApiError(error) {
  if (error instanceof ApiError) return error
  if (error instanceof HttpError) {
    if (error.code === 'TIMEOUT' || error.code === 'ABORTED') {
      return new ApiError('TIMEOUT', '请求超时', { hint: '网络较慢或代理不稳定，可以稍后重试' })
    }
    return new ApiError('NETWORK', error.message, { hint: networkHint() })
  }
  const message = error instanceof Error ? error.message : String(error)
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|socket hang up|proxy|TLS|socket disconnected|EPROTO|UND_ERR/i.test(message)) {
    return new ApiError('NETWORK', '连不上 api.bgm.tv', { hint: networkHint() })
  }
  return new ApiError('UNKNOWN', message)
}

function networkHint() {
  return '检查网络或代理：如果代理把 TLS 拦住了，可以在「设置 → Bangumi → 高级」把代理填成 direct 再试，或换一个代理节点'
}

function describe(status, body) {
  const [code, message] = STATUS_CODES[status] || ['HTTP_' + status, `Bangumi 返回 ${status}`]
  const error = new ApiError(code, message, { status })
  const remote = body?.description || body?.title
  if (remote) error.remote = String(remote).slice(0, 200)
  return error
}

export function createApi({ http, apiBase, requestIntervalMs = 300 }) {
  const gap = Math.min(Math.max(Number(requestIntervalMs) || 0, 0), 5000)
  let chain = Promise.resolve()
  let lastAt = 0

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  /** Serialize requests so the plugin never bursts past Bangumi's tolerance. */
  function limited(task) {
    const run = async () => {
      const wait = lastAt + gap - Date.now()
      if (wait > 0) await sleep(wait)
      lastAt = Date.now()
      return task()
    }
    const result = chain.then(run, run)
    chain = result.then(() => undefined, () => undefined)
    return result
  }

  function retryAfterMs(response) {
    const header = response.headers?.['retry-after']
    const seconds = Number(header)
    return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 10000) : 0
  }

  /**
   * One request with bounded retries: rate limits are always safe to retry
   * (the server applied nothing), while 5xx and network failures are retried
   * only for reads, so a write is never applied twice.
   */
  async function attemptRequest(url, options) {
    const method = (options.method || 'GET').toUpperCase()
    const isRead = method === 'GET' || method === 'HEAD'
    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await http.requestJson(url, options)
        // 429 means the server applied nothing, so any method may retry it.
        // 5xx is ambiguous for a write, so only reads retry.
        const retryStatus = response.status === 429 || (isRead && response.status >= 500)
        if (attempt < 2 && retryStatus) {
          const delay = retryAfterMs(response) || 250 * 2 ** attempt
          await sleep(delay)
          continue
        }
        return response
      } catch (error) {
        const cancelled = options.signal?.aborted === true
        // A timeout already consumed the whole budget: retrying it triples the
        // wait while the network stays down.
        const timedOut = error?.code === 'TIMEOUT'
        if (isRead && !cancelled && !timedOut && attempt < 2) {
          await sleep(250 * 2 ** attempt)
          continue
        }
        throw error
      }
    }
  }

  function url(path, query) {
    const target = new URL(apiBase + path)
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === '') continue
        if (Array.isArray(value)) {
          for (const item of value) target.searchParams.append(key, String(item))
        } else {
          target.searchParams.set(key, String(value))
        }
      }
    }
    return target.toString()
  }

  async function call(path, { method = 'GET', query, body, token, signal, allow404 = false } = {}) {
    let response
    try {
      response = await limited(() => attemptRequest(url(path, query), { method, body, token, signal }))
    } catch (error) {
      throw toApiError(error)
    }
    if (response.status >= 200 && response.status < 300) return response.json ?? null
    if (allow404 && response.status === 404) return null
    throw describe(response.status, response.json)
  }

  return {
    call,
    me: (token, signal) => call('/v0/me', { token, signal }),
    user: (username, token, signal) => call(`/v0/users/${encodeURIComponent(username)}`, { token, signal }),
    collections: (username, { subjectType, type, limit = 50, offset = 0, token, signal } = {}) =>
      call(`/v0/users/${encodeURIComponent(username)}/collections`, {
        query: { subject_type: subjectType, type, limit, offset }, token, signal,
      }),
    subject: (id, token, signal) => call(`/v0/subjects/${id}`, { token, signal }),
    subjectPersons: (id, token, signal) => call(`/v0/subjects/${id}/persons`, { token, signal }),
    subjectCharacters: (id, token, signal) => call(`/v0/subjects/${id}/characters`, { token, signal }),
    subjectRelations: (id, token, signal) => call(`/v0/subjects/${id}/subjects`, { token, signal }),
    episodes: ({ subjectId, type, limit = 100, offset = 0, token, signal } = {}) =>
      call('/v0/episodes', { query: { subject_id: subjectId, type, limit, offset }, token, signal }),
    episode: (id, token, signal) => call(`/v0/episodes/${id}`, { token, signal }),
    search: ({ kind, keyword, sort, filter, limit = 10, offset = 0, token, signal }) =>
      call(`/v0/search/${kind}`, {
        method: 'POST',
        body: { keyword, sort, filter },
        query: { limit, offset },
        token,
        signal,
      }),
    /**
     * The live server answers with an object keyed "0".."6" while the spec
     * documents `{ calendar: [...] }`; normalize both to an array of days.
     */
    calendar: async (signal) => {
      const raw = await call('/calendar', { signal })
      if (!raw) return []
      if (Array.isArray(raw.calendar)) return raw.calendar
      return Object.keys(raw)
        .filter((key) => /^\d+$/.test(key))
        .sort((a, b) => Number(a) - Number(b))
        .map((key) => raw[key])
        .filter((day) => day && Array.isArray(day.items))
    },
    myEpisodes: ({ subjectId, limit = 100, offset = 0, token, signal }) =>
      call(`/v0/users/-/collections/${subjectId}/episodes`, { query: { limit, offset }, token, signal }),
    myCollection: ({ subjectId, username, token, signal }) =>
      call(`/v0/users/${encodeURIComponent(username)}/collections/${subjectId}`, { token, signal, allow404: true }),
    writeCollection: ({ subjectId, patch, token, signal, method = 'PATCH' }) =>
      call(`/v0/users/-/collections/${subjectId}`, { method, body: patch, token, signal }),
    writeEpisode: ({ episodeId, type, token, signal }) =>
      call(`/v0/users/-/collections/-/episodes/${episodeId}`, { method: 'PUT', body: { type }, token, signal }),
  }
}
