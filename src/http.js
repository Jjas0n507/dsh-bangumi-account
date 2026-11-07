/**
 * Minimal HTTPS client with optional HTTP CONNECT proxy support.
 *
 * Node's global fetch never uses a system proxy, and a Windows desktop app
 * often has no HTTPS_PROXY in its environment, so the plugin brings its own
 * agent. Proxy resolution order: explicit config, environment, Windows
 * internet settings, then direct.
 */
import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'
import { execFile } from 'node:child_process'
import { URL } from 'node:url'

const MAX_BODY_BYTES = 4 * 1024 * 1024

class ProxyAgent extends https.Agent {
  constructor(proxyUrl) {
    super({ keepAlive: true, maxSockets: 4, timeout: 20000 })
    this.proxy = new URL(proxyUrl)
  }

  createConnection(options, callback) {
    const host = options.host
    const port = Number(options.port) || 443
    const headers = { host: `${host}:${port}` }
    if (this.proxy.username) {
      const credentials = `${decodeURIComponent(this.proxy.username)}:${decodeURIComponent(this.proxy.password)}`
      headers['proxy-authorization'] = `Basic ${Buffer.from(credentials).toString('base64')}`
    }
    let settled = false
    let guard = null
    const done = (error, socket) => {
      if (settled) {
        try { socket?.destroy() } catch { /* already gone */ }
        return
      }
      settled = true
      if (guard) clearTimeout(guard)
      callback(error, socket)
    }
    // A proxy can accept CONNECT and then never relay the TLS handshake. Without
    // this guard the agent waits forever, and the caller's abort cannot reach a
    // socket that has not been handed back yet.
    guard = setTimeout(() => {
      try { connect.destroy() } catch { /* already gone */ }
      try { secured?.destroy() } catch { /* already gone */ }
      done(new HttpError('proxy TLS handshake timed out', 'TIMEOUT'))
    }, 6000)
    if (guard.unref) guard.unref()

    const connect = http.request({
      host: this.proxy.hostname,
      port: Number(this.proxy.port || 80),
      method: 'CONNECT',
      path: `${host}:${port}`,
      headers,
      timeout: 15000,
    })
    let secured = null
    connect.once('connect', (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy()
        done(new Error(`proxy CONNECT failed with ${response.statusCode}`))
        return
      }
      secured = tls.connect({ socket, servername: options.servername || host })
      secured.once('error', (error) => done(error))
      secured.once('secureConnect', () => done(null, secured))
    })
    connect.once('error', (error) => done(error))
    connect.once('timeout', () => {
      connect.destroy(new Error('proxy CONNECT timed out'))
      done(new HttpError('proxy CONNECT timed out', 'TIMEOUT'))
    })
    connect.end()
  }
}

function normalizeProxy(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim().replace(/^["']|["']$/g, '')
  if (!trimmed) return ''
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed).toString().replace(/\/+$/, '')
    } catch {
      return ''
    }
  }
  try {
    return new URL(`http://${trimmed}`).toString().replace(/\/+$/, '')
  } catch {
    return ''
  }
}

function readRegistryProxy() {
  if (process.platform !== 'win32') return Promise.resolve('')
  const run = (name) => new Promise((resolve) => {
    execFile('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', name],
      { windowsHide: true, timeout: 2500 },
      (error, stdout) => resolve(error ? '' : String(stdout)))
  })
  return Promise.all([run('ProxyEnable'), run('ProxyServer')]).then(([enabled, server]) => {
    const isOn = /ProxyEnable\s+REG_DWORD\s+0x1/i.test(enabled)
    if (!isOn) return ''
    const match = /ProxyServer\s+REG_SZ\s+(.+)/i.exec(server)
    if (!match) return ''
    const value = match[1].trim()
    // "host:port" or per-protocol "http=host:port;https=host:port"
    if (value.includes('=')) {
      const parts = new Map(value.split(';').map((part) => {
        const [key, target] = part.split('=')
        return [String(key).trim().toLowerCase(), String(target || '').trim()]
      }))
      return normalizeProxy(parts.get('https') || parts.get('http') || '')
    }
    return normalizeProxy(value)
  }).catch(() => '')
}

