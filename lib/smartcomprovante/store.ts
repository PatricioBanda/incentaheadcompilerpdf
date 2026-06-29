import { promises as fs } from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import { PDFDocument } from 'pdf-lib'
import { RH_FOLDERS, monthKey } from './taxonomy'
import { extractJoinSectionFingerprints } from './join-learning'
import { processReferenceExample, aggregateAndValidate } from './learning-engine'
import type { ApprovedDocument, BaseJoinValidation, CompanyDatabaseRecord, CompanyRecord, CompanyRules, EnrichedSectionFingerprint, JoinReference, MonthlyWorkspace, ProjectRecord, SectionEnrichment, SmartComprovanteDatabase, ClassifiedDocument, DocumentBatch, AuditManifest, ExportBundle, ProviderCallRecord, CacheEntry } from './types'
import { isFirebaseConfigured, getFirebaseApp, firestoreGet, firestoreSet, firestoreDelete, firestoreList } from './firebase'
import { listUploads } from './upload-store'
import { logger } from './logger'

// On Vercel set SMARTCOMPROVANTE_DATA_DIR=/tmp so ephemeral writes (cache, exports) go to writable /tmp.
// Workspace state and rules use Firestore when FIREBASE_PROJECT_ID is set.
const DATA_ROOT = process.env.SMARTCOMPROVANTE_DATA_DIR || path.join(process.cwd(), '.smartcomprovante-data')
const STATE_PATH = path.join(DATA_ROOT, 'prototype-state.json')
const PROJECTS_PATH = path.join(DATA_ROOT, 'projects.json')
const RULES_DIR = path.join(DATA_ROOT, 'rules', 'companies')
const CACHE_DIR = path.join(DATA_ROOT, 'cache')
const CACHE_INDEX_DIR = path.join(CACHE_DIR, 'index')
const CLASSIFICATION_CACHE_DIR = path.join(CACHE_DIR, 'classifications')
const EXPORTS_DIR = path.join(DATA_ROOT, 'exports')
const UPLOADS_ROOT = path.join(DATA_ROOT, 'uploads')
const safeUploadSegment = (v: string) => v.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'item'

type PrototypeState = {
  workspaces: Record<string, MonthlyWorkspace>
}

export type StoredClassification = {
  document_code: string
  confidence: number
  reason: string
  target_year: number | null
  target_month: number | null
  employee_name: string | null
  route_source: string
  rules_version?: number
  cached_at: string
}

const DEFAULT_PROJECT_ID = 'project-inovacao-01'
const workspaceId = (projectId: string, companyId: string, year: number, month: number) => `${projectId}:${companyId}:${year}:${month}`

const cloneWorkspaceForPeriod = (workspace: MonthlyWorkspace, year: number, month: number): MonthlyWorkspace => ({
  ...structuredClone(workspace),
  year,
  month,
  intakeCount: 0,
  folders: RH_FOLDERS.map((folder) => ({ ...folder, status: 'missing', documentCount: 0, approvedCount: 0, reviewCount: 0 })),
  reviews: [],
  approvedDocuments: [],
  baseJoin: { status: 'blocked', filename: `BJ_${monthKey(year, month)}.pdf`, includedFolders: 0, pageCount: null, updatedAt: null },
  employees: [],
  activity: [{
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    text: `Month ${monthKey(year, month)} opened. Upload files to folder 0 to begin.`,
    tone: 'info',
  }],
})

const DEFAULT_PROGRAM = { id: 'program-2030', code: 'PT2030', name: 'Portugal 2030' }

// A real, empty workspace for a freshly created company — no demo data.
const blankWorkspace = (company: CompanyRecord, project: ProjectRecord, year: number, month: number): MonthlyWorkspace => ({
  program: { ...DEFAULT_PROGRAM },
  project,
  company,
  year,
  month,
  provider: 'gemini',
  intakeCount: 0,
  folders: RH_FOLDERS.map((folder) => ({ ...folder, status: 'missing', documentCount: 0, approvedCount: 0, reviewCount: 0 })),
  reviews: [],
  approvedDocuments: [],
  baseJoin: { status: 'blocked', filename: `BJ_${monthKey(year, month)}.pdf`, includedFolders: 0, pageCount: null, updatedAt: null },
  employees: [],
  joinReferences: [],
  activity: [],
})

const ensureData = async () => {
  if (isFirebaseConfigured) return // Firestore needs no directory setup
  await fs.mkdir(RULES_DIR, { recursive: true })
  await fs.mkdir(EXPORTS_DIR, { recursive: true })
  try {
    await fs.access(STATE_PATH)
  } catch {
    await fs.writeFile(STATE_PATH, JSON.stringify({ workspaces: {} } satisfies PrototypeState, null, 2), 'utf8')
  }
}

const readState = async (): Promise<PrototypeState> => {
  if (isFirebaseConfigured) {
    const doc = await firestoreGet<PrototypeState>('state', 'prototype')
    return doc ?? { workspaces: {} }
  }
  await ensureData()
  return JSON.parse(await fs.readFile(STATE_PATH, 'utf8')) as PrototypeState
}

const writeState = async (state: PrototypeState) => {
  if (isFirebaseConfigured) {
    await firestoreSet('state', 'prototype', state)
    return
  }
  await fs.mkdir(DATA_ROOT, { recursive: true })
  const temporary = `${STATE_PATH}.tmp`
  await fs.writeFile(temporary, JSON.stringify(state, null, 2), 'utf8')
  await fs.rename(temporary, STATE_PATH)
}

const readCompanyRules = async (companyId: string): Promise<CompanyRules | null> => {
  if (isFirebaseConfigured) return firestoreGet<CompanyRules>('rules', companyId)
  const rulesPath = path.join(RULES_DIR, `${companyId}.json`)
  try { return JSON.parse(await fs.readFile(rulesPath, 'utf8')) as CompanyRules } catch { return null }
}

const writeCompanyRules = async (companyId: string, rules: CompanyRules): Promise<void> => {
  if (isFirebaseConfigured) { await firestoreSet('rules', companyId, rules); return }
  await fs.mkdir(RULES_DIR, { recursive: true })
  const rulesPath = path.join(RULES_DIR, `${companyId}.json`)
  const temporary = `${rulesPath}.tmp`
  await fs.writeFile(temporary, JSON.stringify(rules, null, 2), 'utf8')
  await fs.rename(temporary, rulesPath)
}

