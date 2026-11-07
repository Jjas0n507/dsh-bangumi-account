/** Model-facing tools: intent-shaped, bounded output, structured failures. */
import { STATUS_NAMES, TYPE_KEYS, TYPE_NAMES, briefOf, profileSlice } from './profile.js'
import { recommend } from './recommend.js'

const TYPE_BY_KEY = { book: 1, anime: 2, music: 3, game: 4, real: 6 }

function clip(value, limit) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

function number(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed === 0) return '—'
  return parsed >= 10000 ? `${Math.round(parsed / 1000) / 10}万` : String(parsed)
}

function fail(code, message, hint) {
  return { ok: false, code, message, ...(hint ? { hint } : {}) }
}

const NOT_SIGNED_IN = () => fail(
  'NOT_SIGNED_IN',
  '主人还没在「设置 → Bangumi」登录，只能查公开资料。',
  '如果主人问的是他自己的收藏或评分，请如实告诉他需要先登录。',
)

const NOT_SYNCED = () => fail(
  'NOT_SYNCED',
  '已经登录，但还没有同步过收藏。',
  '请主人到「设置 → Bangumi」点一次「立即同步」。',
)

function output(render) {
  return {
    schema: { type: 'object', additionalProperties: true },
    render: (args, value) => [{ type: 'text', text: render(args, value) }],
  }
}

function renderFailure(value) {
  const hint = value.hint ? `\n${value.hint}` : ''
  return `${value.message}${hint}`
}

/** A source that failed must not look like a source that found nothing. */
function describeSource(source) {
  if (!source) return '未尝试'
  if (!source.ok) return '调用失败'
  return `${source.count} 部`
}

function subjectTypeId(value) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'number') return value
  if (TYPE_BY_KEY[value]) return TYPE_BY_KEY[value]
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function subjectLine(subject, index) {
  const parts = [
    `${index}. ${subject.title || subject.name_cn || subject.name}${subject.name && subject.name !== subject.name_cn ? `（${subject.name}）` : ''}`,
    `id=${subject.id}`,
    subject.score !== null && subject.score !== undefined ? `评分 ${subject.score}` : '',
    subject.rank ? `排名 #${subject.rank}` : '',
    subject.date ? subject.date : '',
    subject.collectionTotal ? `收藏 ${number(subject.collectionTotal)}` : '',
  ].filter(Boolean)
  return parts.join(' · ')
}

