import { RH_FOLDERS } from './taxonomy'
import { inspectDocument } from './document-intelligence'
import type { PageProfile } from './document-intelligence'
import { detectPeriodValue, extractLearnedPeriod, type PeriodZoneTexts } from './period-learning'
import type { StoredClassification } from './store'
import type { EnrichedSectionFingerprint, PeriodMark, PeriodSignal } from './types'

const AUTO_FOLDER_CODES = RH_FOLDERS.filter((folder) => folder.number >= 1 && folder.number <= 13).map((folder) => folder.code)
const folderCodeSet = new Set<string>(AUTO_FOLDER_CODES)

export type RoutingSource = 'cache' | 'rules' | 'heuristic' | 'llm' | 'fallback'

export type RoutedClassification = {
  document_code: string
  confidence: number
  reason: string
  target_year: number | null
  target_month: number | null
  employee_name: string | null
  route_source: RoutingSource
}

type RuleContext = {
  rulesVersion: number
  approvedExamples: Array<Record<string, unknown>>
  sectionFingerprints?: Array<Record<string, unknown>>
  enrichedFingerprints?: EnrichedSectionFingerprint[]
}

type CandidatePattern = {
  code: string
  label: string
  strong: RegExp[]
  weak: RegExp[]
  negative?: RegExp[]
}

