import { NextRequest, NextResponse } from 'next/server'
import { getWorkspace, recordJoinReference, updateCompanyFolderRequirements, updateWorkspace } from '@/lib/smartcomprovante/store'
import type { JoinReference } from '@/lib/smartcomprovante/types'
import { RH_FOLDERS } from '@/lib/smartcomprovante/taxonomy'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')
    const kind = String(formData.get('kind')) as JoinReference['kind']
    const companyId = String(formData.get('companyId') || 'agix')
    const projectId = String(formData.get('projectId') || 'project-inovacao-01')
    const year = Number(formData.get('year') || 2026)
    const month = Number(formData.get('month') || 1)

    if (!(file instanceof File)) return NextResponse.json({ error: 'Select a reference PDF.' }, { status: 400 })
    if (!['base_join', 'final_join'].includes(kind)) return NextResponse.json({ error: 'Invalid reference type.' }, { status: 400 })
    if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: 'Reference PDF cannot exceed 25 MB.' }, { status: 400 })

    const current = await getWorkspace(companyId, year, month, projectId)
    const baseCodes = RH_FOLDERS.filter((folder) => folder.number >= 2 && folder.number <= 13).map((folder) => folder.code)
    const analysis: Parameters<typeof recordJoinReference>[3] = {
      document_codes: kind === 'base_join' ? baseCodes : ['RV', ...baseCodes],
      structural_summary: `Fast local profile saved from "${file.name}". Heavy learning/LLM analysis is deferred to the Train rules step so uploads stay responsive.`,
      classification_hints: [
        kind === 'base_join'
          ? 'Monthly Base Join example: aggregated document without individual payslip at the start.'
          : 'Final Join example: per-employee comprovante with payslip and monthly evidence.',
        'Use this PDF as local training material for folder order, section fingerprints, naming, and page-count patterns.',
      ],
      payslip_first: kind === 'final_join' ? true : null,
      employee_specific: kind === 'final_join',
      confidence: 0.35,
    }

    const { reference, rulesVersion } = await recordJoinReference(current.company, file, kind, analysis, {
      extractSections: true,
      runLearningEngine: false,
    })

    if (reference.learnedSections && reference.learnedSections.length > 0) {
      try {
        await updateCompanyFolderRequirements(companyId, reference.learnedSections.map((section) => ({
          document_code: section.document_code,
          section_order: section.section_order,
          page_count: section.page_count,
        })))
      } catch {
        // Non-fatal: upload should remain fast and resilient.
      }
    }

    const workspace = await updateWorkspace(companyId, year, month, (draft) => {
      const references = draft.joinReferences || []
      if (!references.some((item) => item.sourceHash === reference.sourceHash && item.kind === kind)) references.unshift(reference)
      draft.joinReferences = references
      draft.company.rulesVersion = rulesVersion
      const label = kind === 'base_join' ? 'Base Join' : 'Final Join'
      const sectionCount = reference.learnedSections?.length || 0
      draft.activity.unshift({
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        text: `${file.name} saved as ${label} reference - ${sectionCount} quick section fingerprint(s) detected. Click Train rules for the heavier learning pass.`,
        tone: 'success',
      })
      return draft
    }, projectId)

    return NextResponse.json(workspace)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save reference.' }, { status: 400 })
  }
}