export function bangumiSearch({ api, config, grant }) {
  return {
    name: 'bangumi_search',
    description: '按关键词搜索 Bangumi 的作品、角色或人物。作品搜索可再按类型、标签、最低评分过滤。用于「有没有一部叫X的番」「找找某个角色」这类问题。返回条目 id，可交给 bangumi_subject 取详情。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '搜索词，作品名/角色名/人名，中英文日文都行。必填。' },
        entity: {
          type: 'string',
          enum: ['subjects', 'characters', 'persons'],
          description: '搜什么，默认 subjects（作品）。',
        },
        type: {
          type: 'string',
          enum: ['anime', 'book', 'game', 'music', 'real'],
          description: '只搜作品时限定类型。',
        },
        tags: { type: 'array', items: { type: 'string' }, description: '标签精确过滤，多个之间是「且」。' },
        minRating: { type: 'number', description: '最低社区评分（0-10）。' },
        sort: { type: 'string', enum: ['match', 'heat', 'rank', 'score'], description: '排序，默认 match（匹配度）。' },
        limit: { type: 'integer', description: '返回条数，1-20，默认 8。' },
      },
      required: ['keyword'],
    },
    output: output((args, value) => {
      if (!value.ok) return renderFailure(value)
      const lines = [`共 ${value.total} 条，显示前 ${value.items.length} 条：`]
      value.items.forEach((item, index) => lines.push(subjectLine(item, index + 1)))
      if (value.note) lines.push(`\n${value.note}`)
      return lines.join('\n')
    }),
    async execute(args = {}, exec) {
      const keyword = String(args.keyword || '').trim()
      if (!keyword) return fail('BAD_ARGS', 'keyword 不能为空')
      const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 20)
      const entity = args.entity || 'subjects'
      const ticket = await grant.token().catch(() => null)
      try {
        if (entity === 'subjects') {
          const page = await api.search({
            kind: 'subjects',
            keyword,
            sort: args.sort || 'match',
            filter: {
              ...(subjectTypeId(args.type) ? { type: [subjectTypeId(args.type)] } : {}),
              ...(Array.isArray(args.tags) && args.tags.length ? { tag: args.tags } : {}),
              ...(typeof args.minRating === 'number' ? { rating: [`>=${args.minRating}`] } : {}),
              ...(config.includeNsfw ? {} : { nsfw: false }),
            },
            limit,
            token: ticket?.token,
            signal: exec?.signal,
          })
          const items = (page?.data || []).map((subject) => ({
            id: subject.id,
            title: subject.name_cn || subject.name,
            name: subject.name,
            score: subject.rating?.score ?? subject.score ?? null,
            rank: subject.rating?.rank ?? subject.rank ?? null,
            date: subject.date || null,
            collectionTotal: subject.collection?.collect ?? subject.collection_total ?? null,
            type: subject.type,
            tags: (subject.tags || []).slice(0, 5).map((tag) => tag.name),
          }))
          return {
            ok: true,
            total: page?.total ?? items.length,
            items,
            note: items.length === 0 ? '没有匹配结果。可以换个关键词，或去掉过滤条件。' : undefined,
          }
        }
        const page = await api.search({
          kind: entity === 'characters' ? 'characters' : 'persons',
          keyword,
          limit,
          token: ticket?.token,
          signal: exec?.signal,
        })
        const items = (page?.data || []).map((item) => ({
          id: item.id,
          title: item.name,
          name: item.name,
          score: null,
          rank: null,
          date: null,
          type: item.type,
          tags: (item.career || []).slice(0, 4),
        }))
        return { ok: true, total: page?.total ?? items.length, items }
      } catch (error) {
        return fail(error.code || 'SEARCH_FAILED', error.message, error.hint)
      }
    },
  }
}

