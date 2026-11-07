/**
 * Local smoke test: exercises the API client, calendar normalization, profile
 * math, and the recommendation candidate pipeline without the harness.
 *
 * Run: HTTPS_PROXY=... node scripts/smoke.mjs
 */
import { createHttpClient } from '../src/http.js'
import { createApi } from '../src/api.js'
import { buildProfile, briefOf } from '../src/profile.js'
import { recommend } from '../src/recommend.js'

const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || ''
const http = createHttpClient({ userAgent: 'dsh-bangumi-account/0.1.0 (smoke)', proxy })
const api = createApi({ http, apiBase: 'https://api.bgm.tv' })
const config = { includeNsfw: false, includePrivate: false, includeComments: true }

function fakeCollection(id, overrides = {}) {
  return {
    subject_id: id,
    subject_type: 2,
    rate: 8,
    type: 2,
    ep_status: 12,
    updated_at: new Date().toISOString(),
    private: false,
    subject: {
      id,
      name: `subject-${id}`,
      name_cn: `作品${id}`,
      date: '2018-04-01',
      score: 7.8,
      eps: 12,
      collection_total: 5000,
      tags: [{ name: '科幻' }, { name: '原创' }],
    },
    ...overrides,
  }
}

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else { failures += 1; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}

const days = await api.calendar()
check('calendar returns days array', Array.isArray(days) && days.length > 0, JSON.stringify(days).slice(0, 120))
check('calendar day has weekday id', Number.isFinite(days[0]?.weekday?.id), JSON.stringify(days[0]?.weekday))
check('calendar day has anime items', (days[0]?.items || []).some((item) => item.type === 2))

const search = await api.search({ kind: 'subjects', keyword: '凉宫春日', sort: 'match', limit: 3, filter: { nsfw: false } })
check('search returns results', Array.isArray(search?.data) && search.data.length > 0, JSON.stringify(search).slice(0, 160))
const found = search?.data?.[0]
check('search result has rating score', typeof found?.rating?.score === 'number', JSON.stringify(found?.rating))

const subject = await api.subject(found?.id ?? 2)
check('subject has name', Boolean(subject?.name), JSON.stringify(subject).slice(0, 120))
check('subject has rating rank', typeof subject?.rating?.rank === 'number')

const collections = [
  fakeCollection(1, { rate: 9, type: 2 }),
  fakeCollection(2, { rate: 8, type: 3, ep_status: 6 }),
  fakeCollection(3, { rate: 2, type: 5, subject: { ...fakeCollection(3).subject, tags: [{ name: '后宫' }, { name: '慢热' }], score: 7.1 } }),
  fakeCollection(4, { rate: 0, type: 1, subject: { ...fakeCollection(4).subject, collection_total: 200 } }),
  fakeCollection(5, { rate: 10, type: 2, subject: { ...fakeCollection(5).subject, score: 6.2, tags: [{ name: '科幻' }, { name: '机战' }] } }),
]
const profile = buildProfile(collections, config)
check('profile counts total', profile.counts.total === 5, String(profile.counts.total))
check('profile counts by status', profile.counts.byStatus.done === 2 && profile.counts.byStatus.dropped === 1, JSON.stringify(profile.counts.byStatus))
check('profile rates mean', Math.abs(profile.rating.mean - 7.25) < 0.01, String(profile.rating.mean))
check('profile lenient vs crowd', profile.rating.strictness === 'lenient', profile.rating.strictness)
check('profile positive tags', profile.tags.positive.some((tag) => tag.name === '科幻'), JSON.stringify(profile.tags.positive))
check('profile negative tags exclude positives', profile.tags.negative.every((tag) => tag.name !== '科幻'), JSON.stringify(profile.tags.negative))

const brief = briefOf(profile)
check('brief under 400 chars', brief.length > 0 && brief.length <= 400, String(brief.length))
check('brief mentions counts', brief.includes('5 部'), brief)

const rec = await recommend({ api, profile, collections, token: undefined, config, count: 3 })
check('recommend returns candidates', Array.isArray(rec.candidates), JSON.stringify(rec).slice(0, 160))
check('recommend excludes owned ids', !rec.candidates.some((c) => c.id >= 1 && c.id <= 5), JSON.stringify(rec.candidates.map((c) => c.id)))
check('recommend has reasons', rec.candidates.every((c) => Array.isArray(c.reasons) && c.reasons.length > 0))

http.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
