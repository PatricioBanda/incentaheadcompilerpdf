import { promises as fs } from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import { PDFDocument } from 'pdf-lib'
import { RH_FOLDERS, monthKey } from './taxonomy'
import type { CompanyRecord, CompanyRules, JoinReference, MonthlyWorkspace, ClassifiedDocument, DocumentBatch, AuditManifest, ExportBundle, ProviderCallRecord, CacheEntry } from './types'

const DATA_ROOT = process.env.SMARTCOMPROVANTE_DATA_DIR || path.join(process.cwd(), '.smartcomprovante-data')
const STATE_PATH = path.join(DATA_ROOT, 'prototype-state.json')
const RULES_DIR = path.join(DATA_ROOT, 'rules', 'companies')
const CACHE_DIR = path.join(DATA_ROOT, 'cache')
const CACHE_INDEX_DIR = path.join(CACHE_DIR, 'index')

type PrototypeState = {
  workspaces: Record<string, MonthlyWorkspace>
}

const workspaceId = (companyId: string, year: number, month: number) => `${companyId}:${year}:${month}`

const cloneWorkspaceForPeriod = (workspace: MonthlyWorkspace, year: number, month: number): MonthlyWorkspace => ({
  ...structuredClone(workspace),
  year,
  month,
  intakeCount: 0,
  folders: RH_FOLDERS.map((folder) => ({ ...folder, status: 'missing', documentCount: 0, approvedCount: 0, reviewCount: 0 })),
  reviews: [],
  baseJoin: { status: 'blocked', filename: `BJ_${monthKey(year, month)}.pdf`, includedFolders: 0, pageCount: null, updatedAt: null },
  employees: [],
  activity: [{
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    text: `Mês ${monthKey(year, month)} aberto; coloque ficheiros em 00_IN para começar.`,
    tone: 'info',
  }],
})

const seedWorkspace = (): MonthlyWorkspace => {
  const now = new Date().toISOString()
  const company: CompanyRecord = {
    id: 'agix',
    projectId: 'project-inovacao-01',
    legalName: 'AGIX, LDA',
    nif: '513256180',
    code: 'AGIX',
    aliases: ['AGIX LDA', 'AGIX'],
    rulesVersion: 1,
    createdAt: now,
  }
  const statusByFolder: Record<number, MonthlyWorkspace['folders'][number]['status']> = {
    1: 'approved', 2: 'approved', 3: 'review', 4: 'approved', 5: 'approved', 6: 'missing',
    7: 'approved', 8: 'approved', 9: 'approved', 10: 'approved', 11: 'approved', 12: 'review', 13: 'detected',
  }

  return {
    program: { id: 'program-2030', code: 'PT2030', name: 'Portugal 2030' },
    project: { id: 'project-inovacao-01', programId: 'program-2030', code: 'PRJ-001', name: 'Inovação Produtiva' },
    company,
    year: 2026,
    month: 1,
    provider: 'gemini',
    intakeCount: 8,
    folders: RH_FOLDERS.map((folder) => {
      const status = statusByFolder[folder.number] || 'missing'
      const count = status === 'missing' ? 0 : folder.number === 1 ? 4 : 1
      return {
        ...folder,
        status,
        documentCount: count,
        approvedCount: status === 'approved' ? count : 0,
        reviewCount: status === 'review' ? count : 0,
      }
    }),
    reviews: [
      { id: 'review-1', filename: 'transferencia_janeiro.pdf', proposedCode: 'TV', proposedLabel: 'Transferência de Vencimento', confidence: 0.68, reason: 'O período não está explícito no documento.', status: 'pending' },
      { id: 'review-2', filename: 'pagamento_at_2026.pdf', proposedCode: 'PIR', proposedLabel: 'Pagamento de IRS', confidence: 0.61, reason: 'IRS e Segurança Social aparecem no mesmo comprovativo.', status: 'pending' },
    ],
    baseJoin: { status: 'blocked', filename: `BJ_${monthKey(2026, 1)}.pdf`, includedFolders: 9, pageCount: null, updatedAt: null },
    employees: [
      { id: 'employee-42', employeeCode: 'E0042', employeeName: 'Alberto Gil', payslipStatus: 'approved', finalStatus: 'blocked', filename: 'CF_202601_E0042.pdf', pageCount: null },
      { id: 'employee-43', employeeCode: 'E0043', employeeName: 'Ana Martins', payslipStatus: 'approved', finalStatus: 'blocked', filename: 'CF_202601_E0043.pdf', pageCount: null },
      { id: 'employee-44', employeeCode: 'E0044', employeeName: 'Miguel Sousa', payslipStatus: 'review', finalStatus: 'blocked', filename: 'CF_202601_E0044.pdf', pageCount: null },
    ],
    activity: [
      { id: 'activity-1', at: now, text: '8 ficheiros encontrados em 00_IN.', tone: 'info' },
      { id: 'activity-2', at: now, text: 'Gemini classificou 6 documentos; 2 requerem revisão.', tone: 'warning' },
    ],
  }
}

