import { promises as fs } from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import { PDFDocument } from 'pdf-lib'
import { RH_FOLDERS, monthKey } from './taxonomy'
import type { CompanyRecord, CompanyRules, JoinReference, MonthlyWorkspace } from './types'

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
