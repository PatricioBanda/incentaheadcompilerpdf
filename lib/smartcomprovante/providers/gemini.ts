import { z } from 'zod'

const classificationSchema = z.object({
  classifications: z.array(z.object({
    filename: z.string(),
    document_code: z.enum(['RV', 'LC', 'TV', 'EBV', 'TSA', 'EBSA', 'SSR', 'SSD', 'GIR', 'LIR', 'PSS', 'PIR', 'EBI', 'UNKNOWN']),
    confidence: z.number().min(0).max(1),
    reason: z.string(),
  })),
})

const documentClassificationSchema = z.object({
  document_code: z.enum(['RV', 'LC', 'TV', 'EBV', 'TSA', 'EBSA', 'SSR', 'SSD', 'GIR', 'LIR', 'PSS', 'PIR', 'EBI', 'UNKNOWN']),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  target_year: z.number().int().min(2000).max(2100).nullable(),
  target_month: z.number().int().min(1).max(12).nullable(),
  employee_name: z.string().nullable(),
})

export type GeminiClassificationResult = z.infer<typeof classificationSchema>
export type GeminiDocumentClassification = z.infer<typeof documentClassificationSchema>

const joinReferenceAnalysisSchema = z.object({
  document_codes: z.array(z.enum(['RV', 'LC', 'TV', 'EBV', 'TSA', 'EBSA', 'SSR', 'SSD', 'GIR', 'LIR', 'PSS', 'PIR', 'EBI', 'UNKNOWN'])),
  structural_summary: z.string(),
  classification_hints: z.array(z.string()).max(12),
  payslip_first: z.boolean().nullable(),
  employee_specific: z.boolean(),
  confidence: z.number().min(0).max(1),
})

export type GeminiJoinReferenceAnalysis = z.infer<typeof joinReferenceAnalysisSchema>

export class GeminiProviderError extends Error {
  constructor(message: string, public readonly status: number, public readonly retryAfterSeconds?: number) {
    super(message)
    this.name = 'GeminiProviderError'
  }
}

const retryableStatuses = new Set([429, 500, 502, 503, 504])
const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const minimumRequestInterval = Math.max(1_000, Number(process.env.GEMINI_MIN_INTERVAL_MS || 8_000))
let geminiQueue: Promise<void> = Promise.resolve()
let lastGeminiRequestAt = 0

async function getRetryDelay(response: Response, attempt: number) {
  const retryAfterHeader = response.headers.get('retry-after')
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader)
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1_000, 60_000)
    const date = Date.parse(retryAfterHeader)
    if (Number.isFinite(date)) return Math.min(Math.max(date - Date.now(), 1_000), 60_000)
  }
  try {
    const payload = await response.clone().json() as { error?: { details?: Array<{ retryDelay?: string }> } }
    const retryDelay = payload.error?.details?.find((detail) => detail.retryDelay)?.retryDelay
    const seconds = retryDelay ? Number.parseFloat(retryDelay.replace(/s$/i, '')) : NaN
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1_000, 60_000)
  } catch { /* Gemini did not return structured retry metadata. */ }
  return attempt === 1 ? 10_000 : 30_000
}

async function fetchGeminiRequest(input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) {
  const previous = geminiQueue
  let releaseQueue = () => {}
  geminiQueue = new Promise<void>((resolve) => { releaseQueue = resolve })
  await previous
  try {
    const gateDelay = Math.max(0, minimumRequestInterval - (Date.now() - lastGeminiRequestAt))
    if (gateDelay) await delay(gateDelay)
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        lastGeminiRequestAt = Date.now()
        const response = await fetch(input, init)
        if (response.ok || !retryableStatuses.has(response.status) || attempt === 3) return response
        await delay(await getRetryDelay(response, attempt))
      } catch (error) {
        if (attempt === 3) throw error
        await delay(attempt === 1 ? 10_000 : 30_000)
      }
    }
    throw new GeminiProviderError('Não foi possível contactar o Gemini.', 503)
  } finally {
    lastGeminiRequestAt = Date.now()
    releaseQueue()
  }
}

