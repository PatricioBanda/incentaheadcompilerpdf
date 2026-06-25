import { NextRequest, NextResponse } from 'next/server'
import { addLearnedAnchor } from '@/lib/smartcomprovante/store'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { companyId: string; documentCode: string; anchorPhrase: string }
    if (!body.companyId || !body.documentCode || !body.anchorPhrase?.trim()) {
      return NextResponse.json({ error: 'companyId, documentCode, and anchorPhrase are required.' }, { status: 400 })
    }
    await addLearnedAnchor(body.companyId, body.documentCode, body.anchorPhrase.trim())
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to save anchor.' }, { status: 400 })
  }
}