const deleteCompanyRules = async (companyId: string): Promise<void> => {
  if (isFirebaseConfigured) { await firestoreDelete('rules', companyId); return }
  await fs.rm(path.join(RULES_DIR, `${companyId}.json`), { force: true })
}

export const ensureCompanyRules = async (company: CompanyRecord) => {
  const existing = await readCompanyRules(company.id)
  if (existing) return
  const rules: CompanyRules = {
    schema_version: '1.0', rules_version: 1,
    company: { company_id: company.id, display_name: company.legalName, corporate_nif: company.nif, aliases: company.aliases },
    document_rules: {}, filename_patterns: [],
    known_entities: { banks: [], suppliers: [], employees: [] }, approved_examples: [],
    required_folders: [], optional_folders: [], folder_sequence: [], expected_page_counts: {},
    audit: { created_at: company.createdAt, created_by: 'prototype-admin', change_reason: 'Automatic company onboarding' },
  }
  await writeCompanyRules(company.id, rules)
}

const nowYear = () => new Date().getFullYear()
const nowMonth = () => new Date().getMonth() + 1

// Returns null when there is no workspace yet for this company (empty system / onboarding).
export const getWorkspaceOrNull = async (companyId = 'agix', year = nowYear(), month = nowMonth(), projectId = DEFAULT_PROJECT_ID): Promise<MonthlyWorkspace | null> => {
  const state = await readState()
  const key = workspaceId(projectId, companyId, year, month)
  if (state.workspaces[key]) {
    const ws = state.workspaces[key]
    if (!ws.approvedDocuments) ws.approvedDocuments = []
    return ws
  }
  const template = Object.values(state.workspaces).find((workspace) => workspace.company.id === companyId && workspace.project.id === projectId)
    || Object.values(state.workspaces).find((workspace) => workspace.company.id === companyId)
  if (!template) return null
  const workspace = cloneWorkspaceForPeriod(template, year, month)
  state.workspaces[key] = workspace
  await writeState(state)
  return workspace
}

export const getWorkspace = async (companyId = 'agix', year = nowYear(), month = nowMonth(), projectId = DEFAULT_PROJECT_ID): Promise<MonthlyWorkspace> => {
  const workspace = await getWorkspaceOrNull(companyId, year, month, projectId)
  if (!workspace) throw new Error('No workspace found. Create a company first.')
  return workspace
}

export const updateWorkspace = async (
  companyId: string,
  year: number,
  month: number,
  updater: (workspace: MonthlyWorkspace) => MonthlyWorkspace,
  projectId = DEFAULT_PROJECT_ID,
) => {
  const state = await readState()
  const key = workspaceId(projectId, companyId, year, month)
  const fallback = Object.values(state.workspaces).find((workspace) => workspace.company.id === companyId)
  if (!fallback && !state.workspaces[key]) throw new Error(`No workspace found for company ${companyId}. Create the company first.`)
  const current = state.workspaces[key] || cloneWorkspaceForPeriod(fallback!, year, month)
  if (!current.approvedDocuments) current.approvedDocuments = []
  const updated = updater(structuredClone(current))
  state.workspaces[key] = updated
  await writeState(state)
  return updated
}

export const createCompany = async (input: { legalName: string; nif: string; code: string; projectId?: string }) => {
  const state = await readState()
  const id = input.code.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  if (!id || !/^\d{9}$/.test(input.nif)) throw new Error('A valid code and 9-digit NIF are required.')
  const nowDate = new Date()
  const now = nowDate.toISOString()
  const currentYear = nowDate.getFullYear()
  const currentMonth = nowDate.getMonth() + 1
  const projectId = input.projectId || DEFAULT_PROJECT_ID
  const projects = await getAllProjects()
  const projectMatch = projects.find((item) => item.id === projectId)
  const project: ProjectRecord = {
    id: projectId,
    programId: DEFAULT_PROGRAM.id,
    code: projectMatch?.code || projectId.toUpperCase(),
    name: projectMatch?.name || projectId,
  }
  const company: CompanyRecord = { id, projectId, legalName: input.legalName.trim(), nif: input.nif, code: input.code.toUpperCase(), aliases: [], rulesVersion: 1, createdAt: now }
  await ensureCompanyRules(company)
  const workspace = blankWorkspace(company, project, currentYear, currentMonth)
  workspace.activity = [{ id: crypto.randomUUID(), at: now, text: `Company created; rules v1 initialised for ${company.legalName}.`, tone: 'success' }]
  state.workspaces[workspaceId(projectId, id, currentYear, currentMonth)] = workspace
  await writeState(state)
  return workspace
}

export const getDatabaseStructure = async (): Promise<SmartComprovanteDatabase> => {
  const state = await readState()
  const companies = new Map<string, CompanyDatabaseRecord>()

  for (const [key, workspace] of Object.entries(state.workspaces)) {
    const companyId = workspace.company.id
    if (!companies.has(companyId)) companies.set(companyId, { company: workspace.company, years: [] })
    const companyNode = companies.get(companyId)!
    let yearNode = companyNode.years.find((item) => item.year === workspace.year)
    if (!yearNode) {
      yearNode = { year: workspace.year, comprovantesRh: [] }
      companyNode.years.push(yearNode)
    }
    const currentCount = workspace.employees.filter((employee) => employee.finalStatus === 'current').length
    const readyCount = workspace.employees.filter((employee) => employee.finalStatus === 'ready' || employee.finalStatus === 'ready_with_warnings').length
    yearNode.comprovantesRh.push({
      companyId,
      year: workspace.year,
      month: workspace.month,
      workspaceKey: key,
      baseJoin: {
        filename: workspace.baseJoin.filename,
        status: workspace.baseJoin.status,
        pageCount: workspace.baseJoin.pageCount,
        updatedAt: workspace.baseJoin.updatedAt,
      },
      finalJoinFolder: {
        employeeCount: workspace.employees.length,
        currentCount,
        readyCount,
        blockedCount: Math.max(0, workspace.employees.length - currentCount - readyCount),
      },
      evidenceFolderCount: workspace.folders.filter((folder) => folder.status === 'approved' || folder.status === 'passed' || folder.status === 'confirmed_missing').length,
      reviewCount: workspace.reviews.filter((review) => review.status === 'pending').length,
    })
  }

  const projects = await getAllProjects()

  return {
    schemaVersion: 'prototype-db-1.0',
    projects,
    companies: Array.from(companies.values()).map((company) => ({
      ...company,
      years: company.years
        .sort((left, right) => right.year - left.year)
        .map((year) => ({ ...year, comprovantesRh: year.comprovantesRh.sort((left, right) => left.month - right.month) })),
    })),
  }
}

