/**
 * The Bangumi grant: access token (and refresh token for OAuth).
 *
 * Preferred home is the credential store, addressed as `<owner>/<id>`. A
 * plugin-private file under the cache directory is the fallback for profiles
 * without a credential service; it is written with owner-only permissions.
 */
export const RECORD_KEY = 'dsh-bangumi-account/grant'
const REFRESH_MARGIN_MS = 5 * 60 * 1000

export function createGrant({ ctx, store, http }) {
  const credentials = typeof ctx?.get === 'function' ? ctx.get('credentials') : ctx?.credentials

  async function read() {
    if (credentials) {
      try {
        const record = await credentials.readRecord(RECORD_KEY)
        if (record && record.payload) return record.payload
      } catch {
        /* fall through to the file */
      }
    }
    return store.readGrantFile()
  }

  async function save(grant) {
    if (credentials) {
      try {
        await credentials.modifyRecord(RECORD_KEY, async () => ({ kind: 'grant', payload: grant }))
        await store.removeGrantFile()
        return true
      } catch {
        /* fall through to the file */
      }
    }
    await store.saveGrantFile(grant)
    return false
  }

  async function clear() {
    if (credentials) {
      try { await credentials.deleteRecord(RECORD_KEY) } catch { /* already absent */ }
    }
    await store.removeGrantFile()
  }

  async function describe() {
    if (credentials) {
      try {
        const info = await credentials.describeRecord(RECORD_KEY)
        if (info?.configured) return { configured: true, writable: info.writable !== false, store: 'credentials' }
      } catch {
        /* fall through */
      }
    }
    const file = await store.readGrantFile()
    return { configured: Boolean(file?.accessToken), writable: true, store: 'file' }
  }

  async function refresh(grant) {
    if (!grant?.refreshToken || !grant.clientId) return null
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: grant.clientId,
      client_secret: grant.clientSecret || '',
      refresh_token: grant.refreshToken,
      redirect_uri: grant.redirectUri || '',
    })
    const response = await http.requestJson('https://bgm.tv/oauth/access_token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    }).catch((error) => {
      throw error
    })
    if (response.status < 200 || response.status >= 300 || !response.json?.access_token) return null
    const next = {
      ...grant,
      accessToken: response.json.access_token,
      refreshToken: response.json.refresh_token || grant.refreshToken,
      expiresAt: response.json.expires_in ? Date.now() + Number(response.json.expires_in) * 1000 : undefined,
      refreshedAt: Date.now(),
    }
    await save(next)
    return next
  }

  /** @returns {Promise<{token: string, grant: object}|null>} a usable token, refreshed when needed. */
  async function token() {
    const grant = await read()
    if (!grant?.accessToken) return null
    const expiring = grant.method === 'oauth' && grant.expiresAt && grant.expiresAt - REFRESH_MARGIN_MS < Date.now()
    if (expiring && grant.refreshToken) {
      const next = await refresh(grant).catch(() => null)
      if (next) return { token: next.accessToken, grant: next }
      throw new Error('TOKEN_EXPIRED')
    }
    return { token: grant.accessToken, grant }
  }

  /** Non-refreshing read for status display. */
  async function snapshot() {
    const grant = await read()
    if (!grant?.accessToken) return { signedIn: false }
    return {
      signedIn: true,
      method: grant.method || 'pat',
      username: grant.username,
      nickname: grant.nickname,
      userId: grant.userId,
      avatar: grant.avatar,
      expiresAt: grant.expiresAt,
      hasRefresh: Boolean(grant.refreshToken),
    }
  }

  return { read, save, clear, describe, token, snapshot }
}
