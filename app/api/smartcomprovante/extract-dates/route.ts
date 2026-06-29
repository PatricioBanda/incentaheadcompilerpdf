import { NextRequest, NextResponse } from 'next/server'
import { normalizePeriodText } from '@/lib/smartcomprovante/period-learning'

export const runtime = 'nodejs'
export const maxDuration = 60

export type DateCandidate = {
  phrase: string
  year: number
  month: number
  context: string
  page: number
  x: number
  y: number
  score: number
}

// Explicit date patterns that capture the literal date string.
// Each pattern must produce: group 1 = day/month/year piece for parsing.
const DATE_PATTERNS: Array<{ re: RegExp; parse: (m: RegExpExecArray) => { year: number; month: number } | null }> = [
  {
    // DD.MM.YYYY or DD/MM/YYYY or DD-MM-YYYY
    re: /\b(\d{1,2})[./\-](\d{1,2})[./\-](20[2-3]\d)\b/g,
    parse: (m) => {
      const day = Number(m[1]), mon = Number(m[2]), yr = Number(m[3])
      if (mon < 1 || mon > 12 || day < 1 || day > 31) return null
      return { year: yr, month: mon }
    },
  },
  {
    // MM/YYYY or MM-YYYY (period format)
    re: /\b(0?[1-9]|1[0-2])[\/\-](20[2-3]\d)\b/g,
    parse: (m) => ({ year: Number(m[2]), month: Number(m[1]) }),
  },
  {
    // YYYY/MM or YYYY-MM
    re: /\b(20[2-3]\d)[\/\-](0[1-9]|1[0-2])\b/g,
    parse: (m) => ({ year: Number(m[1]), month: Number(m[2]) }),
  },
  {
    // Portuguese month names: "setembro 2025" / "setembro de 2025"
    re: /\b(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de)?\s+(20[2-3]\d)\b/gi,
    parse: (m) => {
      const names: Record<string, number> = {
        janeiro:1,fevereiro:2,'março':3,marco:3,abril:4,maio:5,junho:6,
        julho:7,agosto:8,setembro:9,outubro:10,novembro:11,dezembro:12,
      }
      const mon = names[m[1].toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'')]
      return mon ? { year: Number(m[2]), month: mon } : null
    },
  },
]

const PERIOD_POSITIVE = [
  'periodo', 'referencia', 'competencia', 'mes', 'vencimento', 'vencimentos',
  'salario', 'subsidio', 'ordenado', 'remuneracao', 'folha', 'processamento',
  'diario de salarios', 'diario salarios',
]
const PERIOD_NEGATIVE = [
  'pagamento', 'emissao', 'emitido', 'data de', 'emitida', 'data emissao',
  'processado em', 'gerado', 'impresso', 'licenca', 'versao', 'v25', 'artsoft',
]

function scoreCandidate(context: string, yNorm: number): number {
  const norm = normalizePeriodText(context)
  let score = 0.5
  for (const kw of PERIOD_POSITIVE) if (norm.includes(kw)) { score += 0.4; break }
  for (const kw of PERIOD_NEGATIVE) if (norm.includes(kw)) { score -= 0.35; break }
  if (yNorm <= 0.20) score += 0.15   // top of page = header
  if (yNorm >= 0.85) score -= 0.2    // very bottom = footer
  return Math.max(0, Math.min(1, score))
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file is required.' }, { status: 400 })
    }

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    if (!isPdf) {
      return NextResponse.json({ candidates: [] })
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs' as string)
    pdfjs.GlobalWorkerOptions.workerSrc = ''

    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true })
    const pdf = await loadingTask.promise

    const allCandidates: DateCandidate[] = []
    const maxPages = Math.min(pdf.numPages, 4)

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const page = await pdf.getPage(pageNum)
      const viewport = page.getViewport({ scale: 1 })
      const pageW = viewport.width
      const pageH = viewport.height
      const textContent = await page.getTextContent()

      type TextItem = { str: string; xNorm: number; yNorm: number; charStart: number }
      const items: TextItem[] = []

      // Build full page text + char→item map
      let fullText = ''
      for (const rawItem of textContent.items) {
        if (!('str' in rawItem) || !rawItem.str.trim()) continue
        const [, , , , tx, ty] = rawItem.transform as number[]
        const charStart = fullText.length
        fullText += rawItem.str + ' '
        items.push({
          str: rawItem.str,
          xNorm: tx / pageW,
          yNorm: 1 - (ty / pageH),
          charStart,
        })
      }

      // Find the item responsible for a character offset
      const itemAtOffset = (offset: number): TextItem | null => {
        // Binary-search or linear scan
        for (let j = items.length - 1; j >= 0; j--) {
          if (items[j].charStart <= offset) return items[j]
        }
        return items[0] ?? null
      }

      // Run each date pattern on the full page text
      for (const { re, parse } of DATE_PATTERNS) {
        re.lastIndex = 0
        let match: RegExpExecArray | null
        while ((match = re.exec(fullText)) !== null) {
          const parsed = parse(match)
          if (!parsed) continue
          const { year, month } = parsed

          const phrase = match[0]
          const matchStart = match.index
          const item = itemAtOffset(matchStart)
          if (!item) continue

          // Extract ±120 chars of surrounding context from the full text
          const ctxStart = Math.max(0, matchStart - 120)
          const ctxEnd = Math.min(fullText.length, matchStart + phrase.length + 120)
          const context = fullText.slice(ctxStart, ctxEnd).trim()

          const score = scoreCandidate(context, item.yNorm)

          allCandidates.push({
            phrase,
            year,
            month,
            context,
            page: pageNum,
            x: item.xNorm,
            y: item.yNorm,
            score,
          })
        }
      }
    }

    // Deduplicate by (year-month): keep best score per period
    const byPeriod = new Map<string, DateCandidate>()
    for (const c of allCandidates) {
      const key = `${c.year}-${c.month}`
      const existing = byPeriod.get(key)
      if (!existing || c.score > existing.score) byPeriod.set(key, c)
    }

    const candidates = [...byPeriod.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)

    return NextResponse.json({ candidates })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Date extraction failed.' }, { status: 500 })
  }
}
