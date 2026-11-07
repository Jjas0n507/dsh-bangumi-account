/**
 * Recommendation: candidates from this season, high-lift tag matches, and
 * related works.
 *
 * Two deliberate rules:
 * - Inferred dislikes only *lower* a score; they never remove a candidate.
 *   Only the owner's explicit `excludeTags`, private/NSFW content, and already
 *   collected works are hard filters.
 * - The calendar source feeds itself from what `api.calendar()` actually
 *   returns (an array), and every source reports whether it produced anything,
 *   so a dead source can never masquerade as "no good candidates".
 */
import { TYPE_NAMES } from './profile.js'

function titleOf(subject) {
  return subject?.name_cn || subject?.name || `#${subject?.id}`
}

function collectIds(collections) {
  const ids = new Set()
  for (const item of collections || []) ids.add(item.subject_id)
  return ids
}

function tagsOf(subject) {
  const tags = Array.isArray(subject?.tags) ? subject.tags : []
  return tags.map((tag) => (typeof tag === 'string' ? tag : tag?.name)).filter(Boolean)
}

function scoreOf(subject) {
  const value = subject?.rating?.score ?? subject?.score
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function rankOf(subject) {
  const value = subject?.rating?.rank ?? subject?.rank
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export async function recommend({ api, profile, collections, token, config, kind = 'anime', count = 3, excludeTags = [], signal }) {
  if (!profile || !profile.counts?.total) return { candidates: [], note: 'NOT_SYNCED' }

  const owned = collectIds(collections)
  const positive = profile.tags?.positive || []
  const positiveByName = new Map(positive.map((entry) => [entry.name, entry]))
  const negative = new Map((profile.tags?.negative || []).map((entry) => [entry.name, entry.lift || 1.5]))
  // The owner explicitly said "not this": that is a hard filter. Inferred
  // dislikes are not.
  const explicitExclude = new Set((Array.isArray(excludeTags) ? excludeTags : []).filter(Boolean))

  const sources = {
    calendar: { ok: false, count: 0 },
    tags: { ok: false, count: 0, used: [] },
    relations: { ok: false, count: 0 },
  }
  const candidates = new Map()

  function consider(subject, signalParts) {
    if (!subject?.id || owned.has(subject.id)) return
    if (!config.includeNsfw && subject.nsfw) return
    const tags = tagsOf(subject)
    if (tags.some((tag) => explicitExclude.has(tag))) return

    const calibrated = []
    let tagBonus = 0
    for (const tag of tags) {
      const entry = positiveByName.get(tag)
      if (!entry) continue
      const lift = Number(entry.lift) || 1.2
      if (lift < 1.2) continue
      tagBonus += 0.18 * Math.min(Math.log2(lift), 1.5)
      calibrated.push(entry)
    }
    let penalty = 0
    const cautions = []
    for (const tag of tags) {
      const lift = negative.get(tag)
      if (!lift) continue
      penalty += 0.2 * Math.min(Math.log2(lift), 1.5)
      cautions.push({ tag, lift })
    }

    const existing = candidates.get(subject.id)
    if (existing) {
      existing.tagBonus += tagBonus
      existing.penalty += penalty
      existing.signals.push(...signalParts)
      existing.calibrated.push(...calibrated)
      existing.cautions.push(...cautions)
      return
    }
    candidates.set(subject.id, {
      subject,
      tagBonus,
      penalty,
      signals: [...signalParts],
      calibrated,
      cautions,
    })
  }

  // 1. This season
  const currentYear = new Date().getFullYear()
  try {
    const days = await api.calendar(signal)
    sources.calendar.ok = true
    for (const day of days || []) {
      for (const item of day.items || []) {
        if (item.type !== 2) continue
        // A still-airing show that started years ago (One Piece, Conan) is not
        // a recommendation, it is a fixture.
        const started = Number(String(item.air_date || '').slice(0, 4))
        if (Number.isFinite(started) && started > 1900 && started <= currentYear - 2) continue
        const sizeBefore = candidates.size
        consider(item, [{ kind: 'calendar', weight: 0.15 }])
        if (candidates.size > sizeBefore) sources.calendar.count += 1
      }
    }
  } catch {
    sources.calendar.ok = false
  }

  // 2. High-lift tag search
  for (const entry of positive.slice(0, 2)) {
    try {
      const page = await api.search({
        kind: 'subjects',
        keyword: '',
        sort: 'rank',
        filter: {
          type: [2],
          tag: [entry.name],
          rating: ['>=7'],
          rating_count: ['>=200'],
          ...(config.includeNsfw ? {} : { nsfw: false }),
        },
        limit: 10,
        token,
        signal,
      })
      sources.tags.ok = true
      sources.tags.used.push(entry.name)
      for (const subject of page?.data || []) {
        const sizeBefore = candidates.size
        consider(subject, [{ kind: 'tag', tag: entry.name, weight: 0.3 }])
        if (candidates.size > sizeBefore) sources.tags.count += 1
      }
    } catch {
      /* one tag failing must not empty the result */
    }
  }

  // 3. Related works of the highest-rated entries
  for (const entry of (profile.samples?.topRated || []).slice(0, 2)) {
    try {
      const relations = await api.subjectRelations(entry.id, token, signal)
      sources.relations.ok = true
      for (const relation of relations || []) {
        if (relation.type !== 2) continue
        const sizeBefore = candidates.size
        consider(relation, [{ kind: 'relation', from: entry, relation: relation.relation }])
        if (candidates.size > sizeBefore) sources.relations.count += 1
      }
    } catch {
      /* related lookup is best effort */
    }
  }

  const scored = [...candidates.values()]
    .map((entry) => {
      const subject = entry.subject
      const score = scoreOf(subject)
      const rank = rankOf(subject)
      const relationSignal = entry.signals.find((signal) => signal.kind === 'relation')
      const calendarSignal = entry.signals.find((signal) => signal.kind === 'calendar')

      const community = score === null ? 0 : score / 10
      const rankBonus = rank && rank <= 500 ? 0.1 : 0
      const relationBonus = relationSignal ? 0.5 : 0
      const calendarBonus = calendarSignal ? 0.15 : 0
      const fit = entry.tagBonus + relationBonus + calendarBonus + community * 0.35 + rankBonus - entry.penalty
      // A recommendation must be able to say why it is *yours*; "it airs now"
      // alone is a season chart, not a recommendation.
      const personalized = entry.calibrated.length > 0 || Boolean(relationSignal)

      const reasons = []
      if (relationSignal) {
        reasons.push(`与《${relationSignal.from.title}》（你打了 ${relationSignal.from.rate} 分）是${relationSignal.relation || '同系列'}`)
      }
      const bestTag = [...entry.calibrated].sort((a, b) => (b.lift || 0) - (a.lift || 0))[0]
      if (bestTag) {
        reasons.push(`与你偏爱的「${bestTag.name}」重合（提升度 ${bestTag.lift}×）`)
      }
      if (calendarSignal) reasons.push(personalized ? '本季在播' : '本季在播（与你的口味没有明确关联）')

      const cautions = [...new Map(entry.cautions.map((caution) => [caution.tag, caution])).values()]
        .sort((a, b) => b.lift - a.lift)
        .slice(0, 2)
        .map((caution) => caution.tag)

      return {
        id: subject.id,
        title: titleOf(subject),
        type: TYPE_NAMES[subject.type] || '条目',
        score,
        rank,
        date: subject.date || null,
        url: `https://bgm.tv/subject/${subject.id}`,
        fit: Math.round(fit * 100) / 100,
        personalized,
        reasons: reasons.slice(0, 2),
        cautions,
      }
    })
    .sort((a, b) => Number(b.personalized) - Number(a.personalized) || b.fit - a.fit)

  const personalized = scored.filter((candidate) => candidate.personalized)
  const eligible = personalized.length >= Math.min(Math.max(Number(count) || 3, 1), 10)
    ? personalized
    : scored
  const limited = eligible.slice(0, Math.min(Math.max(Number(count) || 3, 1), 10))

  const result = {
    candidates: limited,
    requested: Math.min(Math.max(Number(count) || 3, 1), 10),
    returned: limited.length,
    basedOn: {
      ratedCount: profile.rating.ratedCount,
      topTags: positive.slice(0, 4).map((entry) => `${entry.name}(${entry.lift}×)`),
      version: profile.version,
    },
    excludedOwned: owned.size,
    sources,
  }
  if (limited.length < result.requested) {
    result.note = `只找到 ${limited.length} 条有个人关联的候选（请求 ${result.requested} 条）；已收藏、NSFW、以及被 excludeTags 排除的不计入。`
  }
  if (!sources.calendar.ok && !sources.tags.ok && !sources.relations.ok) {
    result.note = '三个候选来源都没有成功返回（可能是网络或接口问题），当前结果不可信。'
  }
  return result
}
