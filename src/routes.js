/** The browser-facing HTTP surface for the settings page. */
import { ApiError } from './api.js'
import { briefOf } from './profile.js'

export const ROUTE_PREFIX = '/dsh-bangumi'

const EDITABLE = new Set([
  'apiBase', 'userAgent', 'proxy',
  'includeNsfw', 'includePrivate', 'includeComments',
  'allowWrite', 'syncIntervalHours', 'cacheSubjectTtlDays',
])

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  })
  res.end(body)
}

function isLoopback(req) {
  const address = req.socket?.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address.startsWith('127.') || address === '::ffff:127.0.0.1'
}

function sameOrigin(req) {
  const origin = req.headers?.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 64 * 1024) return null
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function describeError(error) {
  if (error instanceof ApiError) {
    return { code: error.code, message: error.message, hint: error.hint }
  }
  const message = error instanceof Error ? error.message : String(error)
  if (message === 'TOKEN_EXPIRED') return { code: 'TOKEN_EXPIRED', message: '令牌已过期，请重新登录' }
  return { code: 'ERROR', message }
}

function statusFor(code) {
  if (code === 'UNAUTHORIZED' || code === 'TOKEN_EXPIRED') return 401
  if (code === 'FORBIDDEN') return 403
  if (code === 'NOT_FOUND') return 404
  if (code === 'BAD_ARGS' || code === 'BAD_BODY' || code === 'NOT_SYNCED') return 400
  return 500
}

