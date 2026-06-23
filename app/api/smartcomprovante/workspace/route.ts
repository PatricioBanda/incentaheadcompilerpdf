import { NextRequest, NextResponse } from 'next/server'
import { getWorkspace } from '@/lib/smartcomprovante/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    const workspace = await getWorkspace(
      params.get('companyId') || 'agix',
      Number(params.get('year') || 2026),
      Number(params.get('month') || 1),
    )
    return NextResponse.json(workspace, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Não foi possível carregar o workspace.' }, { status: 500 })
  }
}

