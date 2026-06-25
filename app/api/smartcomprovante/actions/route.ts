import { NextRequest, NextResponse } from 'next/server'
import { aggregateCompanyFingerprints, assembleBaseJoinPdf, assembleFinalJoinPdf, recordApprovedExample, resetPrototypeCompany, resetPrototypeDatabase, resetPrototypeWorkspace, updateWorkspace, validateBaseJoinStructure } from '@/lib/smartcomprovante/store'
import { classifyPrototypeDocuments } from '@/lib/smartcomprovante/providers/gemini'
import { RH_FOLDERS } from '@/lib/smartcomprovante/taxonomy'
import { archiveUploadsForPeriod, deleteUploadsForCompany } from '@/lib/smartcomprovante/upload-store'
import { routeLogger } from '@/lib/smartcomprovante/logger'

export const runtime = 'nodejs'
export const maxDuration = 300

const log = routeLogger('actions')

type ActionBody = {
  action: 'process-demo' | 'approve-review' | 'pass-review' | 'generate-base' | 'generate-finals' | 'reset-demo' | 'reset-system' | 'reset-company' | 'train-examples' | 'validate-base'
  companyId?: string
  projectId?: string
  year?: number
  month?: number
  reviewId?: string
  destinationCode?: string
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as ActionBody
    const companyId = body.companyId || 'agix'
    const projectId = body.projectId || 'project-inovacao-01'
    const year = body.year || 2026
    const month = body.month || 1
    const now = new Date().toISOString()
    log.info({ action: body.action, companyId, year, month }, 'Action POST')
    if (body.action === 'reset-system') return NextResponse.json(await resetPrototypeDatabase())
    if (body.action === 'reset-company') {
      const result = await resetPrototypeCompany(companyId, projectId)
      await deleteUploadsForCompany(companyId)
      return NextResponse.json(result)
    }
    if (body.action === 'reset-demo') return NextResponse.json(await resetPrototypeWorkspace())
    let liveGeminiResult: Awaited<ReturnType<typeof classifyPrototypeDocuments>> = null
    if (body.action === 'process-demo') liveGeminiResult = await classifyPrototypeDocuments()

    const workspace = await updateWorkspace(companyId, year, month, (draft) => {
      if (!draft.approvedDocuments) draft.approvedDocuments = []
      if (body.action === 'process-demo') {
        draft.intakeCount = 0
        draft.folders = draft.folders.map((folder) => {
          if (folder.number === 6 || folder.number === 13) {
            return { ...folder, status: 'approved', documentCount: 1, approvedCount: 1, reviewCount: 0 }
          }
          return folder
        })
        draft.activity.unshift({
          id: crypto.randomUUID(), at: now,
          text: liveGeminiResult
            ? `Gemini classified ${liveGeminiResult.classifications.length} synthetic examples; response validated by schema.`
            : 'Local demo complete. Configure Gemini to run the cloud test with synthetic examples.',
          tone: liveGeminiResult ? 'success' : 'info',
        })
      }

      if (body.action === 'approve-review' || body.action === 'pass-review') {
        const review = draft.reviews.find((item) => item.id === body.reviewId)
        if (!review) throw new Error('Review item not found.')
        if (body.action === 'approve-review' && body.destinationCode) {
          const destination = RH_FOLDERS.find((folder) => folder.code === body.destinationCode)
          if (!destination) throw new Error('Invalid classification destination.')
          if (review.proposedCode !== destination.code) {
            const previousFolder = draft.folders.find((folder) => folder.code === review.proposedCode)
            if (previousFolder) {
              previousFolder.documentCount = Math.max(0, previousFolder.documentCount - 1)
              previousFolder.reviewCount = Math.max(0, previousFolder.reviewCount - 1)
              if (previousFolder.documentCount === 0) previousFolder.status = 'missing'
            }
            const nextFolder = draft.folders.find((folder) => folder.code === destination.code)
            if (nextFolder) { nextFolder.documentCount += 1; nextFolder.reviewCount += 1; nextFolder.status = 'review' }
          }
          review.proposedCode = destination.code
          review.proposedLabel = destination.label
        }
        review.status = body.action === 'approve-review' ? 'approved' : 'passed'
        const folder = draft.folders.find((item) => item.code === review.proposedCode)
        if (folder) {
          folder.status = body.action === 'approve-review' ? 'approved' : 'passed'
          folder.reviewCount = 0
          folder.approvedCount = body.action === 'approve-review' ? Math.max(1, folder.documentCount) : 0
        }
        if (body.action === 'approve-review' && review.sourceHash && folder) {
          if (!draft.approvedDocuments) draft.approvedDocuments = []
          const alreadyTracked = draft.approvedDocuments.some((doc) => doc.sourceHash === review.sourceHash)
          if (!alreadyTracked) {
            draft.approvedDocuments.push({
              id: crypto.randomUUID(),
              sourceHash: review.sourceHash,
              folderCode: folder.code,
              folderNumber: folder.number,
              filename: review.filename,
              pageCount: 1,
              confidence: review.confidence,
              approvedAt: now,
              approvedBy: 'operator',
            })
          }
          if (folder.code === 'RV' && review.sourceHash) {
            const matchingEmployee = draft.employees.find((emp) =>
              emp.employeeName === review.employeeName || emp.payslipHash === review.sourceHash
            ) || draft.employees.find((emp) => !emp.payslipHash && emp.payslipStatus === 'review')
            if (matchingEmployee) matchingEmployee.payslipHash = review.sourceHash
          }
        }
        draft.activity.unshift({ id: crypto.randomUUID(), at: now, text: `${review.filename} was ${review.status === 'approved' ? 'approved' : 'passed'} by the operator.`, tone: 'success' })
      }

      const unresolved = draft.reviews.some((review) => review.status === 'pending')
      const missingBaseDependency = draft.folders.slice(1).some((folder) => !['approved', 'passed', 'confirmed_missing'].includes(folder.status))
      if (!unresolved && draft.baseJoin.status === 'blocked') draft.baseJoin.status = missingBaseDependency ? 'needs_confirmation' : 'ready'

      if (body.action === 'train-examples') {
        const references = draft.joinReferences || []
        const baseCount = references.filter((item) => item.kind === 'base_join').length
        const finalCount = references.filter((item) => item.kind === 'final_join').length
        if (baseCount + finalCount === 0) throw new Error('Upload at least one Base Join or Final Join example before training.')
        // Aggregation + validation run after updateWorkspace — placeholder activity here, updated below
        draft.activity.unshift({
          id: crypto.randomUUID(),
          at: now,
          text: `Aggregating ${baseCount} Base Join and ${finalCount} Final Join reference(s) through 7-layer learning engine…`,
          tone: 'info',
        })
      }

      if (body.action === 'generate-base') {
        if (unresolved) throw new Error('Base Join is still blocked by unresolved reviews.')
        const confirmedMissing = draft.folders.slice(1).filter((folder) => !['approved', 'passed', 'confirmed_missing'].includes(folder.status))
        const generatedWithWarnings = confirmedMissing.length > 0
        if (generatedWithWarnings) {
          draft.folders = draft.folders.map((folder) => confirmedMissing.some((missing) => missing.number === folder.number)
            ? { ...folder, status: 'confirmed_missing', documentCount: 0, approvedCount: 0, reviewCount: 0 }
            : folder)
        }
        const baseFilename = `BJ_${year}${String(month).padStart(2, '0')}_${companyId}.pdf`
        draft.baseJoin = {
          status: 'current',
          filename: baseFilename,
          includedFolders: 12 - confirmedMissing.length,
          pageCount: null,
          updatedAt: now,
        }
        draft.employees = draft.employees.map((employee) => ({
          ...employee,
          finalStatus: employee.payslipStatus === 'approved' ? generatedWithWarnings ? 'ready_with_warnings' : 'ready' : 'blocked',
        }))
        draft.activity.unshift({
          id: crypto.randomUUID(), at: now,
          text: generatedWithWarnings
            ? `${baseFilename} prepared with ${confirmedMissing.length} folder(s) confirmed missing.`
            : `${baseFilename} generated and reconciled.`,
          tone: generatedWithWarnings ? 'warning' : 'success',
        })
        return draft
      }

      if (body.action === 'generate-finals') {
        if (draft.baseJoin.status !== 'current') throw new Error('Generate a current Base Join first.')
        const generated = draft.employees.filter((employee) => employee.finalStatus === 'ready' || employee.finalStatus === 'ready_with_warnings').length
        draft.activity.unshift({ id: crypto.randomUUID(), at: now, text: `${generated} comprovante(s) queued for assembly with SharePoint-safe names.`, tone: 'success' })
      }

      return draft
    }, projectId)

    if (body.action === 'train-examples') {
      try {
        const { fingerprints, qualityScore, rulesVersion } = await aggregateCompanyFingerprints(companyId)
        const qualityPct = Math.round(qualityScore * 100)
        const finalWs = await updateWorkspace(companyId, year, month, (draft) => {
          draft.company.rulesVersion = rulesVersion
          const placeholder = draft.activity.find((a) => a.text.includes('7-layer learning engine'))
          if (placeholder) {
            placeholder.text = `Learning engine — ${fingerprints.length} section(s) aggregated and validated. Quality: ${qualityPct}%. Rules v${rulesVersion}.`
            placeholder.tone = qualityScore >= 0.7 ? 'success' : 'warning'
          }
          return draft
        }, projectId)
        return NextResponse.json(finalWs)
      } catch (trainError) {
        const finalWs = await updateWorkspace(companyId, year, month, (draft) => {
          const placeholder = draft.activity.find((a) => a.text.includes('7-layer learning engine'))
          if (placeholder) {
            placeholder.text = `Training failed: ${trainError instanceof Error ? trainError.message : 'unknown error'}`
            placeholder.tone = 'warning'
          }
          return draft
        }, projectId)
        return NextResponse.json(finalWs)
      }
    }

    if (body.action === 'approve-review' && body.reviewId) {
      const approved = workspace.reviews.find((item) => item.id === body.reviewId)
      if (approved) {
        const rulesVersion = await recordApprovedExample(workspace.company, approved)
        if (rulesVersion !== workspace.company.rulesVersion) {
          const learnedWorkspace = await updateWorkspace(companyId, year, month, (draft) => {
            draft.company.rulesVersion = rulesVersion
            draft.activity.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), text: `Approved correction added to company rules v${rulesVersion}.`, tone: 'success' })
            return draft
          }, projectId)
          return NextResponse.json(learnedWorkspace)
        }
      }
    }

    if (body.action === 'generate-base') {
      try {
        const { pageCount } = await assembleBaseJoinPdf(projectId, companyId, year, month)
        // Archive all active uploads for this company/year — documents are now in the output
        void archiveUploadsForPeriod(companyId, year)
        const finalWs = await updateWorkspace(companyId, year, month, (draft) => {
          draft.baseJoin.pageCount = pageCount
          draft.activity.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), text: `Base Join assembled: ${pageCount} page(s).`, tone: 'success' })
          return draft
        }, projectId)
        return NextResponse.json(finalWs)
      } catch (assemblyError) {
        const finalWs = await updateWorkspace(companyId, year, month, (draft) => {
          draft.activity.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), text: `Base Join metadata saved. PDF assembly: ${assemblyError instanceof Error ? assemblyError.message : 'no approved source files cached yet.'}`, tone: 'warning' })
          return draft
        }, projectId)
        return NextResponse.json(finalWs)
      }
    }

    if (body.action === 'generate-finals') {
      const readyEmployees = workspace.employees.filter((emp) => (emp.finalStatus === 'ready' || emp.finalStatus === 'ready_with_warnings') && emp.payslipHash)
      let assembled = 0
      const errors: string[] = []
      for (const employee of readyEmployees) {
        try {
          const { pageCount } = await assembleFinalJoinPdf(projectId, companyId, year, month, employee.employeeCode)
          await updateWorkspace(companyId, year, month, (draft) => {
            const emp = draft.employees.find((e) => e.employeeCode === employee.employeeCode)
            if (emp) { emp.finalStatus = 'current'; emp.pageCount = pageCount }
            return draft
          }, projectId)
          assembled += 1
        } catch (empError) {
          errors.push(`${employee.employeeCode}: ${empError instanceof Error ? empError.message : 'assembly failed'}`)
        }
      }
      const finalWs = await updateWorkspace(companyId, year, month, (draft) => {
        draft.activity.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), text: `${assembled} comprovante(s) assembled. ${errors.length ? `Errors: ${errors.join('; ')}` : 'All done.'}`, tone: errors.length ? 'warning' : 'success' })
        return draft
      }, projectId)
      return NextResponse.json(finalWs)
    }

    if (body.action === 'validate-base') {
      if (workspace.baseJoin.status !== 'current') {
        return NextResponse.json({ error: 'Generate a Base Join first.' }, { status: 400 })
      }
      try {
        const validation = await validateBaseJoinStructure(companyId, year, month, projectId)
        const finalWs = await updateWorkspace(companyId, year, month, (draft) => {
          draft.baseJoin.validation = validation
          const found = validation.sections.filter((s) => s.found).length
          draft.activity.unshift({
            id: crypto.randomUUID(), at: new Date().toISOString(),
            text: `Structure validation: ${Math.round(validation.overallConfidence * 100)}% confidence · ${found}/${validation.sections.length} sections matched.`,
            tone: validation.overallConfidence >= 0.85 ? 'success' : validation.overallConfidence >= 0.7 ? 'info' : 'warning',
          })
          return draft
        }, projectId)
        return NextResponse.json(finalWs)
      } catch (validationError) {
        return NextResponse.json({ error: validationError instanceof Error ? validationError.message : 'Validation failed.' }, { status: 400 })
      }
    }

    return NextResponse.json(workspace)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Action failed.' }, { status: 400 })
  }
}