export function createRoutes({ grant, store, sync, config, getProfile, getProxyInfo, saveConfig, api }) {
  async function statePayload() {
    const [snapshot, meta, stats] = await Promise.all([grant.snapshot(), store.readMeta(), store.stats()])
    const profile = getProfile()
    const expiresAt = snapshot.expiresAt || null
    return {
      signedIn: snapshot.signedIn,
      method: snapshot.method || null,
      username: snapshot.username || meta?.username || null,
      nickname: snapshot.nickname || meta?.nickname || null,
      avatar: snapshot.avatar || null,
      expiresAt,
      expired: Boolean(expiresAt && expiresAt < Date.now()),
      hasRefresh: Boolean(snapshot.hasRefresh),
      lastSyncAt: meta?.lastSyncAt || null,
      counts: meta?.counts || null,
      profileVersion: profile?.version || meta?.profileVersion || null,
      profileBrief: profile ? briefOf(profile) : '',
      profileHasData: Boolean(profile?.counts?.total),
      sync: sync.snapshot(),
      proxy: getProxyInfo(),
      config,
      data: stats,
    }
  }

  async function exportPayload() {
    const [meta, profile] = await Promise.all([store.readMeta(), store.readProfile()])
    const collections = await store.readCollections()
    return {
      ok: true,
      exportedAt: new Date().toISOString(),
      meta,
      profile,
      collections: (collections || []).map((item) => ({
        subject_id: item.subject_id,
        subject_type: item.subject_type,
        type: item.type,
        rate: item.rate,
        ep_status: item.ep_status,
        updated_at: item.updated_at,
        comment: item.comment,
        private: item.private,
        name: item.subject?.name_cn || item.subject?.name,
      })),
    }
  }

  return async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const action = url.pathname.slice(ROUTE_PREFIX.length) || '/'

    // Reads are guarded exactly like writes: one asymmetry is one bug waiting.
    if (!isLoopback(req) || !sameOrigin(req)) {
      sendJson(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'loopback same-origin only' } })
      return
    }

    if (req.method === 'GET' && (action === '/' || action === '/state')) {
      sendJson(res, 200, await statePayload())
      return
    }
    if (req.method === 'GET' && action === '/export') {
      sendJson(res, 200, await exportPayload())
      return
    }

    if (req.method !== 'POST') {
      sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'unknown route' } })
      return
    }
    const body = await readBody(req)
    if (body === null) {
      sendJson(res, 400, { ok: false, error: { code: 'BAD_BODY', message: 'invalid JSON body' } })
      return
    }

    try {
      if (action === '/login') {
        const token = typeof body.token === 'string' ? body.token.trim() : ''
        if (!token) {
          sendJson(res, 400, { ok: false, error: { code: 'BAD_ARGS', message: '令牌不能为空' } })
          return
        }
        const me = await api.me(token)
        const grantPayload = {
          accessToken: token,
          method: 'pat',
          userId: me?.id,
          username: me?.username || String(me?.id || ''),
          nickname: me?.nickname,
          avatar: me?.avatar?.large || me?.avatar?.medium,
          savedAt: Date.now(),
        }
        await grant.save(grantPayload)
        // Kick off the first sync right away; the page polls /state for progress.
        void sync.run().catch(() => undefined)
        sendJson(res, 200, { ok: true, account: { username: grantPayload.username, nickname: grantPayload.nickname, avatar: grantPayload.avatar, id: grantPayload.userId } })
        return
      }

      if (action === '/logout') {
        await grant.clear()
        sendJson(res, 200, { ok: true })
        return
      }

      if (action === '/sync') {
        const snapshot = sync.snapshot()
        if (snapshot.running) {
          sendJson(res, 200, { ok: true, accepted: true, alreadyRunning: true })
          return
        }
        void sync.run().catch(() => undefined)
        sendJson(res, 200, { ok: true, accepted: true })
        return
      }

      if (action === '/rebuild') {
        const profile = await sync.rebuild()
        if (!profile) {
          sendJson(res, 400, { ok: false, error: { code: 'NOT_SYNCED', message: '还没有收藏缓存，请先同步' } })
          return
        }
        sendJson(res, 200, { ok: true, version: profile.version, brief: briefOf(profile) })
        return
      }

      if (action === '/settings') {
        const patch = {}
        for (const [key, value] of Object.entries(body)) {
          if (EDITABLE.has(key)) patch[key] = value
        }
        if (Object.keys(patch).length === 0) {
          sendJson(res, 400, { ok: false, error: { code: 'BAD_ARGS', message: '没有可保存的字段' } })
          return
        }
        const outcome = await saveConfig(patch)
        if (!outcome.ok) {
          sendJson(res, 400, { ok: false, error: { code: outcome.code, message: outcome.message } })
          return
        }
        sendJson(res, 200, { ok: true, restart: outcome.restart !== false })
        return
      }

      if (action === '/diagnose') {
        // A public endpoint proves the network path even before sign-in. A
        // failure is reported as a diagnosis, not as a thrown error, so the
        // page can show what is actually wrong.
        const started = Date.now()
        try {
          const days = await api.calendar(AbortSignal.timeout(8000))
          const result = {
            ok: true,
            latencyMs: Date.now() - started,
            proxy: getProxyInfo(),
            publicRead: Array.isArray(days) && days.length > 0,
            calendarDays: Array.isArray(days) ? days.length : 0,
          }
          const grantData = await grant.read()
          if (grantData?.accessToken) {
            try {
              const me = await api.me(grantData.accessToken)
              result.account = { username: me?.username, nickname: me?.nickname }
            } catch (error) {
              result.accountError = describeError(error)
            }
          }
          sendJson(res, 200, result)
        } catch (error) {
          sendJson(res, 200, {
            ok: true,
            latencyMs: Date.now() - started,
            proxy: getProxyInfo(),
            publicRead: false,
            error: describeError(error),
          })
        }
        return
      }

      if (action === '/export') {
        sendJson(res, 200, await exportPayload())
        return
      }

      if (action === '/clear') {
        await store.clearCache()
        sendJson(res, 200, { ok: true })
        return
      }

      if (action === '/purge') {
        await grant.clear()
        await store.removeAll()
        sendJson(res, 200, { ok: true })
        return
      }

      sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'unknown action' } })
    } catch (error) {
      const described = describeError(error)
      sendJson(res, statusFor(described.code), { ok: false, error: described })
    }
  }
}