const normalize = (text: string) => text
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLowerCase()
  .replace(/[_\-./]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const monthPatterns = [
  ['janeiro|jan|01', 1],
  ['fevereiro|fev|02', 2],
  ['marco|marc|mar|03', 3],
  ['abril|abr|04', 4],
  ['maio|mai|05', 5],
  // "junh" covers 4-char banking truncations like "Subsidio Junh-..."
  ['junho|junh|jun|06', 6],
  ['julho|jul|07', 7],
  ['agosto|ago|08', 8],
  ['setembro|setem|set|09', 9],
  ['outubro|outub|out|10', 10],
  ['novembro|novem|nov|11', 11],
  ['dezembro|dezem|dez|12', 12],
] as const

const folderHints = [
  { number: 2, code: 'LC', label: 'Accounting posting', terms: ['lc', 'lancamento', 'lancamentos', 'contabil', 'contabilidade', 'diario', 'razao', 'movimentos contabilisticos', 'mapa contabilistico'] },
  { number: 3, code: 'TV', label: 'Salary transfer', terms: ['tv', 'transf venc', 'transf vencimento', 'transferencia vencimento', 'transferencias vencimento', 'transferencia salarios', 'pagamento salarios', 'salario', 'ordenado', 'vencimentos'] },
  { number: 4, code: 'EBV', label: 'Salary bank statement', terms: ['ebv', 'extrato vencimento', 'extracto vencimento', 'extrato salario', 'extracto salario', 'banco vencimento', 'movimento vencimento', 'debito salarios'] },
  { number: 5, code: 'TSA', label: 'Meal allowance transfer', terms: ['tsa', 'transf sa', 'transferencia subsidio alimentacao', 'subsidio alimentacao', 'subs alimentacao', 'cartao refeicao', 'refeicao', 'edenred', 'coverflex'] },
  { number: 6, code: 'EBSA', label: 'Meal allowance bank statement', terms: ['ebsa', 'extrato subsidio alimentacao', 'extracto subsidio alimentacao', 'extrato refeicao', 'extracto refeicao', 'movimento refeicao'] },
  { number: 7, code: 'SSR', label: 'Social Security DMR summary', terms: ['ssr', 'dmr resumo', 'declaracao mensal remuneracoes resumo', 'seguranca social resumo', 'resumo ss', 'resumo dmr', 'recapitulativo seguranca social'] },
  { number: 8, code: 'SSD', label: 'Social Security DMR detail', terms: ['ssd', 'dmr detalhe', 'declaracao mensal remuneracoes detalhe', 'seguranca social detalhe', 'detalhe ss', 'detalhe dmr', 'trabalhadores', 'remuneracoes trabalhador'] },
  { number: 9, code: 'GIR', label: 'IRS guide', terms: ['gir', 'guia irs', 'guia pagamento irs', 'guia retencao', 'duc irs', 'documento unico cobranca irs', 'retencao fonte guia'] },
  { number: 10, code: 'LIR', label: 'IRS listing', terms: ['lir', 'listagem irs', 'lista irs', 'relacao irs', 'retencoes fonte', 'mapa retencoes', 'listagem retencoes', 'mapa liquidacao irs', 'mapa de liquidacao de irs', 'liquidacao de irs'] },
  { number: 11, code: 'PSS', label: 'Social Security payment', terms: ['pss', 'pagamento seguranca social', 'pagamento ss', 'comprovativo seguranca social', 'comprovativo ss', 'taxa social unica', 'pagamento tsu', 'tsu', 'du documentos pagamento ss'] },
  { number: 12, code: 'PIR', label: 'IRS payment', terms: ['pir', 'pagamento irs', 'comprovativo irs', 'comprovativo pagamento irs', 'pagamento at', 'autoridade tributaria pagamento', 'portal financas pagamento', 'multi imposto', 'pagamentos ao estado', 'referencia para pagamento'] },
  { number: 13, code: 'EBI', label: 'Tax bank statement', terms: ['ebi', 'extrato impostos', 'extracto impostos', 'extrato irs', 'extracto irs', 'extrato seguranca social', 'extracto seguranca social', 'banco impostos', 'movimento impostos', 'extrato conta ordem', 'extracto conta ordem'] },
] as const

const patterns: CandidatePattern[] = [
  {
    code: 'LC',
    label: 'Accounting posting',
    strong: [/lancamento[s]? contabil/, /diario contabil/, /movimentos contabilisticos/, /contabilidade/],
    weak: [/lancamento/, /contabil/, /balancete/],
  },
  {
    code: 'TV',
    label: 'Salary transfer',
    strong: [/transferencia[s]?.{0,40}(vencimento|salario|ordenado|remunerac)/, /(vencimento|salario|ordenado).{0,40}transferencia/],
    weak: [/transferencia/, /salario/, /ordenado/, /vencimento/],
    negative: [/subsidio.{0,20}alimentacao/, /extrato bancario/],
  },
  {
    code: 'EBV',
    label: 'Salary bank statement',
    strong: [/extrato bancario.{0,80}(vencimento|salario|ordenado|remunerac)/, /(vencimento|salario|ordenado).{0,80}extrato bancario/],
    weak: [/extrato/, /banco/, /movimento bancario/, /vencimento/],
    negative: [/subsidio.{0,20}alimentacao/, /seguranca social/, /\birs\b/],
  },
  {
    code: 'TSA',
    label: 'Meal allowance transfer',
    strong: [/transferencia[s]?.{0,50}subsidio.{0,20}alimentacao/, /subsidio.{0,20}alimentacao.{0,50}transferencia/],
    weak: [/subsidio.{0,20}alimentacao/, /cartao refeicao/, /meal allowance/, /transferencia/],
    negative: [/extrato bancario/],
  },
  {
    code: 'EBSA',
    label: 'Meal allowance bank statement',
    strong: [/extrato bancario.{0,80}subsidio.{0,20}alimentacao/, /subsidio.{0,20}alimentacao.{0,80}extrato bancario/],
    weak: [/extrato/, /banco/, /subsidio.{0,20}alimentacao/, /cartao refeicao/],
  },
  {
    code: 'SSR',
    label: 'Social Security DMR summary',
    strong: [/declaracao mensal de remuneracoes.{0,80}resumo/, /\bdmr\b.{0,40}resumo/, /seguranca social.{0,60}resumo/, /entrega de ficheiro de remuneracoes.{0,80}extrato de resumo/, /extrato de resumo.{0,160}total de remuneracoes/],
    weak: [/\bdmr\b/, /declaracao mensal de remuneracoes/, /seguranca social/, /extrato de resumo/, /total de contribuicoes/],
    negative: [/detalhe/, /trabalhador/],
  },
  {
    code: 'SSD',
    label: 'Social Security DMR detail',
    strong: [/declaracao mensal de remuneracoes.{0,80}(detalhe|trabalhador)/, /\bdmr\b.{0,40}(detalhe|trabalhador)/, /seguranca social.{0,60}(detalhe|trabalhador)/],
    weak: [/\bdmr\b/, /declaracao mensal de remuneracoes/, /remuneracoes trabalhador/, /seguranca social/],
  },
  {
    code: 'GIR',
    label: 'IRS guide',
    strong: [/guia.{0,40}\birs\b/, /documento unico de cobranca.{0,80}\birs\b/, /retencoes? na fonte.{0,60}guia/],
    weak: [/\birs\b/, /retencoes? na fonte/, /guia/, /autoridade tributaria/],
    negative: [/listagem/, /relacao/],
  },
  {
    code: 'LIR',
    label: 'IRS listing',
    strong: [/listagem.{0,40}\birs\b/, /\birs\b.{0,40}listagem/, /relacao.{0,40}retencoes? na fonte/, /mapa de liquidacao de irs/, /liquidacao de irs.{0,120}(funcionario|valor coletavel|liquidado)/],
    weak: [/\birs\b/, /retencoes? na fonte/, /listagem/, /relacao/, /liquidacao/, /valor coletavel/, /liquidado/],
  },
  {
    code: 'PSS',
    label: 'Social Security payment',
    strong: [/pagamento.{0,60}seguranca social/, /comprovativo.{0,60}seguranca social/, /seg social.{0,60}pagamento/, /dados da operacao.{0,220}pagamento tsu/, /descricao.{0,40}pagamento tsu/],
    weak: [/pagamento/, /comprovativo/, /seguranca social/, /tsu/, /pagamento tsu/],
  },
  {
    code: 'PIR',
    label: 'IRS payment',
    strong: [/pagamento.{0,60}\birs\b/, /comprovativo.{0,60}\birs\b/, /\birs\b.{0,60}pagamento/, /referencia para pagamento.{0,160}\birs\b/, /pagamentos ao estado.{0,120}(referencia|linha otica|irs)/, /dados da operacao.{0,220}multi imposto/, /descricao.{0,40}multi imposto/],
    weak: [/pagamento/, /comprovativo/, /\birs\b/, /autoridade tributaria/, /multi imposto/, /pagamentos ao estado/, /referencia para pagamento/],
    negative: [/listagem/, /guia/],
  },
  {
    code: 'EBI',
    label: 'Tax bank statement',
    strong: [/extrato bancario.{0,160}(\birs\b|seguranca social|autoridade tributaria|imposto|pagamento tsu|multi imposto)/, /(\birs\b|seguranca social|autoridade tributaria|imposto|pagamento tsu|multi imposto).{0,160}extrato bancario/, /(extrato|extracto).{0,160}(periodo|data mov|saldo contabil).{0,260}(multi imposto|pagamento tsu|autoridade tributaria|seguranca social|\birs\b)/, /consultar saldos e movimentos.{0,160}data mov.{0,260}(multi imposto|pagamento tsu)/],
    weak: [/extrato/, /extracto/, /banco/, /\birs\b/, /seguranca social/, /imposto/, /autoridade tributaria/, /multi imposto/, /pagamento tsu/, /saldo contabilistico/],
  },
]

type ZoneTexts = { full: string; header: string; body: string; footer: string }

// Text near an operator's clicked point: the line(s) in the marked region,
// which normally hold the label + the date together.
const textNearMark = (mark: PeriodMark, pageProfiles: PageProfile[]): string => {
  const profile = pageProfiles.find((p) => p.pageNumber === mark.page) || pageProfiles[mark.page - 1]
  if (!profile || !profile.width || !profile.height || !profile.positionedLines.length) return ''
  const band = profile.positionedLines.filter((line) => Math.abs((line.y / profile.height) - mark.y) < 0.05)
  if (band.length) return normalize(band.map((line) => line.text).join(' '))
  let best = profile.positionedLines[0]
  let bestDist = Infinity
  for (const line of profile.positionedLines) {
    const dist = Math.hypot((line.x / profile.width) - mark.x, (line.y / profile.height) - mark.y)
    if (dist < bestDist) { bestDist = dist; best = line }
  }
  return normalize(best.text)
}

// Targeted period extraction. Priority: operator-marked spot → learned label/anchor
// phrases → marked zone (header/body/footer) → whole document.
const detectLearnedPeriod = (zones: ZoneTexts, signal: PeriodSignal, markText = ''): { year: number | null; month: number | null } => {
  // 1) Operator-marked spot — the line(s) around the exact point they clicked.
  if (markText) {
    const result = detectPeriod(markText)
    if (result.year && result.month) return result
  }
  // 2) Anchor phrases / learned label — search a window around each.
  if (signal.anchor_phrases.length) {
    const norm = normalize(zones.full)
    for (const anchor of signal.anchor_phrases) {
      const anchorIdx = norm.indexOf(normalize(anchor))
      if (anchorIdx === -1) continue
      const window = norm.slice(anchorIdx, anchorIdx + 80)
      const result = detectPeriod(window)
      if (result.year && result.month) return result
    }
  }
  // 2) Zone hint — scan only the region the operator marked.
  if (signal.position) {
    const zoneText = signal.position === 'header' ? zones.header : signal.position === 'footer' ? zones.footer : zones.body
    const result = detectPeriod(zoneText)
    if (result.year && result.month) return result
  }
  // 3) Fallback — scan the whole document.
  return detectPeriod(zones.full)
}

const detectPeriod = (source: string) => {
  const robustPeriod = detectPeriodValue(source)
  if (robustPeriod.year && robustPeriod.month) return robustPeriod
  const text = normalize(source)
  // All text variants (excluding pure-numeric codes like "06")
  const allVariantsPattern = monthPatterns.map(([pattern]) => pattern.split('|').filter((v) => !/^\d+$/.test(v)).join('|')).join('|')
  const valid = (year: string | number, month: string | number) => {
    const parsedYear = Number(year)
    const parsedMonth = Number(month)
    if (parsedYear < 2020 || parsedYear > 2035 || parsedMonth < 1 || parsedMonth > 12) return null
    return { year: parsedYear, month: parsedMonth }
  }
  const explicitYearMonth = [
    /(?:ano mes de referencia|ano mes ref|ano mes|periodo|referencia)\s+(20[2-3][0-9])\s+(0?[1-9]|1[0-2])/,
    /(20[2-3][0-9])\s+(0?[1-9]|1[0-2])\s+(?:periodo|referencia)/,
  ]
  for (const expression of explicitYearMonth) {
    const match = text.match(expression)
    const period = match ? valid(match[1], match[2]) : null
    if (period) return period
  }
  // Named month adjacent to year (e.g. "Junho 2025")
  const namedMonth = text.match(new RegExp(`\\b(${allVariantsPattern})\\s+(20[2-3][0-9])\\b`))
  if (namedMonth) {
    for (const [pattern, month] of monthPatterns) {
      const variants = pattern.split('|').filter((v) => !/^\d+$/.test(v))
      if (variants.some((v) => v === namedMonth[1])) return { year: Number(namedMonth[2]), month }
    }
  }
  // Non-adjacent: month name anywhere + year anywhere (handles "Subsidio Junho-D46RP717" + "04-07-2025").
  // Only applies when the month name sits next to a description keyword (subsidio, refeicao, etc.)
  // OR when there is no explicit DD/MM/YYYY date competing in the text.
  // Without this guard, "outubro" in a page header would override "30.09.2025" in the date column.
  const standaloneMonthMatch = text.match(new RegExp(`\\b(${allVariantsPattern})\\b`))
  if (standaloneMonthMatch) {
    const yearFromContext = text.match(/\b(20[2-3][0-9])\b/)
    if (yearFromContext) {
      const hasExplicitDate = /\b\d{1,2}\s+(0?[1-9]|1[0-2])\s+(20[2-3][0-9])\b/.test(text)
      const monthIdx = standaloneMonthMatch.index ?? 0
      const nearContext = text.slice(Math.max(0, monthIdx - 35), monthIdx + 35)
      const hasDescriptionKeyword = /subsidio|refeicao|cartao|vencimento|salario|ordenado|ajuda/.test(nearContext)
      if (!hasExplicitDate || hasDescriptionKeyword) {
        for (const [pattern, month] of monthPatterns) {
          const variants = pattern.split('|').filter((v) => !/^\d+$/.test(v))
          if (variants.some((v) => v === standaloneMonthMatch[1])) return { year: Number(yearFromContext[1]), month }
        }
      }
    }
  }
  const compactDate = text.match(/\b(20[2-3][0-9])(0[1-9]|1[0-2])\b/)
  if (compactDate) return { year: Number(compactDate[1]), month: Number(compactDate[2]) }
  const operationDate = text.match(/(?:data valor|data do movimento|data de movimento|data emissao|data de emissao)\s+(\d{1,2})\s+(0?[1-9]|1[0-2])\s+(20[2-3][0-9])/)
  if (operationDate) return valid(operationDate[3], operationDate[2]) || { year: null, month: null }
  const operationIsoDate = text.match(/(?:data valor|data do movimento|data de movimento|data emissao|data de emissao)\s+(20[2-3][0-9])\s+(0?[1-9]|1[0-2])\s+\d{1,2}/)
  if (operationIsoDate) return valid(operationIsoDate[1], operationIsoDate[2]) || { year: null, month: null }
  return { year: null, month: null }
}

const tokensFromExample = (example: Record<string, unknown>) => {
  const value = example.filename_tokens
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 2)
}

