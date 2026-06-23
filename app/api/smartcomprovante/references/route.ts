import { NextRequest, NextResponse } from 'next/server'
import { getWorkspace, recordJoinReference, updateWorkspace } from '@/lib/smartcomprovante/store'
import { analyzeGeminiJoinReference, GeminiProviderError } from '@/lib/smartcomprovante/providers/gemini'
import { analyzeGroqJoinReference, GroqProviderError } from '@/lib/smartcomprovante/providers/groq'
import type { JoinReference } from '@/lib/smartcomprovante/types'
import { RH_FOLDERS } from '@/lib/smartcomprovante/taxonomy'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')
    const kind = String(formData.get('kind')) as JoinReference['kind']
    const companyId = String(formData.get('companyId') || 'agix')
    const year = Number(formData.get('year') || 2026)
    const month = Number(formData.get('month') || 1)
    if (!(file instanceof File)) return NextResponse.json({ error: 'Selecione um PDF de referência.' }, { status: 400 })
    if (!['base_join', 'final_join'].includes(kind)) return NextResponse.json({ error: 'Tipo de referência inválido.' }, { status: 400 })
    if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: 'A referência não pode exceder 25 MB.' }, { status: 400 })

    const current = await getWorkspace(companyId, year, month)
    let analysis: Parameters<typeof recordJoinReference>[3]
    let usedFallback = false
    let fallbackReason = ''
    try {
      analysis = process.env.GROQ_API_KEY ? await analyzeGroqJoinReference(file, kind) : await analyzeGeminiJoinReference(file, kind)
    } catch (error) {
      usedFallback = true
      fallbackReason = error instanceof Error ? error.message : 'O fornecedor LLM nao devolveu um perfil estrutural valido.'
      const baseCodes = RH_FOLDERS.filter((folder) => folder.number >= 2 && folder.number <= 13).map((folder) => folder.code)
      analysis = {
        document_codes: kind === 'base_join' ? baseCodes : ['RV', ...baseCodes],
        structural_summary: `Perfil local guardado a partir do nome e estrutura do PDF "${file.name}". O LLM/OCR nao conseguiu extrair uma analise completa, por isso este exemplo fica como material de treino/fingerprint para comparacao posterior.`,
        classification_hints: [
          kind === 'base_join' ? 'Exemplo de Base Join mensal: documento agregado sem recibo individual no inicio.' : 'Exemplo de Final Join: comprovante por colaborador com recibo de vencimento e evidencia mensal.',
          'Usar este PDF como referencia local para padroes de ordem, tamanho, nomenclatura e contagem de paginas.',
        ],
        payslip_first: kind === 'final_join' ? true : null,
        employee_specific: kind === 'final_join',
        confidence: 0.35,
      }
    }
    const { reference, rulesVersion } = await recordJoinReference(current.company, file, kind, analysis)
    const workspace = await updateWorkspace(companyId, year, month, (draft) => {
      const references = draft.joinReferences || []
      if (!references.some((item) => item.sourceHash === reference.sourceHash && item.kind === kind)) references.unshift(reference)
      draft.joinReferences = references
      draft.company.rulesVersion = rulesVersion
      const label = kind === 'base_join' ? 'Base Join' : 'Final Join'
      if (usedFallback) {
        draft.activity.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), text: `${file.name} guardado como referencia ${label} com perfil local. Motivo: ${fallbackReason}`, tone: 'warning' })
        return draft
      }
      draft.activity.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), text: `${file.name} analisado como referência ${label}; perfil estrutural guardado nas regras v${rulesVersion} e cópia temporária descartada.`, tone: 'success' })
      return draft
    })
    return NextResponse.json(workspace)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Não foi possível guardar a referência.' }, { status: error instanceof GeminiProviderError || error instanceof GroqProviderError ? error.status : 400 })
  }
}
