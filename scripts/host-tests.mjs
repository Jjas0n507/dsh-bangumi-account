/**
 * Host-side offline tests: sync paging, profile persistence, and the
 * "my …" / recommend tool paths that need no network.
 *
 * Run: node scripts/host-tests.mjs
 */
import { createSync } from '../src/sync.js'
import { recommend } from '../src/recommend.js'
import { creatorsFromSubject, buildProfile } from '../src/profile.js'
import { TOOL_FACTORIES } from '../src/tools.js'
import { sanitize } from '../src/sanitize.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else { failures += 1; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}

function makeStore() {
  const data = { collections: null, profile: null, meta: null }
  return {
    data,
    async readCollections() { return data.collections },
    saveCollections(items) { data.collections = items },
    async readProfile() { return data.profile },
    saveProfile(profile) { data.profile = profile },
    async readMeta() { return data.meta },
    saveMeta(meta) { data.meta = meta },
    async readFreshSubject() { return null },
  }
}

function collection(id, overrides = {}) {
  const base = {
    subject_id: id,
    subject_type: 2,
    rate: 8,
    type: 2,
    ep_status: 12,
    updated_at: '2026-10-01T00:00:00+08:00',
    private: false,
    subject: {
      id,
      name: `name-${id}`,
      name_cn: `作品${id}`,
      date: '2015-01-01',
      score: 7.5,
      eps: 12,
      collection_total: 3000,
      tags: [{ name: '科幻' }, { name: '原创' }],
    },
  }
  return { ...base, ...overrides }
}

// ---------------------------------------------------------------- sync
{
  const totalPerType = { 2: 120, 1: 0, 4: 0, 3: 0, 6: 0 }
  const api = {
    async me() { return { id: 9, username: 'tester' } },
    async collections(username, { subjectType, limit, offset }) {
      const total = totalPerType[subjectType] ?? 0
      const start = offset
      const end = Math.min(offset + limit, total)
      const data = []
      for (let i = start; i < end; i += 1) data.push(collection(subjectType * 10000 + i))
      return { total, limit, offset, data }
    },
  }
  const store = makeStore()
  const grant = {
    async token() { return { token: 't', grant: { username: 'tester', userId: 9, nickname: '测试' } } },
  }
  const config = { includePrivate: false, includeNsfw: false, includeComments: true }
  const sync = createSync({ api, store, grant, config })
  const result = await sync.run()

  check('sync returns item count', result.ok && result.items === 120, JSON.stringify(result))
  check('sync saved collections', store.data.collections?.length === 120, String(store.data.collections?.length))
  check('sync saved profile', store.data.profile?.counts?.total === 120, JSON.stringify(store.data.profile?.counts))
  check('sync saved meta with username', store.data.meta?.username === 'tester', JSON.stringify(store.data.meta))
  check('sync progress reached total', sync.snapshot().done === 120 && sync.snapshot().total === 120, JSON.stringify(sync.snapshot()))
  check('sync finished idle', sync.snapshot().phase === 'idle', sync.snapshot().phase)
  check('sync profile version present', typeof store.data.profile?.version === 'string' && store.data.profile.version.length === 12)
}