const exampleScore = (code: string, filename: string, ruleContext?: RuleContext) => {
  if (!ruleContext?.approvedExamples.length) return 0
  const filenameTokens = new Set(normalize(filename).split(' ').filter((token) => token.length > 2))
  let best = 0
  for (const example of ruleContext.approvedExamples) {
    if (example.document_code !== code) continue
    const tokens = tokensFromExample(example)
    if (!tokens.length) continue
    const hits = tokens.filter((token) => filenameTokens.has(normalize(token))).length
    best = Math.max(best, hits / Math.max(1, tokens.length))
  }
  return best
}

const directFolderHint = (filenameText: string, bodyText: string) => {
  const combined = `${filenameText} ${bodyText}`
  let best: { code: string; label: string; score: number; reason: string } | null = null
  for (const hint of folderHints) {
    let score = 0
    const matched: string[] = []
    const folderNumber = String(hint.number).padStart(2, '0')
    const folderCode = normalize(hint.code)
    const numberMarker = new RegExp(`(?:pasta|folder|grupo|f)\\s*0?${hint.number}(?:\\b|\\s|_|-|\\.)`, 'i')
    const codeMarker = new RegExp(`(?:^|\\b|_|-|\\.)${folderCode}(?:\\b|\\s|_|-|\\.)`, 'i')
    if (numberMarker.test(filenameText) || filenameText.includes(`${folderNumber} ${folderCode}`) || filenameText.includes(`${folderNumber}${folderCode}`)) {
      score += 0.54
      matched.push(`folder number ${folderNumber}`)
    }
    if (codeMarker.test(filenameText)) {
      score += 0.5
      matched.push(`folder code ${hint.code}`)
    }
    for (const term of hint.terms) {
      const normalizedTerm = normalize(term)
      if (filenameText.includes(normalizedTerm)) {
        score += 0.22
        matched.push(`filename term "${term}"`)
      } else if (combined.includes(normalizedTerm)) {
        score += 0.1
        matched.push(`text term "${term}"`)
      }
    }
    if (score > (best?.score || 0)) best = { code: hint.code, label: hint.label, score: Math.min(0.88, score), reason: matched.slice(0, 4).join(', ') }
  }
  return best && best.score >= 0.34 ? best : null
}