export const resetPrototypeWorkspace = async () => {
  await writeState({ workspaces: {} })
  return { empty: true as const }
}

export const resetPrototypeDatabase = async () => {
  if (isFirebaseConfigured) {
    const { getFirestore: _db } = await import('firebase-admin/firestore')
    const db = _db(getFirebaseApp())
    // Delete all docs in relevant collections
    for (const col of ['state', 'rules', 'projects', 'batches', 'audits']) {
      const snap = await db.collection(col).get()
      await Promise.all(snap.docs.map((d) => d.ref.delete()))
    }
    return { empty: true as const }
  }
  await fs.rm(DATA_ROOT, { recursive: true, force: true })
  await fs.mkdir(RULES_DIR, { recursive: true })
  await fs.mkdir(EXPORTS_DIR, { recursive: true })
  await writeState({ workspaces: {} })
  return { empty: true as const }
}

export const resetPrototypeCompany = async (companyId: string, projectId?: string) => {
  const state = await readState()
  const scopedWorkspaces = Object.entries(state.workspaces).filter(([, workspace]) =>
    workspace.company.id === companyId && (!projectId || workspace.project.id === projectId)
  )
  if (!scopedWorkspaces.length) return { empty: true as const }

  const nextWorkspaces = Object.fromEntries(Object.entries(state.workspaces).filter(([, workspace]) =>
    !(workspace.company.id === companyId && (!projectId || workspace.project.id === projectId))
  ))
  await writeState({ workspaces: nextWorkspaces })

  const companyStillExists = Object.values(nextWorkspaces).some((workspace) => workspace.company.id === companyId)
  if (!companyStillExists) {
    await deleteCompanyRules(companyId)
    if (!isFirebaseConfigured) await fs.rm(path.join(CLASSIFICATION_CACHE_DIR, companyId), { recursive: true, force: true })
  }

  return { empty: true as const, companyId }
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
  await ensureCompanyRules(company)
  const rules = (await readCompanyRules(company.id))!
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
    await writeCompanyRules(company.id, rules)
  }
  return rules.rules_version
}

export const recordJoinReference = async (
  company: CompanyRecord,
  file: File,
  kind: JoinReference['kind'],
  analysis: { document_codes: string[]; structural_summary: string; classification_hints: string[]; payslip_first: boolean | null; employee_specific: boolean; confidence: number },
  options?: { runLearningEngine?: boolean; extractSections?: boolean },
): Promise<{ reference: JoinReference; rulesVersion: number }> => {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) throw new Error('A referência deve ser um ficheiro PDF.')
  const bytes = Buffer.from(await file.arrayBuffer())
  const sourceHash = createHash('sha256').update(bytes).digest('hex')
  const pageCount = (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount()
  const sectionFingerprints = options?.extractSections === false
    ? []
    : await extractJoinSectionFingerprints(bytes, { includeFolderOne: kind === 'final_join' }).catch(() => [])

  // Run full learning engine (Layers 0-5) — gracefully non-fatal
  let enrichedSections: SectionEnrichment[] = []
  if (options?.runLearningEngine !== false) {
    try {
      const learningResult = await processReferenceExample(bytes, kind)
      enrichedSections = learningResult.sections
    } catch { /* non-fatal: enrichment failure never blocks the upload */ }
  }

  await ensureCompanyRules(company)
  const rules = (await readCompanyRules(company.id))!
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
      section_fingerprints: sectionFingerprints,
      enriched_sections: enrichedSections,
      source_copy_retained: false,
    })
    rules.rules_version += 1
    await writeCompanyRules(company.id, rules)
  }

  return {
    reference: {
      id: `${kind}-${sourceHash.slice(0, 12)}`, kind, filename: file.name, sourceHash,
      uploadedAt: new Date().toISOString(), pageCount,
      structuralSummary: sectionFingerprints.length
        ? `${analysis.structural_summary} Learned ${sectionFingerprints.length} section fingerprint(s); ${enrichedSections.filter((s) => s.llm_enriched).length} LLM-enriched.`
        : analysis.structural_summary,
      learnedSections: sectionFingerprints,
      enrichedSections: enrichedSections.length > 0 ? enrichedSections : undefined,
      temporaryCopyRetained: false,
    },
    rulesVersion: rules.rules_version,
  }
}

export const getCompanyRuleContext = async (companyId: string) => {
  const rules = await readCompanyRules(companyId)
  if (!rules) return { rulesVersion: 1, approvedExamples: [] as Array<Record<string, unknown>>, sectionFingerprints: [] as Array<Record<string, unknown>>, enrichedFingerprints: undefined }
  return {
    rulesVersion: rules.rules_version,
    approvedExamples: (rules.approved_examples as Array<Record<string, unknown>>).slice(-25),
    sectionFingerprints: (rules.approved_examples as Array<Record<string, unknown>>)
      .flatMap((example) => Array.isArray(example.section_fingerprints) ? example.section_fingerprints as Array<Record<string, unknown>> : [])
      .slice(-80),
    enrichedFingerprints: Array.isArray(rules.enriched_fingerprints) && rules.enriched_fingerprints.length > 0
      ? rules.enriched_fingerprints
      : undefined,
  }
}

