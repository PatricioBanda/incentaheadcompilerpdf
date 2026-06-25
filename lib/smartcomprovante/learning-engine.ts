import { extractSectionsWithRawText, extractPeriodSignal } from './join-learning'
import type { PeriodFormat, SectionEnrichment, EnrichedSectionFingerprint } from './types'

export type { SectionEnrichment, EnrichedSectionFingerprint }

export type LearningLayerResult = {
  id: string
  label: string
  status: 'done' | 'skipped' | 'error'
  detail: string
  durationMs: number
}

export type LearningResult = {
  sections: SectionEnrichment[]
  layers: LearningLayerResult[]
  pageCount: number
  scanned: boolean
  qualityScore: number
}

// ─── Utilities ───────────────────────────────────────────────────────────────

const normalize = (text: string) => text
  .normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  .replace(/[_\-./:;()[\]]+/g, ' ').replace(/\s+/g, ' ').trim()

const STOP = new Set([
  'para', 'com', 'por', 'dos', 'das', 'uma', 'sem', 'mes', 'ano', 'pagina',
  'total', 'valor', 'data', 'numero', 'nome', 'que', 'nos', 'nao', 'este',
  'essa', 'outro', 'outra', 'ser', 'ter', 'foi', 'ser', 'mais', 'sobre',
])

const tokenize = (text: string) =>
  normalize(text).split(' ').filter((t) => t.length > 2 && !/^\d{1,3}$/.test(t) && !STOP.has(t))

// Competing sections within the same document domain (used for negative term extraction)
const DOMAIN_CLUSTERS: Record<string, string[]> = {
  banking:         ['TV', 'EBV', 'TSA', 'EBSA', 'EBI'],
  social_security: ['SSR', 'SSD', 'PSS'],
  irs:             ['GIR', 'LIR', 'PIR'],
  payroll:         ['RV', 'LC'],
}

const competingCodes = (code: string): string[] => {
  for (const cluster of Object.values(DOMAIN_CLUSTERS)) {
    if (cluster.includes(code)) return cluster.filter((c) => c !== code)
  }
  return []
}

// ─── Layer 4a: TF-IDF within-document distinctive terms ──────────────────────