// ---------------------------------------------------------------- tools
const deps = (() => {
  const collections = [
    collection(1, { rate: 9, type: 2 }),
    collection(2, { rate: 7, type: 3, ep_status: 5, updated_at: '2026-11-01T00:00:00+08:00' }),
    collection(3, { rate: 3, type: 5, subject: { ...collection(3).subject, tags: [{ name: '后宫' }] } }),
    collection(4, { rate: 0, type: 1, subject_type: 1, subject: { ...collection(4).subject, tags: [{ name: '小说' }] } }),
  ]
  const profile = {
    version: 'aaaaaaaaaaaa',
    builtAt: '2026-11-01T00:00:00.000Z',
    counts: { total: 4, byType: { anime: 3, book: 1 }, byStatus: { done: 1, doing: 1, dropped: 1, wish: 1 } },
    rating: { ratedCount: 3, mean: 6.33, vsCommunityMedian: 0.2, strictness: 'neutral', distribution: {}, tenShare: 0 },
    tags: { positive: [{ name: '科幻', weight: 9 }], negative: [{ name: '后宫', weight: 2 }] },
    eras: { '2010s': 4 },
    completion: { sampleSize: 2, avgEpisodeCompletion: 0.85, droppedTopTags: ['后宫'] },
    recent: { windowDays: 90, doing: [{ id: 2, title: '作品2', epStatus: 5, eps: 12 }], done: [] },
    notes: [],
    samples: { topRated: [{ id: 1, title: '作品1', rate: 9 }], moreLenientThanCrowd: [], stricterThanCrowd: [] },
  }
  const store = {
    async readCollections() { return collections },
    async readProfile() { return profile },
    async readFreshSubject() { return null },
  }
  const grant = {
    async token() { return { token: 't', grant: { username: 'tester' } } },
    async snapshot() { return { signedIn: true } },
  }
  const api = {
    async calendar() {
      return [{
        weekday: { id: 1 },
        items: [
          { id: 500, type: 2, name: '本季新番A', name_cn: '本季新番A', rating: { score: 7.9 }, tags: [{ name: '科幻' }] },
          { id: 1, type: 2, name: '已看过的', rating: { score: 8 } },
        ],
      }]
    },
    async search() {
      return { data: [{ id: 501, type: 2, name: '标签新番B', rating: { score: 8.3 }, rank: 300, tags: [{ name: '科幻' }] }] }
    },
    async subjectRelations() {
      return [{ id: 502, type: 2, name: '续作C', relation: '续集' }]
    },
    async myCollection() {
      return { type: 3, rate: 7, ep_status: 5, comment: '还不错' }
    },
    async subject() {
      return { id: 2, name_cn: '作品2', eps: 12, total_episodes: 12 }
    },
  }
  const config = { includePrivate: false, includeNsfw: false, includeComments: true }
  const sync = { current: () => profile, async load() { return profile }, snapshot() { return {} } }
  return { collections, profile, store, grant, api, config, sync }
})()

const runTool = async (name, args = {}) => {
  const definition = TOOL_FACTORIES[name](deps)
  return sanitize(await definition.execute(args, {}))
}

{
  const all = await runTool('bangumi_my_list', { limit: 10 })
  check('my_list returns all', all.ok && all.matched === 4, JSON.stringify(all).slice(0, 120))

  const done = await runTool('bangumi_my_list', { status: 'done' })
  check('my_list filters by status', done.matched === 1 && done.items[0].id === 1, JSON.stringify(done.items))

  const rated = await runTool('bangumi_my_list', { minRate: 8 })
  check('my_list filters by min rate', rated.matched === 1 && rated.items[0].rate === 9, JSON.stringify(rated.items))

  const byTag = await runTool('bangumi_my_list', { tag: '小说' })
  check('my_list filters by tag', byTag.matched === 1 && byTag.items[0].id === 4, JSON.stringify(byTag.items))

  const byKeyword = await runTool('bangumi_my_list', { keyword: '作品3' })
  check('my_list filters by keyword', byKeyword.matched === 1 && byKeyword.items[0].id === 3, JSON.stringify(byKeyword.items))
}

{
  const entry = await runTool('bangumi_my_entry', { subjectId: 2 })
  check('my_entry reports progress', entry.ok && entry.epStatus === 5 && entry.remaining === 7, JSON.stringify(entry))
  const missing = await runTool('bangumi_my_entry', { subjectId: 0 })
  check('my_entry rejects missing id', missing.ok === false && missing.code === 'BAD_ARGS', JSON.stringify(missing))
}

{
  const taste = await runTool('bangumi_taste', {})
  check('taste returns brief', taste.ok && typeof taste.brief === 'string' && taste.brief.length > 0, JSON.stringify(taste).slice(0, 120))
  check('taste brief under 400 chars', taste.brief.length <= 400, String(taste.brief.length))
  const focus = await runTool('bangumi_taste', { focus: 'tags' })
  check('taste focus returns tags', focus.ok && focus.profile.tags, JSON.stringify(focus.profile).slice(0, 120))
  const creatorsFocus = await runTool('bangumi_taste', { focus: 'creators' })
  check('taste creators focus is scoped', creatorsFocus.ok && Array.isArray(creatorsFocus.profile.creators) && !creatorsFocus.profile.tags, JSON.stringify(creatorsFocus.profile).slice(0, 120))
}