export const aggregateCompanyFingerprints = async (companyId: string): Promise<{
  fingerprints: EnrichedSectionFingerprint[]
  qualityScore: number
  rulesVersion: number
}> => {
  const rules = await readCompanyRules(companyId)
  if (!rules) throw new Error('No rules found. Upload Base/Final Join references first.')
  const examples = rules.approved_examples as Array<Record<string, unknown>>
  const allEnrichedSections = examples
    .filter((ex) => Array.isArray(ex.enriched_sections) && (ex.enriched_sections as SectionEnrichment[]).length > 0)
    .map((ex) => ex.enriched_sections as SectionEnrichment[])

  if (allEnrichedSections.length === 0) {
    // Fall back to legacy section_fingerprints recast as SectionEnrichment
    const legacySections = examples
      .filter((ex) => Array.isArray(ex.section_fingerprints) && (ex.section_fingerprints as SectionEnrichment[]).length > 0)
      .map((ex) => (ex.section_fingerprints as Array<Record<string, unknown>>).map((fp): SectionEnrichment => ({
        document_code: String(fp.document_code || ''),
        folder_number: Number(fp.folder_number || 0),
        label: String(fp.label || ''),
        page_numbers: Array.isArray(fp.page_numbers) ? fp.page_numbers as number[] : [],
        page_count: Number(fp.page_count || 0),
        date_position: (fp.date_position as 'header' | 'footer' | 'body' | null) || null,
        section_order: Number(fp.section_order || 0),
        header_terms: Array.isArray(fp.header_terms) ? fp.header_terms as string[] : [],
        sample_tokens: Array.isArray(fp.sample_tokens) ? fp.sample_tokens as string[] : [],
        tfidf_terms: [],
        ngrams: [],
        negative_terms: [],
        llm_descriptors: [],
        llm_enriched: false,
      })))
    if (legacySections.length === 0) throw new Error('No reference examples found. Upload Base/Final Join references first.')
    const { fingerprints, qualityScore } = aggregateAndValidate(legacySections)
    rules.enriched_fingerprints = fingerprints
    rules.fingerprint_trained_at = new Date().toISOString()
    rules.fingerprint_quality = qualityScore
    rules.rules_version += 1
    await writeCompanyRules(companyId, rules)
    return { fingerprints, qualityScore, rulesVersion: rules.rules_version }
  }

  const { fingerprints, qualityScore } = aggregateAndValidate(allEnrichedSections)
  rules.enriched_fingerprints = fingerprints
  rules.fingerprint_trained_at = new Date().toISOString()
  rules.fingerprint_quality = qualityScore
  rules.rules_version += 1
  await writeCompanyRules(companyId, rules)
  return { fingerprints, qualityScore, rulesVersion: rules.rules_version }
}

export const getCachedClassification = async (
  companyId: string,
  sourceHash: string,
  currentRulesVersion?: number,
): Promise<StoredClassification | null> => {
  if (!/^[a-f0-9]{64}$/.test(sourceHash)) return null
  const cachePath = path.join(CLASSIFICATION_CACHE_DIR, companyId, `${sourceHash}.json`)
  try {
    const cached = JSON.parse(await fs.readFile(cachePath, 'utf8')) as StoredClassification
    if (
      typeof currentRulesVersion === 'number'
      && cached.route_source !== 'operator'
      && cached.rules_version !== currentRulesVersion
    ) {
      return null
    }
    return cached
  } catch {
    return null
  }
}

export const saveCachedClassification = async (companyId: string, sourceHash: string, classification: Omit<StoredClassification, 'cached_at'>) => {
  if (!/^[a-f0-9]{64}$/.test(sourceHash)) return
  const directory = path.join(CLASSIFICATION_CACHE_DIR, companyId)
  await fs.mkdir(directory, { recursive: true })
  const cachePath = path.join(directory, `${sourceHash}.json`)
  const temporary = `${cachePath}.tmp`
  await fs.writeFile(temporary, JSON.stringify({ ...classification, cached_at: new Date().toISOString() }, null, 2), 'utf8')
  await fs.rename(temporary, cachePath)
}

