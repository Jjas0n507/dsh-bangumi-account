/**
 * Integration test against real Bangumi data: reads a public user's collection
 * pages (no token needed), builds a profile, and runs the read-only tools.
 *
 * Run: HTTPS_PROXY=... node scripts/live-test.mjs
 */
import { createHttpClient } from '../src/http.js'
import { createApi } from '../src/api.js'
import { buildProfile, briefOf } from '../src/profile.js'
import { TOOL_FACTORIES } from '../src/tools.js'
import { sanitize } from '../src/sanitize.js'

const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || ''
const http = createHttpClient({ userAgent: 'dsh-bangumi-account/0.1.0 (live-test)', proxy })
const api = createApi({ http, apiBase: 'https://api.bgm.tv' })
const config = { includeNsfw: false, includePrivate: false, includeComments: true }

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else { failures += 1; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}

const CANDIDATES = ['sai', 'trim21', 'lain', 'sorata']

async function fetchPublicCollections() {
  for (const username of CANDIDATES) {
    try {
      const first = await api.collections(username, { limit: 50, offset: 0 })
      if (!first || !(first.total > 0)) continue
      const items = [...(first.data || [])]
      const cap = Math.min(first.total, 200)
      let offset = 50
      while (items.length < cap) {
        const page = await api.collections(username, { limit: 50, offset })
        const data = page?.data || []
        if (data.length === 0) break
        items.push(...data)
        offset += 50
      }
      return { username, total: first.total, items }
    } catch (error) {
      console.log(`  (skipped ${username}: ${error.message})`)
    }
  }
  return null
}

const source = await fetchPublicCollections()
check('found a public user with collections', Boolean(source), 'tried: ' + CANDIDATES.join(', '))
if (!source) {
  console.log('\nNo public collection found; aborting.')
  process.exit(1)
}
console.log(`  source: ${source.username} — reported total ${source.total}, fetched ${source.items.length}`)

// Real payload shape
const sample = source.items[0]
check('collection item has subject_id', Number.isFinite(sample.subject_id), JSON.stringify(sample).slice(0, 120))
check('collection item embeds subject', Boolean(sample.subject), JSON.stringify(sample).slice(0, 160))
check('subject carries tags array', Array.isArray(sample.subject?.tags), typeof sample.subject?.tags)
check('subject carries score', typeof sample.subject?.score === 'number' || sample.subject?.score === undefined)
check('rate is number or absent', sample.rate === undefined || typeof sample.rate === 'number', String(sample.rate))

const started = Date.now()
const profile = buildProfile(source.items, config)
const elapsed = Date.now() - started
console.log(`  profile built in ${elapsed}ms from ${source.items.length} items`)

check('profile total matches fetched', profile.counts.total === source.items.length, `${profile.counts.total} vs ${source.items.length}`)
check('profile has positive tags', profile.tags.positive.length > 0, JSON.stringify(profile.tags.positive).slice(0, 160))
const distributionSum = Object.values(profile.rating.distribution).reduce((sum, value) => sum + value, 0)
check('rating distribution sums to rated count', distributionSum === profile.rating.ratedCount, `${distributionSum} vs ${profile.rating.ratedCount}`)
check('brief within budget', briefOf(profile).length > 0 && briefOf(profile).length <= 400, String(briefOf(profile).length))
check('strictness decided', ['lenient', 'strict', 'neutral', 'unknown'].includes(profile.rating.strictness), profile.rating.strictness)
check('recent arrays are arrays', Array.isArray(profile.recent.doing) && Array.isArray(profile.recent.done))
check('version is stable for identical input', buildProfile(source.items, config).version === profile.version)
console.log('\n  brief:', briefOf(profile))
console.log('  top tags:', profile.tags.positive.slice(0, 6).map((t) => `${t.name}(${t.weight})`).join(', '))
console.log('  eras:', JSON.stringify(profile.eras))

// Tool layer over real data
const deps = {
  api,
  config,
  grant: {
    async token() { return { token: undefined, grant: { username: source.username } } },
    async snapshot() { return { signedIn: true } },
  },
  store: {
    async readCollections() { return source.items },
    async readProfile() { return profile },
    async readFreshSubject() { return null },
  },
  sync: { current: () => profile, async load() { return profile }, snapshot() { return {} } },
}

const call = async (name, args = {}) => {
  const definition = TOOL_FACTORIES[name](deps)
  const value = sanitize(await definition.execute(args, {}))
  const rendered = definition.output.render(args, value)
  return { value, text: rendered[0].text }
}

{
  const { value, text } = await call('bangumi_my_list', { status: 'doing', limit: 5 })
  check('my_list(doing) ok on real data', value.ok === true, JSON.stringify(value).slice(0, 160))
  check('my_list renders rows', text.length > 10, text.slice(0, 120))
  const { value: top } = await call('bangumi_my_list', { sort: 'rate', limit: 3 })
  check('my_list sort=rate returns max first', !top.items.length || top.items.every((item) => item.rate >= 0), JSON.stringify(top.items))
}

{
  const { value, text } = await call('bangumi_taste', { focus: 'rating' })
  check('taste(rating) ok on real data', value.ok === true, JSON.stringify(value).slice(0, 120))
  check('taste render mentions distribution', text.includes('评分分布'), text.slice(0, 120))
}

{
  const { value } = await call('bangumi_recommend', { count: 3 })
  check('recommend ok on real data', value.ok === true, JSON.stringify(value).slice(0, 200))
  if (value.ok) {
    check('recommend returned candidates', value.candidates.length > 0, String(value.candidates.length))
    check('recommend excludes owned subjects', !value.candidates.some((c) => source.items.some((item) => item.subject_id === c.id)))
    for (const candidate of value.candidates) {
      console.log(`  · ${candidate.title} (${candidate.score ?? '—'}) — ${candidate.reasons.join('；')}`)
    }
  }
}

http.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