export function bangumiSubject({ api, config, grant }) {
  return {
    name: 'bangumi_subject',
    description: '取一部作品（书籍/动画/音乐/游戏/三次元）的详情：简介、评分与排名、标签、放送日期、集数，可选附带角色、制作人员、关联作品和章节表。id 来自 bangumi_search 或主人直接给出的链接。',
    parameters: {
      type: 'object',
      properties: {
        subjectId: { type: 'integer', description: '作品 id；给不出 id 时改用 keyword。' },
        keyword: { type: 'string', description: '没有 id 时按名字搜，取最匹配的一部。' },
        type: {
          type: 'string',
          enum: ['anime', 'book', 'game', 'music', 'real'],
          description: '按名字搜索时限定作品类型；同名跨类型时用它消歧。',
        },
        include: {
          type: 'array',
          items: { type: 'string', enum: ['characters', 'staff', 'relations', 'episodes'] },
          description: '额外要哪些关联数据，默认只要本体。',
        },
      },
    },
    output: output((args, value) => {
      if (!value.ok) {
        const lines = [renderFailure(value)]
        if (Array.isArray(value.candidates) && value.candidates.length) {
          lines.push('候选：')
          value.candidates.forEach((candidate, index) => {
            lines.push(`${index + 1}. ${candidate.title} · id=${candidate.id} · ${candidate.type}${candidate.date ? ` · ${candidate.date}` : ''}${candidate.score ? ` · 评分 ${candidate.score}` : ''}`)
          })
        }
        return lines.join('\n')
      }
      const s = value.subject
      const lines = [
        `《${s.title}》${s.name && s.name !== s.title ? `（${s.name}）` : ''}  id=${s.id}`,
        `类型 ${s.typeName}${s.date ? ` · 放送 ${s.date}` : ''}${s.platform ? ` · ${s.platform}` : ''}`,
        `评分 ${s.score ?? '—'}${s.rank ? `（排名 #${s.rank}）` : ''} · 收藏 ${number(s.collectionTotal)}`,
        s.eps ? `集数 ${s.eps}` : '',
        s.tags?.length ? `标签 ${s.tags.join('、')}` : '',
        s.summary ? `\n${s.summary}` : '',
      ].filter(Boolean)
      if (value.myStatus) lines.push(`\n主人：${value.myStatus}`)
      if (s.episodes?.length) lines.push(`\n章节（前 ${s.episodes.length} 集）：${s.episodes.map((ep) => ep.label).join('、')}`)
      if (s.characters?.length) lines.push(`\n角色：${s.characters.map((c) => `${c.name}${c.relation ? `(${c.relation})` : ''}`).join('、')}`)
      if (s.staff?.length) lines.push(`\n制作：${s.staff.map((p) => `${p.name}(${p.relation})`).join('、')}`)
      if (s.relations?.length) lines.push(`\n关联：${s.relations.map((r) => `${r.name}(${r.relation})`).join('、')}`)
      if (value.omitted?.length) lines.push(`\n（${value.omitted.join('、')}暂时取不到，可能是接口临时故障）`)
      lines.push(`\n链接 https://bgm.tv/subject/${s.id}`)
      return lines.join('\n')
    }),
    async execute(args = {}, exec) {
      let id = Number(args.subjectId) || 0
      const ticket = await grant.token().catch(() => null)
      try {
        if (!id && args.keyword) {
          const wanted = subjectTypeId(args.type)
          const page = await api.search({
            kind: 'subjects',
            keyword: String(args.keyword),
            sort: 'match',
            filter: {
              ...(wanted ? { type: [wanted] } : {}),
              ...(config.includeNsfw ? {} : { nsfw: false }),
            },
            limit: 6,
            token: ticket?.token,
            signal: exec?.signal,
          })
          const results = page?.data || []
          if (!wanted && results.length > 0) {
            const types = new Set(results.map((item) => item.type))
            // 「孤独摇滚」既是漫画也是动画：猜错类别比多问一句更糟。
            if (types.size > 1) {
              return {
                ok: false,
                code: 'AMBIGUOUS',
                message: `「${args.keyword}」同时匹配到不同类别的条目，请用 subjectId 指定，或加 type 限定类型。`,
                hint: '候选见下；若主人说的是动画，用 type=anime 再查一次。',
                candidates: results.slice(0, 5).map((item) => ({
                  id: item.id,
                  title: item.name_cn || item.name,
                  type: TYPE_NAMES[item.type] || String(item.type),
                  date: item.date || null,
                  score: item.rating?.score ?? null,
                })),
              }
            }
          }
          id = Number(results[0]?.id) || 0
          if (!id) return fail('NOT_FOUND', `没搜到「${args.keyword}」`, '换个关键词试试')
        }
        if (!id) return fail('BAD_ARGS', '需要 subjectId 或 keyword')
        const subject = await api.subject(id, ticket?.token, exec?.signal)
        const include = new Set(Array.isArray(args.include) ? args.include : [])
        const omitted = []
        const detail = {
          id: subject.id,
          title: subject.name_cn || subject.name,
          name: subject.name,
          typeName: TYPE_NAMES[subject.type] || String(subject.type),
          date: subject.date || null,
          platform: subject.platform || null,
          score: subject.rating?.score ?? null,
          rank: subject.rating?.rank ?? null,
          collectionTotal: subject.collection?.collect ?? null,
          eps: subject.eps || subject.total_episodes || null,
          summary: clip(subject.summary, 320),
          tags: (subject.tags || []).slice(0, 8).map((tag) => tag.name),
        }
        if (include.has('episodes')) {
          try {
            const episodes = await api.episodes({ subjectId: id, limit: 100, token: ticket?.token, signal: exec?.signal })
            detail.episodes = (episodes?.data || []).slice(0, 12).map((ep) => ({
              id: ep.id,
              label: `ep${ep.sort ?? ep.ep ?? ''}${ep.name_cn || ep.name ? ` ${ep.name_cn || ep.name}` : ''}`,
              airdate: ep.airdate || null,
            }))
          } catch {
            omitted.push('章节')
          }
        }
        if (include.has('characters')) {
          try {
            const characters = await api.subjectCharacters(id, ticket?.token, exec?.signal)
            detail.characters = (characters || []).slice(0, 12).map((c) => ({
              id: c.id, name: c.name, relation: c.relation || null,
            }))
          } catch {
            omitted.push('角色')
          }
        }
        if (include.has('staff')) {
          try {
            const persons = await api.subjectPersons(id, ticket?.token, exec?.signal)
            detail.staff = (persons || []).slice(0, 12).map((p) => ({
              id: p.id, name: p.name, relation: p.relation || null,
            }))
          } catch {
            omitted.push('制作人员')
          }
        }
        if (include.has('relations')) {
          try {
            const relations = await api.subjectRelations(id, ticket?.token, exec?.signal)
            detail.relations = (relations || []).slice(0, 12).map((r) => ({
              id: r.id, name: r.name_cn || r.name, relation: r.relation || null,
            }))
          } catch {
            omitted.push('关联作品')
          }
        }
        let myStatus
        if (ticket?.grant?.username) {
          const mine = await api.myCollection({
            subjectId: id, username: ticket.grant.username, token: ticket.token, signal: exec?.signal,
          }).catch(() => null)
          if (mine) {
            const status = STATUS_NAMES[mine.type] || '未知'
            myStatus = `${status}${mine.rate ? ` · 评分 ${mine.rate}` : ''}${mine.ep_status ? ` · 看到第 ${mine.ep_status} 集` : ''}`
          }
        }
        return { ok: true, subject: detail, myStatus, omitted }
      } catch (error) {
        return fail(error.code || 'SUBJECT_FAILED', error.message, error.hint)
      }
    },
  }
}