export const deleteCachedClassification = async (companyId: string, sourceHash: string) => {
  if (!/^[a-f0-9]{64}$/.test(sourceHash)) return
  await fs.rm(path.join(CLASSIFICATION_CACHE_DIR, companyId, `${sourceHash}.json`), { force: true })
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

// Project management
export const getAllProjects = async (): Promise<ProjectRecord[]> => {
  // Empty by default — the user creates their first project explicitly during onboarding.
  try {
    const data = JSON.parse(await fs.readFile(PROJECTS_PATH, 'utf8')) as ProjectRecord[]
    if (!Array.isArray(data)) return []
    return data
  } catch {
    return []
  }
}

export const createProject = async (input: { name: string; code: string }) => {
  const id = input.code.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  if (!id) throw new Error('A valid project code is required.')
  const projects = await getAllProjects()
  if (projects.some((project) => project.id === id)) throw new Error(`Project with code "${input.code}" already exists.`)
  const newProject: ProjectRecord = { id, programId: DEFAULT_PROGRAM.id, code: input.code.toUpperCase(), name: input.name.trim() }
  projects.push(newProject)
  await fs.mkdir(DATA_ROOT, { recursive: true })
  await fs.writeFile(PROJECTS_PATH, JSON.stringify(projects, null, 2), 'utf8')
  return newProject
}

// Read a file directly from the uploads directory (fallback when cache index is unavailable)
const readFileFromUploads = async (
  companyId: string, year: number, folderNumber: number, uploadId: string, filename: string
): Promise<Buffer | null> => {
  try {
    const filePath = path.join(UPLOADS_ROOT, safeUploadSegment(companyId), String(year), `folder-${folderNumber}`, uploadId, filename)
    return await fs.readFile(filePath)
  } catch {
    return null
  }
}

// Read a cached source file by its SHA-256 hash
export const readCachedSourceFile = async (sourceHash: string): Promise<{ bytes: Buffer; mimeType: string }> => {
  if (!/^[a-f0-9]{64}$/.test(sourceHash)) throw new Error('Invalid source hash.')
  const index = JSON.parse(await fs.readFile(path.join(CACHE_INDEX_DIR, `${sourceHash}.json`), 'utf8')) as { relativePath: string; mimeType: string }
  const target = path.resolve(CACHE_DIR, index.relativePath)
  const cacheRoot = `${path.resolve(CACHE_DIR)}${path.sep}`
  if (!target.startsWith(cacheRoot)) throw new Error('Invalid cached file path.')
  return { bytes: await fs.readFile(target), mimeType: index.mimeType }
}

// Assemble the Base Join PDF from all documents in folders 2–13 for the given month.
// Primary source: workspace.approvedDocuments (populated via review/LLM flow).
// Fallback source: files uploaded directly to folder 2–13 in the uploads store.
export const assembleBaseJoinPdf = async (projectId: string, companyId: string, year: number, month: number): Promise<{ buffer: Buffer; pageCount: number; filename: string }> => {
  const workspace = await getWorkspace(companyId, year, month, projectId)

  // uploadFolderNumber is the physical folder on disk (may differ for inbox/folder-0 uploads where files are inferred to a logical folder)
  type DocSource = { folderNumber: number; sourceHash: string; filename: string; uploadId?: string; uploadFilename?: string; uploadFolderNumber?: number }
  let sources: DocSource[] = (workspace.approvedDocuments || [])
    .filter((doc) => doc.folderNumber >= 2 && doc.folderNumber <= 13)
    .sort((left, right) => left.folderNumber - right.folderNumber || left.approvedAt.localeCompare(right.approvedAt))
    .map((doc) => ({ folderNumber: doc.folderNumber, sourceHash: doc.sourceHash, filename: doc.filename || doc.sourceHash }))

  // Fallback: collect directly from uploads store when approvedDocuments is empty
  if (sources.length === 0) {
    const inferFolderFromFilename = (filename: string): number | null => {
      const match = filename.match(/^(\d{1,2})[_\-\s]/)
      if (!match) return null
      const n = parseInt(match[1], 10)
      return n >= 2 && n <= 13 ? n : null
    }

    const allUploads = await listUploads(companyId, year)

    // Direct folder uploads (2-13)
    const directUploads = allUploads
      .filter((u) => u.folderNumber >= 2 && u.folderNumber <= 13 && (u.month === month || u.month == null))
      .sort((a, b) => a.folderNumber - b.folderNumber || a.submittedAt.localeCompare(b.submittedAt))
    for (const upload of directUploads) {
      for (const file of upload.files) {
        sources.push({ folderNumber: upload.folderNumber, uploadFolderNumber: upload.folderNumber, sourceHash: file.hash || '', filename: file.name, uploadId: upload.id, uploadFilename: file.name })
      }
    }

    // Inbox (folder-0) uploads — infer logical folder from filename prefix (e.g. "02_LC_..." → folder 2)
    // uploadFolderNumber stays 0 so readFileFromUploads looks in the right physical directory
    if (sources.length === 0) {
      const inboxUploads = allUploads.filter((u) => u.folderNumber === 0 && u.status !== 'archived' && (u.month === month || u.month == null))
      const inferred: typeof sources = []
      for (const upload of inboxUploads) {
        for (const file of upload.files) {
          const folderNumber = inferFolderFromFilename(file.name)
          if (!folderNumber) continue
          inferred.push({ folderNumber, uploadFolderNumber: 0, sourceHash: file.hash || '', filename: file.name, uploadId: upload.id, uploadFilename: file.name })
        }
      }
      inferred.sort((a, b) => a.folderNumber - b.folderNumber)
      sources.push(...inferred)
    }
  }

  if (sources.length === 0) throw new Error('No documents found in folders 2–13 for this month. Upload the evidence documents first.')

  const merged = await PDFDocument.create()
  let skipped = 0
  for (const doc of sources) {
    let bytes: Buffer | null = null
    // Try cache index first
    if (doc.sourceHash) {
      try {
        const cached = await readCachedSourceFile(doc.sourceHash)
        bytes = cached.bytes
      } catch {
        // Cache miss — try uploads directory fallback below
      }
    }
    // Fallback: read directly from the uploads filesystem path using the physical upload folder (not the logical folder)
    if (!bytes && doc.uploadId && doc.uploadFilename) {
      bytes = await readFileFromUploads(companyId, year, doc.uploadFolderNumber ?? doc.folderNumber, doc.uploadId, doc.uploadFilename)
    }
    if (!bytes) {
      logger.warn({ folderNumber: doc.folderNumber, filename: doc.filename }, 'Document skipped from Base Join — file not readable from cache or uploads')
      skipped++
      continue
    }
    try {
      const source = await PDFDocument.load(bytes, { ignoreEncryption: true })
      const pages = await merged.copyPages(source, source.getPageIndices())
      pages.forEach((page) => merged.addPage(page))
    } catch (pdfError) {
      logger.warn({ folderNumber: doc.folderNumber, filename: doc.filename, error: String(pdfError) }, 'Document skipped from Base Join — PDF load failed')
      skipped++
    }
  }

  if (skipped > 0) logger.info({ skipped, total: sources.length }, 'Base Join assembled with some documents skipped')

  const buffer = Buffer.from(await merged.save())
  const filename = `BJ_${year}${String(month).padStart(2, '0')}_${companyId}.pdf`
  await fs.mkdir(EXPORTS_DIR, { recursive: true })
  await fs.writeFile(path.join(EXPORTS_DIR, filename), buffer)
  return { buffer, pageCount: merged.getPageCount(), filename }
}

export interface BaseJoinEntry {
  filename: string
  companyId: string
  year: number
  month: number
  sizeBytes: number
  generatedAt: string
}

// Returns all Base Join PDFs stored in the exports directory, newest first.
export const listBaseJoins = async (filterCompanyId?: string): Promise<BaseJoinEntry[]> => {
  try {
    const entries = await fs.readdir(EXPORTS_DIR, { withFileTypes: true })
    const results: BaseJoinEntry[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.pdf')) continue
      // Filename convention: BJ_{year}{month2}_{companyId}.pdf
      const match = entry.name.match(/^BJ_(\d{4})(\d{2})_(.+)\.pdf$/)
      if (!match) continue
      const [, yearStr, monthStr, companyId] = match
      if (filterCompanyId && companyId !== filterCompanyId) continue
      try {
        const stat = await fs.stat(path.join(EXPORTS_DIR, entry.name))
        results.push({
          filename: entry.name,
          companyId,
          year: parseInt(yearStr, 10),
          month: parseInt(monthStr, 10),
          sizeBytes: stat.size,
          generatedAt: stat.mtime.toISOString(),
        })
      } catch { /* skip unreadable */ }
    }
    return results.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
  } catch {
    return []
  }
}

export interface FinalJoinEntry {
  filename: string
  companyId: string
  year: number
  month: number
  employeeCode: string
  sizeBytes: number
  generatedAt: string
}

// Returns all Final Join PDFs stored in the exports directory, newest first.
export const listFinalJoins = async (filterCompanyId?: string): Promise<FinalJoinEntry[]> => {
  try {
    const entries = await fs.readdir(EXPORTS_DIR, { withFileTypes: true })
    const results: FinalJoinEntry[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.pdf')) continue
      // Filename convention: CF_{year}{month2}_{employeeCode}_{companyId}.pdf
      const match = entry.name.match(/^CF_(\d{4})(\d{2})_(.+)_([^_]+)\.pdf$/)
      if (!match) continue
      const [, yearStr, monthStr, employeeCode, companyId] = match
      if (filterCompanyId && companyId !== filterCompanyId) continue
      try {
        const stat = await fs.stat(path.join(EXPORTS_DIR, entry.name))
        results.push({ filename: entry.name, companyId, year: parseInt(yearStr, 10), month: parseInt(monthStr, 10), employeeCode, sizeBytes: stat.size, generatedAt: stat.mtime.toISOString() })
      } catch { /* skip */ }
    }
    return results.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
  } catch { return [] }
}

export interface Folder1Payslip {
  filename: string
  employeeName: string
  uploadId: string
  physicalFolderNumber: number // actual folder on disk (may be 0 for inbox uploads)
  hash?: string
}

// Detects payslip files from folder-1 uploads (and folder-0 inbox uploads with 01_RV_ prefix).
// Extracts employee name from the filename.
export const detectFolder1Payslips = async (companyId: string, year: number, month?: number | null): Promise<Folder1Payslip[]> => {
  const allUploads = await listUploads(companyId, year)
  const results: Folder1Payslip[] = []
  const seen = new Set<string>()

  const nameFromFilename = (filename: string): string => {
    const base = filename.replace(/\.pdf$/i, '')
    // Strip folder prefix: "01_RV_" or "01_"
    const stripped = base.replace(/^\d{1,2}[_\-][A-Z]+[_\-]/i, '').replace(/^\d{1,2}[_\-]/i, '')
    // Strip trailing date patterns like "_2026-06" or "_202606"
    const noDate = stripped.replace(/[_\-]\d{4}[_\-]\d{2}$/, '').replace(/[_\-]\d{6}$/, '')
    // Strip "_TESTE" suffix
    const noTest = noDate.replace(/[_\-]TESTE$/i, '')
    return noTest.replace(/_/g, ' ').trim() || filename
  }

  // Direct folder-1 uploads
  for (const upload of allUploads) {
    if (upload.folderNumber !== 1) continue
    if (month != null && upload.month != null && upload.month !== month) continue
    for (const file of upload.files) {
      if (seen.has(file.name)) continue
      seen.add(file.name)
      results.push({ filename: file.name, employeeName: nameFromFilename(file.name), uploadId: upload.id, physicalFolderNumber: 1, hash: file.hash })
    }
  }

  // Inbox (folder-0) uploads with 01_RV_ prefix
  for (const upload of allUploads) {
    if (upload.folderNumber !== 0 || upload.status === 'archived') continue
    if (month != null && upload.month != null && upload.month !== month) continue
    for (const file of upload.files) {
      if (!file.name.match(/^01[_\-]/i)) continue
      if (seen.has(file.name)) continue
      seen.add(file.name)
      results.push({ filename: file.name, employeeName: nameFromFilename(file.name), uploadId: upload.id, physicalFolderNumber: 0, hash: file.hash })
    }
  }

  return results
}

// Assembles a Final Join from a specific payslip file + a specific Base Join file.
// Does not require workspace.employees to be populated — works directly from uploads.
export const assembleCustomFinalJoinPdf = async (
  companyId: string, year: number, month: number,
  payslip: { uploadId: string; physicalFolderNumber: number; filename: string },
  baseJoinFilename: string,
): Promise<{ buffer: Buffer; pageCount: number; filename: string }> => {
  const payslipBytes = await readFileFromUploads(companyId, year, payslip.physicalFolderNumber, payslip.uploadId, payslip.filename)
  if (!payslipBytes) throw new Error(`Payslip file not found on disk: ${payslip.filename}`)

  const baseJoinPath = path.join(EXPORTS_DIR, baseJoinFilename)
  let baseJoinBytes: Buffer
  try { baseJoinBytes = await fs.readFile(baseJoinPath) } catch { throw new Error(`Base Join not found: ${baseJoinFilename}. Generate it first.`) }

  const merged = await PDFDocument.create()
  const payslipPdf = await PDFDocument.load(payslipBytes, { ignoreEncryption: true })
  const baseJoinPdf = await PDFDocument.load(baseJoinBytes, { ignoreEncryption: true })
  const payslipPages = await merged.copyPages(payslipPdf, payslipPdf.getPageIndices())
  payslipPages.forEach((p) => merged.addPage(p))
  const basePages = await merged.copyPages(baseJoinPdf, baseJoinPdf.getPageIndices())
  basePages.forEach((p) => merged.addPage(p))

  const buffer = Buffer.from(await merged.save())
  // Derive a safe employee code from the payslip filename
  const safeCode = payslip.filename.replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 40)
  const filename = `CF_${year}${String(month).padStart(2, '0')}_${safeCode}_${companyId}.pdf`
  await fs.mkdir(EXPORTS_DIR, { recursive: true })
  await fs.writeFile(path.join(EXPORTS_DIR, filename), buffer)
  return { buffer, pageCount: merged.getPageCount(), filename }
}

