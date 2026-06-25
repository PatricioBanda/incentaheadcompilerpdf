import { PDFDocument } from 'pdf-lib'
import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'

export type PageProfile = {
  pageNumber: number
  width: number
  height: number
  orientation: 'portrait' | 'landscape' | 'square'
  textLength: number
  headerText: string
  footerText: string
  positionedLines: PositionedLine[]
  numberingPatterns: NumberingPattern[]
  hierarchyHints: HierarchyHint[]
}

export type PdfMetadata = {
  title: string | null
  author: string | null
  subject: string | null
  keywords: string | null
  creator: string | null
  producer: string | null
  creationDate: string | null
  modificationDate: string | null
}

export type PositionedLine = {
  text: string
  x: number
  y: number
  width: number
  itemCount: number
}

export type NumberingPattern = {
  prefix: string
  first: number
  last: number
  count: number
  labels: string[]
}

export type HierarchyHint = {
  title: string
  childCount: number
  children: string[]
}

export type DocumentIntelligence = {
  text: string
  pageCount: number
  metadata: PdfMetadata
  averageTextLength: number
  ocrRecommended: boolean
  pageProfiles: PageProfile[]
  layoutTokens: string[]
  hierarchyHints: HierarchyHint[]
  numberingPatterns: NumberingPattern[]
  diagnostics: string[]
}

const normalize = (text: string) => text
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLowerCase()
  .replace(/[_\-./:;()[\]]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const topTokens = (text: string) => {
  const stop = new Set(['para', 'com', 'por', 'dos', 'das', 'uma', 'sem', 'mes', 'ano', 'pagina', 'total', 'valor'])
  const counts = new Map<string, number>()
  for (const token of normalize(text).split(' ')) {
    if (token.length < 3 || stop.has(token) || /^\d+$/.test(token)) continue
    counts.set(token, (counts.get(token) || 0) + 1)
  }
  return Array.from(counts.entries()).sort((left, right) => right[1] - left[1]).map(([token]) => token).slice(0, 45)
}

const emptyMetadata = (): PdfMetadata => ({
  title: null,
  author: null,
  subject: null,
  keywords: null,
  creator: null,
  producer: null,
  creationDate: null,
  modificationDate: null,
})

const dateToIso = (value: Date | undefined) => value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null

type PositionedTextItem = {
  text: string
  x: number
  y: number
  width: number
}

const extractPositionedItems = (items: unknown[]): PositionedTextItem[] => items
  .map((item) => {
    if (!item || typeof item !== 'object' || !('str' in item)) return null
    const candidate = item as { str?: unknown; transform?: unknown; width?: unknown }
    const text = typeof candidate.str === 'string' ? candidate.str.trim() : ''
    const transform = Array.isArray(candidate.transform) ? candidate.transform : []
    const x = Number(transform[4] ?? 0)
    const y = Number(transform[5] ?? 0)
    const width = Number(candidate.width ?? 0)
    return text ? { text, x, y, width } : null
  })
  .filter((item): item is PositionedTextItem => Boolean(item))

const buildPositionedLines = (items: PositionedTextItem[]): PositionedLine[] => {
  const rows = new Map<number, PositionedTextItem[]>()
  for (const item of items) {
    const yBucket = Math.round(item.y / 4) * 4
    rows.set(yBucket, [...(rows.get(yBucket) || []), item])
  }
  return Array.from(rows.entries())
    .sort((left, right) => right[0] - left[0])
    .map(([, rowItems]) => {
      const sorted = rowItems.sort((left, right) => left.x - right.x)
      return {
        text: sorted.map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim(),
        x: Math.round(Math.min(...sorted.map((item) => item.x))),
        y: Math.round(sorted.reduce((sum, item) => sum + item.y, 0) / sorted.length),
        width: Math.round(sorted.reduce((sum, item) => sum + item.width, 0)),
        itemCount: sorted.length,
      }
    })
    .filter((line) => line.text.length > 1)
}

const detectNumberingPatterns = (lines: PositionedLine[]): NumberingPattern[] => {
  const groups = new Map<string, Array<{ number: number; label: string }>>()
  for (const line of lines) {
    const match = line.text.match(/^\s*(?:(\d{1,2})[.)\-_]|\b(\d{1,2})\s+-)\s*(.+)$/)
    if (!match) continue
    const number = Number(match[1] || match[2])
    const label = (match[3] || '').trim()
    if (!number || number > 99 || label.length < 2) continue
    const prefix = number <= 13 ? '1-13 candidate' : 'numbered list'
    groups.set(prefix, [...(groups.get(prefix) || []), { number, label }])
  }
  return Array.from(groups.entries())
    .map(([prefix, values]) => {
      const unique = Array.from(new Map(values.map((value) => [value.number, value])).values()).sort((left, right) => left.number - right.number)
      return {
        prefix,
        first: unique[0]?.number || 0,
        last: unique[unique.length - 1]?.number || 0,
        count: unique.length,
        labels: unique.map((value) => value.label).slice(0, 16),
      }
    })
    .filter((pattern) => pattern.count >= 3)
}