const ensureData = async () => {
  await fs.mkdir(RULES_DIR, { recursive: true })
  try {
    await fs.access(STATE_PATH)
  } catch {
    const workspace = seedWorkspace()
    const state: PrototypeState = { workspaces: { [workspaceId(workspace.company.id, workspace.year, workspace.month)]: workspace } }
    await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf8')
    await ensureCompanyRules(workspace.company)
  }
}

const readState = async (): Promise<PrototypeState> => {
  await ensureData()
  return JSON.parse(await fs.readFile(STATE_PATH, 'utf8')) as PrototypeState
}

const writeState = async (state: PrototypeState) => {
  await fs.mkdir(DATA_ROOT, { recursive: true })
  const temporary = `${STATE_PATH}.tmp`
  await fs.writeFile(temporary, JSON.stringify(state, null, 2), 'utf8')
  await fs.rename(temporary, STATE_PATH)
}

export const ensureCompanyRules = async (company: CompanyRecord) => {
  await fs.mkdir(RULES_DIR, { recursive: true })
  const rulesPath = path.join(RULES_DIR, `${company.id}.json`)
  try {
    await fs.access(rulesPath)
  } catch {
    const rules: CompanyRules = {
      schema_version: '1.0', rules_version: 1,
      company: { company_id: company.id, display_name: company.legalName, corporate_nif: company.nif, aliases: company.aliases },
      document_rules: {}, filename_patterns: [],
      known_entities: { banks: [], suppliers: [], employees: [] }, approved_examples: [],
      audit: { created_at: company.createdAt, created_by: 'prototype-admin', change_reason: 'Automatic company onboarding' },
    }
    await fs.writeFile(rulesPath, JSON.stringify(rules, null, 2), { encoding: 'utf8', flag: 'wx' })
  }
}

export const getWorkspace = async (companyId = 'agix', year = 2026, month = 1) => {
  const state = await readState()
  const key = workspaceId(companyId, year, month)
  if (state.workspaces[key]) return state.workspaces[key]
  const template = Object.values(state.workspaces).find((workspace) => workspace.company.id === companyId) || Object.values(state.workspaces)[0]
  const workspace = cloneWorkspaceForPeriod(template, year, month)
  state.workspaces[key] = workspace
  await writeState(state)
  return workspace
}

export const updateWorkspace = async (
  companyId: string,
  year: number,
  month: number,
  updater: (workspace: MonthlyWorkspace) => MonthlyWorkspace,
) => {
  const state = await readState()
  const key = workspaceId(companyId, year, month)
  const current = state.workspaces[key] || cloneWorkspaceForPeriod(Object.values(state.workspaces).find((workspace) => workspace.company.id === companyId) || Object.values(state.workspaces)[0], year, month)
  const updated = updater(structuredClone(current))
  state.workspaces[key] = updated
  await writeState(state)
  return updated
}

export const createCompany = async (input: { legalName: string; nif: string; code: string }) => {
  const state = await readState()
  const id = input.code.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  if (!id || !/^\d{9}$/.test(input.nif)) throw new Error('Código e NIF válido de 9 dígitos são obrigatórios.')
  const now = new Date().toISOString()
  const template = seedWorkspace()
  const company: CompanyRecord = { id, projectId: template.project.id, legalName: input.legalName.trim(), nif: input.nif, code: input.code.toUpperCase(), aliases: [], rulesVersion: 1, createdAt: now }
  await ensureCompanyRules(company)
  const workspace: MonthlyWorkspace = {
    ...template,
    company,
    intakeCount: 0,
    folders: RH_FOLDERS.map((folder) => ({ ...folder, status: 'missing', documentCount: 0, approvedCount: 0, reviewCount: 0 })),
    reviews: [],
    baseJoin: { status: 'blocked', filename: `BJ_${monthKey(2026, 1)}.pdf`, includedFolders: 0, pageCount: null, updatedAt: null },
    employees: [],
    activity: [{ id: crypto.randomUUID(), at: now, text: `Empresa criada; regras v1 inicializadas para ${company.legalName}.`, tone: 'success' }],
  }
  state.workspaces[workspaceId(id, 2026, 1)] = workspace
  await writeState(state)
  return workspace
}