async function throwGeminiResponseError(response: Response): Promise<never> {
  const status = response.status
  if (status === 429) {
    const retryMilliseconds = await getRetryDelay(response, 2)
    const retrySeconds = Math.max(1, Math.ceil(retryMilliseconds / 1_000))
    throw new GeminiProviderError(`O Gemini continua sem quota disponível após 3 tentativas. O processamento foi pausado; tente novamente dentro de aproximadamente ${retrySeconds} segundos. Os ficheiros já concluídos foram preservados.`, 429, retrySeconds)
  }
  if (status === 401 || status === 403) throw new GeminiProviderError('A chave Gemini é inválida ou não tem autorização.', status)
  if (status === 503) throw new GeminiProviderError('O Gemini está temporariamente indisponível (503) após 3 tentativas. O ficheiro não foi aprovado; tente novamente dentro de alguns instantes.', 503)
  if (status >= 500) throw new GeminiProviderError(`O serviço Gemini está temporariamente indisponível (${status}) após 3 tentativas.`, 503)
  throw new GeminiProviderError(`O Gemini rejeitou o pedido com estado ${status}.`, status)
}

const responseSchema = {
  type: 'object',
  required: ['document_code', 'confidence', 'reason', 'target_year', 'target_month', 'employee_name'],
  properties: {
    document_code: { type: 'string', enum: ['RV', 'LC', 'TV', 'EBV', 'TSA', 'EBSA', 'SSR', 'SSD', 'GIR', 'LIR', 'PSS', 'PIR', 'EBI', 'UNKNOWN'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reason: { type: 'string' },
    target_year: { anyOf: [{ type: 'integer', minimum: 2000, maximum: 2100 }, { type: 'null' }] },
    target_month: { anyOf: [{ type: 'integer', minimum: 1, maximum: 12 }, { type: 'null' }] },
    employee_name: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
}

const joinReferenceResponseSchema = {
  type: 'object',
  required: ['document_codes', 'structural_summary', 'classification_hints', 'payslip_first', 'employee_specific', 'confidence'],
  properties: {
    document_codes: { type: 'array', items: { type: 'string', enum: ['RV', 'LC', 'TV', 'EBV', 'TSA', 'EBSA', 'SSR', 'SSD', 'GIR', 'LIR', 'PSS', 'PIR', 'EBI', 'UNKNOWN'] } },
    structural_summary: { type: 'string' },
    classification_hints: { type: 'array', maxItems: 12, items: { type: 'string' } },
    payslip_first: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
    employee_specific: { type: 'boolean' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
}

export async function analyzeGeminiJoinReference(file: File, kind: 'base_join' | 'final_join'): Promise<GeminiJoinReferenceAnalysis> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new GeminiProviderError('Gemini não está configurado. Adicione a chave em .env.local.', 409)
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 90_000)
  try {
    const response = await fetchGeminiRequest(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [
          { text: [
            `Analisa este PDF como exemplo aprovado de ${kind === 'base_join' ? 'Base Join mensal' : 'Final Join / Comprovante Final'}.`,
            'Identifica apenas padrões estruturais reutilizáveis: tipos documentais, ordem, sinais visuais/textuais e se é específico de um colaborador.',
            'Códigos permitidos: RV, LC, TV, EBV, TSA, EBSA, SSR, SSD, GIR, LIR, PSS, PIR, EBI, UNKNOWN.',
            'Não copies dados pessoais, NIF, IBAN, valores, nomes completos ou texto sensível para o resumo/regras.',
            'Um Base Join normalmente contém evidência das pastas 2–13; um Final Join normalmente começa com RV e é seguido pela Base Join.',
          ].join('\n') },
          { inlineData: { mimeType: 'application/pdf', data: Buffer.from(await file.arrayBuffer()).toString('base64') } },
        ] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseJsonSchema: joinReferenceResponseSchema },
      }),
    })
    if (!response.ok) await throwGeminiResponseError(response)
    const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) throw new GeminiProviderError('O Gemini não devolveu uma análise estrutural da referência.', 502)
    return joinReferenceAnalysisSchema.parse(JSON.parse(text))
  } finally {
    clearTimeout(timeout)
  }
}