const computeTfIdf = (
  code: string,
  sectionTokenFreqs: Map<string, Map<string, number>>,
): string[] => {
  const myFreq = sectionTokenFreqs.get(code)
  if (!myFreq) return []
  const N = sectionTokenFreqs.size
  return Array.from(myFreq.entries())
    .map(([token, tf]) => {
      const df = Array.from(sectionTokenFreqs.values()).filter((freq) => freq.has(token)).length
      const idf = Math.log((1 + N) / (1 + df))
      return { token, score: tf * idf }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.token)
    .slice(0, 20)
}

// ─── Layer 4b: Exclusive n-grams ─────────────────────────────────────────────

const extractNgrams = (
  code: string,
  sectionTexts: Map<string, string>,
): string[] => {
  const myText = sectionTexts.get(code) || ''
  const otherTokens = new Set(
    Array.from(sectionTexts.entries())
      .filter(([c]) => c !== code)
      .flatMap(([, t]) => tokenize(t)),
  )
  const tokens = tokenize(myText)
  const freq = new Map<string, number>()
  for (let i = 0; i < tokens.length - 1; i++) {
    const bigram = `${tokens[i]} ${tokens[i + 1]}`
    freq.set(bigram, (freq.get(bigram) || 0) + 1)
    if (i < tokens.length - 2) {
      const trigram = `${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`
      freq.set(trigram, (freq.get(trigram) || 0) + 1)
    }
  }
  return Array.from(freq.entries())
    .filter(([phrase, count]) => count >= 2 && phrase.split(' ').some((p) => !otherTokens.has(p)))
    .sort(([, a], [, b]) => b - a)
    .map(([phrase]) => phrase)
    .slice(0, 10)
}

// ─── Layer 4c: Negative terms from domain competitors ────────────────────────

const extractNegativeTerms = (
  code: string,
  sectionTokenFreqs: Map<string, Map<string, number>>,
): string[] => {
  const myTokens = new Set((sectionTokenFreqs.get(code) || new Map()).keys())
  const negatives = new Set<string>()
  for (const compCode of competingCodes(code)) {
    const compFreq = sectionTokenFreqs.get(compCode)
    if (!compFreq) continue
    for (const [token, count] of compFreq) {
      if (count >= 2 && !myTokens.has(token) && token.length > 3) negatives.add(token)
    }
  }
  return Array.from(negatives).slice(0, 12)
}

// ─── Layer 7: Score a text string against an enriched fingerprint ─────────────

const scoreAgainstFingerprint = (
  testText: string,
  fp: EnrichedSectionFingerprint,
): number => {
  const n = normalize(testText)
  let score = 0
  for (const term of fp.required_terms.slice(0, 15)) if (n.includes(normalize(term))) score += 0.5
  for (const term of fp.header_terms.slice(0, 10)) if (normalize(term) && n.includes(normalize(term))) score += 0.3
  for (const term of fp.tfidf_terms.slice(0, 12)) if (n.includes(normalize(term))) score += 0.2
  for (const phrase of fp.ngrams.slice(0, 8)) if (n.includes(normalize(phrase))) score += 0.45
  for (const descriptor of fp.llm_descriptors.slice(0, 6)) if (n.includes(normalize(descriptor))) score += 0.4
  for (const term of fp.negative_terms.slice(0, 8)) if (n.includes(normalize(term))) score -= 0.25
  return Math.max(0, score)
}

const runValidationRound = (
  fingerprints: EnrichedSectionFingerprint[],
): Map<string, { recall: number; precision: number }> => {
  const results = new Map<string, { recall: number; precision: number }>()
  for (const fp of fingerprints) {
    const testText = [
      ...fp.required_terms,
      ...fp.header_terms.slice(0, 8),
      ...fp.tfidf_terms.slice(0, 10),
      ...fp.ngrams.slice(0, 6),
      ...fp.llm_descriptors,
    ].join(' ')

    if (!testText.trim()) { results.set(fp.document_code, { recall: 0, precision: 0 }); continue }

    const scores = fingerprints.map((other) => ({
      code: other.document_code,
      score: scoreAgainstFingerprint(testText, other),
    }))
    const myScore = scores.find((s) => s.code === fp.document_code)?.score || 0
    const maxOther = Math.max(0, ...scores.filter((s) => s.code !== fp.document_code).map((s) => s.score))
    const recall = myScore > maxOther ? 1 : myScore > 0 && myScore > maxOther * 0.7 ? 0.6 : 0
    const precision = myScore > 0 ? myScore / Math.max(1, myScore + maxOther) : 0
    results.set(fp.document_code, { recall, precision })
  }
  return results
}

// ─── Main: process one reference example (Layers 0–5) ────────────────────────

export const processReferenceExample = async (
  bytes: Buffer,
  kind: 'base_join' | 'final_join',
): Promise<LearningResult> => {
  const layers: LearningLayerResult[] = []

  // Layer 0: Input validation
  let pageCount = 0
  const t0 = Date.now()
  try {
    const { PDFDocument } = await import('pdf-lib')
    const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true })
    pageCount = pdfDoc.getPageCount()
    layers.push({ id: 'input', label: 'Input validation', status: 'done', detail: `${pageCount} pages · ${(bytes.length / 1024).toFixed(0)} KB`, durationMs: Date.now() - t0 })
  } catch (error) {
    layers.push({ id: 'input', label: 'Input validation', status: 'error', detail: error instanceof Error ? error.message : 'PDF could not be read', durationMs: Date.now() - t0 })
    return { sections: [], layers, pageCount: 0, scanned: false, qualityScore: 0 }
  }

  // Layers 1+3: PDF text extraction + section identification
  const t13 = Date.now()
  let rawResult: Awaited<ReturnType<typeof extractSectionsWithRawText>>
  try {
    rawResult = await extractSectionsWithRawText(bytes, { includeFolderOne: kind === 'final_join' })
    const scanned = rawResult.averageTextLength < 80
    layers.push({
      id: 'structure',
      label: 'Text extraction + section identification',
      status: 'done',
      detail: `${rawResult.fingerprints.length} section(s) identified${scanned ? ' · low text density, may be scanned' : ''}`,
      durationMs: Date.now() - t13,
    })
  } catch (error) {
    layers.push({ id: 'structure', label: 'Text extraction + section identification', status: 'error', detail: error instanceof Error ? error.message : 'Extraction failed', durationMs: Date.now() - t13 })
    return { sections: [], layers, pageCount, scanned: false, qualityScore: 0 }
  }

  const scanned = rawResult.averageTextLength < 80

  // Layer 2: OCR detection / advisory
  const t2 = Date.now()
  layers.push({
    id: 'ocr',
    label: 'OCR / vision',
    status: 'skipped',
    detail: scanned
      ? process.env.TESSERACT_PATH ? 'Scanned PDF: Tesseract will enrich classification on use.'
        : process.env.GEMINI_API_KEY ? 'Scanned PDF: Gemini Vision will enrich classification on use.'
        : 'Scanned PDF: no OCR configured. Set TESSERACT_PATH for best results.'
      : 'Searchable PDF — native text layer sufficient.',
    durationMs: Date.now() - t2,
  })

  // Layer 4: TF-IDF + n-grams + negative terms
  const t4 = Date.now()
  const sectionTexts = rawResult.sectionTexts
  const sectionTokenFreqs = new Map<string, Map<string, number>>()
  for (const [code, text] of sectionTexts.entries()) {
    const freq = new Map<string, number>()
    for (const token of tokenize(text)) freq.set(token, (freq.get(token) || 0) + 1)
    sectionTokenFreqs.set(code, freq)
  }

  const layer4Results = new Map<string, { tfidfTerms: string[]; ngrams: string[]; negativeTerms: string[] }>()
  for (const fp of rawResult.fingerprints) {
    layer4Results.set(fp.document_code, {
      tfidfTerms: computeTfIdf(fp.document_code, sectionTokenFreqs),
      ngrams: extractNgrams(fp.document_code, sectionTexts),
      negativeTerms: extractNegativeTerms(fp.document_code, sectionTokenFreqs),
    })
  }
  layers.push({ id: 'tfidf', label: 'TF-IDF + n-grams + negative terms', status: 'done', detail: `${layer4Results.size} section(s) enriched with distinctive terms`, durationMs: Date.now() - t4 })

  // Layer 5: LLM enrichment (Gemini text-only batch call)
  const t5 = Date.now()
  let llmDescriptors = new Map<string, string[]>()
  if (rawResult.fingerprints.length > 0) {
    try {
      const { batchEnrichSections } = await import('./providers/gemini')
      const inputs = rawResult.fingerprints.map((fp) => ({
        document_code: fp.document_code,
        label: fp.label,
        sampleText: (sectionTexts.get(fp.document_code) || fp.header_terms.join(' ')).slice(0, 350),
      }))
      llmDescriptors = await batchEnrichSections(inputs)
      const enrichedCount = Array.from(llmDescriptors.values()).filter((d) => d.length > 0).length
      layers.push({
        id: 'llm',
        label: 'LLM enrichment',
        status: enrichedCount > 0 ? 'done' : 'skipped',
        detail: enrichedCount > 0
          ? `Gemini generated descriptors for ${enrichedCount} of ${rawResult.fingerprints.length} section(s)`
          : 'Gemini not configured or returned no descriptors',
        durationMs: Date.now() - t5,
      })
    } catch {
      layers.push({ id: 'llm', label: 'LLM enrichment', status: 'skipped', detail: 'LLM enrichment gracefully skipped', durationMs: Date.now() - t5 })
    }
  } else {
    layers.push({ id: 'llm', label: 'LLM enrichment', status: 'skipped', detail: 'No sections to enrich', durationMs: 0 })
  }

  // Build SectionEnrichment[]
  const sections: SectionEnrichment[] = rawResult.fingerprints.map((fp) => {
    const l4 = layer4Results.get(fp.document_code)
    const sectionText = sectionTexts.get(fp.document_code) || ''
    const periodExtract = extractPeriodSignal(sectionText, fp.date_position)
    return {
      document_code: fp.document_code,
      folder_number: fp.folder_number,
      label: fp.label,
      page_numbers: fp.page_numbers,
      page_count: fp.page_count,
      date_position: fp.date_position,
      section_order: fp.section_order,
      header_terms: fp.header_terms,
      sample_tokens: fp.sample_tokens,
      tfidf_terms: l4?.tfidfTerms || [],
      ngrams: l4?.ngrams || [],
      negative_terms: l4?.negativeTerms || [],
      llm_descriptors: llmDescriptors.get(fp.document_code) || [],
      llm_enriched: (llmDescriptors.get(fp.document_code) || []).length > 0,
      period_signal: periodExtract.format !== null ? { position: fp.date_position, format: periodExtract.format, anchor_phrases: periodExtract.anchorPhrases, detection_rate: 1 } : undefined,
    }
  })

  const qualityScore = sections.length === 0 ? 0 : Math.min(1,
    (sections.filter((s) => s.tfidf_terms.length >= 5).length / sections.length) * 0.4 +
    (sections.filter((s) => s.ngrams.length >= 2).length / sections.length) * 0.2 +
    (sections.filter((s) => s.llm_enriched).length / sections.length) * 0.4,
  )

  return { sections, layers, pageCount, scanned, qualityScore }
}