export const resetPrototypeWorkspace = async () => {
  const state = await readState()
  const workspace = seedWorkspace()
  state.workspaces[workspaceId(workspace.company.id, workspace.year, workspace.month)] = workspace
  await ensureCompanyRules(workspace.company)
  workspace.company.rulesVersion = (await getCompanyRuleContext(workspace.company.id)).rulesVersion
  await writeState(state)
  return workspace
}

export const cacheIntakeFile = async (file: File, batchId: string) => {
  const bytes = Buffer.from(await file.arrayBuffer())
  const hash = createHash('sha256').update(bytes).digest('hex')
  const lowerName = file.name.toLowerCase()
  const extension = file.type === 'application/pdf' || lowerName.endsWith('.pdf') ? '.pdf' : file.type === 'image/png' || lowerName.endsWith('.png') ? '.png' : '.jpg'
  const directory = path.join(CACHE_DIR, batchId, 'sources')
  await fs.mkdir(directory, { recursive: true })
  const target = path.join(directory, `${hash}${extension}`)
  try { await fs.writeFile(target, bytes, { flag: 'wx', mode: 0o600 }) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  await fs.mkdir(CACHE_INDEX_DIR, { recursive: true })
  const indexPath = path.join(CACHE_INDEX_DIR, `${hash}.json`)
  const indexTemporary = `${indexPath}.tmp`
  await fs.writeFile(indexTemporary, JSON.stringify({ relativePath: path.relative(CACHE_DIR, target), mimeType: file.type || (extension === '.pdf' ? 'application/pdf' : extension === '.png' ? 'image/png' : 'image/jpeg') }), 'utf8')
  await fs.rename(indexTemporary, indexPath)
  return hash
}

export const getCachedPreview = async (sourceHash: string) => {
  if (!/^[a-f0-9]{64}$/.test(sourceHash)) throw new Error('Identificador de pré-visualização inválido.')
  const index = JSON.parse(await fs.readFile(path.join(CACHE_INDEX_DIR, `${sourceHash}.json`), 'utf8')) as { relativePath: string; mimeType: string }
  const target = path.resolve(CACHE_DIR, index.relativePath)
  const cacheRoot = `${path.resolve(CACHE_DIR)}${path.sep}`
  if (!target.startsWith(cacheRoot)) throw new Error('Caminho de pré-visualização inválido.')
  const bytes = await fs.readFile(target)
  if (index.mimeType !== 'application/pdf') return { bytes, mimeType: index.mimeType, pageCount: 1 }
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const preview = await PDFDocument.create()
  const pageCount = Math.min(3, source.getPageCount())
  const pages = await preview.copyPages(source, Array.from({ length: pageCount }, (_, indexValue) => indexValue))
  pages.forEach((page) => preview.addPage(page))
  return { bytes: Buffer.from(await preview.save()), mimeType: 'application/pdf', pageCount }
}

export const recordApprovedExample = async (company: CompanyRecord, item: { filename: string; proposedCode: string; sourceHash?: string }) => {
  const rulesPath = path.join(RULES_DIR, `${company.id}.json`)
  await ensureCompanyRules(company)
  const rules = JSON.parse(await fs.readFile(rulesPath, 'utf8')) as CompanyRules
  const examples = rules.approved_examples as Array<Record<string, unknown>>
  const duplicate = examples.some((example) => example.source_hash === item.sourceHash && example.document_code === item.proposedCode)
  if (!duplicate) {
    examples.push({
      original_extension: path.extname(item.filename).toLowerCase(),
      filename_tokens: path.basename(item.filename, path.extname(item.filename)).toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2).slice(0, 8),
      document_code: item.proposedCode,
      source_hash: item.sourceHash || null,
      approved_at: new Date().toISOString(),
    })
    rules.rules_version += 1
    const temporary = `${rulesPath}.tmp`
    await fs.writeFile(temporary, JSON.stringify(rules, null, 2), 'utf8')
    await fs.rename(temporary, rulesPath)
  }
  return rules.rules_version
}