export function bangumiCalendar({ api, grant }) {
  const WEEKDAYS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']
  return {
    name: 'bangumi_calendar',
    description: '取本周番剧放送表（Bangumi 每日更新的当季新番）。用于「今天有什么更新」「这季有什么在播」。只返回动画，最多 40 部。',
    parameters: {
      type: 'object',
      properties: {
        weekday: { type: 'integer', description: '只看某一天：1=周一 … 7=周日。不填则返回全部。' },
      },
    },
    output: output((args, value) => {
      if (!value.ok) return renderFailure(value)
      if (!value.days.length) return '本周没有在播动画数据。'
      return value.days
        .map((day) => `${WEEKDAYS[day.weekday] || `周${day.weekday}`}\n${day.items.map((item) => `  · ${item.title}${item.score ? `（${item.score}）` : ''} · id=${item.id}`).join('\n')}`)
        .join('\n\n')
    }),
    async execute(args = {}, exec) {
      try {
        const days = await api.calendar(exec?.signal)
        const wanted = Number(args.weekday) || 0
        const result = (days || [])
          .filter((day) => !wanted || day.weekday?.id === wanted)
          .map((day) => ({
            weekday: day.weekday?.id || 0,
            items: (day.items || [])
              .filter((item) => item.type === 2)
              .slice(0, 40)
              .map((item) => ({
                id: item.id,
                title: item.name_cn || item.name,
                score: item.rating?.score ?? null,
                airDate: item.air_date || null,
              })),
          }))
          .filter((day) => day.items.length > 0)
        return { ok: true, days: result }
      } catch (error) {
        return fail(error.code || 'CALENDAR_FAILED', error.message, error.hint)
      }
    },
  }
}

