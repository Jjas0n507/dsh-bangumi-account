/**
 * API-layer tests: request spacing and bounded retries.
 *
 * Run: node scripts/api-tests.mjs
 */
import { createApi, ApiError } from '../src/api.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else { failures += 1; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function stub(responses) {
  const calls = []
  return {
    calls,
    async requestJson(url, options) {
      calls.push({ url, method: (options?.method || 'GET').toUpperCase(), at: Date.now() })
      const next = responses[Math.min(calls.length - 1, responses.length - 1)]
      if (typeof next === 'function') return next(calls.length)
      return next
    },
  }
}

// ---------------------------------------------------------------- spacing
{
  const http = stub([{ status: 200, headers: {}, text: '{}', json: {} }])
  const api = createApi({ http, apiBase: 'https://example.test', requestIntervalMs: 60 })
  const started = Date.now()
  await Promise.all([api.calendar(), api.calendar(), api.calendar()])
  const gaps = http.calls.slice(1).map((call, index) => call.at - http.calls[index].at)
  const elapsed = Date.now() - started
  check('three calls are serialized with spacing', gaps.every((gap) => gap >= 45), JSON.stringify(gaps))
  check('spacing bounds total time', elapsed >= 100 && elapsed < 600, String(elapsed))
}

// ---------------------------------------------------------------- 429 retry
{
  const http = stub([
    { status: 429, headers: {}, text: '{}', json: {} },
    { status: 200, headers: {}, text: '{}', json: { calendar: [] } },
  ])
  const api = createApi({ http, apiBase: 'https://example.test', requestIntervalMs: 0 })
  const result = await api.calendar()
  check('429 is retried', http.calls.length === 2, String(http.calls.length))
  check('429 retry returns data', Array.isArray(result), JSON.stringify(result))
}

// ---------------------------------------------------------------- 5xx read retry
{
  const http = stub([{ status: 503, headers: {}, text: '{}', json: {} }])
  const api = createApi({ http, apiBase: 'https://example.test', requestIntervalMs: 0 })
  let caught
  try {
    await api.subject(1)
  } catch (error) {
    caught = error
  }
  check('GET retries 5xx three times', http.calls.length === 3, String(http.calls.length))
  check('GET 5xx maps to UPSTREAM', caught instanceof ApiError && caught.code === 'UPSTREAM', caught?.code)
}

// ---------------------------------------------------------------- write safety
{
  const http = stub([{ status: 500, headers: {}, text: '{}', json: {} }])
  const api = createApi({ http, apiBase: 'https://example.test', requestIntervalMs: 0 })
  await api.writeCollection({ subjectId: 1, patch: { rate: 9 } }).catch(() => undefined)
  check('POST 5xx is not retried (no double write)', http.calls.length === 1, String(http.calls.length))
}

// ---------------------------------------------------------------- network errors
{
  const http = {
    calls: 0,
    async requestJson() {
      this.calls += 1
      const error = new Error('socket hang up')
      error.code = 'ECONNRESET'
      throw error
    },
  }
  const api = createApi({ http, apiBase: 'https://example.test', requestIntervalMs: 0 })
  await api.subject(1).catch(() => undefined)
  check('GET retries a network failure', http.calls === 3, String(http.calls))

  const http2 = {
    calls: 0,
    async requestJson() {
      this.calls += 1
      const error = new Error('socket hang up')
      error.code = 'ECONNRESET'
      throw error
    },
  }
  const api2 = createApi({ http: http2, apiBase: 'https://example.test', requestIntervalMs: 0 })
  await api2.writeCollection({ subjectId: 1, patch: {} }).catch(() => undefined)
  check('POST does not retry a network failure', http2.calls === 1, String(http2.calls))
}

// ---------------------------------------------------------------- retry-after
{
  const http = stub([
    { status: 429, headers: { 'retry-after': '1' }, text: '{}', json: {} },
    { status: 200, headers: {}, text: '{}', json: {} },
  ])
  const api = createApi({ http, apiBase: 'https://example.test', requestIntervalMs: 0 })
  const started = Date.now()
  await api.calendar()
  const waited = Date.now() - started
  check('Retry-After is honored', waited >= 900 && waited < 2500, String(waited))
}

// ---------------------------------------------------------------- error mapping
{
  const http = stub([{ status: 404, headers: {}, text: '{}', json: { title: 'Not Found', description: 'not found' } }])
  const api = createApi({ http, apiBase: 'https://example.test', requestIntervalMs: 0 })
  let caught
  try {
    await api.subject(999)
  } catch (error) {
    caught = error
  }
  check('404 maps to NOT_FOUND', caught?.code === 'NOT_FOUND', caught?.code)
  check('404 message stays Chinese', caught?.message === '没有找到', caught?.message)
  check('404 keeps the remote text as a detail', caught?.remote === 'not found', caught?.remote)

  const allow = createApi({ http: stub([{ status: 404, headers: {}, text: '{}', json: {} }]), apiBase: 'https://example.test', requestIntervalMs: 0 })
  const nulled = await allow.myCollection({ subjectId: 999, username: 'x' })
  check('allow404 returns null instead of throwing', nulled === null, JSON.stringify(nulled))
}

// ---------------------------------------------------------------- TLS stall mapping
{
  const http = {
    async requestJson() {
      throw new Error('Client network socket disconnected before secure TLS connection was established')
    },
  }
  const api = createApi({ http, apiBase: 'https://example.test', requestIntervalMs: 0 })
  let caught
  try {
    await api.subject(1)
  } catch (error) {
    caught = error
  }
  check('TLS stall maps to NETWORK', caught?.code === 'NETWORK', caught?.code)
  check('TLS stall message is readable', caught?.message === '连不上 api.bgm.tv', caught?.message)
  check('TLS stall suggests an escape hatch', /代理/.test(caught?.hint || '') && /direct/.test(caught?.hint || ''), caught?.hint)
}

// ---------------------------------------------------------------- proxy escape hatch
{
  const { resolveProxy } = await import('../src/http.js')
  check('proxy "direct" forces a direct connection', (await resolveProxy('direct')).source === 'forced-direct')
  check('proxy "off" is also honoured', (await resolveProxy('OFF')).proxy === '')
  check('explicit proxy still wins', (await resolveProxy('127.0.0.1:7897')).proxy === 'http://127.0.0.1:7897')
}

// ---------------------------------------------------------------- timeout policy
{
  const http = {
    calls: 0,
    async requestJson() {
      this.calls += 1
      const error = new Error('timeout')
      error.name = 'HttpError'
      error.code = 'TIMEOUT'
      throw error
    },
  }
  const api = createApi({ http, apiBase: 'https://example.test', requestIntervalMs: 0 })
  const started = Date.now()
  await api.subject(1).catch(() => undefined)
  check('a timeout is not retried', http.calls === 1, String(http.calls))
  check('a timeout fails fast', Date.now() - started < 500, String(Date.now() - started))
}

await sleep(10)
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)