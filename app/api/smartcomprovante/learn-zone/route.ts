import { NextRequest, NextResponse } from 'next/server'
import { addLearnedZone } from '@/lib/smartcomprovante/store'

export const runtime = 'nodejs'
export const maxDuration = 120

const zones = new Set(['header', 'body', 'footer'])

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { companyId: string; documentCode: string; zone: string }
    if (!body.companyId || !body.documentCode || !zones.has(body.zone)) {
      return NextResponse.json({ error: 'companyId, documentCode, and a valid zone (header|body|footer) are required.' }, { status: 400 })
    }
    await addLearnedZone(body.companyId, body.documentCode, body.zone as 'header' | 'body' | 'footer')
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to save zone.' }, { status: 400 })
  }
}
