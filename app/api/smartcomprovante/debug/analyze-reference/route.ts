import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { extractJoinSectionFingerprints } from '@/lib/smartcomprovante/join-learning'
import { inspectDocument } from '@/lib/smartcomprovante/document-intelligence'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { path?: string; kind?: 'base_join' | 'final_join' }
    if (!body.path) return NextResponse.json({ error: 'Missing PDF path.' }, { status: 400 })
    const resolved = path.resolve(body.path)
    const bytes = await fs.readFile(resolved)
    const sections = await extractJoinSectionFingerprints(bytes, { includeFolderOne: body.kind !== 'base_join' })
    const file = new File([bytes], path.basename(resolved), { type: 'application/pdf' })
    const intelligence = await inspectDocument(file)
    return NextResponse.json({
      filename: path.basename(resolved),
      kind: body.kind || 'final_join',
      detected: sections.length,
      metadata: intelligence.metadata,
      numberingPatterns: intelligence.numberingPatterns,
      hierarchyHints: intelligence.hierarchyHints,
      diagnostics: intelligence.diagnostics,
      sections,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Analysis failed.' }, { status: 400 })
  }
}
