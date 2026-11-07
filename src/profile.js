/** Pure functions: collections -> taste profile -> short brief. */
import { createHash } from 'node:crypto'

export const TYPE_NAMES = { 1: '书籍', 2: '动画', 3: '音乐', 4: '游戏', 6: '三次元' }
export const TYPE_KEYS = { 1: 'book', 2: 'anime', 3: 'music', 4: 'game', 6: 'real' }
export const STATUS_NAMES = { 1: '想看', 2: '看过', 3: '在看', 4: '搁置', 5: '抛弃' }
export const STATUS_KEYS = { 1: 'wish', 2: 'done', 3: 'doing', 4: 'onHold', 5: 'dropped' }

const DAY = 86400000
const RECENT_WINDOW_DAYS = 90

/**
 * Year and season tags ("2026", "2026年4月", "2026-04") are metadata, not taste:
 * an airing show being dropped is normal and says nothing about preference.
 */
const NOISE_TAG = /^\d{4}(年(\d{1,2})?月?)?(-\d{1,2})?$/

/** Country and delivery-format tags describe the catalogue, not the owner. */
const STOP_TAGS = new Set(['日本', '中国', '美国', '韩国', '欧美', 'TV', 'WEB', 'OVA', 'OAD', 'TV动画'])

function isTasteTag(name) {
  if (typeof name !== 'string') return false
  const trimmed = name.trim()
  if (!trimmed) return false
  if (STOP_TAGS.has(trimmed)) return false
  return !NOISE_TAG.test(trimmed)
}