// Scoring against a single enriched fingerprint using all available signal layers
const scoreEnrichedFingerprint = (
  combined: string,
  fp: EnrichedSectionFingerprint,
): { score: number; matched: string[] } => {
  let score = 0
  const matched: string[] = []
  const genericLearningTerms = new Set(['eur', 'agix', 'lda', '513256180', 'pagina', 'page', 'total', 'valor', 'data', 'conta', 'nome', 'nif'])
  const useful = (term: string) => {
    const normalized = normalize(term)
    return normalized.length > 2 && !genericLearningTerms.has(normalized) && !/^\d+$/.test(normalized)
  }
  // Required terms (high confidence — appear in ≥60% of training examples)
  for (const term of fp.required_terms.slice(0, 15)) {
    const n = normalize(term)
    if (useful(term) && n && combined.includes(n)) { score += 0.5; matched.push(`req:${term}`) }
  }
  // Header terms (structural patterns detected during extraction)
  for (const term of fp.header_terms.slice(0, 10)) {
    const n = normalize(term)
    if (n && combined.includes(n)) { score += term.split(' ').length > 1 ? 0.3 : 0.14; matched.push(`hdr:${term}`) }
  }
  // TF-IDF distinctive terms
  for (const term of fp.tfidf_terms.slice(0, 12)) {
    if (useful(term) && combined.includes(normalize(term))) { score += 0.2; matched.push(`tf:${term}`) }
  }
  // N-grams (exclusive multi-word phrases)
  for (const phrase of fp.ngrams.slice(0, 8)) {
    if (combined.includes(normalize(phrase))) { score += 0.45; matched.push(`ng:${phrase}`) }
  }
  // LLM-generated distinctive descriptors
  for (const descriptor of fp.llm_descriptors.slice(0, 6)) {
    const n = normalize(descriptor)
    if (n && combined.includes(n)) { score += 0.4; matched.push(`llm:${descriptor}`) }
  }
  // Optional terms (lighter weight)
  for (const term of fp.optional_terms.slice(0, 10)) {
    if (useful(term) && combined.includes(normalize(term))) score += 0.08
  }
  // Negative terms — penalise if this text belongs to a competing section
  for (const term of fp.negative_terms.slice(0, 8)) {
    if (combined.includes(normalize(term))) score -= 0.28
  }
  return { score: Math.max(0, Math.min(0.98, score)), matched }
}