export const validateBaseJoinStructure = async (companyId: string, year: number, month: number, projectId: string): Promise<BaseJoinValidation> => {
  const rules = await readCompanyRules(companyId)
  if (!rules) throw new Error('No rules found. Train from reference examples first.')
  const fingerprints = rules.enriched_fingerprints
  if (!fingerprints || fingerprints.length === 0) throw new Error('Train from reference examples first.')

  const sorted = [...fingerprints].sort((a, b) => a.section_order - b.section_order)
  const workspace = await getWorkspace(companyId, year, month, projectId)

  const actualFolders = workspace.folders
    .filter((f) => (f.status === 'approved' || f.status === 'passed') && f.number >= 2)
    .sort((a, b) => a.number - b.number)

  const actualPositionByFolderNumber = new Map<number, number>()
  actualFolders.forEach((f, i) => actualPositionByFolderNumber.set(f.number, i))

  const fingerprintFolderNumbers = new Set(sorted.map((fp) => fp.folder_number))
  const unexpectedFound = actualFolders
    .filter((f) => !fingerprintFolderNumbers.has(f.number))
    .map((f) => f.code)

  let lastActualPos = -1
  const sections = sorted.map((fp, expectedPosition) => {
    const actualPosition = actualPositionByFolderNumber.get(fp.folder_number) ?? null
    const found = actualPosition !== null
    let orderMatch = false
    if (found) {
      orderMatch = actualPosition! > lastActualPos
      if (orderMatch) lastActualPos = actualPosition!
    }
    return {
      folderCode: fp.document_code,
      folderNumber: fp.folder_number,
      label: fp.label,
      found,
      actualPosition,
      expectedPosition,
      orderMatch,
      requiredTermsCount: fp.required_terms.length,
      optionalTermsCount: fp.optional_terms.length,
      llmEnriched: fp.llm_enriched,
      validationScore: fp.validation.coverage,
    }
  })

  const foundCount = sections.filter((s) => s.found).length
  const correctlyOrdered = sections.filter((s) => s.found && s.orderMatch).length
  const coverageScore = sorted.length ? foundCount / sorted.length : 0
  const orderAlignmentScore = foundCount ? correctlyOrdered / foundCount : 0
  const fingerprintQuality = rules.fingerprint_quality ?? 0
  const overallConfidence = 0.5 * coverageScore + 0.3 * orderAlignmentScore + 0.2 * fingerprintQuality
  const missingRequired = sections.filter((s) => !s.found).map((s) => s.folderCode)

  return { overallConfidence, coverageScore, orderAlignmentScore, sections, missingRequired, unexpectedFound, fingerprintQuality, validatedAt: new Date().toISOString() }
}