export async function classifyGeminiDocument(
  file: File,
  ruleContext?: { rulesVersion: number; approvedExamples: Array<Record<string, unknown>> },
): Promise<GeminiDocumentClassification> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('Gemini não está configurado. Adicione a chave nas Definições ou em .env.local.')
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)
  const mimeType = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : file.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg')
  try {
    const response = await fetchGeminiRequest(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [
          { text: [
            'Classifica este documento português de RH para a empresa ativa.',
            'Códigos: RV recibo vencimento; LC lançamento contabilístico; TV transferência vencimento; EBV extrato vencimento; TSA transferência subsídio alimentação; EBSA extrato subsídio alimentação; SSR DMR SS resumo; SSD DMR SS detalhe; GIR guia IRS; LIR listagem IRS; PSS pagamento SS; PIR pagamento IRS; EBI extrato impostos; UNKNOWN se não houver evidência suficiente.',
            'Não inventes período, colaborador ou tipo. Usa null quando não estiver visível.',
            'As regras aprovadas da empresa são apenas contexto auxiliar; não substituem evidência visível no documento.',
            `Regras da empresa v${ruleContext?.rulesVersion || 1}: ${JSON.stringify(ruleContext?.approvedExamples || [])}`,
            `Nome original: ${file.name}`,
          ].join('\n') },
          { inlineData: { mimeType, data: Buffer.from(await file.arrayBuffer()).toString('base64') } },
        ] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseJsonSchema: responseSchema },
      }),
    })
    if (!response.ok) {
      await throwGeminiResponseError(response)
      if (response.status === 429) throw new Error('Limite temporário do Gemini atingido. Tente novamente dentro de alguns instantes.')
      if (response.status === 401 || response.status === 403) throw new Error('A chave Gemini é inválida ou não tem autorização.')
      throw new Error(`Gemini respondeu com estado ${response.status}.`)
    }
    const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) throw new Error(`Gemini não devolveu classificação para ${file.name}.`)
    return documentClassificationSchema.parse(JSON.parse(text))
  } finally {
    clearTimeout(timeout)
  }
}

export async function classifyPrototypeDocuments(): Promise<GeminiClassificationResult | null> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return null
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)

  try {
    const response = await fetchGeminiRequest(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: [
          'Classifica estes exemplos sintéticos portugueses. Usa apenas os códigos permitidos.',
          '1. filename=extrato_subsidio_jan.pdf; texto=Extrato bancário AGIX, movimento subsídio alimentação, janeiro 2026.',
          '2. filename=extrato_impostos_jan.pdf; texto=Extrato bancário AGIX, pagamento IRS e Segurança Social, janeiro 2026.',
        ].join('\n') }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseJsonSchema: {
            type: 'object', required: ['classifications'],
            properties: { classifications: { type: 'array', items: { type: 'object', required: ['filename', 'document_code', 'confidence', 'reason'], properties: {
              filename: { type: 'string' },
              document_code: { type: 'string', enum: ['RV', 'LC', 'TV', 'EBV', 'TSA', 'EBSA', 'SSR', 'SSD', 'GIR', 'LIR', 'PSS', 'PIR', 'EBI', 'UNKNOWN'] },
              confidence: { type: 'number', minimum: 0, maximum: 1 }, reason: { type: 'string' },
            } } } },
          },
        },
      }),
    })
    if (!response.ok) await throwGeminiResponseError(response)
    const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) throw new Error('Gemini não devolveu uma classificação.')
    return classificationSchema.parse(JSON.parse(text))
  } finally {
    clearTimeout(timeout)
  }
}
