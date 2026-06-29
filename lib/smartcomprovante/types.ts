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
  payslipHash?: string
}

export interface ApprovedDocument {
  id: string
  sourceHash: string
  folderCode: string
  folderNumber: number
  filename: string
  pageCount: number
  confidence: number
  approvedAt: string
  approvedBy: 'auto' | 'operator'
}

export interface ActivityItem {
  id: string
  at: string
  text: string
  tone: 'info' | 'success' | 'warning'
}

export interface BaseJoinSectionCheck {
  folderCode: string
  folderNumber: number
  label: string
  found: boolean
  actualPosition: number | null
  expectedPosition: number
  orderMatch: boolean
  requiredTermsCount: number
  optionalTermsCount: number
  llmEnriched: boolean
  validationScore: number
}

export interface BaseJoinValidation {
  overallConfidence: number
  coverageScore: number
  orderAlignmentScore: number
  sections: BaseJoinSectionCheck[]
  missingRequired: string[]
  unexpectedFound: string[]
  fingerprintQuality: number
  validatedAt: string
}

export type PeriodFormat = 'explicit_label' | 'named_month' | 'compact_yyyymm' | 'operation_date'

// A point an operator clicked on the document where the date lives.
// x/y are normalized 0..1 in pdf.js text space (origin bottom-left, y up).
export interface PeriodMark {
  page: number
  x: number
  y: number
  dateText?: string
  label?: string
  contextText?: string
}

export interface PeriodSignal {
  position: 'header' | 'footer' | 'body' | null
  format: PeriodFormat | null
  anchor_phrases: string[]
  detection_rate: number
  mark?: PeriodMark | null
}

export interface SectionEnrichment {
  document_code: string
  folder_number: number
  label: string
  page_numbers: number[]
  page_count: number
  date_position: 'header' | 'footer' | 'body' | null
  section_order: number
  header_terms: string[]
  sample_tokens: string[]
  tfidf_terms: string[]
  ngrams: string[]
  negative_terms: string[]
  llm_descriptors: string[]
  llm_enriched: boolean
  period_signal?: PeriodSignal
}

export interface EnrichedSectionFingerprint extends SectionEnrichment {
  required_terms: string[]
  optional_terms: string[]
  validation: {
    recall: number
    precision: number
    coverage: number
    rounds: number
  }
}

export interface JoinReference {
  id: string
  kind: 'base_join' | 'final_join'
  filename: string
  sourceHash: string
  uploadedAt: string
  pageCount: number
  structuralSummary: string
  learnedSections?: Array<{
    document_code: string
    folder_number: number
    label: string
    page_numbers: number[]
    header_terms: string[]
    sample_tokens: string[]
    page_count: number
    date_position: 'header' | 'footer' | 'body' | null
    section_order: number
  }>
  enrichedSections?: SectionEnrichment[]
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
    validation?: BaseJoinValidation
  }
  employees: EmployeeDeliverable[]
  approvedDocuments: ApprovedDocument[]
  joinReferences?: JoinReference[]
  activity: ActivityItem[]
}

export interface MonthlyComprovanteRecord {
  companyId: string
  year: number
  month: number
  workspaceKey: string
  baseJoin: {
    filename: string
    status: JoinStatus
    pageCount: number | null
    updatedAt: string | null
  }
  finalJoinFolder: {
    employeeCount: number
    currentCount: number
    readyCount: number
    blockedCount: number
  }
  evidenceFolderCount: number
  reviewCount: number
}

export interface YearComprovanteRecord {
  year: number
  comprovantesRh: MonthlyComprovanteRecord[]
}

export interface CompanyDatabaseRecord {
  company: CompanyRecord
  years: YearComprovanteRecord[]
}

export interface SmartComprovanteDatabase {
  schemaVersion: 'prototype-db-1.0'
  projects: ProjectRecord[]
  companies: CompanyDatabaseRecord[]
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
  required_folders: string[]
  optional_folders: string[]
  folder_sequence: string[]
  expected_page_counts: Record<string, number>
  enriched_fingerprints?: EnrichedSectionFingerprint[]
  fingerprint_trained_at?: string
  fingerprint_quality?: number
  audit: {
    created_at: string
    created_by: string
    change_reason: string
  }
}

// Batch & document processing
export interface ClassifiedDocument {
  id: string
  sourceHash: string
  filename: string
  mimeType: string
  folderNumber: number
  folderCode: string
  documentType: string
  confidence: number
  pageCount: number
  employeeCode?: string
  employeeName?: string
  period?: { year: number; month: number }
  classificationReason: string
  ruleName?: string
  cacheHit: boolean
  classifiedAt: string
}

export interface DocumentBatch {
  id: string
  companyId: string
  year: number
  month: number
  createdAt: string
  processedAt?: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  documents: ClassifiedDocument[]
  totalPages: number
  approvedCount: number
  reviewCount: number
  failedCount: number
}

// Export & audit
export interface AuditManifest {
  id: string
  batchId: string
  companyId: string
  year: number
  month: number
  generatedAt: string
  provider: ProviderId
  totalInputPages: number
  classifiedPages: number
  reviewedPages: number
  approvedPages: number
  discardedPages: number
  accuracy: {
    classificationAccuracy: number
    groupingAccuracy: number
  }
  metrics: {
    totalTokensUsed: number
    cacheHitRate: number
    ruleHitRate: number
    averageLatencyMs: number
    estimatedCost: number
  }
  documents: Array<{
    sourceHash: string
    filename: string
    classification: string
    status: 'approved' | 'review' | 'discarded'
  }>
}

export interface ExportBundle {
  id: string
  batchId: string
  filename: string
  timestamp: string
  companyId: string
  year: number
  month: number
  format: 'pdf' | 'pdf_with_manifest'
  pageCount: number
  size: number
  auditManifest?: AuditManifest
}

// Tracking & analytics
export interface ProviderCallRecord {
  id: string
  batchId: string
  providerId: ProviderId
  documentType: string
  status: 'success' | 'cached' | 'failed'
  inputTokens: number
  outputTokens: number
  latencyMs: number
  cost: number
  timestamp: string
}

export interface CacheEntry {
  sourceHash: string
  documentCode: string
  confidence: number
  timestamp: string
  hitCount: number
  employeeCode?: string
}
