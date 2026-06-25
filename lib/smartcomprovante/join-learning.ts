import { RH_FOLDERS } from './taxonomy'
import type { PeriodFormat } from './types'

export type SectionFingerprint = {
  document_code: string
  folder_number: number
  label: string
  page_numbers: number[]
  header_terms: string[]
  sample_tokens: string[]
  page_count: number
  date_position: 'header' | 'footer' | 'body' | null
  section_order: number
}

const normalize = (text: string) => text
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLowerCase()
  .replace(/[_\-./:;()[\]]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const tokenise = (text: string) => normalize(text)
  .split(' ')
  .filter((token) => token.length > 2 && !/^\d+$/.test(token))

const folderTerms = (folder: typeof RH_FOLDERS[number]) => {
  const base = [folder.code, folder.label, `${folder.number}`, String(folder.number).padStart(2, '0')]
  const extra: Record<string, string[]> = {
    RV: ['recibo vencimento', 'folha vencimento', 'payslip', 'remuneracao'],
    LC: ['lancamento contabilistico', 'contabilidade', 'diario'],
    TV: ['transferencia vencimento', 'transferencias vencimento', 'salario', 'ordenado'],
    EBV: ['extrato vencimento', 'extrato salario', 'banco vencimento'],
    TSA: ['transferencia subsidio alimentacao', 'subsidio alimentacao', 'refeicao'],
    EBSA: ['extrato subsidio alimentacao', 'extrato refeicao'],
    SSR: ['dmr resumo', 'seguranca social resumo', 'resumo dmr'],
    SSD: ['dmr detalhe', 'seguranca social detalhe', 'detalhe dmr', 'trabalhador'],
    GIR: ['guia irs', 'documento unico cobranca', 'duc irs'],
    LIR: ['listagem irs', 'relacao irs', 'retencoes fonte'],
    PSS: ['pagamento seguranca social', 'pagamento ss', 'taxa social unica'],
    PIR: ['pagamento irs', 'autoridade tributaria pagamento'],
    EBI: ['extrato impostos', 'extrato irs', 'extrato seguranca social', 'autoridade tributaria', 'pagamento ao estado'],
  }
  return [...base, ...(extra[folder.code] || [])].map(normalize).filter(Boolean)
}

const strongPagePatterns: Record<string, Array<{ pattern: RegExp; weight: number; label: string }>> = {
  RV: [
    { pattern: /recibo de vencimento/, weight: 1.4, label: 'recibo de vencimento' },
    { pattern: /data de processamento.*entidade patronal.*empregado/, weight: 1.0, label: 'payroll receipt layout' },
  ],
  LC: [
    { pattern: /extracto de contas|extrato de contas/, weight: 1.3, label: 'extracto de contas' },
    { pattern: /centro custo.*conta.*datas/, weight: 0.9, label: 'accounting cost-center layout' },
    { pattern: /int salarios processamento|processamento 901/, weight: 0.7, label: 'salary accounting posting' },
  ],
  TV: [
    { pattern: /comprovativo de operacao.*transferencia|dados da operacao.*conta destino/, weight: 1.2, label: 'bank transfer proof' },
    { pattern: /n[oº]? de transferencia|transferencia.*venc|descricao venc/, weight: 0.9, label: 'salary transfer signal' },
  ],
  EBV: [
    { pattern: /extrato ?d ?o|extracto ?d ?o/, weight: 0.16, label: 'bank statement layout' },
    { pattern: /periodo.*data ?mov.*data ?valor/, weight: 0.16, label: 'bank statement movement table' },
    { pattern: /venc|salario|ordenado|trfdehoraindustria|trf de hora industria/, weight: 0.9, label: 'salary movement in bank statement' },
  ],
  TSA: [
    { pattern: /carregamento de cartoes pre pagos|cartao caixa break/, weight: 1.3, label: 'meal card loading proof' },
    { pattern: /subsidio de refeicao|subsidio alimentacao|conta cartao/, weight: 1.0, label: 'meal allowance card signal' },
  ],
  EBSA: [
    { pattern: /extrato ?d ?o|extracto ?d ?o/, weight: 0.16, label: 'bank statement layout' },
    { pattern: /refeicao|subsidio alimentacao|cartao/, weight: 0.9, label: 'meal allowance bank movement' },
  ],
  SSR: [
    { pattern: /entrega de declaracao de remuneracoes.*extrato de resumo/, weight: 1.5, label: 'DMR summary header' },
    { pattern: /total de remuneracoes.*total de contribuicoes/, weight: 0.9, label: 'DMR totals' },
  ],
  SSD: [
    { pattern: /extracto da declaracao de remuneracoes|extrato da declaracao de remuneracoes/, weight: 1.3, label: 'DMR detail header' },
    { pattern: /nome do trabalhador.*ano mes ref.*dias.*valor/, weight: 1.0, label: 'DMR worker detail table' },
  ],
  GIR: [
    { pattern: /identificacao do sujeito passivo.*importancia a pagar/, weight: 1.2, label: 'IRS guide/payment document' },
    { pattern: /referencia.*certificacao do pagamento|documento unico de cobranca/, weight: 0.9, label: 'tax guide reference' },
  ],
  LIR: [
    { pattern: /mapa de liquidacao de irs|liquidacao de irs/, weight: 1.4, label: 'IRS liquidation map' },
    { pattern: /funcionario.*n[oº]?contribuinte.*liquidado/, weight: 1.0, label: 'IRS employee list table' },
  ],
  PSS: [
    { pattern: /pagamento.*seguranca social|comprovativo.*seguranca social|taxa social unica/, weight: 1.2, label: 'social security payment proof' },
  ],
  PIR: [
    { pattern: /pagamento.*irs|comprovativo.*irs|autoridade tributaria.*pagamento/, weight: 1.2, label: 'IRS payment proof' },
  ],
  EBI: [
    { pattern: /extrato ?d ?o|extracto ?d ?o/, weight: 0.16, label: 'bank statement layout' },
    { pattern: /autoridade tributaria|seguranca social|irs|pagamento ao estado|pagamento estado/, weight: 0.9, label: 'tax/social-security bank movement' },
  ],
}

const scoreFolderOnPage = (folder: typeof RH_FOLDERS[number], pageText: string) => {
  const text = normalize(pageText)
  let score = 0
  const matched: string[] = []
  const folderNumber = String(folder.number).padStart(2, '0')
  const code = normalize(folder.code)
  if (new RegExp(`(?:pasta|folder|grupo|sec(?:c|ç)ao|section)\\s*0?${folder.number}\\b`, 'i').test(text)) {
    score += 0.6
    matched.push(`folder ${folderNumber}`)
  }
  if (new RegExp(`\\b${code}\\b`, 'i').test(text)) {
    score += 0.45
    matched.push(folder.code)
  }
  for (const term of folderTerms(folder)) {
    if (term.length > 2 && text.includes(term)) {
      score += term.split(' ').length > 1 ? 0.35 : 0.16
      matched.push(term)
    }
  }
  for (const item of strongPagePatterns[folder.code] || []) {
    if (item.pattern.test(text)) {
      score += item.weight
      matched.push(item.label)
    }
  }
  return { score, matched: Array.from(new Set(matched)).slice(0, 8) }
}

// Extract how the period/month is expressed in a section's text (format + context anchor phrases)
export const extractPeriodSignal = (
  text: string,
  position: 'header' | 'footer' | 'body' | null,
): { format: PeriodFormat | null; anchorPhrases: string[] } => {
  const norm = normalize(text)
  const anchorFor = (matchIndex: number): string[] => {
    const before = norm.slice(Math.max(0, matchIndex - 40), matchIndex)
    return before.split(/\s+/).filter((w) => w.length > 2 && !/^\d+$/.test(w)).slice(-3)
  }

  // Pattern 1: explicit label before year+month
  const explicitMatch = norm.match(/(ano\s+mes\s+de\s+referencia|ano\s+mes\s+ref|ano\s+mes|periodo|referencia)\s+(20[2-3]\d)\s+(0?[1-9]|1[0-2])/)
  if (explicitMatch && explicitMatch.index !== undefined) {
    return { format: 'explicit_label', anchorPhrases: anchorFor(explicitMatch.index) }
  }

  // Pattern 2: Portuguese named month + year
  const monthNames = 'janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro'
  const namedMatch = norm.match(new RegExp(`(${monthNames})\\s+(20[2-3]\\d)`, 'i'))
  if (namedMatch && namedMatch.index !== undefined) {
    return { format: 'named_month', anchorPhrases: anchorFor(namedMatch.index) }
  }

  // Pattern 3: compact YYYYMM
  const compactMatch = norm.match(/\b(20[2-3]\d)(0[1-9]|1[0-2])\b/)
  if (compactMatch && compactMatch.index !== undefined) {
    return { format: 'compact_yyyymm', anchorPhrases: anchorFor(compactMatch.index) }
  }

  // Pattern 4: operation/emission date labels
  const opMatch = norm.match(/(data\s+valor|data\s+do\s+movimento|data\s+de\s+movimento|data\s+emissao|data\s+de\s+emissao)/)
  if (opMatch && opMatch.index !== undefined) {
    return { format: 'operation_date', anchorPhrases: anchorFor(opMatch.index) }
  }

  return { format: null, anchorPhrases: [] }
}

const detectDatePosition = (pageText: string, totalLines: number): 'header' | 'footer' | 'body' | null => {
  const lines = pageText.split('\n').filter((line) => line.trim())
  const datePattern = /\b(20\d{2})\b.*\b(0[1-9]|1[0-2])\b|\b(0[1-9]|1[0-2])\b.*\b(20\d{2})\b|\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b.*\b(20\d{2})\b/i
  const headerZone = lines.slice(0, Math.max(1, Math.floor(lines.length * 0.2)))
  const footerZone = lines.slice(Math.floor(lines.length * 0.8))
  if (headerZone.some((line) => datePattern.test(line))) return 'header'
  if (footerZone.some((line) => datePattern.test(line))) return 'footer'
  if (lines.some((line) => datePattern.test(line))) return 'body'
  return null
}

export const extractSectionsWithRawText = async (
  bytes: Buffer,
  options?: { includeFolderOne?: boolean },
): Promise<{ fingerprints: SectionFingerprint[]; sectionTexts: Map<string, string>; averageTextLength: number }> => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const document = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise
  type Collected = SectionFingerprint & { tokenCounts: Map<string, number>; firstPageNumber: number; rawText: string }
  const collected = new Map<string, Collected>()
  const sectionOrder: string[] = []
  const folders = RH_FOLDERS.filter((folder) => options?.includeFolderOne || folder.number >= 2)
  const pageLimit = Math.min(document.numPages, 120)
  let lastBest: { folder: typeof RH_FOLDERS[number]; matched: string[] } | null = null
  let totalTextLength = 0
  let textPageCount = 0

  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const content = await page.getTextContent()
    const pageText = content.items.map((item) => 'str' in item ? item.str : '').join(' ')
    if (!pageText.trim()) continue
    totalTextLength += pageText.length
    textPageCount += 1
    let best = folders
      .map((folder) => ({ folder, ...scoreFolderOnPage(folder, pageText) }))
      .sort((left, right) => right.score - left.score)[0]
    const normalizedPage = normalize(pageText)
    const continuation = /continua|continuacao|transporte|pag\s*\d+\s*\/\s*\d+|pag\d+\/\d+|pag\.\s*\d+/.test(normalizedPage)
    const bankStatementOnly = /extrato ?d ?o|extracto ?d ?o|datamov|data mov|saldo contabilistico|saldo contabil/.test(normalizedPage)
    const ebiFolder = folders.find((folder) => folder.code === 'EBI')
    if ((!best || best.score < 0.42) && bankStatementOnly && lastBest && lastBest.folder.number >= 9 && ebiFolder) {
      best = { folder: ebiFolder, score: 0.44, matched: ['bank statement after tax/IRS section', 'sequence/order inference'] }
    } else if ((!best || best.score < 0.42) && continuation && lastBest && ['LC', 'EBV', 'EBSA', 'SSD', 'EBI'].includes(lastBest.folder.code)) {
      best = { folder: lastBest.folder, score: 0.43, matched: [...lastBest.matched, 'continuation page'].slice(0, 8) }
    }
    if (!best || best.score < 0.42) continue
    lastBest = { folder: best.folder, matched: best.matched }
    if (!collected.has(best.folder.code)) sectionOrder.push(best.folder.code)
    const existing = collected.get(best.folder.code) || {
      document_code: best.folder.code, folder_number: best.folder.number, label: best.folder.label,
      page_numbers: [], header_terms: [], sample_tokens: [], page_count: 0,
      date_position: null as 'header' | 'footer' | 'body' | null,
      section_order: sectionOrder.indexOf(best.folder.code) + 1,
      tokenCounts: new Map<string, number>(), firstPageNumber: pageNumber, rawText: '',
    }
    existing.page_numbers.push(pageNumber)
    existing.header_terms = Array.from(new Set([...existing.header_terms, ...best.matched])).slice(0, 20)
    if (!existing.date_position) existing.date_position = detectDatePosition(pageText, content.items.length)
    existing.rawText = `${existing.rawText} ${pageText}`.slice(0, 12_000)
    for (const token of tokenise(pageText).slice(0, 160)) {
      existing.tokenCounts.set(token, (existing.tokenCounts.get(token) || 0) + 1)
    }
    collected.set(best.folder.code, existing)
  }
  await document.destroy()

  const fingerprints = Array.from(collected.values())
    .sort((left, right) => left.section_order - right.section_order)
    .map(({ tokenCounts, firstPageNumber, rawText, ...fingerprint }) => ({
      ...fingerprint,
      page_numbers: Array.from(new Set(fingerprint.page_numbers)).slice(0, 20),
      page_count: fingerprint.page_numbers.length,
      sample_tokens: Array.from(tokenCounts.entries())
        .sort((left, right) => right[1] - left[1])
        .map(([token]) => token)
        .filter((token) => !['para', 'com', 'por', 'dos', 'das', 'uma', 'sem', 'mes', 'ano'].includes(token))
        .slice(0, 35),
    }))

  const sectionTexts = new Map<string, string>()
  for (const [code, entry] of collected.entries()) sectionTexts.set(code, entry.rawText.trim())
  const averageTextLength = textPageCount > 0 ? totalTextLength / textPageCount : 0

  return { fingerprints, sectionTexts, averageTextLength }
}