function round(value, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function titleOf(collection) {
  const subject = collection.subject || {}
  return subject.name_cn || subject.name || `#${collection.subject_id}`
}

function yearOf(collection) {
  const date = collection.subject?.date
  if (typeof date !== 'string' || date.length < 4) return null
  const year = Number(date.slice(0, 4))
  return Number.isFinite(year) && year > 1900 ? year : null
}

function decadeOf(year) {
  if (!year) return null
  return `${Math.floor(year / 10) * 10}s`
}

function mean(values) {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/** Median is robust to one 2/10 outlier among many 8/10 scores. */
function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

/**
 * Build the structured profile.
 *
 * @param {object[]} collections raw `UserSubjectCollection` items
 * @param {{includePrivate?: boolean, includeNsfw?: boolean, includeComments?: boolean}} options
 */
export function buildProfile(collections, options = {}) {
  const { includePrivate = false, includeNsfw = false, includeComments = true } = options
  const items = (collections || []).filter((item) => {
    if (!item || !item.subject_id) return false
    if (!includePrivate && item.private) return false
    if (!includeNsfw && item.subject?.nsfw) return false
    return true
  })

  const byType = { book: 0, anime: 0, music: 0, game: 0, real: 0 }
  const byStatus = { wish: 0, done: 0, doing: 0, onHold: 0, dropped: 0 }
  // Tag affinity is measured as lift, not frequency: a tag that appears on
  // every anime ("TV") says nothing, so it must sink even when it is the most
  // frequent tag in the library.
  const likedTagCount = new Map()
  const badTagCount = new Map()
  const allTagCount = new Map()
  let likedTotal = 0
  let badTotal = 0
  let taggedTotal = 0
  const rated = []
  const gaps = []

  for (const item of items) {
    const typeKey = TYPE_KEYS[item.subject_type]
    if (typeKey) byType[typeKey] += 1
    const statusKey = STATUS_KEYS[item.type]
    if (statusKey) byStatus[statusKey] += 1

    const rate = Number(item.rate) || 0
    const communityScore = Number(item.subject?.score) || 0
    const tags = Array.isArray(item.subject?.tags)
      ? item.subject.tags.map((tag) => (typeof tag === 'string' ? tag : tag?.name)).filter(isTasteTag)
      : (Array.isArray(item.tags) ? item.tags.filter(isTasteTag) : [])

    if (tags.length > 0) {
      taggedTotal += 1
      for (const tag of tags) allTagCount.set(tag, (allTagCount.get(tag) || 0) + 1)
    }

    if (rate > 0) {
      rated.push({ rate, communityScore })
      if (communityScore > 0) {
        gaps.push({
          id: item.subject_id,
          title: titleOf(item),
          rate,
          score: communityScore,
          gap: round(rate - communityScore, 1),
        })
      }
      // Only a genuinely liked work counts toward "favourites".
      if (rate >= 8) {
        likedTotal += 1
        for (const tag of tags) likedTagCount.set(tag, (likedTagCount.get(tag) || 0) + 1)
      }
    }

    if (item.type === 5 || (rate > 0 && rate <= 4)) {
      badTotal += 1
      for (const tag of tags) badTagCount.set(tag, (badTagCount.get(tag) || 0) + 1)
    }
  }

  const baseRate = (tag) => {
    const count = allTagCount.get(tag) || 0
    return taggedTotal > 0 ? count / taggedTotal : 0
  }

  function rankByLift(counts, total, minLift, limit) {
    // Small libraries cannot support a 3-item threshold, so scale it down.
    const minSupport = total >= 10 ? 3 : 1
    const entries = []
    for (const [name, count] of counts) {
      if (count < minSupport) continue
      const baseline = baseRate(name)
      if (baseline <= 0) continue
      const lift = (count / total) / baseline
      if (lift < minLift) continue
      entries.push({ name, lift: round(lift, 2), support: count })
    }
    return entries
      .sort((a, b) => b.lift * Math.log2(1 + b.support) - a.lift * Math.log2(1 + a.support) || a.name.localeCompare(b.name, 'zh'))
      .slice(0, limit)
  }

  const positive = rankByLift(likedTagCount, likedTotal, 1.2, 15)
  const positiveNames = new Set(positive.map((entry) => entry.name))
  const negative = rankByLift(badTagCount, badTotal, 1.5, 10)
    .filter((entry) => !positiveNames.has(entry.name))
    .slice(0, 5)

  const rates = rated.map((entry) => entry.rate)
  const ratedCount = rates.length
  const meanRate = mean(rates)
  const variance = ratedCount > 1
    ? rates.reduce((sum, value) => sum + (value - meanRate) ** 2, 0) / (ratedCount - 1)
    : 0
  const vsCommunityValues = rated.filter((entry) => entry.communityScore > 0).map((entry) => entry.rate - entry.communityScore)
  const vsCommunityMean = mean(vsCommunityValues)
  // The label uses the median: one disliked masterpiece must not redefine his taste.
  const vsCommunityMedian = median(vsCommunityValues)
  const distribution = { '1-5': 0, '6-7': 0, '8': 0, '9': 0, '10': 0 }
  for (const rate of rates) {
    if (rate <= 5) distribution['1-5'] += 1
    else if (rate <= 7) distribution['6-7'] += 1
    else distribution[String(rate)] = (distribution[String(rate)] || 0) + 1
  }

  const eras = {}
  for (const item of items) {
    const decade = decadeOf(yearOf(item))
    if (decade) eras[decade] = (eras[decade] || 0) + 1
  }

  const completions = []
  for (const item of items) {
    if (item.subject_type !== 2) continue
    const total = Number(item.subject?.eps) || Number(item.subject?.total_episodes) || 0
    const seen = Number(item.ep_status) || 0
    if (total > 0 && seen > 0) completions.push(Math.min(seen / total, 1))
  }

  const cutoff = Date.now() - RECENT_WINDOW_DAYS * DAY
  const recentItems = items
    .filter((item) => {
      const stamp = Date.parse(item.updated_at || '')
      return Number.isFinite(stamp) && stamp >= cutoff
    })
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))

  const recentDoing = recentItems
    .filter((item) => item.type === 3)
    .slice(0, 8)
    .map((item) => ({
      id: item.subject_id,
      title: titleOf(item),
      epStatus: Number(item.ep_status) || 0,
      eps: Number(item.subject?.eps) || Number(item.subject?.total_episodes) || 0,
    }))

  const recentDone = recentItems
    .filter((item) => item.type === 2)
    .slice(0, 8)
    .map((item) => ({ id: item.subject_id, title: titleOf(item), rate: Number(item.rate) || 0 }))

  const notes = []
  if (includeComments) {
    const commented = items
      .filter((item) => typeof item.comment === 'string' && item.comment.trim().length >= 30)
      .sort((a, b) => (Number(b.rate) || 0) - (Number(a.rate) || 0))
    const picked = [...commented.slice(0, 2), ...commented.slice(-1)]
    for (const item of picked) {
      if (!item || !item.comment) continue
      if (notes.some((note) => note.subjectId === item.subject_id)) continue
      notes.push({
        subjectId: item.subject_id,
        title: titleOf(item),
        rate: Number(item.rate) || 0,
        // One line, bounded: a raw comment keeps its newlines and blows up the render.
        excerpt: item.comment.replace(/\s+/g, ' ').trim().slice(0, 120),
      })
    }
  }

  const gapSorted = gaps.sort((a, b) => b.gap - a.gap)
  const topRated = [...items]
    .filter((item) => (Number(item.rate) || 0) >= 8)
    .sort((a, b) => (Number(b.rate) || 0) - (Number(a.rate) || 0) || b.subject_id - a.subject_id)
    .slice(0, 10)
    .map((item) => ({ id: item.subject_id, title: titleOf(item), rate: Number(item.rate) || 0 }))

  const profile = {
    builtAt: new Date().toISOString(),
    counts: {
      total: items.length,
      byType,
      byStatus,
    },
    rating: {
      ratedCount,
      mean: meanRate === null ? null : round(meanRate, 2),
      std: ratedCount > 1 ? round(Math.sqrt(variance), 2) : null,
      vsCommunityMean: vsCommunityMean === null ? null : round(vsCommunityMean, 2),
      vsCommunityMedian: vsCommunityMedian === null ? null : round(vsCommunityMedian, 2),
      strictness: vsCommunityMedian === null
        ? 'unknown'
        : vsCommunityMedian > 0.5 ? 'lenient' : vsCommunityMedian < -0.5 ? 'strict' : 'neutral',
      distribution,
      tenShare: ratedCount > 0 ? round(distribution['10'] / ratedCount, 3) : 0,
    },
    tags: { positive, negative },
    eras,
    completion: {
      sampleSize: completions.length,
      avgEpisodeCompletion: completions.length > 0 ? round(mean(completions), 2) : null,
      droppedTopTags: negative.slice(0, 3).map((entry) => entry.name),
    },
    recent: {
      windowDays: RECENT_WINDOW_DAYS,
      doing: recentDoing,
      done: recentDone,
    },
    notes,
    samples: {
      moreLenientThanCrowd: gapSorted.filter((entry) => entry.gap > 0).slice(0, 5),
      stricterThanCrowd: gapSorted.slice(-5).reverse().filter((entry) => entry.gap < 0),
      topRated,
    },
    flags: { includesPrivate: includePrivate, includesNsfw: includeNsfw, includesComments: includeComments },
  }
  // The version must describe the data, not the moment: exclude the timestamp
  // so an unchanged collection set keeps the same version across rebuilds.
  profile.version = profileVersion(profile)
  return profile
}

