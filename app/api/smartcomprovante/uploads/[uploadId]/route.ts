import { NextRequest, NextResponse } from 'next/server'
import type { UploadStatus } from '@/lib/smartcomprovante/upload-types'
import { updateUploadStatus } from '@/lib/smartcomprovante/upload-store'

export const runtime = 'nodejs'
export const maxDuration = 120

const VALID_STATUSES: UploadStatus[] = ['submitted', 'grouped', 'month_detected', 'approved', 'archived']

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ uploadId: string }> }) {
  try {
    const { uploadId } = await params
    const body = await request.json() as { companyId?: string; year?: number; status?: UploadStatus }
    const { companyId, year, status } = body
    if (!companyId || !year || !status) {
      return NextResponse.json({ error: 'companyId, year, and status are required.' }, { status: 400 })
    }
    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 })
    }
    await updateUploadStatus(companyId, year, uploadId, status)
    return NextResponse.json({ ok: true, uploadId, status })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Status update failed.' }, { status: 400 })
  }
}
