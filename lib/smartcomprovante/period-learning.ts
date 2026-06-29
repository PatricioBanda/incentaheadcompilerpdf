import type { PageProfile } from './document-intelligence'
import type { PeriodMark, PeriodSignal } from './types'

export type PeriodZoneTexts = { full: string; header: string; body: string; footer: string }

export type LearnedPeriodExtraction = {
  year: number | null
  month: number | null
  source: 'mark-nearby' | 'anchor-window' | 'zone' | 'document' | 'none'
  evidenceText: string
}

const monthPatterns = [
  ['janeiro|jan|01', 1],
  ['fevereiro|fev|02', 2],
  ['marco|marc|mar|03', 3],
  ['abril|abr|04', 4],
  ['maio|mai|05', 5],
  // "junh" covers 4-char banking truncations like "Cartao Refeicao Junh-..."
  ['junho|junh|jun|06', 6],
  ['julho|jul|07', 7],
  ['agosto|ago|08', 8],
  ['setembro|setem|set|09', 9],
  ['outubro|outub|out|10', 10],
  ['novembro|novem|nov|11', 11],
  ['dezembro|dezem|dez|12', 12],
] as const

export const normalizePeriodText = (text: string) => text
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLowerCase()
  .replace(/[_\-./:;()[\]]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

export const detectPeriodValue = (source: string, options?: { allowStandaloneFullDate?: boolean }): { year: number | null; month: number | null } => {
  const text = normalizePeriodText(source)
  const monthNamePattern = monthPatterns.map(([pattern]) => pattern.split('|').slice(0, 2).join('|')).join('|')
  const valid = (year: string | number, month: string | number) => {
    const parsedYear = Number(year)
    const parsedMonth = Number(month)
    if (parsedYear < 2020 || parsedYear > 2035 || parsedMonth < 1 || parsedMonth > 12) return null
    return { year: parsedYear, month: parsedMonth }
  }

  const rhPeriodExpression = text.match(
    /(?:sub\s+refeicao|subsidio\s+alimentacao|subs?\s+alimentacao|refeicao|vencimento|vencimentos|salario|salarios|remuneracao|remuneracoes|ordenado|ordenados)\s+(0?[1-9]|1[0-2])\s+(20[2-3][0-9])\b/,
  )
  if (rhPeriodExpression) return valid(rhPeriodExpression[2], rhPeriodExpression[1]) || { year: null, month: null }

  const labelledYearMonth = [
    /(?:ano mes de referencia|ano mes ref|ano mes|periodo|referencia|competencia|mes)\s+(20[2-3][0-9])\s+(0?[1-9]|1[0-2])/,
    /(?:ano mes de referencia|ano mes ref|ano mes|periodo|referencia|competencia|mes)\s+(0?[1-9]|1[0-2])\s+(20[2-3][0-9])/,
  ]
  for (const expression of labelledYearMonth) {
    const match = text.match(expression)
    if (!match) continue
    const period = match[1].startsWith('20') ? valid(match[1], match[2]) : valid(match[2], match[1])
    if (period) return period
  }

  // Build a wider pattern that includes all variants (including truncations like "junh")
  const allVariantsPattern = monthPatterns.map(([pattern]) => pattern.split('|').filter((v) => !/^\d+$/.test(v)).join('|')).join('|')

  const namedMonth = text.match(new RegExp(`\\b(${allVariantsPattern})(?:\\s+de)?\\s+(20[2-3][0-9])\\b`))
  if (namedMonth) {
    for (const [pattern, month] of monthPatterns) {
      const variants = pattern.split('|').filter((v) => !/^\d+$/.test(v))
      if (variants.some((v) => v === namedMonth[1])) return { year: Number(namedMonth[2]), month }
    }
  }

  // Non-adjacent: month name anywhere + year anywhere.
  // Only applies when the month name is adjacent to a description keyword (subsidio, refeicao…)
  // OR when there is no explicit DD/MM/YYYY date competing in the text.
  // Without this guard, "outubro" in a page header would override "30.09.2025" in the date column.
  const standaloneMonth = text.match(new RegExp(`\\b(${allVariantsPattern})\\b`))
  if (standaloneMonth) {
    const yearFromContext = text.match(/\b(20[2-3][0-9])\b/)
    if (yearFromContext) {
      const hasExplicitDate = /\b\d{1,2}\s+(0?[1-9]|1[0-2])\s+(20[2-3][0-9])\b/.test(text)
      const monthIdx = standaloneMonth.index ?? 0
      const nearContext = text.slice(Math.max(0, monthIdx - 35), monthIdx + 35)
      const hasDescriptionKeyword = /subsidio|refeicao|cartao|vencimento|salario|ordenado|ajuda/.test(nearContext)
      if (!hasExplicitDate || hasDescriptionKeyword) {
        for (const [pattern, month] of monthPatterns) {
          const variants = pattern.split('|').filter((v) => !/^\d+$/.test(v))
          if (variants.some((v) => v === standaloneMonth[1])) return { year: Number(yearFromContext[1]), month }
        }
      }
    }
  }

  if (options?.allowStandaloneFullDate !== false) {
    const fullDate = text.match(/\b(\d{1,2})\s+(0?[1-9]|1[0-2])\s+(20[2-3][0-9])\b/)
    if (fullDate) return valid(fullDate[3], fullDate[2]) || { year: null, month: null }

    const fullIsoDate = text.match(/\b(20[2-3][0-9])\s+(0?[1-9]|1[0-2])\s+\d{1,2}\b/)
    if (fullIsoDate) return valid(fullIsoDate[1], fullIsoDate[2]) || { year: null, month: null }
  }

  const yearMonth = text.match(/\b(20[2-3][0-9])\s+(0?[1-9]|1[0-2])\b/)
  if (yearMonth) return valid(yearMonth[1], yearMonth[2]) || { year: null, month: null }

  const monthYear = text.match(/\b(0?[1-9]|1[0-2])\s+(20[2-3][0-9])\b/)
  if (monthYear) return valid(monthYear[2], monthYear[1]) || { year: null, month: null }

  const compactDate = text.match(/\b(20[2-3][0-9])(0[1-9]|1[0-2])\b/)
  if (compactDate) return { year: Number(compactDate[1]), month: Number(compactDate[2]) }

  return { year: null, month: null }
}

const markCandidateTexts = (mark: PeriodMark, pageProfiles: PageProfile[]) => {
  const profile = pageProfiles.find((page) => page.pageNumber === mark.page) || pageProfiles[mark.page - 1]
  if (!profile || !profile.width || !profile.height || !profile.positionedLines.length) return []
  const lines = profile.positionedLines
    .map((line) => ({
      line,
      nx: line.x / profile.width,
      ny: line.y / profile.height,
      distance: Math.hypot((line.x / profile.width) - mark.x, (line.y / profile.height) - mark.y),
    }))
    .sort((left, right) => left.distance - right.distance)
  const nearest = lines[0]
  if (!nearest) return []

  const sameBand = lines
    .filter((item) => Math.abs(item.ny - mark.y) <= 0.065)
    .sort((left, right) => left.nx - right.nx)
    .map((item) => item.line.text)
    .join(' ')

  const neighborhood = lines
    .filter((item) => Math.abs(item.ny - nearest.ny) <= 0.11)
    .sort((left, right) => right.ny - left.ny || left.nx - right.nx)
    .map((item) => item.line.text)
    .join(' ')

  const closestLines = lines.slice(0, 5).map((item) => item.line.text).join(' ')
  return [sameBand, neighborhood, closestLines, nearest.line.text].filter(Boolean)
}

const tryTexts = (texts: string[], source: LearnedPeriodExtraction['source']) => {
  for (const text of texts) {
    const detected = detectPeriodValue(text, { allowStandaloneFullDate: false })
    if (detected.year && detected.month) return { ...detected, source, evidenceText: normalizePeriodText(text).slice(0, 180) }
  }
  for (const text of texts) {
    const detected = detectPeriodValue(text)
    if (detected.year && detected.month) return { ...detected, source, evidenceText: normalizePeriodText(text).slice(0, 180) }
  }
  return null
}

export const extractLearnedPeriod = (
  zones: PeriodZoneTexts,
  signal: PeriodSignal,
  pageProfiles: PageProfile[],
): LearnedPeriodExtraction => {
  const explicitMarkTexts = [signal.mark?.dateText, signal.mark?.label, signal.mark?.contextText]
    .filter((item): item is string => Boolean(item?.trim()))
  if (explicitMarkTexts.length) {
    const detected = tryTexts(explicitMarkTexts, 'mark-nearby')
    if (detected) return detected
  }

  if (signal.anchor_phrases.length) {
    const exactAnchor = tryTexts(signal.anchor_phrases, 'anchor-window')
    if (exactAnchor) return exactAnchor
  }

  if (signal.mark) {
    const detected = tryTexts(markCandidateTexts(signal.mark, pageProfiles), 'mark-nearby')
    if (detected) return detected
  }

  if (signal.anchor_phrases.length) {
    const norm = normalizePeriodText(zones.full)
    const candidates: string[] = []
    for (const anchor of signal.anchor_phrases) {
      const normalizedAnchor = normalizePeriodText(anchor)
      if (!normalizedAnchor) continue
      const anchorIdx = norm.indexOf(normalizedAnchor)
      if (anchorIdx !== -1) {
        candidates.push(norm.slice(Math.max(0, anchorIdx - 160), anchorIdx + normalizedAnchor.length + 240))
      } else if (normalizedAnchor.length >= 8) {
        // Fuzzy fallback: match the first 70% of the anchor phrase to handle minor spacing/formatting differences
        const prefix = normalizedAnchor.slice(0, Math.floor(normalizedAnchor.length * 0.7))
        const fallbackIdx = norm.indexOf(prefix)
        if (fallbackIdx !== -1) {
          candidates.push(norm.slice(Math.max(0, fallbackIdx - 160), fallbackIdx + normalizedAnchor.length + 240))
        }
      }
    }
    const detected = tryTexts(candidates, 'anchor-window')
    if (detected) return detected
  }

  if (signal.position) {
    const zoneText = signal.position === 'header' ? zones.header : signal.position === 'footer' ? zones.footer : zones.body
    const detected = tryTexts([zoneText], 'zone')
    if (detected) return detected
  }

  const detected = tryTexts([zones.full], 'document')
  if (detected) return detected
  return { year: null, month: null, source: 'none', evidenceText: '' }
}