/** Recompute the content hash after enriching a profile (creators, etc.). */
export function profileVersion(profile) {
  const { builtAt: _builtAt, version: _version, ...content } = profile
  return createHash('sha1').update(JSON.stringify(content)).digest('hex').slice(0, 12)
}

const INFOBOX_ROLES = {
  动画制作: '动画制作',
  // 制作 / 製作 name the production committee, not the studio: listing those
  // produces "「SHIROBAKO」製作委員会" as if it were an animation studio.
  作者: '作者',
  出版社: '出版社',
  厂牌: '厂牌',
  レーベル: '厂牌',
  原作: '原作',
}

/**
 * Pull studio/author names out of a subject `infobox`, which is the cheapest
 * source (one `/v0/subjects/{id}` request instead of the persons endpoint).
 *
 * @returns {{role: string, name: string}[]}
 */
export function creatorsFromSubject(subject) {
  const infobox = Array.isArray(subject?.infobox) ? subject.infobox : []
  const found = []
  for (const entry of infobox) {
    const role = INFOBOX_ROLES[entry?.key]
    if (!role) continue
    const raw = entry.value
    const values = Array.isArray(raw) ? raw : [raw]
    for (const item of values) {
      const name = typeof item === 'string' ? item : item?.v
      if (typeof name === 'string' && name.trim()) found.push({ role, name: name.replace(/\s+/g, ' ').trim().slice(0, 80) })
    }
  }
  return found
}