const enrichedSectionHint = (
  filenameText: string,
  bodyText: string,
  fingerprints: EnrichedSectionFingerprint[],
): { code: string; label: string; score: number; reason: string } | null => {
  const combined = `${filenameText} ${bodyText}`
  let best: { code: string; label: string; score: number; reason: string } | null = null
  for (const fp of fingerprints) {
    if (!folderCodeSet.has(fp.document_code)) continue
    const { score, matched } = scoreEnrichedFingerprint(combined, fp)
    if (score > (best?.score || 0)) {
      best = { code: fp.document_code, label: fp.label, score, reason: matched.slice(0, 5).join(', ') }
    }
  }
  return best && best.score >= 0.28 ? best : null
}

const learnedSectionHint = (filenameText: string, bodyText: string, ruleContext?: RuleContext) => {
  // Prefer aggregated enriched fingerprints (post-Layer 6+7 training) when available
  if (process.env.SMARTCOMPROVANTE_USE_ENRICHED_CLUSTERING === '1' && ruleContext?.enrichedFingerprints?.length) {
    return enrichedSectionHint(filenameText, bodyText, ruleContext.enrichedFingerprints)
  }

  // Fall back to per-example section fingerprints (pre-training baseline)
  const fingerprints = ruleContext?.sectionFingerprints || []
  if (!fingerprints.length) return null
  const combinedTokens = new Set(`${filenameText} ${bodyText}`.split(' ').filter((token) => token.length > 2))
  let best: { code: string; label: string; score: number; reason: string } | null = null
  for (const fingerprint of fingerprints) {
    const code = typeof fingerprint.document_code === 'string' ? fingerprint.document_code : ''
    const label = typeof fingerprint.label === 'string' ? fingerprint.label : code
    const headerTerms = Array.isArray(fingerprint.header_terms) ? fingerprint.header_terms.filter((item): item is string => typeof item === 'string') : []
    const sampleTokens = Array.isArray(fingerprint.sample_tokens) ? fingerprint.sample_tokens.filter((item): item is string => typeof item === 'string') : []
    if (!code || !folderCodeSet.has(code)) continue
    let score = 0
    const matched: string[] = []
    for (const term of headerTerms) {
      const normalized = normalize(term)
      if (normalized && `${filenameText} ${bodyText}`.includes(normalized)) {
        score += normalized.split(' ').length > 1 ? 0.28 : 0.12
        matched.push(`learned header "${term}"`)
      }
    }
    const relevantTokens = sampleTokens.map(normalize).filter((token) => token.length > 2).slice(0, 35)
    const tokenHits = relevantTokens.filter((token) => combinedTokens.has(token)).length
    if (relevantTokens.length) {
      const ratio = tokenHits / relevantTokens.length
      score += Math.min(0.55, ratio * 1.2)
      if (tokenHits) matched.push(`${tokenHits}/${relevantTokens.length} learned tokens`)
    }
    if (score > (best?.score || 0)) best = { code, label, score: Math.min(0.92, score), reason: matched.slice(0, 5).join(', ') }
  }
  return best && best.score >= 0.3 ? best : null
}