const detectHierarchyHints = (lines: PositionedLine[]): HierarchyHint[] => {
  const hints: HierarchyHint[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const nextLines = lines.slice(index + 1, index + 18)
    const children = nextLines
      .filter((candidate) => candidate.x > line.x + 20 && /^\s*\d{1,2}[.)\-_]?\s+/.test(candidate.text))
      .map((candidate) => candidate.text)
      .slice(0, 14)
    const titleLooksUseful = line.text.length > 3 && line.text.length < 90 && !/^\d{1,2}[.)\-_]?\s+/.test(line.text)
    if (titleLooksUseful && children.length >= 3) {
      hints.push({ title: line.text, childCount: children.length, children })
    }
  }
  return hints.slice(0, 8)
}

const runOptionalTesseract = async (bytes: Buffer, extension: string) => {
  const command = process.env.TESSERACT_PATH
  if (!command) return { text: '', diagnostic: 'Tesseract OCR not configured. Set TESSERACT_PATH to enable local OCR.' }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'smartcomprovante-ocr-'))
  const inputPath = path.join(directory, `input${extension}`)
  const outputBase = path.join(directory, 'output')
  try {
    await fs.writeFile(inputPath, bytes)
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, [inputPath, outputBase, '-l', process.env.TESSERACT_LANG || 'por+eng'], { windowsHide: true })
      let stderr = ''
      child.stderr.on('data', (chunk) => { stderr += String(chunk) })
      child.on('error', reject)
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr || `Tesseract exited with code ${code}`)))
    })
    return { text: await fs.readFile(`${outputBase}.txt`, 'utf8'), diagnostic: 'Tesseract OCR text extracted.' }
  } catch (error) {
    return { text: '', diagnostic: `Tesseract OCR failed: ${error instanceof Error ? error.message : 'unknown error'}` }
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
}