export const addLearnedAnchor = async (companyId: string, documentCode: string, anchorPhrase: string): Promise<void> => {
  const rules = await readCompanyRules(companyId)
  if (!rules || !Array.isArray(rules.enriched_fingerprints) || rules.enriched_fingerprints.length === 0) {
    throw new Error('No learned fingerprints yet. Train the system first.')
  }
  const fp = rules.enriched_fingerprints.find((f) => f.document_code === documentCode)
  if (!fp) throw new Error(`No fingerprint found for document code ${documentCode}.`)
  const trimmed = anchorPhrase.trim()
  if (!fp.period_signal) {
    fp.period_signal = { position: null, format: null, anchor_phrases: [trimmed], detection_rate: 0.56 }
  } else {
    const existing = fp.period_signal.anchor_phrases.filter((p) => p.toLowerCase() !== trimmed.toLowerCase())
    fp.period_signal.anchor_phrases = [trimmed, ...existing].slice(0, 8)
    fp.period_signal.detection_rate = Math.min(0.95, (fp.period_signal.detection_rate ?? 0.5) + 0.06)
  }
  rules.rules_version += 1
  await writeCompanyRules(companyId, rules)
}

export const addLearnedZone = async (companyId: string, documentCode: string, zone: 'header' | 'body' | 'footer'): Promise<void> => {
  const rules = await readCompanyRules(companyId)
  if (!rules || !Array.isArray(rules.enriched_fingerprints) || rules.enriched_fingerprints.length === 0) {
    throw new Error('No learned fingerprints yet. Train the system first.')
  }
  const fp = rules.enriched_fingerprints.find((f) => f.document_code === documentCode)
  if (!fp) throw new Error(`No fingerprint found for document code ${documentCode}.`)
  if (!fp.period_signal) {
    fp.period_signal = { position: zone, format: null, anchor_phrases: [], detection_rate: 0.5 }
  } else {
    fp.period_signal.position = zone
    if (fp.period_signal.detection_rate < 0.5) fp.period_signal.detection_rate = 0.5
  }
  rules.rules_version += 1
  await writeCompanyRules(companyId, rules)
}

export const addLearnedMark = async (
  companyId: string,
  documentCode: string,
  input: { mark: { page: number; x: number; y: number }; label?: string; dateText?: string; contextText?: string },
): Promise<void> => {
  const rules = await readCompanyRules(companyId)
  if (!rules || !Array.isArray(rules.enriched_fingerprints) || rules.enriched_fingerprints.length === 0) {
    throw new Error('No learned fingerprints yet. Train the system first.')
  }
  const fp = rules.enriched_fingerprints.find((f) => f.document_code === documentCode)
  if (!fp) throw new Error(`No fingerprint found for document code ${documentCode}.`)
  const label = input.label?.trim()
  const dateText = input.dateText?.trim()
  const contextText = input.contextText?.trim().slice(0, 220)
  const anchors = [dateText, label, contextText].filter((item): item is string => Boolean(item))
  const mark = { ...input.mark, dateText, label, contextText }
  if (!fp.period_signal) {
    fp.period_signal = { position: null, format: null, anchor_phrases: anchors.slice(0, 8), detection_rate: 0.5, mark }
  } else {
    fp.period_signal.mark = mark
    if (fp.period_signal.detection_rate < 0.5) fp.period_signal.detection_rate = 0.5
    for (const anchor of anchors.reverse()) {
      const existing = fp.period_signal.anchor_phrases.filter((p) => p.toLowerCase() !== anchor.toLowerCase())
      fp.period_signal.anchor_phrases = [anchor, ...existing].slice(0, 8)
    }
  }
  rules.rules_version += 1
  await writeCompanyRules(companyId, rules)
}