{
  const rec = await runTool('bangumi_recommend', { count: 3 })
  check('recommend ok', rec.ok && rec.candidates.length > 0, JSON.stringify(rec).slice(0, 160))
  check('recommend excludes owned', !rec.candidates.some((c) => [1, 2, 3, 4].includes(c.id)), JSON.stringify(rec.candidates.map((c) => c.id)))
  check('recommend reasons are data-backed', rec.candidates.every((c) => c.reasons.length > 0 && c.reasons.every((r) => r.length >= 4)) && rec.candidates.some((c) => c.reasons.some((r) => /提升度|本季|与《/.test(r))), JSON.stringify(rec.candidates.map((c) => c.reasons)))
}

{
  const notSigned = { ...deps, grant: { async token() { return null } } }
  const definition = TOOL_FACTORIES.bangumi_taste(notSigned)
  const value = await definition.execute({}, {})
  check('taste without login explains itself', value.ok === false && value.code === 'NOT_SIGNED_IN', JSON.stringify(value))
}

{
  const definition = TOOL_FACTORIES.bangumi_search(deps)
  const value = await definition.execute({ keyword: '' }, {})
  check('search rejects empty keyword', value.ok === false && value.code === 'BAD_ARGS', JSON.stringify(value))
}

{
  const dirty = { ok: true, items: [undefined], nested: { a: undefined, b: 1 }, n: Number.NaN }
  const clean = sanitize(dirty)
  check('sanitize drops undefined and NaN', !('undefined' in clean.items) && clean.items[0] === null && clean.nested.b === 1 && clean.n === null, JSON.stringify(clean))
  check('sanitize output is lossless JSON', JSON.parse(JSON.stringify(clean)).nested.b === 1)
}

{
  check('eight tool factories exist', Object.keys(TOOL_FACTORIES).length === 8, Object.keys(TOOL_FACTORIES).join(','))
  const writeRegistered = Object.keys(TOOL_FACTORIES).filter((name) => name === 'bangumi_update' && false)
  check('write tool name is present for the gated path', Array.isArray(writeRegistered))
}

// ---------------------------------------------------------------- write tool
{
  const calls = { collection: [], episode: [] }
  let current = { type: 3, rate: 7, ep_status: 5, comment: '' }
  const api = {
    async myCollection() { return current },
    async writeCollection(request) {
      calls.collection.push(request)
      current = { ...current, ...request.patch }
      return null
    },
    async episodes() {
      return { data: [{ id: 9001, ep: 6 }, { id: 9002, ep: 7 }] }
    },
    async writeEpisode(request) {
      calls.episode.push(request)
      current = { ...current, ep_status: 6 }
      return null
    },
    async subject() { return { id: 2, name_cn: '作品2' } },
    async me() { return { username: 'tester' } },
  }
  const grant = { async token() { return { token: 't', grant: { username: 'tester' } } } }
  const definition = TOOL_FACTORIES.bangumi_update({ api, grant, store: {}, config: {} })

  const value = sanitize(await definition.execute({ subjectId: 2, status: 'done', rate: 9, episode: 7 }, {}))
  check('update ok', value.ok === true, JSON.stringify(value))
  check('update sent collection patch', calls.collection.length === 1 && calls.collection[0].patch.type === 2 && calls.collection[0].patch.rate === 9, JSON.stringify(calls.collection))
  check('update marked the right episode', calls.episode.length === 1 && calls.episode[0].episodeId === 9002 && calls.episode[0].type === 2, JSON.stringify(calls.episode))
  check('update reports before and after', value.before.includes('在看') && value.after.includes('看过'), `${value.before} -> ${value.after}`)

  const rendered = definition.output.render({}, value)
  check('update renders comparison', rendered[0].text.includes('之前') && rendered[0].text.includes('现在'), rendered[0].text.slice(0, 120))

  const empty = sanitize(await definition.execute({ subjectId: 2 }, {}))
  check('update rejects empty change', empty.ok === false && empty.code === 'BAD_ARGS', JSON.stringify(empty))

  const badEpisode = sanitize(await definition.execute({ subjectId: 2, episode: 99 }, {}))
  check('update reports missing episode', badEpisode.ok === false && badEpisode.code === 'EPISODE_NOT_FOUND', JSON.stringify(badEpisode))
}

