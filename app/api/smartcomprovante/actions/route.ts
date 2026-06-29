import { NextRequest, NextResponse } from 'next/server'
import { aggregateCompanyFingerprints, assembleBaseJoinPdf, assembleFinalJoinPdf, assembleCustomFinalJoinPdf, recordApprovedExample, resetPrototypeCompany, resetPrototypeDatabase, resetPrototypeWorkspace, updateWorkspace, validateBaseJoinStructure } from '@/lib/smartcomprovante/store'
import { classifyPrototypeDocuments } from '@/lib/smartcomprovante/providers/gemini'
import { RH_FOLDERS } from '@/lib/smartcomprovante/taxonomy'
import { archiveUploadsForPeriod, deleteUploadsForCompany, listUploads } from '@/lib/smartcomprovante/upload-store'
import { routeLogger } from '@/lib/smartcomprovante/logger'

export const runtime = 'nodejs'
export const maxDuration = 60

const log = routeLogger('actions')

type ClassificationItem = {
  sourceHash: string
  filename: string
  folderNumber: number
  folderCode: string
  targetYear: number
  targetMonth: number
  confidence: number
}

type ActionBody = {
  action: 'process-demo' | 'approve-review' | 'pass-review' | 'generate-base' | 'generate-finals' | 'generate-custom-final' | 'reset-demo' | 'reset-system' | 'reset-company' | 'train-examples' | 'validate-base' | 'confirm-classification'
  companyId?: string
  projectId?: string
  year?: number
  month?: number
  reviewId?: string
  destinationCode?: string
  confirmMissing?: boolean
  classificationItems?: ClassificationItem[]
  // generate-custom-final
  payslipUploadId?: string
  payslipPhysicalFolder?: number
  payslipFilename?: string
  baseJoinFilename?: string
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

    // confirm-classification: persists cluster assignments from the UI into workspace reviews + folder statuses.
    // Items are grouped by their targetYear/targetMonth and applied to the corresponding workspace.
    if (body.action === 'confirm-classification') {
      const items = body.classificationItems ?? []
      if (!items.length) return NextResponse.json({ ok: true, updated: 0 })

      // Group items by period
      const byPeriod = new Map<string, ClassificationItem[]>()
      for (const item of items) {
        const key = `${item.targetYear}:${item.targetMonth}`
        if (!byPeriod.has(key)) byPeriod.set(key, [])
        byPeriod.get(key)!.push(item)
      }

      let totalUpdated = 0
      for (const [, periodItems] of byPeriod) {
        const { targetYear: pYear, targetMonth: pMonth } = periodItems[0]
        await updateWorkspace(companyId, pYear, pMonth, (draft) => {
          if (!draft.approvedDocuments) draft.approvedDocuments = []
          for (const item of periodItems) {
            // Add/update workspace review so operators can see what was confirmed
            const existing = draft.reviews.find((r) => r.sourceHash === item.sourceHash)
            if (!existing) {
              draft.reviews.push({
                id: crypto.randomUUID(),
                filename: item.filename,
                proposedCode: item.folderCode,
                proposedLabel: RH_FOLDERS.find((f) => f.number === item.folderNumber)?.label ?? item.folderCode,
                confidence: item.confidence,
                reason: 'Confirmed by operator via cluster view',
                status: 'passed',
                sourceHash: item.sourceHash,
              })
            } else if (existing.status === 'pending') {
              existing.status = 'passed'
              existing.proposedCode = item.folderCode
            }

            // Update folder documentCount + status
            const folder = draft.folders.find((f) => f.number === item.folderNumber)
            if (folder) {
              folder.documentCount = Math.max(folder.documentCount, periodItems.filter((i) => i.folderNumber === item.folderNumber).length)
              if (folder.status === 'missing') folder.status = 'review'
            }

            // Register in approvedDocuments so assembly can find the file immediately
            if (!draft.approvedDocuments.some((d) => d.sourceHash === item.sourceHash)) {
              draft.approvedDocuments.push({
                id: crypto.randomUUID(),
                sourceHash: item.sourceHash,
                folderCode: item.folderCode,
                folderNumber: item.folderNumber,
                filename: item.filename,
                pageCount: 1,
                confidence: item.confidence,
                approvedAt: now,
                approvedBy: 'auto',
              })
            }
          }
          return draft
        }, projectId)
        totalUpdated += periodItems.length
      }
      return NextResponse.json({ ok: true, updated: totalUpdated, periods: byPeriod.size })
    }

    let liveGeminiResult: Awaited<ReturnType<typeof classifyPrototypeDocuments>> = null
    if (body.action === 'process-demo') liveGeminiResult = await classifyPrototypeDocuments()

    // Pre-flight for generate-base: sync folder statuses and approvedDocuments from all available sources
    // so that the confirmation gate inside updateWorkspace sees correct folder states.
    if (body.action === 'generate-base') {
      const allUploads = await listUploads(companyId, year)

      // Helper: infer folder number from filename prefix (e.g. "02_LC_..." → 2)
      const inferFolderFromFilename = (filename: string): number | null => {
        const match = filename.match(/^(\d{1,2})[_\-\s]/)
        if (!match) return null
        const n = parseInt(match[1], 10)
        return n >= 1 && n <= 13 ? n : null
      }

      await updateWorkspace(companyId, year, month, (draft) => {
        if (!draft.approvedDocuments) draft.approvedDocuments = []

        // Source 1: workspace reviews (files classified from folder 0 via clustering)
        for (const review of draft.reviews) {
          if (!review.sourceHash) continue
          const folder = draft.folders.find((f) => f.code === review.proposedCode && f.number >= 2 && f.number <= 13)
          if (!folder) continue
          if (folder.documentCount === 0) folder.documentCount = 1
          if (!draft.approvedDocuments.some((d) => d.sourceHash === review.sourceHash)) {
            draft.approvedDocuments.push({
              id: crypto.randomUUID(), sourceHash: review.sourceHash,
              folderCode: folder.code, folderNumber: folder.number,
              filename: review.filename, pageCount: 1,
              confidence: review.confidence, approvedAt: now, approvedBy: 'auto',
            })
          }
        }

        // Source 2: files uploaded directly to folders 2-13
        const directUploads = allUploads.filter((u) => u.folderNumber >= 2 && u.folderNumber <= 13 && (u.month === month || u.month == null))
        for (const upload of directUploads) {
          const folderEntry = draft.folders.find((f) => f.number === upload.folderNumber)
          if (folderEntry && folderEntry.documentCount === 0) folderEntry.documentCount = upload.files.length
          for (const file of upload.files) {
            if (!file.hash || draft.approvedDocuments.some((d) => d.sourceHash === file.hash)) continue
            const folderDef = RH_FOLDERS.find((f) => f.number === upload.folderNumber)
            draft.approvedDocuments.push({
              id: crypto.randomUUID(), sourceHash: file.hash,
              folderCode: folderDef?.code ?? 'UNKNOWN', folderNumber: upload.folderNumber,
              filename: file.name, pageCount: 1,
              confidence: 1.0, approvedAt: upload.submittedAt, approvedBy: 'auto',
            })
          }
        }

        // Source 3: folder-0 uploads — infer folder from filename prefix (e.g. "02_LC_..." → folder 2)
        // This handles files uploaded in bulk to the inbox that were visually classified in the cluster UI
        const inboxUploads = allUploads.filter((u) => u.folderNumber === 0 && u.status !== 'archived' && (u.month === month || u.month == null))
        for (const upload of inboxUploads) {
          for (const file of upload.files) {
            if (!file.hash || draft.approvedDocuments.some((d) => d.sourceHash === file.hash)) continue
            const inferredFolder = inferFolderFromFilename(file.name)
            if (!inferredFolder || inferredFolder < 2 || inferredFolder > 13) continue
            const folderDef = RH_FOLDERS.find((f) => f.number === inferredFolder)
            if (!folderDef) continue
            const folderEntry = draft.folders.find((f) => f.number === inferredFolder)
            if (folderEntry && folderEntry.documentCount === 0) folderEntry.documentCount = 1
            draft.approvedDocuments.push({
              id: crypto.randomUUID(), sourceHash: file.hash,
              folderCode: folderDef.code, folderNumber: inferredFolder,
              filename: file.name, pageCount: 1,
              confidence: 0.9, approvedAt: upload.submittedAt, approvedBy: 'auto',
            })
          }
        }

        return draft
      }, projectId)
    }

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
        // Folders are considered present if they have documents (any of: approved, passed, review, confirmed_missing)
        // Only truly empty folders (missing/blocked with documentCount 0) require confirmation
        const incompleteFolders = draft.folders
          .filter((f) => f.number >= 2 && f.number <= 13)
          .filter((f) => !['approved', 'passed', 'confirmed_missing', 'review'].includes(f.status) && f.documentCount === 0)
        // Dry-run: if folders are genuinely empty and the operator has not yet confirmed, surface the list
        if (incompleteFolders.length > 0 && !body.confirmMissing) {
          const missingFolders = incompleteFolders.map((f) => ({ number: f.number, code: f.code, label: f.label }))
          // Return a sentinel so the caller can show the confirmation dialog; updateWorkspace is abandoned via throw
          throw Object.assign(new Error('REQUIRES_CONFIRMATION'), { requiresConfirmation: true, missingFolders })
        }
        const generatedWithWarnings = incompleteFolders.length > 0
        if (generatedWithWarnings) {
          draft.folders = draft.folders.map((folder) => incompleteFolders.some((missing) => missing.number === folder.number)
            ? { ...folder, status: 'confirmed_missing', documentCount: 0, approvedCount: 0, reviewCount: 0 }
            : folder)
        }
        const baseFilename = `BJ_${year}${String(month).padStart(2, '0')}_${companyId}.pdf`
        draft.baseJoin = {
          status: 'current',
          filename: baseFilename,
          includedFolders: 12 - incompleteFolders.length,
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
            ? `${baseFilename} prepared with ${incompleteFolders.length} folder(s) confirmed missing.`
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

    // generate-custom-final: assembles payslip + chosen Base Join without needing workspace.employees
    if (body.action === 'generate-custom-final') {
      const { payslipUploadId, payslipFilename, baseJoinFilename } = body
      const physicalFolder = body.payslipPhysicalFolder ?? 1
      if (!payslipUploadId || !payslipFilename || !baseJoinFilename) {
        return NextResponse.json({ error: 'payslipUploadId, payslipFilename and baseJoinFilename are required.' }, { status: 400 })
      }
      try {
        const result = await assembleCustomFinalJoinPdf(companyId, year, month, { uploadId: payslipUploadId, physicalFolderNumber: physicalFolder, filename: payslipFilename }, baseJoinFilename)
        return NextResponse.json({ ok: true, filename: result.filename, pageCount: result.pageCount })
      } catch (err) {
        return NextResponse.json({ error: err instanceof Error ? err.message : 'Assembly failed.' }, { status: 400 })
      }
    }

    return NextResponse.json(workspace)
  } catch (error) {
    // Confirmation gate: surface missing folders so the UI can show a dialog
    if (error instanceof Error && (error as Error & { requiresConfirmation?: boolean }).requiresConfirmation) {
      const e = error as Error & { missingFolders?: Array<{ number: number; code: string; label: string }> }
      return NextResponse.json({ requiresConfirmation: true, missingFolders: e.missingFolders ?? [] }, { status: 409 })
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Action failed.' }, { status: 400 })
  }
}
