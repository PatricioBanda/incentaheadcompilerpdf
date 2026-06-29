import { NextRequest, NextResponse } from 'next/server'
import { createCompany, getDatabaseStructure } from '@/lib/smartcomprovante/store'
import { routeLogger } from '@/lib/smartcomprovante/logger'

export const runtime = 'nodejs'
export const maxDuration = 120

const log = routeLogger('companies')

export async function GET() {
  return NextResponse.json(await getDatabaseStructure(), { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { legalName?: string; nif?: string; code?: string; projectId?: string }
    if (!body.legalName || !body.nif || !body.code) {
      return NextResponse.json({ error: 'Legal name, NIF, and code are required.' }, { status: 400 })
    }
    const result = await createCompany({ legalName: body.legalName, nif: body.nif, code: body.code, projectId: body.projectId })
    log.info({ companyId: result.company.id, nif: body.nif }, 'Company created')
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    log.error({ error }, 'Company creation failed')
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not create company.' }, { status: 400 })
  }
}