export const recordJoinReference = async (
  company: CompanyRecord,
  file: File,
  kind: JoinReference['kind'],
  analysis: { document_codes: string[]; structural_summary: string; classification_hints: string[]; payslip_first: boolean | null; employee_specific: boolean; confidence: number },
): Promise<{ reference: JoinReference; rulesVersion: number }> => {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) throw new Error('A referência deve ser um ficheiro PDF.')
  const bytes = Buffer.from(await file.arrayBuffer())
  const sourceHash = createHash('sha256').update(bytes).digest('hex')
  const pageCount = (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount()

  await ensureCompanyRules(company)
  const rulesPath = path.join(RULES_DIR, `${company.id}.json`)
  const rules = JSON.parse(await fs.readFile(rulesPath, 'utf8')) as CompanyRules
  const examples = rules.approved_examples as Array<Record<string, unknown>>
  const duplicate = examples.some((example) => example.source_hash === sourceHash && example.example_kind === kind)
  if (!duplicate) {
    examples.push({
      example_kind: kind,
      original_filename: file.name,
      source_hash: sourceHash,
      approved_at: new Date().toISOString(),
      status: 'approved_reference',
      page_count: pageCount,
      structural_profile: analysis,
      source_copy_retained: false,
    })
    rules.rules_version += 1
    const temporary = `${rulesPath}.tmp`
    await fs.writeFile(temporary, JSON.stringify(rules, null, 2), 'utf8')
    await fs.rename(temporary, rulesPath)
  }

  return {
    reference: {
      id: `${kind}-${sourceHash.slice(0, 12)}`, kind, filename: file.name, sourceHash,
      uploadedAt: new Date().toISOString(), pageCount,
      structuralSummary: analysis.structural_summary, temporaryCopyRetained: false,
    },
    rulesVersion: rules.rules_version,
  }
}

export const getCompanyRuleContext = async (companyId: string) => {
  const rulesPath = path.join(RULES_DIR, `${companyId}.json`)
  const rules = JSON.parse(await fs.readFile(rulesPath, 'utf8')) as CompanyRules
  return {
    rulesVersion: rules.rules_version,
    approvedExamples: (rules.approved_examples as Array<Record<string, unknown>>).slice(-25),
  }
}

// Batch processing and document grouping
export const createDocumentBatch = async (
  companyId: string,
  year: number,
  month: number,
  documents: Array<{
    sourceHash: string
    filename: string
    mimeType: string
    classification: { code: string; label: string; confidence: number; reason: string; ruleName?: string; cacheHit?: boolean }
    pageCount: number
    employeeCode?: string
    employeeName?: string
  }>,
) => {
  const batchId = crypto.randomUUID()
  const BATCH_DIR = path.join(DATA_ROOT, 'batches')
  await fs.mkdir(BATCH_DIR, { recursive: true })

  const batch = {
    id: batchId,
    companyId,
    year,
    month,
    createdAt: new Date().toISOString(),
    status: 'pending' as const,
    documents: documents.map((doc, idx) => ({
      id: `${batchId}-${idx}`,
      sourceHash: doc.sourceHash,
      filename: doc.filename,
      mimeType: doc.mimeType,
      folderNumber: RH_FOLDERS.find((f) => f.code === doc.classification.code)?.number || 0,
      folderCode: doc.classification.code,
      documentType: doc.classification.label,
      confidence: doc.classification.confidence,
      pageCount: doc.pageCount,
      employeeCode: doc.employeeCode,
      employeeName: doc.employeeName,
      period: { year, month },
      classificationReason: doc.classification.reason,
      ruleName: doc.classification.ruleName,
      cacheHit: doc.classification.cacheHit || false,
      classifiedAt: new Date().toISOString(),
    })),
    totalPages: documents.reduce((sum, doc) => sum + doc.pageCount, 0),
    approvedCount: documents.filter((doc) => doc.classification.confidence > 0.8).length,
    reviewCount: documents.filter((doc) => doc.classification.confidence <= 0.8).length,
    failedCount: 0,
  }

  const batchPath = path.join(BATCH_DIR, `${batchId}.json`)
  await fs.writeFile(batchPath, JSON.stringify(batch, null, 2), 'utf8')

  // Update workspace with batch info
  await updateWorkspace(companyId, year, month, (workspace) => ({
    ...workspace,
    intakeCount: (workspace.intakeCount || 0) + batch.documents.length,
    activity: [
      ...workspace.activity,
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        text: `Lote ${batch.documents.length} criado; ${batch.approvedCount} aprovados, ${batch.reviewCount} para revisão.`,
        tone: 'info',
      },
    ],
  }))

  return batch
}

