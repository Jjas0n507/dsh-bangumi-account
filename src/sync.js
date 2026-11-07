/** Collection sync and profile rebuild, with observable progress. */
import { buildProfile, creatorsFromSubject, profileVersion } from './profile.js'

const PAGE_SIZE = 50
const SUBJECT_TYPES = [2, 1, 4, 3, 6]

export function createSync({ api, store, grant, config }) {
  let state = {
    phase: 'idle',
    done: 0,
    total: 0,
    message: '',
    error: null,
    startedAt: null,
    finishedAt: null,
  }
  let running = null
  let profile = null

  function snapshot() {
    return { ...state, running: running !== null }
  }

  async function ensureToken() {
    const ticket = await grant.token()
    if (!ticket) {
      const error = new Error('NOT_SIGNED_IN')
      error.code = 'NOT_SIGNED_IN'
      throw error
    }
    return ticket
  }

  async function fetchAll(token, signal) {
    const username = await usernameOf(token)
    const items = []
    let expected = 0
    for (const subjectType of SUBJECT_TYPES) {
      let offset = 0
      for (;;) {
        const page = await api.collections(username, { subjectType, limit: PAGE_SIZE, offset, token, signal })
        const data = page?.data || []
        // The first page of a bucket reports its total; accumulate for a real progress bar.
        if (offset === 0 && Number(page?.total) > 0) {
          expected += Number(page.total)
          state.total = expected
        }
        items.push(...data)
        state.done = items.length
        if (data.length < PAGE_SIZE) break
        offset += PAGE_SIZE
        if (offset > 20000) break
      }
    }
    return { items }
  }

  let cachedUsername = null
  async function usernameOf(token) {
    if (cachedUsername) return cachedUsername
    const me = await api.me(token)
    cachedUsername = me?.username || String(me?.id || '')
    return cachedUsername
  }

  /**
   * Studios and authors for the highest-rated titles. Each subject detail is
   * cached for `cacheSubjectTtlDays`, so this costs requests only once per
   * title; failures are skipped rather than failing the whole sync.
   */
  async function enrichCreators(built, token, signal) {
    const targets = (built.samples?.topRated || []).slice(0, 8)
    if (targets.length === 0) return []
    const counts = new Map()
    for (const entry of targets) {
      let subject = null
      try {
        subject = await store.readFreshSubject(entry.id)
        if (!subject) {
          subject = await api.subject(entry.id, token, signal)
          if (subject) await store.saveSubject(entry.id, subject, config.cacheSubjectTtlDays)
        }
      } catch {
        subject = null // one title failing must not fail the sync
      }
      if (!subject) continue
      for (const creator of creatorsFromSubject(subject)) {
        const key = `${creator.role}｜${creator.name}`
        const current = counts.get(key) || { role: creator.role, name: creator.name, count: 0 }
        current.count += 1
        counts.set(key, current)
      }
    }
    return [...counts.values()]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'))
      .slice(0, 8)
  }

  async function run({ signal } = {}) {
    if (running) return running
    state = { phase: 'listing', done: 0, total: 0, message: '', error: null, startedAt: Date.now(), finishedAt: null }
    running = (async () => {
      try {
        const { token, grant: ticket } = await ensureToken()
        cachedUsername = ticket.username || (await usernameOf(token))
        const { items } = await fetchAll(token, signal)

        state.phase = 'profiling'
        await store.saveCollections(items)
        const built = buildProfile(items, {
          includePrivate: config.includePrivate,
          includeNsfw: config.includeNsfw,
          includeComments: config.includeComments,
        })
        built.creators = await enrichCreators(built, token, signal)
        built.version = profileVersion(built)
        profile = built
        await store.saveProfile(built)
        await store.saveMeta({
          username: cachedUsername,
          userId: ticket.userId,
          nickname: ticket.nickname,
          lastSyncAt: Date.now(),
          counts: built.counts,
          profileVersion: built.version,
        })
        state = { ...state, phase: 'idle', done: items.length, total: items.length, finishedAt: Date.now() }
        return { ok: true, items: items.length, version: built.version }
      } catch (error) {
        const code = error?.code || 'SYNC_FAILED'
        state = { ...state, phase: 'error', error: { code, message: error?.message || String(error) }, finishedAt: Date.now() }
        throw error
      } finally {
        running = null
      }
    })()
    return running
  }

  async function rebuild() {
    const items = await store.readCollections()
    if (!items) return null
    const built = buildProfile(items, {
      includePrivate: config.includePrivate,
      includeNsfw: config.includeNsfw,
      includeComments: config.includeComments,
    })
    const ticket = await grant.token().catch(() => null)
    if (ticket) {
      built.creators = await enrichCreators(built, ticket.token)
      built.version = profileVersion(built)
    }
    profile = built
    await store.saveProfile(built)
    return built
  }

  async function load() {
    profile = await store.readProfile()
    return profile
  }

  function current() {
    return profile
  }

  function set(value) {
    profile = value
  }

  return { run, rebuild, load, snapshot, current, set }
}
