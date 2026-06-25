import { NextRequest, NextResponse } from 'next/server'
import { getWorkspaceOrNull } from '@/lib/smartcomprovante/store'
import { routeLogger } from '@/lib/smartcomprovante/logger'

export const runtime = 'nodejs'
export const maxDuration = 120
export const dynamic = 'force-dynamic'

const log = routeLogger('workspace')

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    const now = new Date()
    const companyId = params.get('companyId')
    const projectId = params.get('projectId') || 'project-inovacao-01'
    const year = Number(params.get('year') || now.getFullYear())
    const month = Number(params.get('month') || now.getMonth() + 1)
    log.debug({ companyId, year, month }, 'Workspace GET')
    const workspace = companyId ? await getWorkspaceOrNull(companyId, year, month, projectId) : null
    if (!workspace) return NextResponse.json({ empty: true }, { headers: { 'Cache-Control': 'no-store' } })
    return NextResponse.json(workspace, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    log.error({ error }, 'Workspace GET failed')
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load workspace.' }, { status: 500 })
  }
}