// ─── Aggregate + validate across multiple examples (Layers 6–7) ───────────────

export const aggregateAndValidate = (
  allSections: SectionEnrichment[][],
): { fingerprints: EnrichedSectionFingerprint[]; qualityScore: number } => {
  if (allSections.length === 0) return { fingerprints: [], qualityScore: 0 }

  const totalExamples = allSections.length

  // Layer 6: group by section code, compute per-term coverage rates
  const byCode = new Map<string, SectionEnrichment[]>()
  for (const exampleSections of allSections) {
    for (const section of exampleSections) {
      const existing = byCode.get(section.document_code) || []
      existing.push(section)
      byCode.set(section.document_code, existing)
    }
  }

  const fingerprints: EnrichedSectionFingerprint[] = []
  for (const [code, instances] of byCode.entries()) {
    const coverage = instances.length / totalExamples

    // Count how many instances contain each term
    const termCounts = new Map<string, number>()
    for (const instance of instances) {
      const seen = new Set([
        ...instance.header_terms,
        ...instance.tfidf_terms,
        ...instance.ngrams,
        ...instance.llm_descriptors,
      ])
      for (const term of seen) termCounts.set(term, (termCounts.get(term) || 0) + 1)
    }

    const required_terms: string[] = []
    const optional_terms: string[] = []
    for (const [term, count] of termCounts.entries()) {
      const rate = count / instances.length
      if (rate >= 0.6) required_terms.push(term)
      else if (rate >= 0.2) optional_terms.push(term)
    }

    // Aggregate period signal across instances
    const withSignal = instances.filter((s) => s.period_signal?.format)
    const detectionRate = withSignal.length / instances.length
    let aggregatedPeriodSignal: import('./types').PeriodSignal | undefined
    if (detectionRate >= 0.5) {
      const formatVotes = new Map<PeriodFormat, number>()
      const positionVotes = new Map<string, number>()
      const phraseVotes = new Map<string, number>()
      for (const s of withSignal) {
        const sig = s.period_signal!
        formatVotes.set(sig.format!, (formatVotes.get(sig.format!) || 0) + 1)
        const pos = sig.position || 'body'
        positionVotes.set(pos, (positionVotes.get(pos) || 0) + 1)
        for (const phrase of sig.anchor_phrases) {
          phraseVotes.set(phrase, (phraseVotes.get(phrase) || 0) + 1)
        }
      }
      const bestFormat = [...formatVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
      const bestPosition = [...positionVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      const threshold = withSignal.length * 0.4
      const topPhrases = [...phraseVotes.entries()]
        .filter(([, count]) => count >= threshold)
        .sort((a, b) => b[1] - a[1])
        .map(([phrase]) => phrase)
        .slice(0, 6)
      aggregatedPeriodSignal = {
        position: (bestPosition as 'header' | 'footer' | 'body' | null) ?? null,
        format: bestFormat,
        anchor_phrases: topPhrases,
        detection_rate: detectionRate,
      }
    }

    // Use the richest instance as the base for shared fields
    const base = instances.reduce((best, s) =>
      (s.tfidf_terms.length + s.llm_descriptors.length + s.ngrams.length) >
      (best.tfidf_terms.length + best.llm_descriptors.length + best.ngrams.length) ? s : best,
    )

    fingerprints.push({
      ...base,
      // Merge negative terms across all instances
      negative_terms: [...new Set(instances.flatMap((s) => s.negative_terms))].slice(0, 15),
      required_terms: required_terms.slice(0, 20),
      optional_terms: optional_terms.slice(0, 15),
      validation: { recall: 0, precision: 0, coverage, rounds: 0 },
      ...(aggregatedPeriodSignal ? { period_signal: aggregatedPeriodSignal } : {}),
    })
  }

  // Layer 7: self-validation loop (up to 3 rounds, terminate early if ≥75% recall+precision)
  let overallRecall = 0
  let overallPrecision = 0
  let rounds = 0

  for (rounds = 1; rounds <= 3; rounds++) {
    const results = runValidationRound(fingerprints)
    overallRecall = 0
    overallPrecision = 0
    for (const fp of fingerprints) {
      const r = results.get(fp.document_code)
      if (r) { fp.validation = { ...fp.validation, recall: r.recall, precision: r.precision, rounds }; overallRecall += r.recall; overallPrecision += r.precision }
    }
    overallRecall /= fingerprints.length || 1
    overallPrecision /= fingerprints.length || 1

    if (overallRecall >= 0.75 && overallPrecision >= 0.75) break

    // Before the next round: boost under-performing sections by pulling more sample_tokens into required_terms
    if (rounds < 3) {
      for (const fp of fingerprints) {
        const r = results.get(fp.document_code)
        if (r && r.recall < 0.75) {
          const extra = fp.sample_tokens.filter((t) => !fp.required_terms.includes(t)).slice(0, 5)
          fp.required_terms = [...fp.required_terms, ...extra].slice(0, 25)
        }
      }
    }
  }

  const qualityScore = (overallRecall + overallPrecision) / 2
  return { fingerprints, qualityScore }
}