export function bangumiTaste({ grant, store, sync }) {
  return {
    name: 'bangumi_taste',
    description: '读取主人在 Bangumi 的口味档案：收藏规模、评分习惯（含比大众偏严还是偏宽容）、偏爱与回避的标签、年代偏好、近期在看。当主人问「推荐点什么」「我喜欢什么」，或你需要结合他的看片口味回答时，先调用本工具；不要凭聊天印象猜他的口味。需要具体作品时改用 bangumi_my_list。',
    parameters: {
      type: 'object',
      properties: {
        focus: {
          type: 'string',
          enum: ['summary', 'tags', 'rating', 'recent', 'creators'],
          description: '默认 summary。tags 看完整标签画像，rating 看评分分布与「比大众更宽容/更苛刻」的具体作品，recent 看近 90 天动态和他写过的短评。',
        },
      },
    },
    output: output((args, value) => {
      if (!value.ok) return renderFailure(value)
      const lines = [value.brief]
      const p = value.profile
      if (args?.focus === 'tags' && p.tags) {
        lines.push(`\n偏爱：${p.tags.positive.map((t) => t.name).join('、')}`)
        if (p.tags.negative.length) lines.push(`回避：${p.tags.negative.map((t) => t.name).join('、')}`)
      }
      if (args?.focus === 'rating' && p.rating) {
        lines.push(`\n评分分布 ${JSON.stringify(p.rating.distribution)}`)
        if (p.samples?.moreLenientThanCrowd?.length) {
          lines.push(`比大众宽容：${p.samples.moreLenientThanCrowd.map((s) => `${s.title}(${s.rate}/大众${s.score})`).join('、')}`)
        }
        if (p.samples?.stricterThanCrowd?.length) {
          lines.push(`比大众苛刻：${p.samples.stricterThanCrowd.map((s) => `${s.title}(${s.rate}/大众${s.score})`).join('、')}`)
        }
      }
      if (args?.focus === 'recent' && p.recent) {
        if (p.recent.doing.length) lines.push(`\n在看：${p.recent.doing.map((i) => `${i.title}(${i.epStatus}/${i.eps || '?'})`).join('、')}`)
        for (const note of p.notes || []) lines.push(`\n他曾写：「${note.excerpt}」— ${note.title}`)
      }
      if (args?.focus === 'creators') {
        const creators = p.creators || []
        lines.push(creators.length
          ? `\n常看制作方/作者：${creators.map((c) => `${c.name}(${c.role}×${c.count})`).join('、')}`
          : '\n还没有制作方数据（同步时会顺带抓取高分作品的制作信息）。')
      }
      return lines.filter(Boolean).join('\n')
    }),
    async execute(args = {}) {
      const ticket = await grant.token().catch(() => null)
      if (!ticket) return NOT_SIGNED_IN()
      const profile = sync.current() || await sync.load()
      if (!profile) return NOT_SYNCED()
      const focus = args.focus || 'summary'
      const slice = profileSlice(profile, focus)
      return { ok: true, brief: briefOf(profile), profile: slice, source: 'bangumi 收藏数据' }
    },
  }
}

export function bangumiMyList({ api, grant, store, sync }) {
  return {
    name: 'bangumi_my_list',
    description: '查主人自己的 Bangumi 收藏列表，可按类型、状态、评分区间、标签、关键词筛选。用于「我在看什么」「我给它打了几分」「我弃了哪些」。需要主人已登录并同步。',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['wish', 'done', 'doing', 'onHold', 'dropped'], description: '收藏状态。' },
        type: { type: 'string', enum: ['anime', 'book', 'game', 'music', 'real'], description: '作品类型。' },
        minRate: { type: 'number', description: '最低评分（1-10）。' },
        maxRate: { type: 'number', description: '最高评分（1-10）。' },
        tag: { type: 'string', description: '只保留带这个标签的作品。' },
        year: { type: 'integer', description: '只保留该年份的作品。' },
        keyword: { type: 'string', description: '标题包含这个词。' },
        sort: { type: 'string', enum: ['recent', 'rate', 'title'], description: '默认 recent（按更新时间）。' },
        limit: { type: 'integer', description: '1-50，默认 15。' },
      },
    },
    output: output((args, value) => {
      if (!value.ok) return renderFailure(value)
      if (!value.items.length) return '没有符合条件的收藏。'
      const lines = [`共 ${value.matched} 条符合，显示 ${value.items.length} 条：`]
      for (const item of value.items) {
        lines.push(`${item.title} · id=${item.id} · ${item.status}${item.rate ? ` · ${item.rate} 分` : ''}${item.epStatus ? ` · 看到第 ${item.epStatus} 集` : ''}${item.updatedAt ? ` · ${item.updatedAt.slice(0, 10)}` : ''}`)
      }
      if (value.matched > value.items.length) lines.push(`\n（还有 ${value.matched - value.items.length} 条未显示，可用筛选条件缩小范围）`)
      return lines.join('\n')
    }),
    async execute(args = {}) {
      const ticket = await grant.token().catch(() => null)
      if (!ticket) return NOT_SIGNED_IN()
      const collections = await store.readCollections()
      if (!collections) return NOT_SYNCED()
      const statusId = Object.entries({ wish: 1, done: 2, doing: 3, onHold: 4, dropped: 5 }).find(([key]) => key === args.status)?.[1]
      const typeId = subjectTypeId(args.type)
      const keyword = String(args.keyword || '').toLowerCase()
      const tag = String(args.tag || '')

      let items = collections.filter((item) => {
        if (statusId && item.type !== statusId) return false
        if (typeId && item.subject_type !== typeId) return false
        if (typeof args.minRate === 'number' && (Number(item.rate) || 0) < args.minRate) return false
        if (typeof args.maxRate === 'number' && (Number(item.rate) || 0) > args.maxRate) return false
        if (tag) {
          const names = (item.subject?.tags || []).map((t) => t.name)
          if (!names.includes(tag)) return false
        }
        if (typeof args.year === 'number') {
          const date = item.subject?.date
          if (typeof date !== 'string' || Number(date.slice(0, 4)) !== args.year) return false
        }
        if (keyword) {
          const title = `${item.subject?.name_cn || ''}${item.subject?.name || ''}`.toLowerCase()
          if (!title.includes(keyword)) return false
        }
        return true
      })
      const sort = args.sort || 'recent'
      items = items.sort((a, b) => {
        if (sort === 'rate') return (Number(b.rate) || 0) - (Number(a.rate) || 0)
        if (sort === 'title') return (a.subject?.name_cn || a.subject?.name || '').localeCompare(b.subject?.name_cn || b.subject?.name || '', 'zh')
        return Date.parse(b.updated_at || '0') - Date.parse(a.updated_at || '0')
      })
      const limit = Math.min(Math.max(Number(args.limit) || 15, 1), 50)
      const matched = items.length
      return {
        ok: true,
        matched,
        items: items.slice(0, limit).map((item) => ({
          id: item.subject_id,
          title: item.subject?.name_cn || item.subject?.name,
          status: STATUS_NAMES[item.type] || '未知',
          rate: Number(item.rate) || 0,
          epStatus: Number(item.ep_status) || 0,
          updatedAt: item.updated_at || null,
        })),
      }
    },
  }
}

