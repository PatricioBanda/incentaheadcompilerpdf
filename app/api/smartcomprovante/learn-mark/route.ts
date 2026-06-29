import { NextRequest, NextResponse } from 'next/server'
import { addLearnedMark } from '@/lib/smartcomprovante/store'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      companyId: string
      documentCode: string
      mark: { page: number; x: number; y: number }
      label?: string
      dateText?: string
      contextText?: string
    }
    const m = body.mark
    if (!body.companyId || !body.documentCode || !m || typeof m.page !== 'number' || typeof m.x !== 'number' || typeof m.y !== 'number') {
      return NextResponse.json({ error: 'companyId, documentCode, and a {page,x,y} mark are required.' }, { status: 400 })
    }
    if (m.x < 0 || m.x > 1 || m.y < 0 || m.y > 1) {
      return NextResponse.json({ error: 'Mark x/y must be normalized between 0 and 1.' }, { status: 400 })
    }
    await addLearnedMark(body.companyId, body.documentCode, { mark: m, label: body.label, dateText: body.dateText, contextText: body.contextText })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to save mark.' }, { status: 400 })
  }
}
