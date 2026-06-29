import { NextRequest, NextResponse } from 'next/server'
import { addLearnedAnchor, getCompanyRuleContext } from '@/lib/smartcomprovante/store'
import { extractPeriodForKnownCode, localRouteDocument } from '@/lib/smartcomprovante/routing'
import { detectPeriodWithGroq } from '@/lib/smartcomprovante/providers/groq'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const companyId = String(formData.get('companyId') || '')
    const year = Number(formData.get('year') || new Date().getFullYear())
    const month = Number(formData.get('month') || 1)
    const files = formData.getAll('files').filter((item): item is File => item instanceof File)
    const hashes = formData.getAll('hashes').map((item) => String(item))
    const documentCodes = formData.getAll('documentCodes').map((item) => String(item))

    if (!companyId || !files.length) {
      return NextResponse.json({ error: 'companyId and at least one file are required.' }, { status: 400 })
    }

    const ruleContext = await getCompanyRuleContext(companyId)
    const results: Array<{ hash: string; filename: string; year: number | null; month: number | null; reason: string; source: string; phrase?: string | null }> = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const hash = hashes[i] || ''
      const knownCode = documentCodes[i] || ''

      try {
        // Phase 0 — use the known document code's anchor/mark directly (highest priority).
        // This avoids localRouteDocument re-classifying the file under a different code
        // and picking the wrong fingerprint, which would ignore the user-saved anchor.
        if (knownCode) {
          const direct = await extractPeriodForKnownCode(file, knownCode, ruleContext)
          if (direct?.year && direct.month) {
            results.push({ hash, filename: file.name, year: direct.year, month: direct.month, reason: `Learned anchor for ${knownCode}: ${direct.evidenceText}`, source: 'rules', phrase: direct.evidenceText || null })
            continue
          }
        }

        // Phase 1 — full rule-based routing (catches cases with no saved anchor yet)
        const routed = await localRouteDocument(file, { year, month }, ruleContext, file.name, { ignorePeriodConfidence: false })
        const docCode = knownCode || routed.document_code

        if (routed.target_year && routed.target_month) {
          results.push({ hash, filename: file.name, year: routed.target_year, month: routed.target_month, reason: routed.reason, source: 'rules', phrase: null })
          continue
        }

        // Phase 2 — Groq fallback when rules (including the mark) returned no period
        try {
          const learnedPhrases = ruleContext.enrichedFingerprints?.find((fp) => fp.document_code === docCode)?.period_signal?.anchor_phrases
          const groq = await detectPeriodWithGroq(file, docCode, learnedPhrases)
          if (groq.year && groq.month) {
            if (groq.phrase) {
              try { await addLearnedAnchor(companyId, docCode, groq.phrase) } catch { /* pre-training */ }
            }
            results.push({ hash, filename: file.name, year: groq.year, month: groq.month, reason: `Groq: "${groq.phrase ?? 'detected from document'}"`, source: 'groq', phrase: groq.phrase ?? null })
            continue
          }
        } catch { /* Groq unavailable or quota — not fatal */ }

        results.push({ hash, filename: file.name, year: null, month: null, reason: 'No period detected by rules or Groq.', source: 'unknown', phrase: null })
      } catch {
        results.push({ hash, filename: file.name, year: null, month: null, reason: 'Failed to extract period from this file.', source: 'error', phrase: null })
      }
    }

    return NextResponse.json({ results })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Month reclassification failed.' }, { status: 400 })
  }
}