const explicitAdministrativeProofHint = (source: string) => {
  const isBankOperationProof = /dados da operacao|dados da operação|consultar saldos e movimentos a ordem|consultar saldos e movimentos à ordem/.test(source)
  const isBankStatement = /(extrato|extracto).{0,80}(periodo|período|data mov|saldo contabil)|data mov.{0,80}data valor|saldo contabilistico/.test(source)
  const hasTsu = /pagamento tsu|taxa social unica|seguranca social/.test(source)
  const hasTax = /multi imposto|pagamentos ao estado|autoridade tributaria|\birs\b|referencia para pagamento/.test(source)
  if (isBankOperationProof && hasTsu) {
    return { code: 'PSS', label: 'Social Security payment', confidence: 0.68, reason: 'Explicit bank operation proof with "PAGAMENTO TSU"/Social Security signal.' }
  }
  if (isBankOperationProof && hasTax) {
    return { code: 'PIR', label: 'IRS payment', confidence: 0.64, reason: 'Explicit bank/tax operation proof with "Multi Imposto", IRS, AT, or state-payment reference.' }
  }
  if (isBankStatement && (hasTsu || hasTax)) {
    return { code: 'EBI', label: 'Tax bank statement', confidence: 0.58, reason: 'Bank statement/extract contains tax or Social Security movements, so it belongs to the tax-bank-statement family.' }
  }
  if (/entrega de ficheiro de remuneracoes.{0,120}extrato de resumo|extrato de resumo.{0,180}total de remuneracoes/.test(source)) {
    return { code: 'SSR', label: 'Social Security DMR summary', confidence: 0.66, reason: 'Explicit Segurança Social remuneration-file summary layout.' }
  }
  if (/mapa de liquidacao de irs|liquidacao de irs.{0,160}(funcionario|valor coletavel|liquidado)/.test(source)) {
    return { code: 'LIR', label: 'IRS listing', confidence: 0.66, reason: 'Explicit IRS liquidation/listing map layout.' }
  }
  return null
}

const scorePattern = (pattern: CandidatePattern, filenameText: string, bodyText: string, ruleContext?: RuleContext) => {
  let score = 0
  const matched: string[] = []
  for (const expression of pattern.strong) {
    if (expression.test(filenameText)) {
      score += 0.42
      matched.push('filename strong signal')
      break
    }
  }
  for (const expression of pattern.strong) {
    if (expression.test(bodyText)) {
      score += 0.36
      matched.push('PDF text strong signal')
      break
    }
  }
  const filenameWeakHits = pattern.weak.filter((expression) => expression.test(filenameText)).length
  const bodyWeakHits = pattern.weak.filter((expression) => expression.test(bodyText)).length
  score += Math.min(0.24, filenameWeakHits * 0.08)
  score += Math.min(0.18, bodyWeakHits * 0.05)
  if (filenameWeakHits) matched.push(`${filenameWeakHits} filename keyword(s)`)
  if (bodyWeakHits) matched.push(`${bodyWeakHits} text keyword(s)`)
  const sampleScore = exampleScore(pattern.code, filenameText, ruleContext)
  if (sampleScore > 0) {
    score += Math.min(0.12, sampleScore * 0.12)
    matched.push('approved company example similarity')
  }
  const negativeHit = pattern.negative?.some((expression) => expression.test(`${filenameText} ${bodyText}`))
  if (negativeHit) score -= 0.22
  return { score: Math.max(0, Math.min(0.98, score)), matched }
}

export const storedClassificationToRoute = (classification: StoredClassification): RoutedClassification => ({
  document_code: classification.document_code,
  confidence: classification.confidence,
  reason: classification.reason,
  target_year: classification.target_year,
  target_month: classification.target_month,
  employee_name: classification.employee_name,
  route_source: 'cache',
})

