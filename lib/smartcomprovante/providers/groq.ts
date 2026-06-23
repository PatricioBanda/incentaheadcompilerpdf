import { z } from 'zod'

const documentCodes = ['RV', 'LC', 'TV', 'EBV', 'TSA', 'EBSA', 'SSR', 'SSD', 'GIR', 'LIR', 'PSS', 'PIR', 'EBI', 'UNKNOWN'] as const
const nullableInteger = (minimum: number, maximum: number) => z.preprocess((value) => {
  if (value === null || value === undefined || value === '') return null
  const number = typeof value === 'string' ? Number(value) : value
  return number
}, z.number().int().min(minimum).max(maximum).nullable())

const documentSchema = z.object({
  document_code: z.preprocess((value) => typeof value === 'string' && documentCodes.includes(value as typeof documentCodes[number]) ? value : 'UNKNOWN', z.enum(documentCodes)),
  confidence: z.preprocess((value) => value === null || value === undefined ? 0 : typeof value === 'string' ? Number(value) : value, z.number().min(0).max(1)),
  reason: z.preprocess((value) => typeof value === 'string' && value.trim() ? value : 'Sem evidência suficiente para classificação automática.', z.string()),
  target_year: nullableInteger(2000, 2100),
  target_month: nullableInteger(1, 12),
  employee_name: z.preprocess((value) => typeof value === 'string' && value.trim() ? value : null, z.string().nullable()),
})

const privacySafeString = (value: unknown): string => {
  const text = typeof value === 'string'
    ? value
    : Array.isArray(value)
      ? value.map(privacySafeString).filter(Boolean).join('; ')
      : value && typeof value === 'object'
        ? Object.entries(value as Record<string, unknown>).map(([key, item]) => `${key}: ${privacySafeString(item)}`).join('; ')
        : value === null || value === undefined ? '' : String(value)
  return text
    .replace(/\bPT50\s*(?:\d[ -]?){21,25}\b/gi, '[IBAN]')
    .replace(/\b\d{9}\b/g, '[NIF]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4_000)
}

const normalizeHints = (value: unknown) => {
  const items = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value]
  return items.map(privacySafeString).filter(Boolean).slice(0, 12)
}

const findBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (/^(true|yes|sim)$/i.test(value.trim())) return true
    if (/^(false|no|não|nao)$/i.test(value.trim())) return false
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findBoolean(item)
      if (result !== undefined) return result
    }
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      const result = findBoolean(item)
      if (result !== undefined) return result
    }
  }
  return undefined
}

const referenceSchema = z.object({
  document_codes: z.preprocess((value) => Array.isArray(value) ? value : [value], z.array(documentSchema.shape.document_code)),
  structural_summary: z.preprocess(privacySafeString, z.string().min(1).max(4_000)),
  classification_hints: z.preprocess(normalizeHints, z.array(z.string().min(1).max(4_000)).max(12)),
  payslip_first: z.preprocess((value) => findBoolean(value) ?? null, z.boolean().nullable()),
  employee_specific: z.preprocess((value) => findBoolean(value) ?? false, z.boolean()),
  confidence: z.preprocess((value) => value === null || value === undefined ? 0 : typeof value === 'string' ? Number(value) : value, z.number().min(0).max(1)),
})

export type GroqDocumentClassification = z.infer<typeof documentSchema>
export type GroqJoinReferenceAnalysis = z.infer<typeof referenceSchema>
export const normalizeGroqJoinReferenceAnalysis = (value: unknown) => referenceSchema.parse(value)

export class GroqProviderError extends Error {
  readonly status: number
  readonly retryAfterSeconds?: number

  constructor(message: string, status: number, retryAfterSeconds?: number) {
    super(message)
    this.name = 'GroqProviderError'
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

const model = () => process.env.GROQ_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct'
const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))
let queue: Promise<void> = Promise.resolve()
let lastRequestAt = 0

async function extractPdfText(file: File) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise
  const pages: string[] = []
  const pageLimit = Math.min(document.numPages, 60)
  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const content = await page.getTextContent()
    const text = content.items.map((item) => 'str' in item ? item.str : '').join(' ').replace(/\s+/g, ' ').trim()
    if (text) pages.push(`[Página ${pageNumber}] ${text}`)
    if (pages.join('\n').length >= 80_000) break
  }
  await document.destroy()
  const text = pages.join('\n').slice(0, 80_000)
  if (text.replace(/\s/g, '').length < 80) throw new GroqProviderError('Este PDF parece digitalizado e não contém texto suficiente. Envie as páginas como JPG/PNG ou encaminhe o documento para revisão até o OCR local estar ativo.', 422)
  return text
}