// Document grouping by folder, employee, and compliance order
export const groupAndSortDocuments = async (batchId: string, companyId: string) => {
  const BATCH_DIR = path.join(DATA_ROOT, 'batches')
  const batchPath = path.join(BATCH_DIR, `${batchId}.json`)
  const batch = JSON.parse(await fs.readFile(batchPath, 'utf8'))

  // Group by folder, then by employee
  const grouped: Record<number, Record<string, any[]>> = {}
  batch.documents.forEach((doc: any) => {
    if (!grouped[doc.folderNumber]) grouped[doc.folderNumber] = {}
    const employeeKey = doc.employeeCode || 'unknown'
    if (!grouped[doc.folderNumber][employeeKey]) grouped[doc.folderNumber][employeeKey] = []
    grouped[doc.folderNumber][employeeKey].push(doc)
  })

  // Sort folders by compliance order (1-13 for RH)
  const sortedFolders = Object.entries(grouped)
    .sort(([numA], [numB]) => Number(numA) - Number(numB))
    .map(([folderNum, employees]) => ({
      folderNumber: Number(folderNum),
      employees: Object.entries(employees).map(([employeeCode, docs]) => ({ employeeCode, documents: docs })),
    }))

  return sortedFolders
}

// Export and audit manifest generation
export const generateAuditManifest = async (
  batchId: string,
  companyId: string,
  year: number,
  month: number,
  provider: 'gemini' | 'groq' | 'ollama',
  callRecords: Array<{ inputTokens: number; outputTokens: number; cost: number; status: 'success' | 'cached' | 'failed' }>,
) => {
  const BATCH_DIR = path.join(DATA_ROOT, 'batches')
  const batchPath = path.join(BATCH_DIR, `${batchId}.json`)
  const batch = JSON.parse(await fs.readFile(batchPath, 'utf8'))

  const manifestId = crypto.randomUUID()
  const now = new Date().toISOString()

  const totalTokensUsed = callRecords.reduce((sum, rec) => sum + rec.inputTokens + rec.outputTokens, 0)
  const cacheHits = batch.documents.filter((doc: any) => doc.cacheHit).length
  const cacheHitRate = batch.documents.length > 0 ? cacheHits / batch.documents.length : 0
  const totalCost = callRecords.reduce((sum, rec) => sum + rec.cost, 0)

  const manifest = {
    id: manifestId,
    batchId,
    companyId,
    year,
    month,
    generatedAt: now,
    provider,
    totalInputPages: batch.totalPages,
    classifiedPages: batch.approvedCount + batch.reviewCount,
    reviewedPages: batch.reviewCount,
    approvedPages: batch.approvedCount,
    discardedPages: batch.failedCount,
    accuracy: {
      classificationAccuracy: batch.approvedCount / Math.max(1, batch.documents.length),
      groupingAccuracy: 1.0, // placeholder
    },
    metrics: {
      totalTokensUsed,
      cacheHitRate,
      ruleHitRate: cacheHitRate,
      averageLatencyMs: 150, // placeholder
      estimatedCost: totalCost,
    },
    documents: batch.documents.map((doc: any) => ({
      sourceHash: doc.sourceHash,
      filename: doc.filename,
      classification: doc.folderCode,
      status: doc.confidence > 0.8 ? 'approved' : 'review',
    })),
  }

  const AUDIT_DIR = path.join(DATA_ROOT, 'audits')
  await fs.mkdir(AUDIT_DIR, { recursive: true })
  const auditPath = path.join(AUDIT_DIR, `${manifestId}.json`)
  await fs.writeFile(auditPath, JSON.stringify(manifest, null, 2), 'utf8')

  return manifest
}