function joinNames(entries, count) {
  return (entries || []).slice(0, count).map((entry) => entry.name).join('、')
}

/** A short, model-facing summary. Kept under 400 characters on purpose. */
export function briefOf(profile) {
  if (!profile) return ''
  const { counts, rating, tags, eras, completion, recent } = profile
  if (!counts.total) return ''

  const typeParts = Object.entries(counts.byType)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => `${TYPE_NAMES[Object.keys(TYPE_KEYS).find((id) => TYPE_KEYS[id] === key)]}${value}`)
  const strictness = rating.strictness === 'lenient' ? '偏宽容' : rating.strictness === 'strict' ? '偏严格' : '中性'
  const deviation = rating.vsCommunityMedian ?? rating.vsCommunityMean
  const community = deviation === null || deviation === undefined
    ? ''
    : `，比大众${deviation >= 0 ? '+' : ''}${deviation}`
  const decade = Object.entries(eras).sort((a, b) => b[1] - a[1])[0]
  const doing = recent.doing.slice(0, 2).map((item) => item.title).join('、')

  const parts = [
    `收藏 ${counts.total} 部（${typeParts.join(' / ')}）`,
    `打分${strictness}：均分 ${rating.mean ?? '—'}${community}`,
    tags.positive.length ? `偏爱标签 ${joinNames(tags.positive, 4)}` : '',
    tags.negative.length ? `回避 ${joinNames(tags.negative, 2)}` : '',
    decade ? `年代偏好 ${decade[0]}` : '',
    completion.avgEpisodeCompletion !== null ? `平均看完 ${Math.round(completion.avgEpisodeCompletion * 100)}%` : '',
    doing ? `近期在看 ${doing}` : '',
  ].filter(Boolean)

  let text = `主人的 Bangumi：${parts.join('；')}。`
  if (text.length > 400) text = `${text.slice(0, 397)}…`
  return text
}

/** Sectioned view for the `focus` parameter. */
export function profileSlice(profile, focus) {
  if (!profile) return null
  if (!focus || focus === 'summary') {
    return {
      version: profile.version,
      builtAt: profile.builtAt,
      counts: profile.counts,
      rating: {
        ratedCount: profile.rating.ratedCount,
        mean: profile.rating.mean,
        vsCommunityMean: profile.rating.vsCommunityMean,
        strictness: profile.rating.strictness,
      },
      tags: profile.tags,
      recent: profile.recent,
    }
  }
  if (focus === 'tags') return { version: profile.version, tags: profile.tags, eras: profile.eras }
  if (focus === 'rating') return { version: profile.version, rating: profile.rating, samples: profile.samples }
  if (focus === 'recent') return { version: profile.version, recent: profile.recent, notes: profile.notes }
  if (focus === 'creators') return { version: profile.version, creators: profile.creators || [] }
  return { version: profile.version, ...profile }
}