// Assemble a Final Join PDF: employee payslip (RV, folder 1) + Base Join (folders 2–13)
export const assembleFinalJoinPdf = async (projectId: string, companyId: string, year: number, month: number, employeeCode: string): Promise<{ buffer: Buffer; pageCount: number; filename: string }> => {
  const workspace = await getWorkspace(companyId, year, month, projectId)
  const employee = workspace.employees.find((emp) => emp.employeeCode === employeeCode)
  if (!employee) throw new Error(`Employee ${employeeCode} not found in workspace.`)

  // Resolve payslip bytes: from approved review hash, or fallback to a single folder-1 upload for this month
  let payslipBytes: Buffer | null = null
  if (employee.payslipHash) {
    try {
      const cached = await readCachedSourceFile(employee.payslipHash)
      payslipBytes = cached.bytes
    } catch {
      // Cache miss — will try uploads fallback
    }
  }
  if (!payslipBytes) {
    // Fallback: find folder 1 uploads for this month and try to match by employeeName in filename
    const allUploads = await listUploads(companyId, year)
    const folder1Uploads = allUploads.filter((u) => u.folderNumber === 1 && (u.month === month || u.month == null))
    const nameLower = (employee.employeeName || '').toLowerCase().replace(/\s+/g, '')
    let matched: { uploadId: string; filename: string } | null = null
    for (const upload of folder1Uploads) {
      for (const file of upload.files) {
        if (nameLower && file.name.toLowerCase().replace(/\s+/g, '').includes(nameLower)) {
          matched = { uploadId: upload.id, filename: file.name }
          break
        }
      }
      if (matched) break
    }
    // If no name match and there's exactly one folder-1 upload for this month, use it unambiguously
    if (!matched && folder1Uploads.length === 1 && folder1Uploads[0].files.length === 1) {
      matched = { uploadId: folder1Uploads[0].id, filename: folder1Uploads[0].files[0].name }
    }
    if (matched) {
      payslipBytes = await readFileFromUploads(companyId, year, 1, matched.uploadId, matched.filename)
    }
  }
  if (!payslipBytes) {
    throw new Error(
      `No payslip found for employee ${employeeCode}. ` +
      `Either approve the folder 1 (RV) review for this employee, ` +
      `or upload the payslip directly to folder 1 with the employee name in the filename.`
    )
  }

  const baseJoinFilename = `BJ_${year}${String(month).padStart(2, '0')}_${companyId}.pdf`
  const baseJoinPath = path.join(EXPORTS_DIR, baseJoinFilename)
  let baseJoinBytes: Buffer
  try {
    baseJoinBytes = await fs.readFile(baseJoinPath)
  } catch {
    throw new Error('Base Join PDF not found. Generate the Base Join first.')
  }

  const merged = await PDFDocument.create()
  const payslipPdf = await PDFDocument.load(payslipBytes, { ignoreEncryption: true })
  const payslipPages = await merged.copyPages(payslipPdf, payslipPdf.getPageIndices())
  payslipPages.forEach((page) => merged.addPage(page))

  const baseJoinPdf = await PDFDocument.load(baseJoinBytes, { ignoreEncryption: true })
  const basePages = await merged.copyPages(baseJoinPdf, baseJoinPdf.getPageIndices())
  basePages.forEach((page) => merged.addPage(page))

  const buffer = Buffer.from(await merged.save())
  const filename = employee.filename || `CF_${year}${String(month).padStart(2, '0')}_${employeeCode}_${companyId}.pdf`
  await fs.writeFile(path.join(EXPORTS_DIR, filename), buffer)
  return { buffer, pageCount: merged.getPageCount(), filename }
}

// Update company required/optional folders learned from Final Join references
export const updateCompanyFolderRequirements = async (companyId: string, fingerprints: Array<{ document_code: string; section_order: number; page_count: number }>) => {
  const rules = await readCompanyRules(companyId)
  if (!rules) throw new Error('No rules found for company.')
  const examples = rules.approved_examples as Array<Record<string, unknown>>
  const referenceExamples = examples.filter((example) => example.example_kind === 'base_join' || example.example_kind === 'final_join')
  const totalRefs = Math.max(1, referenceExamples.length)

  const folderHitCounts = new Map<string, number>()
  const folderPageCounts = new Map<string, number[]>()
  for (const example of referenceExamples) {
    const sectionFps = Array.isArray(example.section_fingerprints) ? example.section_fingerprints as Array<Record<string, unknown>> : []
    for (const fp of sectionFps) {
      const code = typeof fp.document_code === 'string' ? fp.document_code : ''
      if (!code) continue
      folderHitCounts.set(code, (folderHitCounts.get(code) || 0) + 1)
      const pc = typeof fp.page_count === 'number' ? fp.page_count : 0
      if (pc > 0) {
        const existing = folderPageCounts.get(code) || []
        existing.push(pc)
        folderPageCounts.set(code, existing)
      }
    }
  }
  for (const fp of fingerprints) {
    folderHitCounts.set(fp.document_code, (folderHitCounts.get(fp.document_code) || 0) + 1)
    if (fp.page_count > 0) {
      const existing = folderPageCounts.get(fp.document_code) || []
      existing.push(fp.page_count)
      folderPageCounts.set(fp.document_code, existing)
    }
  }

  const required: string[] = []
  const optional: string[] = []
  for (const [code, count] of folderHitCounts.entries()) {
    if (count / totalRefs >= 0.6) required.push(code)
    else optional.push(code)
  }

  const folderSequence = fingerprints
    .sort((left, right) => left.section_order - right.section_order)
    .map((fp) => fp.document_code)
    .filter((code, index, array) => array.indexOf(code) === index)

  const expectedPageCounts: Record<string, number> = {}
  for (const [code, counts] of folderPageCounts.entries()) {
    const sorted = [...counts].sort((left, right) => left - right)
    expectedPageCounts[code] = sorted[Math.floor(sorted.length / 2)]
  }

  rules.required_folders = required
  rules.optional_folders = optional
  if (folderSequence.length) rules.folder_sequence = folderSequence
  if (Object.keys(expectedPageCounts).length) rules.expected_page_counts = expectedPageCounts
  rules.rules_version += 1

  await writeCompanyRules(companyId, rules)
  return rules.rules_version
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