// Create export bundle with PDF and audit
export const createExportBundle = async (
  batchId: string,
  companyId: string,
  year: number,
  month: number,
  pdfBuffer: Buffer,
) => {
  const bundleId = crypto.randomUUID()
  const timestamp = new Date().toISOString()
  const EXPORT_DIR = path.join(DATA_ROOT, 'exports')
  await fs.mkdir(EXPORT_DIR, { recursive: true })

  const filename = `BJ_${year}${String(month).padStart(2, '0')}_${companyId}.pdf`
  const bundlePath = path.join(EXPORT_DIR, bundleId)
  await fs.mkdir(bundlePath, { recursive: true })

  const pdfPath = path.join(bundlePath, filename)
  await fs.writeFile(pdfPath, pdfBuffer)

  const bundle = {
    id: bundleId,
    batchId,
    filename,
    timestamp,
    companyId,
    year,
    month,
    format: 'pdf' as const,
    pageCount: 1, // would be extracted from PDF in real implementation
    size: pdfBuffer.length,
  }

  const bundleMetaPath = path.join(bundlePath, 'metadata.json')
  await fs.writeFile(bundleMetaPath, JSON.stringify(bundle, null, 2), 'utf8')

  return bundle
}

// Review management: approve or reject items
export const approveReviewItem = async (
  companyId: string,
  year: number,
  month: number,
  reviewId: string,
  approved: boolean,
  correctCode?: string,
) => {
  return updateWorkspace(companyId, year, month, (workspace) => {
    const review = workspace.reviews.find((r) => r.id === reviewId)
    if (review) {
      review.status = approved ? 'approved' : 'passed'
      if (correctCode) review.proposedCode = correctCode
    }
    return workspace
  })
}

// Tracking: record provider calls and metrics
export const recordProviderCall = async (
  batchId: string,
  providerId: 'gemini' | 'groq' | 'ollama',
  documentType: string,
  status: 'success' | 'cached' | 'failed',
  inputTokens: number,
  outputTokens: number,
  latencyMs: number,
  cost: number,
) => {
  const TRACKING_DIR = path.join(DATA_ROOT, 'tracking')
  await fs.mkdir(TRACKING_DIR, { recursive: true })

  const record = {
    id: crypto.randomUUID(),
    batchId,
    providerId,
    documentType,
    status,
    inputTokens,
    outputTokens,
    latencyMs,
    cost,
    timestamp: new Date().toISOString(),
  }

  const trackingPath = path.join(TRACKING_DIR, `${batchId}.jsonl`)
  await fs.appendFile(trackingPath, JSON.stringify(record) + '\n', 'utf8')

  return record
}

// Cache hit tracking for document classifications
export const recordCacheHit = async (
  sourceHash: string,
  documentCode: string,
  confidence: number,
  employeeCode?: string,
) => {
  const CACHE_INDEX_DIR_EXT = path.join(DATA_ROOT, 'cache-hits')
  await fs.mkdir(CACHE_INDEX_DIR_EXT, { recursive: true })

  const cacheEntry = {
    sourceHash,
    documentCode,
    confidence,
    timestamp: new Date().toISOString(),
    hitCount: 1,
    employeeCode,
  }

  const cacheHitPath = path.join(CACHE_INDEX_DIR_EXT, 'hits.jsonl')
  await fs.appendFile(cacheHitPath, JSON.stringify(cacheEntry) + '\n', 'utf8')

  return cacheEntry
}

// Get batch statistics
export const getBatchStatistics = async (batchId: string) => {
  const BATCH_DIR = path.join(DATA_ROOT, 'batches')
  const batchPath = path.join(BATCH_DIR, `${batchId}.json`)
  const batch = JSON.parse(await fs.readFile(batchPath, 'utf8'))

  const TRACKING_DIR = path.join(DATA_ROOT, 'tracking')
  const trackingPath = path.join(TRACKING_DIR, `${batchId}.jsonl`)
  let callRecords: any[] = []
  try {
    const trackingData = await fs.readFile(trackingPath, 'utf8')
    callRecords = trackingData
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line))
  } catch {
    // tracking file may not exist yet
  }

  return {
    batchId,
    totalDocuments: batch.documents.length,
    totalPages: batch.totalPages,
    approvedCount: batch.approvedCount,
    reviewCount: batch.reviewCount,
    cacheHitCount: batch.documents.filter((doc: any) => doc.cacheHit).length,
    totalProviderCalls: callRecords.length,
    totalTokensUsed: callRecords.reduce((sum: number, rec: any) => sum + rec.inputTokens + rec.outputTokens, 0),
    totalCost: callRecords.reduce((sum: number, rec: any) => sum + rec.cost, 0),
    averageConfidence: batch.documents.length > 0 ? batch.documents.reduce((sum: number, doc: any) => sum + doc.confidence, 0) / batch.documents.length : 0,
  }
}