export function bangumiMyEntry({ api, grant, store }) {
  return {
    name: 'bangumi_my_entry',
    description: '查主人对某一部作品的状态与章节进度（看到第几集、剩下几集）。用于「我看到第几集了」。需要作品 id。',
    parameters: {
      type: 'object',
      properties: { subjectId: { type: 'integer', description: '作品 id。' } },
      required: ['subjectId'],
    },
    output: output((args, value) => {
      if (!value.ok) return renderFailure(value)
      const lines = [
        `《${value.title}》`,
        `状态 ${value.status}${value.rate ? ` · 评分 ${value.rate}` : ''}${value.epStatus ? ` · 看到第 ${value.epStatus} 集` : ''}`,
      ]
      if (value.remaining !== null && value.aired !== null) {
        lines.push(`已放送 ${value.aired} 集，还差 ${value.remaining} 集`)
      } else if (value.remaining !== null) {
        lines.push(`标记进度 ${value.epStatus}/${value.total}，还差 ${value.remaining} 集（未放送的也计入）`)
      } else if (value.total > 0 && value.epStatus > 0) {
        lines.push(`标记进度 ${value.epStatus}/${value.total}`)
      }
      if (value.comment) lines.push(`\n你的短评：${value.comment}`)
      return lines.join('\n')
    }),
    async execute(args = {}, exec) {
      const id = Number(args.subjectId) || 0
      if (!id) return fail('BAD_ARGS', '需要 subjectId')
      const ticket = await grant.token().catch(() => null)
      if (!ticket) return NOT_SIGNED_IN()
      try {
        const username = ticket.grant.username || (await api.me(ticket.token, exec?.signal))?.username
        const mine = await api.myCollection({
          subjectId: id, username, token: ticket.token, signal: exec?.signal,
        })
        if (!mine) return fail('NOT_COLLECTED', '主人没有收藏这部作品。')
        const subject = await store.readFreshSubject(id) || await api.subject(id, ticket.token, exec?.signal).catch(() => null)
        const total = Number(subject?.eps) || Number(subject?.total_episodes) || 0
        const seen = Number(mine.ep_status) || 0
        // "还差 N 集" must count episodes that actually aired: a show marked
        // 5/12 in its first month is not seven episodes behind.
        let aired = null
        try {
          const page = await api.episodes({ subjectId: id, limit: 200, token: ticket.token, signal: exec?.signal })
          const episodes = (page?.data || []).filter((episode) => episode.type === 0 || episode.type === undefined)
          if (episodes.length > 0) {
            const now = Date.now()
            aired = episodes.filter((episode) => {
              const stamp = Date.parse(episode.airdate || '')
              return !Number.isFinite(stamp) || stamp <= now
            }).length
          }
        } catch {
          aired = null
        }
        const basis = aired !== null ? aired : total
        return {
          ok: true,
          id,
          title: subject?.name_cn || subject?.name || `#${id}`,
          status: STATUS_NAMES[mine.type] || '未知',
          rate: Number(mine.rate) || 0,
          epStatus: seen,
          aired,
          total,
          remaining: basis > 0 && seen > 0 ? Math.max(basis - seen, 0) : null,
          comment: mine.comment ? clip(mine.comment, 200) : null,
        }
      } catch (error) {
        return fail(error.code || 'MY_ENTRY_FAILED', error.message, error.hint)
      }
    },
  }
}

