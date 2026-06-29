import { NextRequest, NextResponse } from 'next/server'
import { saveCachedClassification } from '@/lib/smartcomprovante/store'
import { RH_FOLDERS } from '@/lib/smartcomprovante/taxonomy'
import { updateUploadStatusByHash } from '@/lib/smartcomprovante/upload-store'

export const runtime = 'nodejs'
export const maxDuration = 300

type ReassignBody = {
  companyId: string
  sourceHash: string
  documentCode: string
  targetYear?: number | null
  targetMonth?: number | null
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as ReassignBody
    if (!body.companyId || !body.sourceHash || !body.documentCode) {
      return NextResponse.json({ error: 'companyId, sourceHash, and documentCode are required.' }, { status: 400 })
    }
    if (!/^[0-9a-f]{64}$/.test(body.sourceHash)) {
      return NextResponse.json({ error: 'sourceHash must be a 64-character hex SHA-256 digest.' }, { status: 400 })
    }
    const folder = RH_FOLDERS.find((item) => item.code === body.documentCode)
    if (!folder) return NextResponse.json({ error: `Unknown document code ${body.documentCode}.` }, { status: 400 })

    // An operator correction is ground truth — store it at full confidence so the next
    // clustering run reads it from cache and places the file in the corrected folder.
    await saveCachedClassification(body.companyId, body.sourceHash, {
      document_code: body.documentCode,
      confidence: 1,
      reason: `Operator reassigned to ${folder.code} · ${folder.label}.`,
      target_year: body.targetYear ?? null,
      target_month: body.targetMonth ?? null,
      employee_name: null,
      route_source: 'operator',
    })
    // Mark the upload as operator-approved (non-blocking, best-effort)
    if (body.targetYear) {
      void updateUploadStatusByHash(body.companyId, body.targetYear, body.sourceHash, 'approved')
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Reassignment failed.' }, { status: 400 })
  }
}