export const localRouteDocument = async (
  file: File,
  target: { year: number; month: number },
  ruleContext?: RuleContext,
  sourceName?: string,
  options?: { ignorePeriodConfidence?: boolean },
): Promise<RoutedClassification> => {
  const intelligence = await inspectDocument(file)
  const text = intelligence.text
  const filenameText = normalize(sourceName || file.name)
  const bodyText = normalize(`${text} ${intelligence.layoutTokens.join(' ')} ${intelligence.pageProfiles.map((page) => `${page.headerText} ${page.footerText}`).join(' ')}`)
  const source = `${filenameText} ${bodyText}`
  // Per-zone text so a learned/operator-marked position can target the date region.
  const zoneTexts: ZoneTexts = {
    full: bodyText,
    header: normalize(intelligence.pageProfiles.map((page) => page.headerText).join(' ')),
    body: normalize(text),
    footer: normalize(intelligence.pageProfiles.map((page) => page.footerText).join(' ')),
  }
  const period = detectPeriod(source)
  const learnedPeriodForCode = (documentCode: string) => {
    const signal = ruleContext?.enrichedFingerprints?.find((fp) => fp.document_code === documentCode)?.period_signal
    // A mark or saved anchor phrase is a direct user instruction — always apply it regardless of detection_rate.
    // Only skip learned extraction when there's no explicit signal AND detection_rate is still too low.
    const hasExplicitSignal = Boolean(signal?.mark || signal?.anchor_phrases?.length)
    if (!signal || (signal.detection_rate < 0.5 && !hasExplicitSignal)) return { year: period.year, month: period.month, evidence: '', confidenceDelta: 0 }
    const learned = extractLearnedPeriod(zoneTexts, signal, intelligence.pageProfiles)
    if (!learned.year || !learned.month) return { year: period.year, month: period.month, evidence: '', confidenceDelta: 0 }
    if (learned.year === target.year && learned.month === target.month) {
      return {
        year: learned.year,
        month: learned.month,
        evidence: ` · period:${String(learned.month).padStart(2, '0')}/${learned.year} via learned date mark`,
        confidenceDelta: 0.1,
      }
    }
    return {
      year: learned.year,
      month: learned.month,
      evidence: ` · period mismatch via learned date mark (found ${learned.month}/${learned.year})`,
      confidenceDelta: options?.ignorePeriodConfidence ? 0 : -0.15,
    }
  }
  const structuralSignals = [
    intelligence.metadata.creator ? `creator=${intelligence.metadata.creator}` : null,
    intelligence.numberingPatterns.length ? `${intelligence.numberingPatterns.length} numbered-list pattern(s)` : null,
    intelligence.hierarchyHints.length ? `${intelligence.hierarchyHints.length} hierarchy hint(s)` : null,
    intelligence.pageProfiles.some((page) => page.positionedLines.length) ? 'coordinate layout extracted' : null,
  ].filter((item): item is string => Boolean(item))
  const diagnostics = [...structuralSignals, ...intelligence.diagnostics].join(' ')
  const explicitHint = explicitAdministrativeProofHint(source)
  if (explicitHint) {
    const learnedPeriod = learnedPeriodForCode(explicitHint.code)
    return {
      document_code: explicitHint.code,
      confidence: Math.max(0, Math.min(0.98, explicitHint.confidence + learnedPeriod.confidenceDelta)),
      reason: `${explicitHint.reason} Structure: ${diagnostics || 'PDF text and coordinate layout inspected.'}${learnedPeriod.evidence}`,
      target_year: learnedPeriod.year,
      target_month: learnedPeriod.month,
      employee_name: null,
      route_source: 'heuristic',
    }
  }
  const learnedHint = learnedSectionHint(filenameText, bodyText, ruleContext)
  if (learnedHint) {
    const lhFingerprint = ruleContext?.enrichedFingerprints?.find((fp) => fp.document_code === learnedHint.code)
    const lhSig = lhFingerprint?.period_signal
    let lhConfidence = Math.max(0.38, learnedHint.score)
    let lhYear = period.year
    let lhMonth = period.month
    let lhPeriodNote = ''
    const lhHasExplicitSignal = Boolean(lhSig?.mark || lhSig?.anchor_phrases?.length)
    if (lhSig && (lhSig.detection_rate >= 0.5 || lhHasExplicitSignal)) {
      const learned = extractLearnedPeriod(zoneTexts, lhSig, intelligence.pageProfiles)
      if (learned.year && learned.month) {
        lhYear = learned.year
        lhMonth = learned.month
        if (learned.year === target.year && learned.month === target.month) {
          lhConfidence = Math.min(0.98, lhConfidence + 0.10)
          lhPeriodNote = ` · period:${String(learned.month).padStart(2,'0')}/${learned.year} via learned anchor`
        } else {
          if (!options?.ignorePeriodConfidence) lhConfidence = Math.max(0, lhConfidence - 0.25)
          lhPeriodNote = ` · period mismatch via learned pattern (found ${learned.month}/${learned.year})`
        }
      }
    } else {
      if (period.year === target.year) lhConfidence = Math.min(0.98, lhConfidence + 0.04)
      if (period.month === target.month) lhConfidence = Math.min(0.98, lhConfidence + 0.05)
      if (!options?.ignorePeriodConfidence && ((period.year && period.year !== target.year) || (period.month && period.month !== target.month))) lhConfidence = Math.max(0, lhConfidence - 0.18)
    }
    return {
      document_code: learnedHint.code,
      confidence: lhConfidence,
      reason: `Learned join-section similarity for ${learnedHint.label}: ${learnedHint.reason}. Compared against uploaded Base/Final Join section fingerprints. Structure: ${diagnostics || 'text layout inspected.'}${lhPeriodNote}`,
      target_year: lhYear,
      target_month: lhMonth,
      employee_name: null,
      route_source: 'rules',
    }
  }
  const directHint = directFolderHint(filenameText, bodyText)
  if (directHint) {
    const learnedPeriod = learnedPeriodForCode(directHint.code)
    return {
      document_code: directHint.code,
      confidence: Math.max(0, Math.min(0.98, Math.max(0.42, directHint.score) + learnedPeriod.confidenceDelta)),
      reason: `Similarity cluster hint for ${directHint.label}: ${directHint.reason}. Structure: ${diagnostics || 'text layout inspected.'} This is enough for grouping; month classification can still request review if confidence is low.${learnedPeriod.evidence}`,
      target_year: learnedPeriod.year,
      target_month: learnedPeriod.month,
      employee_name: null,
      route_source: ruleContext?.approvedExamples.length ? 'rules' : 'heuristic',
    }
  }

  const rvSignal = /recibo[s]?.{0,30}(vencimento|salario|remunerac)|folha de vencimento|payslip/.test(source)
  if (rvSignal) {
    return {
      document_code: 'RV',
      confidence: 0.64,
      reason: 'Looks like a payslip/folder 1 document. It is grouped separately for Final Join, while folders 2-13 feed the Base Join.',
      target_year: period.year,
      target_month: period.month,
      employee_name: null,
      route_source: 'heuristic',
    }
  }

  const candidates = patterns
    .map((pattern) => ({ ...scorePattern(pattern, filenameText, bodyText, ruleContext), pattern }))
    .sort((left, right) => right.score - left.score)

  const best = candidates[0]
  const second = candidates[1]
  if (!best || best.score < 0.3) {
    return {
      document_code: 'UNKNOWN',
      confidence: intelligence.ocrRecommended ? 0.18 : 0.35,
      reason: intelligence.ocrRecommended
        ? `Local text extraction found little or no searchable text; OCR/LLM or human review is required. Diagnostics: ${diagnostics}`
        : `No strong local rule matched this document. Diagnostics: ${diagnostics || 'PDF text and coordinate layout inspected.'}`,
      target_year: period.year,
      target_month: period.month,
      employee_name: null,
      route_source: 'heuristic',
    }
  }

  const gap = best.score - (second?.score || 0)
  let confidence = best.score
  const matchedFingerprint = ruleContext?.enrichedFingerprints?.find((fp) => fp.document_code === best.pattern.code)
  const learnedSig = matchedFingerprint?.period_signal
  let resolvedYear = period.year
  let resolvedMonth = period.month
  let periodEvidence = ''
  if (learnedSig && learnedSig.detection_rate >= 0.5) {
    const learned = extractLearnedPeriod(zoneTexts, learnedSig, intelligence.pageProfiles)
    if (learned.year && learned.month) {
      resolvedYear = learned.year
      resolvedMonth = learned.month
      if (learned.year === target.year && learned.month === target.month) {
        confidence += 0.10
        periodEvidence = ` · period:${String(learned.month).padStart(2,'0')}/${learned.year} via learned anchor`
      } else {
        if (!options?.ignorePeriodConfidence) confidence -= 0.25
        periodEvidence = ` · period mismatch via learned pattern (found ${learned.month}/${learned.year})`
      }
    }
  } else {
    if (period.year === target.year) confidence += 0.04
    if (period.month === target.month) confidence += 0.05
    if (!options?.ignorePeriodConfidence && ((period.year && period.year !== target.year) || (period.month && period.month !== target.month))) confidence -= 0.18
  }
  if (gap < 0.12) confidence -= 0.1
  confidence = Math.max(0, Math.min(0.98, confidence))

  return {
    document_code: folderCodeSet.has(best.pattern.code) ? best.pattern.code : 'UNKNOWN',
    confidence,
    reason: `Local ${best.pattern.label} match: ${best.matched.join(', ') || 'pattern evidence'}. Structure: ${diagnostics || 'PDF text and coordinate layout inspected.'} Runner: cache -> rules/examples -> filename/PDF text/layout -> LLM fallback.${periodEvidence}`,
    target_year: resolvedYear,
    target_month: resolvedMonth,
    employee_name: null,
    route_source: ruleContext?.approvedExamples.length ? 'rules' : 'heuristic',
  }
}

