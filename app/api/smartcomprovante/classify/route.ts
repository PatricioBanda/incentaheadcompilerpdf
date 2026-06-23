import { NextRequest, NextResponse } from 'next/server'
import { classifyGeminiDocument, GeminiProviderError } from '@/lib/smartcomprovante/providers/gemini'
import type { GeminiDocumentClassification } from '@/lib/smartcomprovante/providers/gemini'
import { classifyGroqDocument, GroqProviderError } from '@/lib/smartcomprovante/providers/groq'
import { cacheIntakeFile, getCompanyRuleContext, getWorkspace, updateWorkspace } from '@/lib/smartcomprovante/store'
import { RH_FOLDERS } from '@/lib/smartcomprovante/taxonomy'

export const runtime = 'nodejs'
export const maxDuration = 300

const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png'])
const MAX_FILE_SIZE = 15 * 1024 * 1024
const MAX_TOTAL_SIZE = 100 * 1024 * 1024

export async function POST(request: NextRequest) {
  try {
    if (!process.env.GROQ_API_KEY && !process.env.GEMINI_API_KEY) return NextResponse.json({ error: 'Configure GROQ_API_KEY ou GEMINI_API_KEY em .env.local.' }, { status: 409 })
    const formData = await request.formData()
    const files = formData.getAll('files').filter((item): item is File => item instanceof File)
    const companyId = String(formData.get('companyId') || 'agix')
    const year = Number(formData.get('year') || 2026)
    const month = Number(formData.get('month') || 1)
    const mode = formData.get('mode') === 'append' ? 'append' : 'replace'
    const batchPosition = Math.max(1, Number(formData.get('batchPosition') || 1))
    const batchTotal = Math.max(batchPosition, Number(formData.get('batchTotal') || files.length))
    if (!files.length || files.length > 20) return NextResponse.json({ error: 'Selecione entre 1 e 20 ficheiros por teste.' }, { status: 400 })
    const inferredType = (file: File) => file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : file.name.toLowerCase().endsWith('.png') ? 'image/png' : /\.jpe?g$/i.test(file.name) ? 'image/jpeg' : '')
    if (files.some((file) => !allowedTypes.has(inferredType(file)) || file.size > MAX_FILE_SIZE)) return NextResponse.json({ error: 'Use PDF, JPG ou PNG até 15 MB por ficheiro.' }, { status: 400 })
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_SIZE) return NextResponse.json({ error: 'O lote excede o máximo de 100 MB.' }, { status: 400 })

    const batchId = crypto.randomUUID()
    const useGroq = Boolean(process.env.GROQ_API_KEY)
    const providerLabel = useGroq ? 'Groq' : 'Gemini'
    const ruleContext = await getCompanyRuleContext(companyId)
    const existingWorkspace = mode === 'append' ? await getWorkspace(companyId, year, month) : null
    const existingHashes = new Set(existingWorkspace?.reviews.map((review) => review.sourceHash).filter(Boolean))
    const results: Array<{ file: File; sourceHash: string; classification: GeminiDocumentClassification }> = []
    let providerFailureCount = 0
    for (const file of files) {
      const sourceHash = await cacheIntakeFile(file, batchId)
      if (existingHashes.has(sourceHash)) continue
      let classification: GeminiDocumentClassification
      try {
        classification = useGroq ? await classifyGroqDocument(file, ruleContext) : await classifyGeminiDocument(file, ruleContext)
      } catch (error) {
        if ((error instanceof GeminiProviderError || error instanceof GroqProviderError) && [401, 403, 429].includes(error.status)) throw error
        providerFailureCount += 1
        classification = {
          document_code: 'UNKNOWN', confidence: 0,
          reason: error instanceof Error ? error.message : 'O fornecedor de IA não respondeu; requer revisão humana.',
          target_year: null, target_month: null, employee_name: null,
        }
      }
      results.push({ file, sourceHash, classification })
    }

    if (!results.length && existingWorkspace) return NextResponse.json(existingWorkspace)

    const workspace = await updateWorkspace(companyId, year, month, (draft) => {
      draft.intakeCount = 0
      draft.provider = useGroq ? 'groq' : 'gemini'
      if (mode === 'replace') {
        draft.folders = draft.folders.map((folder) => ({ ...folder, status: 'missing', documentCount: 0, approvedCount: 0, reviewCount: 0 }))
        draft.reviews = []
        draft.employees = []
      }
      const newReviews = results.map(({ file, sourceHash, classification }, index) => {
        const folder = RH_FOLDERS.find((item) => item.code === classification.document_code)
        if (folder) {
          const target = draft.folders.find((item) => item.code === folder.code)
          if (target) { target.status = 'review'; target.documentCount += 1; target.reviewCount += 1 }
        }
        return {
          id: `${batchId}-${index + 1}`,
          filename: file.name,
          proposedCode: classification.document_code,
          proposedLabel: folder?.label || 'Tipo desconhecido',
          confidence: classification.confidence,
          reason: classification.reason,
          status: 'pending' as const,
          sourceHash,
          employeeName: classification.employee_name,
          targetYear: classification.target_year,
          targetMonth: classification.target_month,
        }
      })
      draft.reviews.push(...newReviews)
      const employees = results.filter((result) => result.classification.document_code === 'RV')
      const employeeOffset = draft.employees.length
      draft.employees.push(...employees.map((result, index) => ({
        id: `employee-${batchId}-${index + 1}`,
        employeeCode: `E${String(employeeOffset + index + 1).padStart(4, '0')}`,
        employeeName: result.classification.employee_name || `Colaborador ${index + 1}`,
        payslipStatus: 'review' as const, finalStatus: 'blocked' as const, filename: `CF_${year}${String(month).padStart(2, '0')}_E${String(employeeOffset + index + 1).padStart(4, '0')}.pdf`, pageCount: null,
      })))
      draft.baseJoin = { status: 'blocked', filename: `BJ_${year}${String(month).padStart(2, '0')}.pdf`, includedFolders: 0, pageCount: null, updatedAt: null }
      draft.activity.unshift({
        id: crypto.randomUUID(), at: new Date().toISOString(),
        text: providerFailureCount
          ? `${files.length} ficheiros preservados; ${providerFailureCount} não obtiveram resposta do ${providerLabel} após as tentativas e foram enviados para revisão humana.`
          : `${files.length} ficheiros classificados por ${providerLabel} e enviados para validação. As categorias não fornecidas permanecem “Em falta”.`,
        tone: providerFailureCount ? 'warning' : 'success',
      })
      if (batchTotal > 1 && batchPosition >= batchTotal) draft.activity.unshift({
        id: crypto.randomUUID(), at: new Date().toISOString(),
        text: `${batchTotal} ficheiros da pasta 0 foram verificados sequencialmente.`,
        tone: 'success',
      })
      return draft
    })
    return NextResponse.json(workspace)
  } catch (error) {
    const status = error instanceof GeminiProviderError || error instanceof GroqProviderError ? error.status : 400
    const response = NextResponse.json({ error: error instanceof Error ? error.message : 'A classificação falhou.' }, { status })
    if ((error instanceof GeminiProviderError || error instanceof GroqProviderError) && error.retryAfterSeconds) response.headers.set('Retry-After', String(error.retryAfterSeconds))
    return response
  }
}
