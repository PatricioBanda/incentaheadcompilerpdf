import { NextRequest, NextResponse } from 'next/server'
import { recordApprovedExample, resetPrototypeWorkspace, updateWorkspace } from '@/lib/smartcomprovante/store'
import { classifyPrototypeDocuments } from '@/lib/smartcomprovante/providers/gemini'
import { RH_FOLDERS } from '@/lib/smartcomprovante/taxonomy'

export const runtime = 'nodejs'

type ActionBody = {
  action: 'process-demo' | 'approve-review' | 'pass-review' | 'generate-base' | 'generate-finals' | 'reset-demo' | 'train-examples'
  companyId?: string
  year?: number
  month?: number
  reviewId?: string
  destinationCode?: string
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as ActionBody
    const companyId = body.companyId || 'agix'
    const year = body.year || 2026
    const month = body.month || 1
    const now = new Date().toISOString()
    if (body.action === 'reset-demo') return NextResponse.json(await resetPrototypeWorkspace())
    let liveGeminiResult: Awaited<ReturnType<typeof classifyPrototypeDocuments>> = null
    if (body.action === 'process-demo') liveGeminiResult = await classifyPrototypeDocuments()

    const workspace = await updateWorkspace(companyId, year, month, (draft) => {
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
            ? `Gemini classificou ${liveGeminiResult.classifications.length} exemplos sintéticos; resposta validada pelo schema.`
            : 'Demonstração local concluída. Configure Gemini para executar o teste cloud com exemplos sintéticos.',
          tone: liveGeminiResult ? 'success' : 'info',
        })
      }

      if (body.action === 'approve-review' || body.action === 'pass-review') {
        const review = draft.reviews.find((item) => item.id === body.reviewId)
        if (!review) throw new Error('Item de revisão não encontrado.')
        if (body.action === 'approve-review' && body.destinationCode) {
          const destination = RH_FOLDERS.find((folder) => folder.code === body.destinationCode)
          if (!destination) throw new Error('Destino de classificação inválido.')
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
        draft.activity.unshift({ id: crypto.randomUUID(), at: now, text: `${review.filename} foi ${review.status === 'approved' ? 'aprovado' : 'passado'} pelo operador.`, tone: 'success' })
      }

      const unresolved = draft.reviews.some((review) => review.status === 'pending')
      const missingBaseDependency = draft.folders.slice(1).some((folder) => !['approved', 'passed', 'confirmed_missing'].includes(folder.status))
      if (!unresolved && draft.baseJoin.status === 'blocked') draft.baseJoin.status = missingBaseDependency ? 'needs_confirmation' : 'ready'

      if (body.action === 'train-examples') {
        const references = draft.joinReferences || []
        const baseCount = references.filter((item) => item.kind === 'base_join').length
        const finalCount = references.filter((item) => item.kind === 'final_join').length
        if (baseCount + finalCount === 0) throw new Error('Carregue pelo menos um exemplo Base Join ou Final Join antes de treinar.')
        draft.company.rulesVersion += 1
        draft.activity.unshift({
          id: crypto.randomUUID(),
          at: now,
          text: `Treino estrutural concluído com ${baseCount} Base Join e ${finalCount} Final Join. Regras da empresa atualizadas para v${draft.company.rulesVersion}.`,
          tone: baseCount > 0 && finalCount > 0 ? 'success' : 'warning',
        })
      }

      if (body.action === 'generate-base') {
        if (unresolved) throw new Error('A Base Join continua bloqueada por revisões por resolver.')
        const confirmedMissing = draft.folders.slice(1).filter((folder) => !['approved', 'passed', 'confirmed_missing'].includes(folder.status))
        const generatedWithWarnings = confirmedMissing.length > 0
        if (generatedWithWarnings) {
          draft.folders = draft.folders.map((folder) => confirmedMissing.some((missing) => missing.number === folder.number)
            ? { ...folder, status: 'confirmed_missing', documentCount: 0, approvedCount: 0, reviewCount: 0 }
            : folder)
        }
        draft.baseJoin = {
          status: 'current',
          filename: `BJ_${year}${String(month).padStart(2, '0')}.pdf`,
          includedFolders: 12 - confirmedMissing.length,
          pageCount: generatedWithWarnings ? 18 : 24,
          updatedAt: now,
        }
        draft.employees = draft.employees.map((employee) => ({
          ...employee,
          finalStatus: employee.payslipStatus === 'approved' ? generatedWithWarnings ? 'ready_with_warnings' : 'ready' : 'blocked',
        }))
        draft.activity.unshift({
          id: crypto.randomUUID(), at: now,
          text: generatedWithWarnings
            ? `${draft.baseJoin.filename} preparado com ${confirmedMissing.length} pasta(s) confirmadas em falta.`
            : `${draft.baseJoin.filename} gerado e reconciliado (24 páginas).`,
          tone: generatedWithWarnings ? 'warning' : 'success',
        })
        return draft
        if (unresolved || missingBaseDependency) throw new Error('A Base Join continua bloqueada por revisões ou evidência em falta.')
        draft.baseJoin = { status: 'current', filename: `BJ_${year}${String(month).padStart(2, '0')}.pdf`, includedFolders: 12, pageCount: 24, updatedAt: now }
        draft.employees = draft.employees.map((employee) => ({ ...employee, finalStatus: employee.payslipStatus === 'approved' ? 'ready' : 'blocked' }))
        draft.activity.unshift({ id: crypto.randomUUID(), at: now, text: `${draft.baseJoin.filename} gerado e reconciliado (24 páginas).`, tone: 'success' })
      }

      if (body.action === 'generate-finals') {
        if (draft.baseJoin.status !== 'current') throw new Error('Gere primeiro uma Base Join atual.')
        draft.employees = draft.employees.map((employee) => employee.finalStatus === 'ready' || employee.finalStatus === 'ready_with_warnings'
          ? { ...employee, finalStatus: 'current', pageCount: employee.finalStatus === 'ready_with_warnings' ? 19 : 25 }
          : employee)
        const generated = draft.employees.filter((employee) => employee.finalStatus === 'current').length
        draft.activity.unshift({ id: crypto.randomUUID(), at: now, text: `${generated} Comprovantes Finais gerados com nomes SharePoint-safe.`, tone: 'success' })
      }

      return draft
    })

    if (body.action === 'approve-review' && body.reviewId) {
      const approved = workspace.reviews.find((item) => item.id === body.reviewId)
      if (approved) {
        const rulesVersion = await recordApprovedExample(workspace.company, approved)
        if (rulesVersion !== workspace.company.rulesVersion) {
          const learnedWorkspace = await updateWorkspace(companyId, year, month, (draft) => {
            draft.company.rulesVersion = rulesVersion
            draft.activity.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), text: `Correção aprovada adicionada às regras da empresa v${rulesVersion}.`, tone: 'success' })
            return draft
          })
          return NextResponse.json(learnedWorkspace)
        }
      }
    }
    return NextResponse.json(workspace)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'A ação falhou.' }, { status: 400 })
  }
}