export const inspectDocument = async (file: File): Promise<DocumentIntelligence> => {
  const lowerName = file.name.toLowerCase()
  if (file.type !== 'application/pdf' && !lowerName.endsWith('.pdf')) {
    const bytes = Buffer.from(await file.arrayBuffer())
    const extension = lowerName.endsWith('.png') ? '.png' : '.jpg'
    const ocr = await runOptionalTesseract(bytes, extension)
    return {
      text: ocr.text,
      pageCount: 1,
      metadata: emptyMetadata(),
      averageTextLength: ocr.text.length,
      ocrRecommended: !ocr.text.trim(),
      pageProfiles: [],
      layoutTokens: ['image-input'],
      hierarchyHints: [],
      numberingPatterns: [],
      diagnostics: ['Image input: OCR/vision is recommended for local clustering.', ocr.diagnostic],
    }
  }

  const bytes = Buffer.from(await file.arrayBuffer())
  const diagnostics: string[] = []
  let pageCount = 0
  let metadata = emptyMetadata()
  const dimensions = new Map<number, { width: number; height: number }>()
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
    pageCount = pdf.getPageCount()
    metadata = {
      title: pdf.getTitle() || null,
      author: pdf.getAuthor() || null,
      subject: pdf.getSubject() || null,
      keywords: pdf.getKeywords() || null,
      creator: pdf.getCreator() || null,
      producer: pdf.getProducer() || null,
      creationDate: dateToIso(pdf.getCreationDate()),
      modificationDate: dateToIso(pdf.getModificationDate()),
    }
    pdf.getPages().forEach((page, index) => {
      const size = page.getSize()
      dimensions.set(index + 1, { width: Math.round(size.width), height: Math.round(size.height) })
    })
    if (metadata.creator) diagnostics.push(`PDF creator: ${metadata.creator}.`)
    if (metadata.producer) diagnostics.push(`PDF producer: ${metadata.producer}.`)
  } catch {
    diagnostics.push('PDF structure could not be read with pdf-lib.')
  }

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const document = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise
  pageCount = pageCount || document.numPages
  const pages: string[] = []
  const profiles: PageProfile[] = []
  const pageLimit = Math.min(document.numPages, 20)
  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const positionedItems = extractPositionedItems(content.items)
    const positionedLines = buildPositionedLines(positionedItems)
    const rawItems = positionedItems.map((item) => item.text).filter(Boolean)
    const pageText = rawItems.join(' ').replace(/\s+/g, ' ').trim()
    if (pageText) pages.push(`[Page ${pageNumber}] ${pageText}`)
    const dims = dimensions.get(pageNumber) || { width: Math.round(viewport.width), height: Math.round(viewport.height) }
    const numberingPatterns = detectNumberingPatterns(positionedLines)
    const hierarchyHints = detectHierarchyHints(positionedLines)
    profiles.push({
      pageNumber,
      width: dims.width,
      height: dims.height,
      orientation: Math.abs(dims.width - dims.height) < 20 ? 'square' : dims.width > dims.height ? 'landscape' : 'portrait',
      textLength: pageText.length,
      headerText: rawItems.slice(0, 12).join(' ').slice(0, 260),
      footerText: rawItems.slice(-12).join(' ').slice(0, 260),
      positionedLines: positionedLines.slice(0, 80),
      numberingPatterns,
      hierarchyHints,
    })
  }
  await document.destroy()

  const text = pages.join('\n').slice(0, 80_000)
  const averageTextLength = profiles.length ? profiles.reduce((sum, page) => sum + page.textLength, 0) / profiles.length : 0
  const hierarchyHints = profiles.flatMap((page) => page.hierarchyHints).slice(0, 12)
  const numberingPatterns = profiles.flatMap((page) => page.numberingPatterns).slice(0, 12)
  const ocrRecommended = averageTextLength < 80
  if (ocrRecommended) diagnostics.push('Low/no PDF text layer detected. Local OCR should be used before relying on text similarity.')
  if (ocrRecommended) diagnostics.push((await runOptionalTesseract(bytes, '.pdf')).diagnostic)
  if (profiles.some((page) => page.orientation === 'landscape')) diagnostics.push('Landscape page detected; often useful for accounting/bank statement grouping.')
  if (profiles.some((page) => page.positionedLines.length >= 5)) diagnostics.push('Coordinate-aware text lines extracted for layout/hierarchy analysis.')
  if (numberingPatterns.some((pattern) => pattern.first === 1 && pattern.last >= 13)) diagnostics.push('Detected a numbered 1-13 document/folder structure.')
  if (hierarchyHints.length) diagnostics.push(`Detected ${hierarchyHints.length} hierarchy/list hint(s) from positioned text.`)
  if (pageCount > pageLimit) diagnostics.push(`Only first ${pageLimit} of ${pageCount} pages inspected for fast clustering.`)

  return {
    text,
    pageCount,
    metadata,
    averageTextLength,
    ocrRecommended,
    pageProfiles: profiles,
    layoutTokens: [
      `pages-${pageCount}`,
      profiles[0]?.orientation ? `first-${profiles[0].orientation}` : 'unknown-orientation',
      `avgtext-${Math.round(averageTextLength)}`,
      metadata.creator ? `creator-${normalize(metadata.creator).slice(0, 36)}` : null,
      metadata.producer ? `producer-${normalize(metadata.producer).slice(0, 36)}` : null,
      numberingPatterns.some((pattern) => pattern.first === 1 && pattern.last >= 13) ? 'numbered-1-13-structure' : null,
      hierarchyHints.length ? 'hierarchy-detected' : null,
      ...topTokens(profiles.map((page) => `${page.headerText} ${page.footerText}`).join(' ')),
    ].filter((token): token is string => Boolean(token)),
    hierarchyHints,
    numberingPatterns,
    diagnostics,
  }
}