export const extractJoinSectionFingerprints = async (bytes: Buffer, options?: { includeFolderOne?: boolean }): Promise<SectionFingerprint[]> => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const document = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise
  type Collected = SectionFingerprint & { tokenCounts: Map<string, number>; firstPageNumber: number }
  const collected = new Map<string, Collected>()
  const sectionOrder: string[] = []
  const folders = RH_FOLDERS.filter((folder) => options?.includeFolderOne || folder.number >= 2)
  const pageLimit = Math.min(document.numPages, 120)
  let lastBest: { folder: typeof RH_FOLDERS[number]; matched: string[] } | null = null

  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const content = await page.getTextContent()
    const pageText = content.items.map((item) => 'str' in item ? item.str : '').join(' ')
    if (!pageText.trim()) continue
    let best = folders
      .map((folder) => ({ folder, ...scoreFolderOnPage(folder, pageText) }))
      .sort((left, right) => right.score - left.score)[0]
    const normalizedPage = normalize(pageText)
    const continuation = /continua|continuacao|transporte|pag\s*\d+\s*\/\s*\d+|pag\d+\/\d+|pag\.\s*\d+/.test(normalizedPage)
    const bankStatementOnly = /extrato ?d ?o|extracto ?d ?o|datamov|data mov|saldo contabilistico|saldo contabil/.test(normalizedPage)
    const ebiFolder = folders.find((folder) => folder.code === 'EBI')
    if ((!best || best.score < 0.42) && bankStatementOnly && lastBest && lastBest.folder.number >= 9 && ebiFolder) {
      best = { folder: ebiFolder, score: 0.44, matched: ['bank statement after tax/IRS section', 'sequence/order inference'] }
    } else if ((!best || best.score < 0.42) && continuation && lastBest && ['LC', 'EBV', 'EBSA', 'SSD', 'EBI'].includes(lastBest.folder.code)) {
      best = { folder: lastBest.folder, score: 0.43, matched: [...lastBest.matched, 'continuation page'].slice(0, 8) }
    }
    if (!best || best.score < 0.42) continue
    lastBest = { folder: best.folder, matched: best.matched }

    if (!collected.has(best.folder.code)) sectionOrder.push(best.folder.code)

    const existing = collected.get(best.folder.code) || {
      document_code: best.folder.code,
      folder_number: best.folder.number,
      label: best.folder.label,
      page_numbers: [],
      header_terms: [],
      sample_tokens: [],
      page_count: 0,
      date_position: null as 'header' | 'footer' | 'body' | null,
      section_order: sectionOrder.indexOf(best.folder.code) + 1,
      tokenCounts: new Map<string, number>(),
      firstPageNumber: pageNumber,
    }
    existing.page_numbers.push(pageNumber)
    existing.header_terms = Array.from(new Set([...existing.header_terms, ...best.matched])).slice(0, 20)
    if (!existing.date_position) {
      existing.date_position = detectDatePosition(pageText, content.items.length)
    }
    for (const token of tokenise(pageText).slice(0, 160)) {
      existing.tokenCounts.set(token, (existing.tokenCounts.get(token) || 0) + 1)
    }
    collected.set(best.folder.code, existing)
  }
  await document.destroy()

  return Array.from(collected.values())
    .sort((left, right) => left.section_order - right.section_order)
    .map(({ tokenCounts, firstPageNumber, ...fingerprint }) => ({
      ...fingerprint,
      page_numbers: Array.from(new Set(fingerprint.page_numbers)).slice(0, 20),
      page_count: fingerprint.page_numbers.length,
      sample_tokens: Array.from(tokenCounts.entries())
        .sort((left, right) => right[1] - left[1])
        .map(([token]) => token)
        .filter((token) => !['para', 'com', 'por', 'dos', 'das', 'uma', 'sem', 'mes', 'ano'].includes(token))
        .slice(0, 35),
    }))
}
