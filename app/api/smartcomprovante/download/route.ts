import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { getWorkspace } from '@/lib/smartcomprovante/store'

export const runtime = 'nodejs'
export const maxDuration = 120

const DATA_ROOT = process.env.SMARTCOMPROVANTE_DATA_DIR || path.join(process.cwd(), '.smartcomprovante-data')
const EXPORTS_DIR = path.join(DATA_ROOT, 'exports')

export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get('type') === 'final' ? 'final' : 'base'
  const employeeCode = request.nextUrl.searchParams.get('employee') || ''
  const companyId = request.nextUrl.searchParams.get('companyId') || 'agix'
  const projectId = request.nextUrl.searchParams.get('projectId') || 'project-inovacao-01'
  const year = Number(request.nextUrl.searchParams.get('year') || 2026)
  const month = Number(request.nextUrl.searchParams.get('month') || 1)

  const workspace = await getWorkspace(companyId, year, month, projectId)

  if (type === 'base') {
    if (workspace.baseJoin.status !== 'current') {
      return NextResponse.json({ error: 'Base Join is not yet current. Generate it first.' }, { status: 409 })
    }
    const filename = workspace.baseJoin.filename
    const filePath = path.join(EXPORTS_DIR, filename)
    try {
      const bytes = await fs.readFile(filePath)
      return new NextResponse(bytes.buffer as ArrayBuffer, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
        },
      })
    } catch {
      return NextResponse.json({ error: 'Base Join PDF file not found on disk. Re-generate it.' }, { status: 404 })
    }
  }

  const employee = workspace.employees.find((item) => item.employeeCode === employeeCode)
  if (!employee) {
    return NextResponse.json({ error: `Employee ${employeeCode} not found.` }, { status: 404 })
  }
  if (employee.finalStatus !== 'current') {
    return NextResponse.json({ error: 'Comprovante is not yet current. Generate finals first.' }, { status: 409 })
  }
  const filename = employee.filename
  const filePath = path.join(EXPORTS_DIR, filename)
  try {
    const bytes = await fs.readFile(filePath)
    return new NextResponse(bytes.buffer as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Comprovante PDF file not found on disk. Re-generate finals.' }, { status: 404 })
  }
}
