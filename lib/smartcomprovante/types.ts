export type ProviderId = 'gemini' | 'groq' | 'ollama'

export type EvidenceStatus = 'missing' | 'detected' | 'review' | 'approved' | 'passed' | 'confirmed_missing'
export type JoinStatus = 'blocked' | 'needs_confirmation' | 'ready' | 'ready_with_warnings' | 'current' | 'stale' | 'failed'

export interface ProgramRecord {
  id: string
  code: string
  name: string
}

export interface ProjectRecord {
  id: string
  programId: string
  code: string
  name: string
}

export interface CompanyRecord {
  id: string
  projectId: string
  legalName: string
  nif: string
  code: string
  aliases: string[]
  rulesVersion: number
  createdAt: string
}

export interface EvidenceFolder {
  number: number
  code: string
  label: string
  status: EvidenceStatus
  documentCount: number
  approvedCount: number
  reviewCount: number
}

export interface ReviewItem {
  id: string
  filename: string
  proposedCode: string
  proposedLabel: string
  confidence: number
  reason: string
  status: 'pending' | 'approved' | 'passed'
  sourceHash?: string
  employeeName?: string | null
  targetYear?: number | null
  targetMonth?: number | null
}

export interface EmployeeDeliverable {
  id: string
  employeeCode: string
  employeeName: string
  payslipStatus: EvidenceStatus
  finalStatus: JoinStatus
  filename: string
  pageCount: number | null
}

export interface ActivityItem {
  id: string
  at: string
  text: string
  tone: 'info' | 'success' | 'warning'
}

export interface JoinReference {
  id: string
  kind: 'base_join' | 'final_join'
  filename: string
  sourceHash: string
  uploadedAt: string
  pageCount: number
  structuralSummary: string
  temporaryCopyRetained: false
}

export interface MonthlyWorkspace {
  program: ProgramRecord
  project: ProjectRecord
  company: CompanyRecord
  year: number
  month: number
  provider: ProviderId
  intakeCount: number
  folders: EvidenceFolder[]
  reviews: ReviewItem[]
  baseJoin: {
    status: JoinStatus
    filename: string
    includedFolders: number
    pageCount: number | null
    updatedAt: string | null
  }
  employees: EmployeeDeliverable[]
  joinReferences?: JoinReference[]
  activity: ActivityItem[]
}

export interface CompanyRules {
  schema_version: '1.0'
  rules_version: number
  company: {
    company_id: string
    display_name: string
    corporate_nif: string
    aliases: string[]
  }
  document_rules: Record<string, unknown>
  filename_patterns: unknown[]
  known_entities: {
    banks: unknown[]
    suppliers: unknown[]
    employees: unknown[]
  }
  approved_examples: unknown[]
  audit: {
    created_at: string
    created_by: string
    change_reason: string
  }
}