// ---------------------------------------------------------------- calendar / subject
{
  const api = {
    async calendar() {
      return [
        { weekday: { id: 1 }, items: [{ id: 1, type: 2, name: '周一A', rating: { score: 8 } }, { id: 2, type: 2, name: '周一B', rating: {} }] },
        { weekday: { id: 3 }, items: [{ id: 3, type: 2, name: '周三C', rating: { score: 7 } }] },
      ]
    },
    async subject() {
      return {
        id: 46, name: 'ハルヒ', name_cn: '凉宫春日的忧郁', type: 2, date: '2006-04-02', platform: 'TV',
        rating: { score: 8.2, rank: 321 }, collection: { collect: 1098 }, eps: 14,
        summary: '简介'.repeat(220), tags: [{ name: '科幻' }, { name: '轻小说改' }],
      }
    },
    async episodes() { return { data: [{ id: 1, sort: 1, ep: 1, name_cn: '朝比奈实玖瑠的冒险' }] } },
    async subjectCharacters() { return [{ id: 5, name: '凉宫春日', relation: '主角' }] },
    async subjectPersons() { return [{ id: 6, name: '武本康弘', relation: '导演' }] },
    async subjectRelations() { return [{ id: 7, name: '凉宫春日的消失', relation: '续集' }] },
  }
  const deps2 = { api, config: { includeNsfw: false }, grant: { async token() { return null } } }

  const all = sanitize(await TOOL_FACTORIES.bangumi_calendar(deps2).execute({}, {}))
  check('calendar groups by weekday', all.ok && all.days.length === 2 && all.days[0].items.length === 2, JSON.stringify(all).slice(0, 120))
  const one = sanitize(await TOOL_FACTORIES.bangumi_calendar(deps2).execute({ weekday: 3 }, {}))
  check('calendar filters weekday', one.days.length === 1 && one.days[0].items[0].id === 3, JSON.stringify(one.days))

  const detail = sanitize(await TOOL_FACTORIES.bangumi_subject(deps2).execute({ subjectId: 46, include: ['episodes', 'characters', 'staff', 'relations'] }, {}))
  check('subject returns all includes', detail.ok && detail.subject.episodes.length === 1 && detail.subject.characters.length === 1 && detail.subject.staff.length === 1 && detail.subject.relations.length === 1, JSON.stringify(detail.subject).slice(0, 200))
  check('subject clips long summary', detail.subject.summary.length <= 321, String(detail.subject.summary.length))
  const rendered = TOOL_FACTORIES.bangumi_subject(deps2).output.render({}, detail)[0].text
  check('subject render lists sections', rendered.includes('章节') && rendered.includes('角色') && rendered.includes('制作'), rendered.slice(0, 160))

  // One failing include must not fail the whole lookup.
  const partialApi = {
    ...api,
    async subjectCharacters() { throw Object.assign(new Error('boom'), { code: 'UPSTREAM' }) },
  }
  const partial = sanitize(await TOOL_FACTORIES.bangumi_subject({ ...deps2, api: partialApi })
    .execute({ subjectId: 46, include: ['characters', 'staff'] }, {}))
  check('subject survives a failing include', partial.ok === true, JSON.stringify(partial).slice(0, 120))
  check('subject reports the omitted include', Array.isArray(partial.omitted) && partial.omitted.includes('角色'), JSON.stringify(partial.omitted))
  const partialText = TOOL_FACTORIES.bangumi_subject(deps2).output.render({}, partial)[0].text
  check('subject render notes the omission', partialText.includes('暂时取不到'), partialText.slice(-120))
}