// Directly applies the saved anchor/mark for a KNOWN document code without re-routing.
// Use this when the document type is already known (e.g. from a cluster) to avoid the
// routing step picking the wrong fingerprint and ignoring the user-saved anchor.
export const extractPeriodForKnownCode = async (
  file: File,
  documentCode: string,
  ruleContext: { enrichedFingerprints?: Array<{ document_code: string; period_signal?: import('./types').PeriodSignal }> },
): Promise<{ year: number | null; month: number | null; evidenceText: string; source: string } | null> => {
  const signal = ruleContext.enrichedFingerprints?.find((fp) => fp.document_code === documentCode)?.period_signal
  const hasExplicitSignal = Boolean(signal?.mark || signal?.anchor_phrases?.length)
  if (!signal || (signal.detection_rate < 0.5 && !hasExplicitSignal)) return null
  const intelligence = await inspectDocument(file)
  const zoneTexts: PeriodZoneTexts = {
    full: normalize(`${intelligence.text} ${intelligence.layoutTokens.join(' ')} ${intelligence.pageProfiles.map((p) => `${p.headerText} ${p.footerText}`).join(' ')}`),
    header: normalize(intelligence.pageProfiles.map((p) => p.headerText).join(' ')),
    body: normalize(intelligence.text),
    footer: normalize(intelligence.pageProfiles.map((p) => p.footerText).join(' ')),
  }
  const learned = extractLearnedPeriod(zoneTexts, signal, intelligence.pageProfiles)
  if (!learned.year || !learned.month) return null
  return { year: learned.year, month: learned.month, evidenceText: learned.evidenceText, source: learned.source }
}

export const normalizeLlmRoute = (classification: {
  document_code: string
  confidence: number
  reason: string
  target_year: number | null
  target_month: number | null
  employee_name: string | null
}): RoutedClassification => ({
  ...classification,
  route_source: 'llm',
})
