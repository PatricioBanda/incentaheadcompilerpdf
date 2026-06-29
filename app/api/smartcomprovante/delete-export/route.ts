import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { updateWorkspace } from '@/lib/smartcomprovante/store'
import { SMARTCOMPROVANTE_DATA_ROOT } from '@/lib/smartcomprovante/paths'

export const runtime = 'nodejs'
export const maxDuration = 120

const DATA_ROOT = SMARTCOMPROVANTE_DATA_ROOT
const EXPORTS_DIR = path.join(DATA_ROOT, 'exports')

type DeleteExportBody = {
  filename?: string
  companyId?: string
  projectId?: string
  year?: number
  month?: number
}

const parseExportFilename = (filename: string) => {
  const base = filename.match(/^BJ_(\d{4})(\d{2})_([^\\/]+)\.pdf$/)
  if (base) return { kind: 'base' as const, year: Number(base[1]), month: Number(base[2]), companyId: base[3], employeeCode: null }

  const final = filename.match(/^CF_(\d{4})(\d{2})_(.+)_([^_\\/]+)\.pdf$/)
  if (final) return { kind: 'final' as const, year: Number(final[1]), month: Number(final[2]), employeeCode: final[3], companyId: final[4] }

  return null
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as DeleteExportBody
    const filename = body.filename || ''
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return NextResponse.json({ error: 'Invalid filename.' }, { status: 400 })
    }

    const parsed = parseExportFilename(filename)
    if (!parsed) return NextResponse.json({ error: 'Only generated Base Join and Final Join PDFs can be deleted here.' }, { status: 400 })

    const companyId = body.companyId || parsed.companyId
    const projectId = body.projectId || 'project-inovacao-01'
    const year = body.year || parsed.year
    const month = body.month || parsed.month
    if (companyId !== parsed.companyId || year !== parsed.year || month !== parsed.month) {
      return NextResponse.json({ error: 'Filename does not match the requested company/period.' }, { status: 400 })
    }

    await fs.rm(path.join(EXPORTS_DIR, filename), { force: true })

    let workspaceUpdated = false
    try {
      await updateWorkspace(companyId, year, month, (draft) => {
        if (parsed.kind === 'base' && draft.baseJoin.filename === filename) {
          draft.baseJoin = {
            status: 'ready',
            filename: `BJ_${year}${String(month).padStart(2, '0')}_${companyId}.pdf`,
            includedFolders: 0,
            pageCount: null,
            updatedAt: null,
          }
          draft.employees = draft.employees.map((employee) => ({
            ...employee,
            finalStatus: employee.finalStatus === 'current' ? 'ready' : employee.finalStatus,
          }))
        }

        if (parsed.kind === 'final') {
          draft.employees = draft.employees.map((employee) => employee.filename === filename
            ? { ...employee, finalStatus: 'ready', pageCount: null }
            : employee)
        }

        draft.activity.unshift({
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          text: `${parsed.kind === 'base' ? 'Base Join' : 'Final Join'} deleted: ${filename}`,
          tone: 'warning',
        })
        workspaceUpdated = true
        return draft
      }, projectId)
    } catch {
      // The export library can contain old files for periods that no longer have a workspace.
    }

    return NextResponse.json({ ok: true, kind: parsed.kind, workspaceUpdated })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not delete generated PDF.' }, { status: 400 })
  }
}