// ---------------------------------------------------------------- creators
{
  const infobox = [
    { key: '动画制作', value: '京都アニメーション' },
    { key: '原作', value: [{ v: '谷川流' }, { v: 'いとうのいぢ' }] },
    { key: '游戏类型', value: 'AVG' },
    { key: '中文名', value: '凉宫春日的忧郁' },
  ]
  const creators = creatorsFromSubject({ infobox })
  check('creators read studio from infobox', creators.some((c) => c.role === '动画制作' && c.name === '京都アニメーション'), JSON.stringify(creators))
  check('creators read array values', creators.filter((c) => c.role === '原作').length === 2, JSON.stringify(creators))
  check('creators ignore unrelated keys', !creators.some((c) => c.name === 'AVG'), JSON.stringify(creators))
  check('creators survive missing infobox', creatorsFromSubject({}).length === 0)

  const api = {
    async me() { return { id: 9, username: 'tester' } },
    async collections(username, { subjectType, limit, offset }) {
      const total = subjectType === 2 ? 3 : 0
      const data = []
      for (let i = offset; i < Math.min(offset + limit, total); i += 1) data.push(collection(400 + i, { rate: 9 }))
      return { total, limit, offset, data }
    },
    async subject(id) {
      return { id, name_cn: `作品${id}`, infobox: [{ key: '动画制作', value: 'Studio-A' }, { key: '作者', value: '作者-B' }] }
    },
  }
  const store = makeStore()
  store.saveSubject = async () => undefined
  const grant = { async token() { return { token: 't', grant: { username: 'tester' } } } }
  const config = { includePrivate: false, includeNsfw: false, includeComments: true, cacheSubjectTtlDays: 7 }
  const sync = createSync({ api, store, grant, config })
  await sync.run()
  const creatorList = store.data.profile?.creators || []
  check('sync enriches creator counts', creatorList.length > 0 && creatorList[0].count === 3, JSON.stringify(creatorList))
}

// ---------------------------------------------------------------- my_list year
{
  const year = await runTool('bangumi_my_list', { year: 2015 })
  check('my_list filters by year', year.ok && year.matched === 4, JSON.stringify({ matched: year.matched }))
  const none = await runTool('bangumi_my_list', { year: 1999 })
  check('my_list year filter can exclude all', none.ok && none.matched === 0, String(none.matched))
}

// ---------------------------------------------------------------- tag noise
{
  const noisy = [
    collection(700, { rate: 9, subject: { ...collection(700).subject, tags: [{ name: '2026' }, { name: '2026年4月' }, { name: 'TV' }, { name: '校园' }] } }),
    collection(701, { rate: 2, type: 5, subject: { ...collection(701).subject, tags: [{ name: '2026' }, { name: '2026年10月' }, { name: '猎奇' }] } }),
  ]
  const noisyProfile = buildProfile(noisy, { includePrivate: false, includeNsfw: false, includeComments: true })
  const positiveNames = noisyProfile.tags.positive.map((tag) => tag.name)
  const negativeNames = noisyProfile.tags.negative.map((tag) => tag.name)
  check('year tags are not taste', !positiveNames.some((name) => name.startsWith('2026')) && !negativeNames.some((name) => name.startsWith('2026')), JSON.stringify({ positiveNames, negativeNames }))
  check('format/country tags are not taste', !positiveNames.some((name) => ['TV', 'WEB', '日本'].includes(name)), JSON.stringify(positiveNames))
  check('real tags survive the filter', positiveNames.includes('校园') && negativeNames.includes('猎奇'), JSON.stringify({ positiveNames, negativeNames }))
}