async function fileContent(file: File, instruction: string) {
  const lowerName = file.name.toLowerCase()
  if (file.type === 'application/pdf' || lowerName.endsWith('.pdf')) {
    return `${instruction}\n\nNome do ficheiro: ${file.name}\n\nTexto extraído localmente:\n${await extractPdfText(file)}`
  }
  const mimeType = file.type || (lowerName.endsWith('.png') ? 'image/png' : 'image/jpeg')
  const data = Buffer.from(await file.arrayBuffer()).toString('base64')
  return [
    { type: 'text', text: `${instruction}\nNome do ficheiro: ${file.name}` },
    { type: 'image_url', image_url: { url: `data:${mimeType};base64,${data}` } },
  ]
}

async function groqJson(file: File, instruction: string) {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) throw new GroqProviderError('Groq não está configurado. Adicione GROQ_API_KEY em .env.local.', 409)
  const previous = queue
  let release = () => {}
  queue = new Promise<void>((resolve) => { release = resolve })
  await previous
  try {
    const minimumInterval = Math.max(1_000, Number(process.env.GROQ_MIN_INTERVAL_MS || 3_000))
    const wait = Math.max(0, minimumInterval - (Date.now() - lastRequestAt))
    if (wait) await delay(wait)
    const body = JSON.stringify({
      model: model(), temperature: 0, response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Responde apenas com um objeto JSON válido. Não uses Markdown.' },
        { role: 'user', content: await fileContent(file, instruction) },
      ],
    })
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      lastRequestAt = Date.now()
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body,
      })
      if (response.ok) {
        const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
        const content = payload.choices?.[0]?.message?.content
        if (!content) throw new GroqProviderError('Groq não devolveu conteúdo estruturado.', 502)
        return JSON.parse(content) as unknown
      }
      const retryAfter = Number(response.headers.get('retry-after'))
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 3) {
        if (response.status === 401 || response.status === 403) throw new GroqProviderError('A chave Groq é inválida ou não tem autorização.', response.status)
        if (response.status === 429) throw new GroqProviderError('O limite temporário do Groq foi atingido. O processamento foi pausado e os resultados anteriores foram preservados.', 429, Number.isFinite(retryAfter) ? retryAfter : 30)
        throw new GroqProviderError(`Groq respondeu com estado ${response.status}.`, response.status)
      }
      await delay(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1_000, 60_000) : attempt * 5_000)
    }
    throw new GroqProviderError('Não foi possível contactar o Groq.', 503)
  } finally {
    lastRequestAt = Date.now()
    release()
  }
}

const classificationInstruction = (ruleContext?: { rulesVersion: number; approvedExamples: Array<Record<string, unknown>> }) => [
  'Classifica este documento português de RH.',
  'Códigos: RV recibo vencimento; LC lançamento contabilístico; TV transferência vencimento; EBV extrato vencimento; TSA transferência subsídio alimentação; EBSA extrato subsídio alimentação; SSR DMR SS resumo; SSD DMR SS detalhe; GIR guia IRS; LIR listagem IRS; PSS pagamento SS; PIR pagamento IRS; EBI extrato impostos; UNKNOWN sem evidência suficiente.',
  'Devolve exatamente: document_code, confidence (0..1), reason, target_year, target_month, employee_name. Usa null quando desconhecido.',
  `Regras aprovadas da empresa v${ruleContext?.rulesVersion || 1}: ${JSON.stringify(ruleContext?.approvedExamples || [])}`,
].join('\n')

export async function classifyGroqDocument(file: File, ruleContext?: { rulesVersion: number; approvedExamples: Array<Record<string, unknown>> }) {
  return documentSchema.parse(await groqJson(file, classificationInstruction(ruleContext)))
}

export async function analyzeGroqJoinReference(file: File, kind: 'base_join' | 'final_join') {
  const instruction = [
    `Analisa este exemplo aprovado de ${kind === 'base_join' ? 'Base Join mensal' : 'Final Join / Comprovante Final'}.`,
    'Extrai apenas padrões estruturais reutilizáveis e não copies nomes, NIF, IBAN, valores ou texto pessoal.',
    'Devolve exatamente: document_codes (array de códigos), structural_summary (uma única string), classification_hints (array de strings), payslip_first (boolean ou null), employee_specific (boolean), confidence (número 0..1).',
    'Códigos permitidos: RV, LC, TV, EBV, TSA, EBSA, SSR, SSD, GIR, LIR, PSS, PIR, EBI, UNKNOWN.',
  ].join('\n')
  return normalizeGroqJoinReferenceAnalysis(await groqJson(file, instruction))
}