export function bangumiRecommend({ api, grant, store, sync, config }) {
  return {
    name: 'bangumi_recommend',
    description: '基于主人的口味推荐他还没看过的动画：候选来自本季在播、他偏爱标签下的高分作品、以及他高分作品的关联续作；已收藏的一律排除。每条推荐都带可核对的理由。需要主人已登录并同步。',
    parameters: {
      type: 'object',
      properties: {
        count: { type: 'integer', description: '推荐几部，1-10，默认 3。' },
        excludeTags: { type: 'array', items: { type: 'string' }, description: '额外想避开的标签。' },
      },
    },
    output: output((args, value) => {
      if (!value.ok) return renderFailure(value)
      if (!value.candidates.length) {
        return `没有找到合适的候选。\n来源：日历 ${describeSource(value.sources?.calendar)} · 标签搜索 ${describeSource(value.sources?.tags)} · 关联作品 ${describeSource(value.sources?.relations)}`
      }
      const lines = [`推荐 ${value.returned} 条（请求 ${value.requested} 条）：`]
      value.candidates.forEach((item, index) => {
        lines.push(`${index + 1}. 《${item.title}》${item.score ? ` 评分 ${item.score}` : ''}${item.rank ? ` 排名 #${item.rank}` : ''} · id=${item.id}`)
        if (item.reasons.length) lines.push(`   理由：${item.reasons.join('；')}`)
        if (item.cautions.length) lines.push(`   注意：含你常弃的标签「${item.cautions.join('」「')}」`)
      })
      lines.push(`\n依据：${value.basedOn.ratedCount} 条评分；偏好标签 ${value.basedOn.topTags.join('、')}`)
      lines.push(`来源：日历 ${describeSource(value.sources?.calendar)} · 标签搜索 ${describeSource(value.sources?.tags)} · 关联作品 ${describeSource(value.sources?.relations)}`)
      if (value.note) lines.push(`\n${value.note}`)
      return lines.join('\n')
    }),
    async execute(args = {}, exec) {
      const ticket = await grant.token().catch(() => null)
      if (!ticket) return NOT_SIGNED_IN()
      const profile = sync.current() || await sync.load()
      if (!profile) return NOT_SYNCED()
      const collections = await store.readCollections()
      if (!collections) return NOT_SYNCED()
      try {
        const result = await recommend({
          api,
          profile,
          collections,
          token: ticket.token,
          config,
          count: Number(args.count) || 3,
          excludeTags: Array.isArray(args.excludeTags) ? args.excludeTags : [],
          signal: exec?.signal,
        })
        // An empty result still carries the per-source report, so "no candidates"
        // can never be confused with "a source died".
        return { ok: true, ...result }
      } catch (error) {
        return fail(error.code || 'RECOMMEND_FAILED', error.message, error.hint)
      }
    },
  }
}

export function bangumiUpdate({ api, grant, store }) {
  return {
    name: 'bangumi_update',
    description: '修改主人在 Bangumi 的收藏：状态、评分、短评、标签、私密标记，或把某一集标记为看过。只在他明确要求时调用，并用返回的 before/after 向他确认结果。',
    parameters: {
      type: 'object',
      properties: {
        subjectId: { type: 'integer', description: '作品 id。' },
        status: { type: 'string', enum: ['wish', 'done', 'doing', 'onHold', 'dropped'], description: '新的收藏状态。' },
        rate: { type: 'integer', description: '评分 1-10。' },
        comment: { type: 'string', description: '短评（会覆盖原短评）。' },
        tags: { type: 'array', items: { type: 'string' }, description: '个人标签，覆盖原标签。' },
        private: { type: 'boolean', description: '是否设为私有收藏。' },
        episode: { type: 'integer', description: '把这一集标记为看过（传集数序号 ep）。' },
      },
      required: ['subjectId'],
    },
    output: output((args, value) => {
      if (!value.ok) return renderFailure(value)
      return `已更新《${value.title}》\n之前：${value.before}\n现在：${value.after}`
    }),
    async execute(args = {}, exec) {
      const id = Number(args.subjectId) || 0
      const ticket = await grant.token().catch(() => null)
      if (!ticket) return NOT_SIGNED_IN()
      if (!id) return fail('BAD_ARGS', '需要 subjectId')
      const statusId = Object.entries({ wish: 1, done: 2, doing: 3, onHold: 4, dropped: 5 })
        .find(([key]) => key === args.status)?.[1]
      const patch = {}
      if (statusId) patch.type = statusId
      if (typeof args.rate === 'number' && args.rate >= 0 && args.rate <= 10) patch.rate = args.rate
      if (typeof args.comment === 'string') patch.comment = args.comment
      if (Array.isArray(args.tags)) patch.tags = args.tags
      if (typeof args.private === 'boolean') patch.private = args.private
      if (Object.keys(patch).length === 0 && args.episode === undefined) {
        return fail('BAD_ARGS', '没有任何要修改的字段')
      }
      try {
        const username = ticket.grant.username || (await api.me(ticket.token, exec?.signal))?.username
        const before = await api.myCollection({
          subjectId: id, username, token: ticket.token, signal: exec?.signal,
        }).catch(() => null)
        const subject = await api.subject(id, ticket.token, exec?.signal).catch(() => null)
        if (Object.keys(patch).length > 0) {
          await api.writeCollection({ subjectId: id, patch, token: ticket.token, signal: exec?.signal })
        }
        if (args.episode !== undefined) {
          const episodes = await api.episodes({ subjectId: id, limit: 200, token: ticket.token, signal: exec?.signal })
          const target = (episodes?.data || []).find((ep) => Number(ep.ep) === Number(args.episode) || Number(ep.sort) === Number(args.episode))
          if (!target) return fail('EPISODE_NOT_FOUND', `没找到第 ${args.episode} 集`)
          await api.writeEpisode({ episodeId: target.id, type: 2, token: ticket.token, signal: exec?.signal })
        }
        const after = await api.myCollection({
          subjectId: id, username, token: ticket.token, signal: exec?.signal,
        }).catch(() => null)
        const describe = (entry) => entry
          ? `${STATUS_NAMES[entry.type] || '未知'}${entry.rate ? ` · ${entry.rate} 分` : ''}${entry.ep_status ? ` · 第 ${entry.ep_status} 集` : ''}`
          : '未收藏'
        return {
          ok: true,
          id,
          title: subject?.name_cn || subject?.name || `#${id}`,
          before: describe(before),
          after: describe(after),
        }
      } catch (error) {
        return fail(error.code || 'UPDATE_FAILED', error.message, error.hint)
      }
    },
  }
}

export const TOOL_FACTORIES = {
  bangumi_search: bangumiSearch,
  bangumi_subject: bangumiSubject,
  bangumi_calendar: bangumiCalendar,
  bangumi_taste: bangumiTaste,
  bangumi_my_list: bangumiMyList,
  bangumi_my_entry: bangumiMyEntry,
  bangumi_recommend: bangumiRecommend,
  bangumi_update: bangumiUpdate,
}

export { TYPE_KEYS }