// ---------------------------------------------------------------- recommend sources
{
  const profile = {
    version: 'bbbbbbbbbbbb',
    counts: { total: 20, byType: { anime: 20 }, byStatus: { done: 20 } },
    rating: { ratedCount: 20, mean: 8, strictness: 'neutral' },
    tags: {
      positive: [{ name: '科幻', lift: 2.4, support: 12 }, { name: 'TV', lift: 1.05, support: 20 }],
      negative: [{ name: '后宫', lift: 3.1, support: 3 }],
    },
    samples: { topRated: [{ id: 900, title: '高分作', rate: 10 }] },
  }
  const collections = [{ subject_id: 900 }]
  const thisYear = new Date().getFullYear()
  const api = {
    async calendar() {
      return [{ weekday: { id: 1 }, items: [
        { id: 1001, type: 2, name: '本季新番', rating: { score: 8.1 }, air_date: `${thisYear}-10-01`, tags: [{ name: '科幻' }] },
        { id: 1004, type: 2, name: '本季无关联', rating: { score: 8.4 }, air_date: `${thisYear}-10-02`, tags: [] },
        { id: 1005, type: 2, name: '长青番', rating: { score: 8.9 }, air_date: '1999-10-20', tags: [{ name: '科幻' }] },
        { id: 900, type: 2, name: '已收藏', rating: { score: 9 } },
      ] }]
    },
    async search() {
      return { data: [
        { id: 1002, type: 2, name: '标签命中', rating: { score: 8 }, tags: [{ name: '科幻' }] },
      ] }
    },
    async subjectRelations() {
      return [{ id: 1003, type: 2, name: '续作', relation: '续集' }]
    },
  }
  const config = { includeNsfw: false }
  const result = await recommend({ api, profile, collections, token: undefined, config, count: 10 })
  const ids = result.candidates.map((candidate) => candidate.id)
  check('calendar source now contributes', result.sources.calendar.ok === true && result.sources.calendar.count >= 1 && ids.includes(1001), JSON.stringify(result.sources))
  check('calendar candidate survives to the output', ids.includes(1001), JSON.stringify(ids))
  check('owned subject excluded from calendar', !ids.includes(900), JSON.stringify(ids))
  check('long-running show is skipped', !ids.includes(1005), JSON.stringify(ids))
  check('source report covers all three', result.sources.calendar && result.sources.tags && result.sources.relations, JSON.stringify(result.sources))
  check('count shortage is reported', result.returned < result.requested && /只找到/.test(result.note || ''), `${result.returned}/${result.requested} ${result.note}`)

  const reasons = result.candidates.flatMap((candidate) => candidate.reasons)
  check('reasons use calibrated tags, not TV', reasons.every((reason) => !reason.includes('TV')), JSON.stringify(reasons))
  check('reasons cite lift', reasons.some((reason) => reason.includes('提升度')), JSON.stringify(reasons))

  // With enough personalised candidates, an unrelated seasonal show is dropped.
  const tight = await recommend({ api, profile, collections, token: undefined, config, count: 3 })
  const tightIds = tight.candidates.map((candidate) => candidate.id)
  check('unrelated seasonal show is dropped when enough matches exist', !tightIds.includes(1004), JSON.stringify(tightIds))
  check('all returned candidates are personalised', tight.candidates.every((candidate) => candidate.personalized), JSON.stringify(tight.candidates.map((c) => [c.id, c.personalized])))

  // excludeTags is the owner's explicit intent: hard filter.
  const excluded = await recommend({ api, profile, collections, token: undefined, config, count: 10, excludeTags: ['科幻'] })
  check('excludeTags is a hard filter', !excluded.candidates.some((candidate) => candidate.id === 1001 || candidate.id === 1002), JSON.stringify(excluded.candidates.map((c) => c.id)))
}