let cachedAutoProxy

/** Resolve the proxy: explicit config wins, then environment, then system settings. */
export async function resolveProxy(configured) {
  const requested = typeof configured === 'string' ? configured.trim().toLowerCase() : ''
  // Escape hatch: "direct"/"off" forces a plain connection even when the
  // environment or registry advertises a proxy.
  if (requested === 'direct' || requested === 'off' || requested === 'none') {
    return { proxy: '', source: 'forced-direct' }
  }
  const explicit = normalizeProxy(configured)
  if (explicit) return { proxy: explicit, source: 'config' }
  const fromEnv = normalizeProxy(
    process.env.HTTPS_PROXY || process.env.https_proxy ||
    process.env.HTTP_PROXY || process.env.http_proxy ||
    process.env.ALL_PROXY || process.env.all_proxy || '',
  )
  if (fromEnv) return { proxy: fromEnv, source: 'env' }
  if (cachedAutoProxy === undefined) cachedAutoProxy = await readRegistryProxy()
  if (cachedAutoProxy) return { proxy: cachedAutoProxy, source: 'system' }
  return { proxy: '', source: 'direct' }
}

function readBody(response) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    response.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        response.destroy(new Error('response body too large'))
        return
      }
      chunks.push(chunk)
    })
    response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    response.on('error', reject)
  })
}

export class HttpError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'HttpError'
    this.code = code
  }
}

export function createHttpClient({ userAgent, proxy }) {
  const agent = proxy
    ? new ProxyAgent(proxy)
    : new https.Agent({ keepAlive: true, maxSockets: 4, timeout: 20000 })

  /**
   * Perform one request and return the raw response.
   * @returns {Promise<{status:number, headers:object, text:string}>}
   */
  async function request(url, options = {}) {
    const {
      method = 'GET',
      headers = {},
      body,
      token,
      signal,
      timeoutMs = 20000,
    } = options
    const target = new URL(url)
    const payload = body === undefined
      ? undefined
      : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
    const finalHeaders = {
      'user-agent': userAgent,
      accept: 'application/json',
      'accept-encoding': 'identity',
      ...headers,
    }
    if (payload !== undefined) {
      finalHeaders['content-type'] = finalHeaders['content-type'] || 'application/json'
      finalHeaders['content-length'] = String(payload.length)
    }
    if (token) finalHeaders.authorization = `Bearer ${token}`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
    if (timer.unref) timer.unref()
    const onAbort = () => controller.abort(signal.reason ?? new Error('aborted'))
    if (signal) {
      if (signal.aborted) controller.abort(signal.reason)
      else signal.addEventListener('abort', onAbort, { once: true })
    }

    try {
      const response = await new Promise((resolve, reject) => {
        const req = https.request({
          host: target.hostname,
          port: target.port ? Number(target.port) : 443,
          path: `${target.pathname}${target.search}`,
          method,
          headers: finalHeaders,
          agent,
        }, (res) => resolve(res))
        req.on('error', reject)
        req.on('abort', () => reject(new HttpError('request aborted', 'ABORTED')))
        controller.signal.addEventListener('abort', () => {
          req.destroy(new HttpError(controller.signal.reason?.message || 'timeout', 'TIMEOUT'))
        }, { once: true })
        if (payload !== undefined) req.write(payload)
        req.end()
      })
      const text = await readBody(response)
      return { status: response.statusCode || 0, headers: response.headers, text }
    } finally {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
    }
  }

  async function requestJson(url, options) {
    const result = await request(url, options)
    let json
    if (result.text) {
      try {
        json = JSON.parse(result.text)
      } catch {
        json = undefined
      }
    }
    return { ...result, json }
  }

  function close() {
    try { agent.destroy() } catch { /* already gone */ }
  }

  return { request, requestJson, close }
}