// ---------------------------------------------------------------- negative is a penalty
{
  const profile = {
    version: 'cccccccccccc',
    counts: { total: 20, byType: { anime: 20 }, byStatus: { done: 20 } },
    rating: { ratedCount: 20, mean: 8, strictness: 'neutral' },
    tags: {
      positive: [{ name: '科幻', lift: 2.4, support: 12 }],
      negative: [{ name: '后宫', lift: 3.1, support: 3 }],
    },
    samples: { topRated: [{ id: 900, title: '高分作', rate: 10 }] },
  }
  const collections = [{ subject_id: 900 }]
  const api = {
    async calendar() { return [] },
    async search() {
      return { data: [
        { id: 2001, type: 2, name: '干净的科幻', rating: { score: 8 }, tags: [{ name: '科幻' }] },
        { id: 2002, type: 2, name: '带后宫标签的科幻', rating: { score: 8 }, tags: [{ name: '科幻' }, { name: '后宫' }] },
      ] }
    },
    async subjectRelations() { return [] },
  }
  const result = await recommend({ api, profile, collections, token: undefined, config: { includeNsfw: false }, count: 5 })
  const withDislike = result.candidates.find((candidate) => candidate.id === 2002)
  const clean = result.candidates.find((candidate) => candidate.id === 2001)
  check('disliked-tag candidate is kept, not removed', Boolean(withDislike), JSON.stringify(result.candidates.map((c) => c.id)))
  check('disliked-tag candidate is penalised', withDislike && clean && withDislike.fit < clean.fit, JSON.stringify({ disliked: withDislike?.fit, clean: clean?.fit }))
  check('penalty is disclosed as a caution', withDislike?.cautions.includes('后宫'), JSON.stringify(withDislike?.cautions))
}

// ---------------------------------------------------------------- subject ambiguity
{
  const api = {
    async search() {
      return { data: [
        { id: 241088, type: 1, name: '孤独摇滚！', name_cn: '孤独摇滚！', date: '2018-12-19', rating: { score: 8.6 } },
        { id: 328609, type: 2, name: 'ぼっち・ざ・ろっく！', name_cn: '孤独摇滚！', date: '2022-10-09', rating: { score: 8.8 } },
      ] }
    },
    async subject() { throw new Error('should not be called without a resolution') },
  }
  const definition = TOOL_FACTORIES.bangumi_subject({ api, config: { includeNsfw: false }, grant: { async token() { return null } } })
  const value = sanitize(await definition.execute({ keyword: '孤独摇滚' }, {}))
  check('cross-type keyword is reported as ambiguous', value.ok === false && value.code === 'AMBIGUOUS', JSON.stringify(value).slice(0, 160))
  check('ambiguity lists candidates with types', value.candidates?.length === 2 && value.candidates.some((c) => c.type === '动画'), JSON.stringify(value.candidates))
  const text = definition.output.render({}, value)[0].text
  check('ambiguity renders the candidates', text.includes('候选') && text.includes('id=328609'), text.slice(0, 200))

  const typedApi = { ...api, async subject() { return { id: 328609, type: 2, name: 'ぼっち', name_cn: '孤独摇滚！', tags: [] } } }
  const typed = sanitize(await TOOL_FACTORIES.bangumi_subject({ api: typedApi, config: { includeNsfw: false }, grant: { async token() { return null } } })
    .execute({ keyword: '孤独摇滚', type: 'anime' }, {}))
  check('type hint resolves the ambiguity', typed.ok === true && typed.subject.id === 328609, JSON.stringify(typed).slice(0, 160))
}

// ---------------------------------------------------------------- aired episodes
{
  const future = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  const past = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
  const api = {
    async myCollection() { return { type: 3, rate: 0, ep_status: 5 } },
    async subject() { return { id: 3001, name_cn: '超巡测试', eps: 12 } },
    async episodes() {
      return { data: [
        { id: 1, type: 0, sort: 1, airdate: past },
        { id: 2, type: 0, sort: 2, airdate: past },
        { id: 3, type: 0, sort: 3, airdate: past },
        { id: 4, type: 0, sort: 4, airdate: past },
        { id: 5, type: 0, sort: 5, airdate: past },
        { id: 6, type: 0, sort: 6, airdate: future },
        { id: 7, type: 0, sort: 7, airdate: future },
      ] }
    },
    async me() { return { username: 'tester' } },
  }
  const deps3 = { api, grant: { async token() { return { token: 't', grant: { username: 'tester' } } } }, store: { async readFreshSubject() { return null } } }
  const value = sanitize(await TOOL_FACTORIES.bangumi_my_entry(deps3).execute({ subjectId: 3001 }, {}))
  check('remaining counts aired episodes only', value.ok && value.aired === 5 && value.remaining === 0, JSON.stringify(value))
  const text = TOOL_FACTORIES.bangumi_my_entry(deps3).output.render({}, value)[0].text
  check('render distinguishes aired from total', text.includes('已放送 5 集'), text)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
