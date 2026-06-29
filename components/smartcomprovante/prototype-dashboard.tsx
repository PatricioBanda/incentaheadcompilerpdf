'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EvidenceStatus, JoinStatus, MonthlyWorkspace } from '@/lib/smartcomprovante/types'
import type { CustomerUpload, UploadedFile } from '@/lib/smartcomprovante/upload-types'
import { buildDocumentDisplayCode } from '@/lib/smartcomprovante/upload-types'
import { PdfDateMarker, type DateMark } from './pdf-date-marker'
import {
  AlertTriangle, Archive, Bot, Building2, Check,
  Clock3, Download, FileCheck2, FileStack, Folder, FolderCheck, FolderInput, KeyRound, LayoutDashboard,
  LayoutGrid, List, Loader2, LockKeyhole, Plus, RefreshCw, Search, Settings, ShieldCheck, Sparkles, Tag, Upload, Users, X,
} from 'lucide-react'

type View = 'workspace' | 'review' | 'settings'
type AppSide = 'internal' | 'customer'
type ProjectRecord = { id: string; name: string; code: string; createdAt: string }
type TrainingStepStatus = 'pending' | 'running' | 'done' | 'error'
type TrainingStep = { id: string; label: string; detail: string; status: TrainingStepStatus }
type LocalMonthClusterLogEntry = { filename: string; result: string; source: 'rules' | 'groq' | 'unknown' | 'error'; hash?: string; phrase?: string | null }
type DateCandidate = { phrase: string; year: number; month: number; context: string; page: number; x: number; y: number; score: number }
type CandidateState = { status: 'idle' | 'loading' | 'loaded' | 'saving' | 'saved' | 'correcting'; candidates?: DateCandidate[]; phraseInput?: string }
type LocalMonthClusterStatus = { status: 'running' | 'done'; detected: number; unknown: number; detail: string; log?: LocalMonthClusterLogEntry[] }
type ClusterItem = {
  filename: string
  sourceHash: string
  confidence: number
  reason: string
  routeSource: string
  suggestedCode: string
  suggestedLabel: string
  evidence: string[]
  funnelLayer: string
  funnelTrace: Array<{ layer: string; status: 'matched' | 'missed' | 'skipped' | 'rejected'; detail: string }>
  targetYear: number | null
  targetMonth: number | null
}
type PeriodSignalSummary = { anchorPhrases: string[]; hasMark: boolean; detectionRate: number }
type ClusterResult = {
  runId: string
  totalItems: number
  groupedItems: number
  outliers: number
  reportPath?: string
  reportJsonPath?: string
  detectedPeriods?: Array<{ key: string; year: number; month: number; count: number; groupedCount: number }>
  funnelSummary?: Array<{ key: string; label: string; matched: number; rejected: number; missed: number }>
  periodSignals?: Record<string, PeriodSignalSummary>
  clusters: Array<{
    key: string
    folderNumber: number | null
    code: string
    label: string
    averageConfidence: number
    items: ClusterItem[]
  }>
}
type ProviderStatus = { provider: string; model: string; configured: boolean; credentialState: string; mode: string }
type DatabaseTree = {
  schemaVersion: string
  companies: Array<{
    company: { id: string; legalName: string; code: string; nif: string; rulesVersion: number }
    years: Array<{
      year: number
      comprovantesRh: Array<{
        month: number
        workspaceKey: string
        baseJoin: { filename: string; status: string; pageCount: number | null; updatedAt: string | null }
        finalJoinFolder: { employeeCount: number; currentCount: number; readyCount: number; blockedCount: number }
        evidenceFolderCount: number
        reviewCount: number
      }>
    }>
  }>
}

const customerUploadKey = (folderNumber: number, month: number | null | undefined) => `${folderNumber}:${month ?? 'none'}`

const SC_SESSION_PREFIX = 'sc-session-'
const sessionKey = (companyId: string, year: number, month: number) => `${SC_SESSION_PREFIX}${companyId}-${year}-${month}`
type SavedSession = {
  clusterResult: ClusterResult
  localMonthClusters: Record<string, LocalMonthClusterStatus>
  selectedPeriodKeys: string[]
  selectedMonths: number[]
  stagedSubFolderHints: Record<string, { year: number; month: number }>
  savedAt: string
}

declare global {
  interface Window {
    smartComprovante?: {
      credentialStatus: () => Promise<{ configured: boolean; encryptionAvailable: boolean }>
      saveGeminiKey: (key: string) => Promise<{ ok: boolean; configured: boolean; error?: string }>
      deleteGeminiKey: () => Promise<{ ok: boolean; configured: boolean }>
    }
  }
}

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const statusLabel: Partial<Record<EvidenceStatus | JoinStatus, string>> = {
  missing: 'Missing', detected: 'Detected', review: 'Review', approved: 'Approved', passed: 'Passed',
  blocked: 'Blocked', ready: 'Ready', current: 'Current', stale: 'Stale', failed: 'Failed',
}

const statusClasses: Partial<Record<EvidenceStatus | JoinStatus, string>> = {
  missing: 'bg-slate-100 text-slate-600', detected: 'bg-blue-50 text-blue-700', review: 'bg-amber-50 text-amber-700',
  approved: 'bg-emerald-50 text-emerald-700', passed: 'bg-violet-50 text-violet-700', blocked: 'bg-rose-50 text-rose-700',
  ready: 'bg-blue-50 text-blue-700', current: 'bg-emerald-50 text-emerald-700', stale: 'bg-amber-50 text-amber-700', failed: 'bg-rose-50 text-rose-700',
}

const initialTrainingSteps: TrainingStep[] = [
  { id: 'input',     label: 'Input validation',    detail: 'Validate examples: page count, format, minimum text quality.', status: 'pending' },
  { id: 'structure', label: 'PDF structure',       detail: 'Extract text, detect section headers, map folder numbers 1-13.', status: 'pending' },
  { id: 'ocr',       label: 'OCR advisory',        detail: 'Flag scanned pages; record scan ratio per section.', status: 'pending' },
  { id: 'tfidf',     label: 'TF-IDF + n-grams',    detail: 'Score distinctive tokens and 2–3 word phrases per section.', status: 'pending' },
  { id: 'llm',       label: 'LLM enrichment',      detail: 'Single Gemini batch call extracts key Portuguese phrases per section.', status: 'pending' },
  { id: 'aggregate', label: 'Cross-example merge', detail: 'Merge all examples: required terms ≥60%, optional 20–60%.', status: 'pending' },
  { id: 'validate',  label: 'Self-validation loop', detail: 'Test each fingerprint against all others; iterate up to 3 rounds.', status: 'pending' },
]

// Detect period from a folder name like "setembro_2025", "09_2025", "October", "09"
const detectPeriodFromFolderName = (folderName: string): { year: number; month: number } | null => {
  const norm = folderName
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[_\-./ ]+/g, ' ')
    .trim()
  const monthEntries: Array<[RegExp, number]> = [
    [/\b(janeiro|jan)\b/, 1], [/\b(fevereiro|fev)\b/, 2], [/\b(marco|mar)\b/, 3],
    [/\b(abril|abr)\b/, 4], [/\b(maio|mai)\b/, 5], [/\b(junho|jun)\b/, 6],
    [/\b(julho|jul)\b/, 7], [/\b(agosto|ago)\b/, 8], [/\b(setembro|set)\b/, 9],
    [/\b(outubro|out)\b/, 10], [/\b(novembro|nov)\b/, 11], [/\b(dezembro|dez)\b/, 12],
    [/\bjanuary\b/, 1], [/\bfebruary\b/, 2], [/\bmarch\b/, 3], [/\bapril\b/, 4],
    [/\bmay\b/, 5], [/\bjune\b/, 6], [/\bjuly\b/, 7], [/\baugust\b/, 8],
    [/\bseptember\b/, 9], [/\boctober\b/, 10], [/\bnovember\b/, 11], [/\bdecember\b/, 12],
  ]
  const yearMatch = norm.match(/\b(20[2-3][0-9])\b/)
  const year = yearMatch ? Number(yearMatch[1]) : new Date().getFullYear()
  let month: number | null = null
  for (const [pattern, m] of monthEntries) {
    if (pattern.test(norm)) { month = m; break }
  }
  if (!month) {
    // numeric month like "09" or "9" — only trust if short enough to not be a year
    const numeric = norm.replace(/\b20[2-3][0-9]\b/, '').match(/\b(0?[1-9]|1[0-2])\b/)
    if (numeric) month = Number(numeric[1])
  }
  return month ? { year, month } : null
}

function StatusPill({ status }: { status: EvidenceStatus | JoinStatus }) {
  const fallbackLabel: Record<string, string> = {
    confirmed_missing: 'Confirmed missing',
    needs_confirmation: 'Confirm missing',
    ready_with_warnings: 'Ready w/ warnings',
  }
  const fallbackClass = status === 'confirmed_missing' || status === 'needs_confirmation' || status === 'ready_with_warnings'
    ? 'bg-orange-50 text-orange-700'
    : 'bg-slate-100 text-slate-600'
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClasses[status] || fallbackClass}`}>{statusLabel[status] || fallbackLabel[status] || status}</span>
}

function MetricCard({ icon: Icon, label, value, detail, tone }: { icon: typeof FolderInput; label: string; value: string | number; detail: string; tone: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div><p className="text-sm font-medium text-slate-500">{label}</p><p className="mt-2 text-3xl font-bold tracking-tight text-slate-950">{value}</p></div>
        <div className={`rounded-xl p-2.5 ${tone}`}><Icon className="h-5 w-5" /></div>
      </div>
      <p className="mt-3 text-xs text-slate-500">{detail}</p>
    </div>
  )
}

async function readApiJson<T = unknown>(response: Response, fallbackMessage: string): Promise<T> {
  const contentType = response.headers.get('content-type') || ''
  const text = await response.text()
  if (!contentType.includes('application/json')) {
    const clean = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    const preview = clean.slice(0, 180) || response.statusText || fallbackMessage
    throw new Error(`${fallbackMessage} (${response.status}): ${preview}`)
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`${fallbackMessage} (${response.status}): invalid JSON response.`)
  }
}

export function PrototypeDashboard() {
  const [workspace, setWorkspace] = useState<MonthlyWorkspace | null>(null)
  const [databaseTree, setDatabaseTree] = useState<DatabaseTree | null>(null)
  const [provider, setProvider] = useState<ProviderStatus | null>(null)
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string>('project-inovacao-01')
  const [showProjectDialog, setShowProjectDialog] = useState(false)
  const [projectForm, setProjectForm] = useState({ name: '', code: '' })
  const [view, setView] = useState<View>('workspace')
  const [appSide, setAppSide] = useState<AppSide>('internal')
  const [busy, setBusy] = useState<string | null>('loading')
  const [error, setError] = useState('')
  const [showCompanyDialog, setShowCompanyDialog] = useState(false)
  const [companyForm, setCompanyForm] = useState({ legalName: '', nif: '', code: '' })
  const [keyValue, setKeyValue] = useState('')
  const [credential, setCredential] = useState<{ configured: boolean; encryptionAvailable: boolean } | null>(null)
  const [reviewDestinations, setReviewDestinations] = useState<Record<string, string>>({})
  const [previewReviewId, setPreviewReviewId] = useState<string | null>(null)
  const [folderProgress, setFolderProgress] = useState<{ current: number; total: number; filename: string } | null>(null)
  const [stagedFolderFiles, setStagedFolderFiles] = useState<File[]>([])
  const [stagedFolderContext, setStagedFolderContext] = useState<{ companyId: string; companyName: string; projectId: string; rulesVersion: number } | null>(null)
  const [clusterResult, setClusterResult] = useState<ClusterResult | null>(null)
  const [previewClusterHash, setPreviewClusterHash] = useState<string | null>(null)
  const [trainingProgress, setTrainingProgress] = useState<{ active: boolean; percent: number; label: string; done: boolean } | null>(null)
  const [trainingSteps, setTrainingSteps] = useState<TrainingStep[]>(initialTrainingSteps)
  const [selectedMonths, setSelectedMonths] = useState<number[]>([])
  const [selectedPeriodKeys, setSelectedPeriodKeys] = useState<string[]>([])
  const [pendingDownloads, setPendingDownloads] = useState<Array<{ year: number; month: number; filename: string }>>([])
  const [baseJoinLibrary, setBaseJoinLibrary] = useState<Array<{ filename: string; companyId: string; year: number; month: number; sizeBytes: number; generatedAt: string }>>([])
  const [finalJoinLibrary, setFinalJoinLibrary] = useState<Array<{ filename: string; companyId: string; year: number; month: number; employeeCode: string; sizeBytes: number; generatedAt: string }>>([])
  const [selectedBaseJoinFilename, setSelectedBaseJoinFilename] = useState<string | null>(null)
  const [folder1Payslips, setFolder1Payslips] = useState<Array<{ filename: string; employeeName: string; uploadId: string; physicalFolderNumber: number; hash?: string }>>([])
  const [folder1Loaded, setFolder1Loaded] = useState(false)
  const [selectedPayslipFilenames, setSelectedPayslipFilenames] = useState<string[]>([])
  const [generatingFinalFor, setGeneratingFinalFor] = useState<string | null>(null)
  const [batchGeneratingFinals, setBatchGeneratingFinals] = useState(false)
  const [previewBaseJoinFilename, setPreviewBaseJoinFilename] = useState<string | null>(null)
  const [previewFinalJoinFilename, setPreviewFinalJoinFilename] = useState<string | null>(null)
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null)
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  const [internalActiveYear, setInternalActiveYear] = useState<number | null>(null)
  const [showNewYearInput, setShowNewYearInput] = useState(false)
  const [newYearEntry, setNewYearEntry] = useState('')
  const [sessionRestored, setSessionRestored] = useState(false)
  const [clusterViewMode, setClusterViewMode] = useState<'list' | 'matrix'>('matrix')
  const [confirmClassificationStatus, setConfirmClassificationStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [localMonthClusters, setLocalMonthClusters] = useState<Record<string, LocalMonthClusterStatus>>({})
  const [candidateStates, setCandidateStates] = useState<Record<string, CandidateState>>({})
  const [reviewItem, setReviewItem] = useState<{ item: ClusterItem; clusterKey: string; allItems: ClusterItem[] } | null>(null)
  const [reviewReassignTarget, setReviewReassignTarget] = useState('')
  const [reviewMark, setReviewMark] = useState<DateMark | null>(null)
  const [anchorSaveStatus, setAnchorSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [reviewScanStatus, setReviewScanStatus] = useState<'idle' | 'loading' | 'loaded' | 'saving' | 'saved'>('idle')
  const [reviewScanCandidates, setReviewScanCandidates] = useState<DateCandidate[]>([])
  const [reviewManualPeriod, setReviewManualPeriod] = useState<{ year: number; month: number } | null>(null)
  const [reviewAnchorText, setReviewAnchorText] = useState('')
  const [reviewMonthFeedbackStatus, setReviewMonthFeedbackStatus] = useState<'idle' | 'confirmed' | 'wrong'>('idle')
  const [lastTaughtCode, setLastTaughtCode] = useState<string | null>(null)
  const [reviewVerifyStatus, setReviewVerifyStatus] = useState<'idle' | 'verifying' | 'verified' | 'failed'>('idle')
  const [reviewVerifyResult, setReviewVerifyResult] = useState<DateCandidate | null>(null)
  const confirmedPeriodsRef = useRef<Record<string, { year: number; month: number }>>({})
  const [customerCell, setCustomerCell] = useState<{ folderNumber: number; folderCode: string; folderLabel: string; month: number | null; year: number } | null>(null)
  const [lastCustomerCellKey, setLastCustomerCellKey] = useState<string | null>(null)
  const [customerPendingUploads, setCustomerPendingUploads] = useState<Record<string, File[]>>({})
  const [customerFolderUploads, setCustomerFolderUploads] = useState<Record<string, File[]>>({})
  const [customerSubmittedUploads, setCustomerSubmittedUploads] = useState<CustomerUpload[]>([])
  const [customerActiveYear, setCustomerActiveYear] = useState<number | null>(null)
  const [customerUploadsLastRefreshed, setCustomerUploadsLastRefreshed] = useState<Date | null>(null)
  const [customerPreviewFile, setCustomerPreviewFile] = useState<File | null>(null)
  const [customerPreviewUploadedFile, setCustomerPreviewUploadedFile] = useState<UploadedFile | null>(null)
  const [lastInternalPreviewHash, setLastInternalPreviewHash] = useState<string | null>(null)
  const [stagedSubFolderHints, setStagedSubFolderHints] = useState<Record<string, { year: number; month: number }>>({})
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const filesOnlyInputRef = useRef<HTMLInputElement>(null)
  const customerUploadInputRef = useRef<HTMLInputElement>(null)
  const customerUploadOpenedForMonthRef = useRef(false)
  const baseReferenceInputRef = useRef<HTMLInputElement>(null)
  const finalReferenceInputRef = useRef<HTMLInputElement>(null)
  const stagedFolderFilesRef = useRef<File[]>([])
  const lastGenerationConfirmRef = useRef(0)

  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear()
    return Array.from({ length: 7 }, (_, index) => currentYear - 3 + index)
  }, [])
  const customerPreviewUrl = useMemo(() => customerPreviewFile ? URL.createObjectURL(customerPreviewFile) : '', [customerPreviewFile])
  const reviewLocalFile = useMemo(() => {
    if (!reviewItem) return null
    const basename = reviewItem.item.filename.includes('/') ? reviewItem.item.filename.split('/').pop()! : reviewItem.item.filename
    const pools = [stagedFolderFiles, ...Object.values(customerFolderUploads)]
    for (const pool of pools) {
      const match = pool.find((file) => file.name === basename || file.webkitRelativePath === reviewItem.item.filename)
      if (match) return match
    }
    return null
  }, [reviewItem, stagedFolderFiles, customerFolderUploads])
  const reviewLocalPreviewUrl = useMemo(() => reviewLocalFile ? URL.createObjectURL(reviewLocalFile) : '', [reviewLocalFile])
  const reviewUploadedFile = useMemo(() => {
    if (!reviewItem) return null
    for (const upload of customerSubmittedUploads) {
      const match = upload.files.find((file) => file.hash === reviewItem.item.sourceHash || file.name === reviewItem.item.filename)
      if (match) return match
    }
    return null
  }, [reviewItem, customerSubmittedUploads])

  // Group customer uploads by year then folderNumber for the internal submissions panel.
  const customerSubmissionsByYear = useMemo(() => {
    const active = customerSubmittedUploads.filter((u) => u.status !== 'archived')
    const byYear = new Map<number, Map<number, { label: string; code: string; uploads: CustomerUpload[] }>>()
    for (const upload of active) {
      if (!byYear.has(upload.year)) byYear.set(upload.year, new Map())
      const byFolder = byYear.get(upload.year)!
      if (!byFolder.has(upload.folderNumber)) {
        const label = upload.folderNumber === 0 ? 'Inbox' : `Folder ${upload.folderNumber}`
        const code = upload.folderNumber === 0 ? '00_IN' : ''
        byFolder.set(upload.folderNumber, { label, code, uploads: [] })
      }
      byFolder.get(upload.folderNumber)!.uploads.push(upload)
    }
    return byYear
  }, [customerSubmittedUploads])

  // Per-year filter for the customer view (only show current active year's uploads).
  const customerYearUploads = useMemo(
    () => customerSubmittedUploads.filter((u) => u.year === (customerActiveYear ?? workspace?.year ?? new Date().getFullYear())),
    [customerSubmittedUploads, customerActiveYear, workspace?.year],
  )

  useEffect(() => {
    return () => {
      if (customerPreviewUrl) URL.revokeObjectURL(customerPreviewUrl)
    }
  }, [customerPreviewUrl])

  useEffect(() => {
    return () => {
      if (reviewLocalPreviewUrl) URL.revokeObjectURL(reviewLocalPreviewUrl)
    }
  }, [reviewLocalPreviewUrl])

  // When file picker is cancelled after a month-button click, deselect the month so clicking it again re-opens the picker.
  useEffect(() => {
    const input = customerUploadInputRef.current
    if (!input) return
    const handleCancel = () => {
      if (customerUploadOpenedForMonthRef.current) {
        setCustomerCell((prev) => prev ? { ...prev, month: null } : null)
      }
      customerUploadOpenedForMonthRef.current = false
    }
    input.addEventListener('cancel', handleCancel)
    return () => input.removeEventListener('cancel', handleCancel)
  }, [])

  const clearWorkspaceSessionState = () => {
    setTrainingProgress(null)
    setTrainingSteps(initialTrainingSteps)
    setStagedFolderFiles([])
    setStagedFolderContext(null)
    stagedFolderFilesRef.current = []
    setStagedSubFolderHints({})
    setClusterResult(null)
    setSelectedMonths([])
    setSelectedPeriodKeys([])
    setLocalMonthClusters({})
    setPreviewClusterHash(null)
    setPreviewReviewId(null)
    setFolderProgress(null)
    setReviewItem(null)
    setReviewReassignTarget('')
    setReviewMark(null)
    setAnchorSaveStatus('idle')
    setReviewScanStatus('idle')
    setReviewScanCandidates([])
    setFolder1Loaded(false)
    setFolder1Payslips([])
    setSelectedPayslipFilenames([])
    setPreviewFinalJoinFilename(null)
    setReviewManualPeriod(null)
    setReviewAnchorText('')
    setCustomerCell(null)
    setLastCustomerCellKey(null)
    setCustomerPendingUploads({})
    setCustomerFolderUploads({})
    setCustomerSubmittedUploads([])
    setCustomerPreviewFile(null)
    setCustomerPreviewUploadedFile(null)
    setLastInternalPreviewHash(null)
    if (folderInputRef.current) folderInputRef.current.value = ''
    if (customerUploadInputRef.current) customerUploadInputRef.current.value = ''
    if (uploadInputRef.current) uploadInputRef.current.value = ''
    if (baseReferenceInputRef.current) baseReferenceInputRef.current.value = ''
    if (finalReferenceInputRef.current) finalReferenceInputRef.current.value = ''
  }

  const refreshCustomerUploads = useCallback(async (companyId: string) => {
    const response = await fetch(`/api/smartcomprovante/uploads?companyId=${encodeURIComponent(companyId)}`, { cache: 'no-store' })
    if (!response.ok) return
    const data = await readApiJson<{ uploads?: CustomerUpload[] }>(response, 'Could not load customer uploads.')
    setCustomerSubmittedUploads(data.uploads || [])
    setCustomerUploadsLastRefreshed(new Date())
  }, [])

  const load = async (overrideProjectId?: string) => {
    setBusy('loading')
    setError('')
    const projectId = overrideProjectId ?? selectedProjectId
    try {
      const canReuseCurrentWorkspace = workspace && workspace.project.id === projectId
      const workspaceUrl = canReuseCurrentWorkspace
        ? `/api/smartcomprovante/workspace?companyId=${encodeURIComponent(workspace.company.id)}&year=${workspace.year}&month=${workspace.month}&projectId=${encodeURIComponent(projectId)}`
        : `/api/smartcomprovante/workspace?projectId=${encodeURIComponent(projectId)}`
      const [workspaceResponse, providerResponse, companiesResponse, projectsResponse] = await Promise.all([
        fetch(workspaceUrl, { cache: 'no-store' }),
        fetch('/api/smartcomprovante/provider', { cache: 'no-store' }),
        fetch('/api/smartcomprovante/companies', { cache: 'no-store' }),
        fetch('/api/smartcomprovante/projects', { cache: 'no-store' }),
      ])
      const loadedWorkspace = await readApiJson<(MonthlyWorkspace & { empty?: false; error?: string }) | { empty: true; error?: string }>(workspaceResponse, 'Could not load workspace.')
      if (!workspaceResponse.ok) throw new Error((loadedWorkspace as { error?: string }).error || 'Could not load workspace.')
      const companiesData = companiesResponse.ok ? await readApiJson<DatabaseTree>(companiesResponse, 'Could not load companies.') : null
      if (companiesData) setDatabaseTree(companiesData)
      let resolvedWorkspace = loadedWorkspace?.empty ? null : loadedWorkspace
      // Empty first load but companies already exist → reopen one instead of forcing onboarding.
      if (!resolvedWorkspace && companiesData?.companies?.length) {
        const companyNodes = companiesData.companies as Array<{ company: { id: string; projectId?: string }; years: Array<{ year: number; comprovantesRh: Array<{ month: number }> }> }>
        const node = companyNodes.find((c) => (c.company.projectId ?? projectId) === projectId) || companyNodes[0]
        const targetProjectId = node.company.projectId || projectId
        const latestYear = node.years?.[0]?.year ?? new Date().getFullYear()
        const monthsForYear = node.years?.[0]?.comprovantesRh
        const latestMonth = monthsForYear?.length ? monthsForYear[monthsForYear.length - 1].month : new Date().getMonth() + 1
        const resumeResponse = await fetch(`/api/smartcomprovante/workspace?companyId=${encodeURIComponent(node.company.id)}&year=${latestYear}&month=${latestMonth}&projectId=${encodeURIComponent(targetProjectId)}`, { cache: 'no-store' })
        if (resumeResponse.ok) {
          const resumed = await readApiJson<(MonthlyWorkspace & { empty?: false }) | { empty: true }>(resumeResponse, 'Could not resume workspace.')
          if (!resumed?.empty) { resolvedWorkspace = resumed; setSelectedProjectId(targetProjectId) }
        }
      }
      if (resolvedWorkspace) {
        if (
          workspace
          && (resolvedWorkspace.company.id !== workspace.company.id || resolvedWorkspace.project.id !== workspace.project.id)
        ) {
          clearWorkspaceSessionState()
        }
        setWorkspace(resolvedWorkspace)
        setSelectedYear(resolvedWorkspace.year)
        void loadBaseJoinLibrary(resolvedWorkspace.company.id)
        void loadFinalJoinLibrary(resolvedWorkspace.company.id)
      } else {
        setWorkspace(null)
      }
      if (providerResponse.ok) setProvider(await readApiJson(providerResponse, 'Could not load provider.'))
      if (projectsResponse.ok) setProjects(await readApiJson(projectsResponse, 'Could not load projects.'))
      if (window.smartComprovante) setCredential(await window.smartComprovante.credentialStatus())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Loading failed.')
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => { void load() }, [])

  useEffect(() => {
    if (!workspace) return
    void refreshCustomerUploads(workspace.company.id)
  }, [workspace?.company.id, refreshCustomerUploads])

  useEffect(() => {
    if (selectedBaseJoinFilename) return
    setFolder1Loaded(false)
    setFolder1Payslips([])
    setSelectedPayslipFilenames([])
    setPreviewFinalJoinFilename(null)
  }, [selectedBaseJoinFilename])

  useEffect(() => {
    if (!workspace || !customerSubmittedUploads.length) return
    const directUploads = customerSubmittedUploads.filter((upload) => upload.status !== 'archived' && upload.folderNumber >= 0 && upload.folderNumber <= 13)
    if (!directUploads.length) return
    setClusterResult((current) => {
      const clusters = [...(current?.clusters || [])]
      for (const upload of directUploads) {
        const folder = upload.folderNumber === 0
          ? { number: 0, code: '00_IN', label: 'Inbox' }
          : workspace.folders.find((item) => item.number === upload.folderNumber)
        if (!folder) continue
        let cluster = clusters.find((item) => item.folderNumber === upload.folderNumber)
        if (!cluster) {
          cluster = { key: folder.code, folderNumber: folder.number, code: folder.code, label: folder.label, averageConfidence: 1, items: [] }
          clusters.push(cluster)
        }
        for (const file of upload.files) {
          const sourceHash = file.hash || `${upload.id}-${file.name}`
          if (cluster.items.some((item) => item.sourceHash === sourceHash)) continue
          cluster.items.push({
            filename: file.name,
            sourceHash,
            confidence: 1,
            reason: upload.month ? 'Customer submitted this file directly into this folder and month.' : 'Customer submitted this file directly into this folder without month separation.',
            routeSource: 'customer-persisted-upload',
            suggestedCode: folder.code,
            suggestedLabel: folder.label,
            evidence: [upload.month ? `Persisted customer upload for ${monthNames[upload.month - 1]} ${upload.year}.` : 'Persisted customer upload.'],
            funnelLayer: 'customer_direct_folder',
            funnelTrace: [{ layer: 'customer_direct_folder', status: 'matched', detail: upload.month ? 'Customer selected this folder/type and month.' : 'Customer selected this folder/type; month is still unknown.' }],
            targetYear: upload.month ? upload.year : null,
            targetMonth: upload.month ?? null,
          })
        }
      }
      clusters.sort((left, right) => (left.folderNumber || 99) - (right.folderNumber || 99))
      const totalItems = clusters.reduce((sum, cluster) => sum + cluster.items.length, 0)
      return {
        runId: current?.runId || `submitted-${Date.now()}`,
        totalItems,
        groupedItems: totalItems,
        outliers: current?.outliers || 0,
        reportPath: current?.reportPath,
        reportJsonPath: current?.reportJsonPath,
        detectedPeriods: current?.detectedPeriods,
        funnelSummary: current?.funnelSummary,
        periodSignals: current?.periodSignals,
        clusters,
      }
    })
  }, [workspace, customerSubmittedUploads])

  // When clusterResult is reset to null (e.g. period switch) but customer uploads exist, re-trigger injection.
  useEffect(() => {
    if (clusterResult !== null || !workspace || !customerSubmittedUploads.length) return
    setCustomerSubmittedUploads((prev) => [...prev])
  }, [clusterResult, workspace, customerSubmittedUploads.length])

  // Auto-save classification session to localStorage so work survives a page reload.
  useEffect(() => {
    if (!workspace || !clusterResult) return
    try {
      const session: SavedSession = { clusterResult, localMonthClusters, selectedPeriodKeys, selectedMonths, stagedSubFolderHints, savedAt: new Date().toISOString() }
      localStorage.setItem(sessionKey(workspace.company.id, workspace.year, workspace.month), JSON.stringify(session))
    } catch { /* storage quota exceeded */ }
  }, [clusterResult, localMonthClusters, selectedPeriodKeys, selectedMonths, stagedSubFolderHints, workspace])

  // Restore classification session when a workspace period is opened.
  useEffect(() => {
    if (!workspace) return
    setSessionRestored(false)
    try {
      const raw = localStorage.getItem(sessionKey(workspace.company.id, workspace.year, workspace.month))
      if (!raw) return
      const session = JSON.parse(raw) as SavedSession
      if (!session.clusterResult) return
      setClusterResult(session.clusterResult)
      // Strip log entries on restore — logs reference File objects that aren't in memory after reload.
      // The summary (detected/unknown counts) is preserved so the user sees the high-level status.
      const clustersWithoutLog: Record<string, LocalMonthClusterStatus> = {}
      for (const [k, v] of Object.entries(session.localMonthClusters ?? {})) clustersWithoutLog[k] = { ...v, log: [] }
      setLocalMonthClusters(clustersWithoutLog)
      setSelectedPeriodKeys(session.selectedPeriodKeys ?? [])
      setSelectedMonths(session.selectedMonths ?? [])
      setStagedSubFolderHints(session.stagedSubFolderHints ?? {})
      setSessionRestored(true)
      setCustomerSubmittedUploads((p) => [...p])
    } catch { /* corrupt JSON — ignore */ }
  }, [workspace?.company.id, workspace?.year, workspace?.month])

  // Auto-refresh customer uploads every 60 s when on internal view so new submissions appear without a page reload.
  useEffect(() => {
    if (appSide !== 'internal' || !workspace) return
    const id = setInterval(() => void refreshCustomerUploads(workspace.company.id), 60_000)
    return () => clearInterval(id)
  }, [appSide, workspace?.company.id, refreshCustomerUploads])

  // Reset year pickers when switching views so both sides always open on the year dashboard.
  useEffect(() => {
    if (appSide === 'customer') setCustomerActiveYear(null)
    if (appSide === 'internal') setInternalActiveYear(null)
  }, [appSide])

  // Reset internal year dashboard when company changes (but NOT when year/month changes within the same company).
  useEffect(() => {
    setInternalActiveYear(null)
  }, [workspace?.company.id])

  // Keyboard navigation: arrow keys move between items inside the open review panel
  useEffect(() => {
    if (!reviewItem) return
    const handleKey = (event: KeyboardEvent) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Escape'].includes(event.key)) event.preventDefault()
      if (event.key === 'Escape') { setReviewItem(null); return }
      const items = reviewItem.allItems
      const currentIdx = items.findIndex((i) => i.sourceHash === reviewItem.item.sourceHash)
      if (currentIdx === -1) return
      let nextIdx = currentIdx
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIdx = Math.min(items.length - 1, currentIdx + 1)
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIdx = Math.max(0, currentIdx - 1)
      if (nextIdx !== currentIdx) {
        const next = items[nextIdx]
        setReviewItem({ item: next, clusterKey: reviewItem.clusterKey, allItems: items })
        setReviewReassignTarget(next.suggestedCode)
        setReviewMark(null)
        setAnchorSaveStatus('idle')
        setReviewScanStatus('idle')
        setReviewScanCandidates([])
        setReviewManualPeriod(null)
        setReviewAnchorText('')
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [reviewItem])

  const openCompany = async (companyId: string, projectId: string, year?: number, month?: number) => {
    setBusy('loading')
    setError('')
    if (companyId !== workspace?.company.id || projectId !== selectedProjectId) clearWorkspaceSessionState()
    try {
      const now = new Date()
      const targetYear = year ?? now.getFullYear()
      const targetMonth = month ?? now.getMonth() + 1
      const response = await fetch(`/api/smartcomprovante/workspace?companyId=${encodeURIComponent(companyId)}&year=${targetYear}&month=${targetMonth}&projectId=${encodeURIComponent(projectId)}`, { cache: 'no-store' })
      if (!response.ok) throw new Error('Could not open the selected company.')
      const ws = await response.json()
      if (ws?.empty) throw new Error('No workspace found for that company.')
      setWorkspace(ws)
      setSelectedYear(ws.year)
      setSelectedProjectId(projectId)
      setView('workspace')
      void loadBaseJoinLibrary(ws.company.id)
      void loadFinalJoinLibrary(ws.company.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open the selected company.')
    } finally {
      setBusy(null)
    }
  }

  const openPeriod = async (year: number, month: number) => {
    if (!workspace) return
    setBusy(`month-${month}`)
    setError('')
    if (year !== workspace.year || month !== workspace.month) clearWorkspaceSessionState()
    try {
      const response = await fetch(`/api/smartcomprovante/workspace?companyId=${encodeURIComponent(workspace.company.id)}&year=${year}&month=${month}&projectId=${encodeURIComponent(selectedProjectId)}`, { cache: 'no-store' })
      if (!response.ok) throw new Error('Could not open the selected month.')
      const nextWorkspace = await response.json()
      setWorkspace(nextWorkspace)
      setSelectedYear(nextWorkspace.year)
      setView('workspace')
      void loadBaseJoinLibrary(nextWorkspace.company.id)
      void loadFinalJoinLibrary(nextWorkspace.company.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open the selected month.')
    } finally {
      setBusy(null)
    }
  }

  const openMonth = async (month: number) => {
    if (!workspace) return
    await openPeriod(selectedYear ?? workspace.year, month)
  }

  const toggleSelectedMonth = (month: number) => {
    setSelectedMonths((current) => current.includes(month) ? current.filter((item) => item !== month) : [...current, month].sort((a, b) => a - b))
  }

  const detectedPeriods = useMemo(() => clusterResult?.detectedPeriods || [], [clusterResult])
  const selectedPeriods = useMemo(() => {
    if (detectedPeriods.length) return detectedPeriods.filter((period) => selectedPeriodKeys.includes(period.key))
    if (!workspace) return []
    return selectedMonths.map((month) => ({ key: `${workspace.year}-${String(month).padStart(2, '0')}`, year: workspace.year, month, count: 0, groupedCount: 0 }))
  }, [detectedPeriods, selectedPeriodKeys, selectedMonths, workspace])
  const finalJoinMonthGroups = useMemo(() => {
    if (!workspace) return []
    const groups = new Map<string, { key: string; year: number; month: number; label: string; items: typeof finalJoinLibrary }>()
    for (const entry of finalJoinLibrary.filter((item) => item.companyId === workspace.company.id)) {
      const key = `${entry.year}-${String(entry.month).padStart(2, '0')}`
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          year: entry.year,
          month: entry.month,
          label: `${monthNames[entry.month - 1]} ${entry.year}`,
          items: [],
        })
      }
      groups.get(key)!.items.push(entry)
    }
    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        items: group.items.slice().sort((left, right) => left.employeeCode.localeCompare(right.employeeCode)),
      }))
      .sort((left, right) => (right.year * 100 + right.month) - (left.year * 100 + left.month))
  }, [finalJoinLibrary, workspace])

  const confirmIncompleteGeneration = (periods: typeof selectedPeriods) => {
    if (!workspace || !clusterResult) return true
    const now = Date.now()
    if (now - lastGenerationConfirmRef.current < 1200) return true
    const requiredFolders = workspace.folders.filter((folder) => folder.number >= 2 && folder.number <= 13)
    const missingLines = periods.flatMap((period) => {
      const missing = requiredFolders.filter((folder) => {
        const cluster = clusterResult.clusters.find((item) => item.folderNumber === folder.number)
        return !cluster?.items.some((item) => item.targetYear === period.year && item.targetMonth === period.month)
      })
      if (!missing.length) return []
      return [`${monthNames[period.month - 1]} ${period.year}: ${missing.map((folder) => `F${String(folder.number).padStart(2, '0')}`).join(', ')}`]
    })
    if (!missingLines.length) return true
    lastGenerationConfirmRef.current = now
    return window.confirm(`Some required folders are missing for the selected Base Join period(s):\n\n${missingLines.join('\n')}\n\nDo you want to generate anyway?`)
  }

  const toggleSelectedPeriod = (key: string) => {
    setSelectedPeriodKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key].sort())
  }

  const generateSelectedBaseJoins = async (confirmMissing = false) => {
    if (!workspace || selectedPeriods.length === 0) return
    setBusy('generate-selected-base')
    setError('')
    try {
      let currentWorkspace: MonthlyWorkspace | null = null
      const readyDownloads: Array<{ year: number; month: number; filename: string }> = []
      for (const period of selectedPeriods) {
        const response = await fetch('/api/smartcomprovante/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'generate-base', companyId: workspace.company.id, projectId: selectedProjectId, year: period.year, month: period.month, confirmMissing }),
        })
        const result = await response.json()
        // Confirmation gate: missing folders detected — show dialog and re-run if confirmed
        if (response.status === 409 && result.requiresConfirmation) {
          const missing = (result.missingFolders as Array<{ number: number; code: string; label: string }>) || []
          const lines = missing.map((f) => `• ${String(f.number).padStart(2, '0')}_${f.code} — ${f.label}`).join('\n')
          const confirmed = window.confirm(
            `${missing.length} folder(s) are incomplete for ${monthNames[period.month - 1]} ${period.year}:\n\n${lines}\n\nGenerate the Base Join anyway with these folders marked as missing?`
          )
          if (!confirmed) {
            setError(`Generation cancelled for ${monthNames[period.month - 1]} ${period.year} — complete the missing folders first or confirm to proceed.`)
            return
          }
          // Re-run this period with confirmation
          setBusy(null)
          await generateSelectedBaseJoins(true)
          return
        }
        if (!response.ok) throw new Error(`${monthNames[period.month - 1]} ${period.year}: ${result.error || 'Base Join generation failed.'}`)
        const ws = result as MonthlyWorkspace
        if (period.year === workspace.year && period.month === workspace.month) currentWorkspace = ws
        if (ws.baseJoin?.status === 'current' && ws.baseJoin.filename) {
          readyDownloads.push({ year: period.year, month: period.month, filename: ws.baseJoin.filename })
        }
      }
      if (currentWorkspace) setWorkspace(currentWorkspace)
      setSelectedMonths([])
      setSelectedPeriodKeys([])
      for (const period of selectedPeriods) localStorage.removeItem(sessionKey(workspace.company.id, period.year, period.month))
      setSessionRestored(false)
      if (workspace) void refreshCustomerUploads(workspace.company.id)
      // Refresh the library so newly generated files appear immediately
      void loadBaseJoinLibrary(workspace.company.id)
      // Trigger download: auto-download if single period, else queue for manual download
      if (readyDownloads.length === 1) {
        downloadBaseJoin(workspace.company.id, selectedProjectId, readyDownloads[0].year, readyDownloads[0].month, readyDownloads[0].filename)
      } else if (readyDownloads.length > 1) {
        setPendingDownloads(readyDownloads)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Base Join generation failed.')
    } finally {
      setBusy(null)
    }
  }

  const generateSelectedBaseAndFinals = async (confirmMissing = false) => {
    if (!workspace || selectedPeriods.length === 0) return
    setBusy('generate-selected-all')
    setError('')
    try {
      let currentWorkspace: MonthlyWorkspace | null = null
      for (const period of selectedPeriods) {
        const baseResponse = await fetch('/api/smartcomprovante/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'generate-base', companyId: workspace.company.id, projectId: selectedProjectId, year: period.year, month: period.month, confirmMissing }),
        })
        const baseResult = await baseResponse.json()
        if (baseResponse.status === 409 && baseResult.requiresConfirmation) {
          const missing = (baseResult.missingFolders as Array<{ number: number; code: string; label: string }>) || []
          const lines = missing.map((f) => `• ${String(f.number).padStart(2, '0')}_${f.code} — ${f.label}`).join('\n')
          const confirmed = window.confirm(
            `${missing.length} folder(s) are incomplete for ${monthNames[period.month - 1]} ${period.year}:\n\n${lines}\n\nGenerate the Base Join anyway with these folders marked as missing?`
          )
          if (!confirmed) {
            setError(`Generation cancelled for ${monthNames[period.month - 1]} ${period.year} — complete the missing folders first.`)
            return
          }
          setBusy(null)
          await generateSelectedBaseAndFinals(true)
          return
        }
        if (!baseResponse.ok) throw new Error(`${monthNames[period.month - 1]} ${period.year}: ${baseResult.error || 'Base Join generation failed.'}`)
        const finalsResponse = await fetch('/api/smartcomprovante/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'generate-finals', companyId: workspace.company.id, projectId: selectedProjectId, year: period.year, month: period.month }),
        })
        const finalsResult = await finalsResponse.json()
        if (!finalsResponse.ok) throw new Error(`${monthNames[period.month - 1]} ${period.year}: ${finalsResult.error || 'Comprovante generation failed.'}`)
        if (period.year === workspace.year && period.month === workspace.month) currentWorkspace = finalsResult as MonthlyWorkspace
      }
      if (currentWorkspace) setWorkspace(currentWorkspace)
      setSelectedMonths([])
      setSelectedPeriodKeys([])
      for (const period of selectedPeriods) localStorage.removeItem(sessionKey(workspace.company.id, period.year, period.month))
      setSessionRestored(false)
      if (workspace) void refreshCustomerUploads(workspace.company.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Generation for selected months failed.')
    } finally {
      setBusy(null)
    }
  }

  const runAction = async (action: string, reviewId?: string, destinationCode?: string) => {
    if (!workspace) return
    setBusy(reviewId || action)
    setError('')
    try {
      const response = await fetch('/api/smartcomprovante/actions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reviewId, destinationCode, companyId: workspace.company.id, projectId: selectedProjectId, year: workspace.year, month: workspace.month }),
      })
      const result = await readApiJson<MonthlyWorkspace & { error?: string }>(response, 'Action failed.')
      if (!response.ok) throw new Error(result.error || 'Action failed.')
      setWorkspace(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Action failed.')
    } finally { setBusy(null) }
  }

  const confirmClassification = async () => {
    if (!clusterResult || !workspace) return
    // Collect all items from clusters 2-13 that have a confirmed period
    const items = clusterResult.clusters
      .filter((c) => c.folderNumber != null && c.folderNumber >= 2 && c.folderNumber <= 13)
      .flatMap((c) =>
        c.items
          .filter((item) => item.targetYear && item.targetMonth && item.sourceHash)
          .map((item) => ({
            sourceHash: item.sourceHash!,
            filename: item.filename,
            folderNumber: c.folderNumber!,
            folderCode: c.code,
            targetYear: item.targetYear!,
            targetMonth: item.targetMonth!,
            confidence: item.confidence ?? 0.9,
          }))
      )
    // Items without a confirmed period: default to workspace year/month
    const unperiodedItems = clusterResult.clusters
      .filter((c) => c.folderNumber != null && c.folderNumber >= 2 && c.folderNumber <= 13)
      .flatMap((c) =>
        c.items
          .filter((item) => (!item.targetYear || !item.targetMonth) && item.sourceHash)
          .map((item) => ({
            sourceHash: item.sourceHash!,
            filename: item.filename,
            folderNumber: c.folderNumber!,
            folderCode: c.code,
            targetYear: workspace.year,
            targetMonth: workspace.month,
            confidence: item.confidence ?? 0.9,
          }))
      )
    const allItems = [...items, ...unperiodedItems]
    if (!allItems.length) return
    setConfirmClassificationStatus('saving')
    try {
      const res = await fetch('/api/smartcomprovante/actions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm-classification', companyId: workspace.company.id, projectId: selectedProjectId, year: workspace.year, month: workspace.month, classificationItems: allItems }),
      })
      if (!res.ok) throw new Error('Failed')
      setConfirmClassificationStatus('saved')
      setTimeout(() => setConfirmClassificationStatus('idle'), 3000)
      await load()
    } catch {
      setConfirmClassificationStatus('error')
      setTimeout(() => setConfirmClassificationStatus('idle'), 4000)
    }
  }

  const openPdfPreview = (filename: string, setFn: (f: string | null) => void, current: string | null) => {
    setFn(current === filename ? null : filename)
  }

  const removeClusterFile = async (item: ClusterItem, clusterKey: string) => {
    if (!workspace) return
    const confirmed = window.confirm(`Remove this file from the folder board?\n\n${item.filename}\n\nThis also deletes the stored upload copy when available.`)
    if (!confirmed) return

    const targetYear = item.targetYear || workspace.year
    const targetMonth = item.targetMonth || workspace.month
    setError('')
    setClusterResult((current) => {
      if (!current) return current
      const clusters = current.clusters
        .map((cluster) => cluster.key !== clusterKey ? cluster : {
          ...cluster,
          items: cluster.items.filter((clusterItem) => clusterItem.sourceHash !== item.sourceHash),
        })
        .filter((cluster) => cluster.items.length > 0 || cluster.folderNumber !== null)
      const totalItems = clusters.reduce((sum, cluster) => sum + cluster.items.length, 0)
      const outliers = clusters.find((cluster) => cluster.key === 'OUTLIERS')?.items.length || 0
      return { ...current, clusters, totalItems, groupedItems: Math.max(0, current.groupedItems - 1), outliers }
    })
    if (reviewItem?.item.sourceHash === item.sourceHash) setReviewItem(null)

    try {
      const response = await fetch('/api/smartcomprovante/remove-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: workspace.company.id,
          projectId: selectedProjectId,
          year: targetYear,
          month: targetMonth,
          sourceHash: item.sourceHash,
        }),
      })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error || 'Could not remove file.')
      void refreshCustomerUploads(workspace.company.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove file.')
      void refreshCustomerUploads(workspace.company.id)
    }
  }

  const deleteGeneratedPdf = async (filename: string, kind: 'base' | 'final', year: number, month: number) => {
    if (!workspace) return
    const label = kind === 'base' ? 'Base Join' : 'Final Join'
    const confirmed = window.confirm(`Delete this generated ${label} PDF?\n\n${filename}\n\nYou can regenerate it later if the source files are still available.`)
    if (!confirmed) return

    setError('')
    if (kind === 'base') {
      setBaseJoinLibrary((current) => current.filter((entry) => entry.filename !== filename))
      if (selectedBaseJoinFilename === filename) setSelectedBaseJoinFilename(null)
      if (previewBaseJoinFilename === filename) setPreviewBaseJoinFilename(null)
      setPendingDownloads((current) => current.filter((entry) => entry.filename !== filename))
    } else {
      setFinalJoinLibrary((current) => current.filter((entry) => entry.filename !== filename))
      if (previewFinalJoinFilename === filename) setPreviewFinalJoinFilename(null)
    }

    try {
      const response = await fetch('/api/smartcomprovante/delete-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename,
          companyId: workspace.company.id,
          projectId: selectedProjectId,
          year,
          month,
        }),
      })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error || `Could not delete ${label}.`)
      if (kind === 'base') void loadBaseJoinLibrary(workspace.company.id)
      else void loadFinalJoinLibrary(workspace.company.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not delete ${label}.`)
      if (kind === 'base') void loadBaseJoinLibrary(workspace.company.id)
      else void loadFinalJoinLibrary(workspace.company.id)
    }
  }

  const loadBaseJoinLibrary = async (companyId: string) => {
    try {
      const res = await fetch(`/api/smartcomprovante/download?type=list&companyId=${encodeURIComponent(companyId)}`, { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json() as { entries: Array<{ filename: string; companyId: string; year: number; month: number; sizeBytes: number; generatedAt: string }> }
      setBaseJoinLibrary(data.entries)
    } catch { /* non-fatal */ }
  }

  const loadFinalJoinLibrary = async (companyId: string) => {
    try {
      const res = await fetch(`/api/smartcomprovante/download?type=list-finals&companyId=${encodeURIComponent(companyId)}`, { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json() as { entries: Array<{ filename: string; companyId: string; year: number; month: number; employeeCode: string; sizeBytes: number; generatedAt: string }> }
      setFinalJoinLibrary(data.entries)
    } catch { /* non-fatal */ }
  }

  const loadFolder1Payslips = async (companyId: string, year: number) => {
    try {
      const res = await fetch(`/api/smartcomprovante/folder1-payslips?companyId=${encodeURIComponent(companyId)}&year=${year}`, { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json() as { payslips: Array<{ filename: string; employeeName: string; uploadId: string; physicalFolderNumber: number; hash?: string }> }
      setFolder1Payslips(data.payslips)
      setFolder1Loaded(true)
    } catch { /* non-fatal */ }
  }

  const generateBatchFinals = async () => {
    if (!workspace || !selectedBaseJoinFilename || !selectedPayslipFilenames.length) return
    const bjMatch = selectedBaseJoinFilename.match(/^BJ_(\d{4})(\d{2})_/)
    const bjYear = bjMatch ? parseInt(bjMatch[1]) : workspace.year
    const bjMonth = bjMatch ? parseInt(bjMatch[2]) : workspace.month
    setBatchGeneratingFinals(true)
    const toGenerate = folder1Payslips.filter((p) => selectedPayslipFilenames.includes(p.filename))
    for (const payslip of toGenerate) {
      await generateCustomFinal(payslip, selectedBaseJoinFilename, bjYear, bjMonth, true)
    }
    void loadFinalJoinLibrary(workspace.company.id)
    setBatchGeneratingFinals(false)
    setSelectedPayslipFilenames([])
  }

  const generateCustomFinal = async (payslip: { filename: string; employeeName: string; uploadId: string; physicalFolderNumber: number }, baseJoinFilename: string, year: number, month: number, skipAutoDownload = false) => {
    if (!workspace) return
    setGeneratingFinalFor(payslip.filename)
    try {
      const res = await fetch('/api/smartcomprovante/actions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate-custom-final',
          companyId: workspace.company.id,
          projectId: selectedProjectId,
          year, month,
          payslipUploadId: payslip.uploadId,
          payslipPhysicalFolder: payslip.physicalFolderNumber,
          payslipFilename: payslip.filename,
          baseJoinFilename,
        }),
      })
      const result = await res.json() as { ok?: boolean; filename?: string; error?: string }
      if (!res.ok || !result.ok) throw new Error(result.error || 'Generation failed')
      if (result.filename && !skipAutoDownload) {
        const a = document.createElement('a')
        a.href = `/api/smartcomprovante/download?type=file&filename=${encodeURIComponent(result.filename)}`
        a.download = result.filename
        document.body.appendChild(a); a.click(); document.body.removeChild(a)
        setDownloadNotice(result.filename)
      }
      if (!skipAutoDownload) void loadFinalJoinLibrary(workspace.company.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Final Join generation failed.')
    } finally {
      setGeneratingFinalFor(null)
    }
  }

  const downloadBaseJoin = (companyId: string, projectId: string, year: number, month: number, filename: string) => {
    const resolvedFilename = filename || `BJ_${year}${String(month).padStart(2, '0')}_${companyId}.pdf`
    const url = `/api/smartcomprovante/download?type=base&companyId=${encodeURIComponent(companyId)}&projectId=${encodeURIComponent(projectId)}&year=${year}&month=${month}`
    const a = document.createElement('a')
    a.href = url
    a.download = resolvedFilename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setDownloadNotice(resolvedFilename)
  }

  const generateAndDownloadBase = async () => {
    if (!workspace) return
    setBusy('generate-base')
    setError('')
    try {
      const response = await fetch('/api/smartcomprovante/actions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate-base', companyId: workspace.company.id, projectId: selectedProjectId, year: workspace.year, month: workspace.month }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Generation failed.')
      setWorkspace(result)
      void refreshCustomerUploads(workspace.company.id)
      const downloadUrl = `/api/smartcomprovante/download?type=base&companyId=${encodeURIComponent(workspace.company.id)}&projectId=${encodeURIComponent(selectedProjectId)}&year=${workspace.year}&month=${workspace.month}`
      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = result.baseJoin?.filename || `BJ_${workspace.year}${String(workspace.month).padStart(2, '0')}_${workspace.company.id}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Generation failed.')
    } finally { setBusy(null) }
  }

  // autoVerifyCode is passed directly so it bypasses stale closure state when called
  // right after setLastTaughtCode (React batches state, the closure wouldn't see the new value yet)
  const navigateReviewTo = useCallback((
    item: NonNullable<typeof reviewItem>['item'],
    clusterKey: string,
    allItems: NonNullable<typeof reviewItem>['allItems'],
    { autoVerifyCode }: { autoVerifyCode?: string } = {},
  ) => {
    setReviewItem({ item, clusterKey, allItems })
    setLastInternalPreviewHash(item.sourceHash)
    setReviewReassignTarget(item.suggestedCode)
    setReviewMark(null)
    setAnchorSaveStatus('idle')
    setReviewScanStatus('idle')
    setReviewScanCandidates([])
    setReviewManualPeriod(null)
    setReviewAnchorText('')
    setReviewMonthFeedbackStatus('idle')
    setReviewVerifyStatus('idle')
    setReviewVerifyResult(null)
    const codeToVerify = autoVerifyCode ?? lastTaughtCode
    if (codeToVerify && item.suggestedCode === codeToVerify) {
      const basename = item.filename.includes('/') ? item.filename.split('/').pop()! : item.filename
      const nextFile = stagedFolderFilesRef.current.find((f) => f.name === basename || f.webkitRelativePath === item.filename)
      if (nextFile && /\.pdf$/i.test(nextFile.name) && workspace) {
        setReviewVerifyStatus('verifying')
        const fd = new FormData()
        fd.set('file', nextFile, nextFile.name)
        fd.set('companyId', workspace.company.id)
        fd.set('documentCode', item.suggestedCode)
        fetch('/api/smartcomprovante/extract-dates', { method: 'POST', body: fd })
          .then((res) => res.json())
          .then((data: { candidates?: DateCandidate[] }) => {
            const top = (data.candidates ?? []).sort((a, b) => b.score - a.score)[0] ?? null
            setReviewVerifyResult(top)
            setReviewVerifyStatus(top ? 'verified' : 'failed')
          })
          .catch(() => setReviewVerifyStatus('failed'))
      }
    }
  }, [lastTaughtCode, workspace])

  const scanReviewDateCandidates = useCallback(async () => {
    if (!reviewItem || !workspace) return
    setReviewScanStatus('loading')
    try {
      let fileToScan = reviewLocalFile
      if (!fileToScan && reviewUploadedFile?.url) {
        const response = await fetch(reviewUploadedFile.url)
        if (!response.ok) throw new Error('Could not load the uploaded file.')
        const blob = await response.blob()
        fileToScan = new File([blob], reviewUploadedFile.name || reviewItem.item.filename, { type: reviewUploadedFile.contentType || blob.type || 'application/pdf' })
      }
      if (!fileToScan) throw new Error('File not available for scanning.')
      const fd = new FormData()
      fd.set('file', fileToScan, fileToScan.name)
      fd.set('companyId', workspace.company.id)
      fd.set('documentCode', reviewItem.item.suggestedCode)
      const res = await fetch('/api/smartcomprovante/extract-dates', { method: 'POST', body: fd })
      const data = await res.json() as { candidates?: DateCandidate[]; error?: string }
      if (!res.ok) throw new Error(data.error || 'Date scan failed.')
      setReviewScanCandidates(data.candidates ?? [])
      setReviewScanStatus(data.candidates?.length ? 'loaded' : 'idle')
    } catch {
      setReviewScanCandidates([])
      setReviewScanStatus('idle')
    }
  }, [reviewItem, reviewLocalFile, reviewUploadedFile, workspace])

  const confirmDetectedMonthAndAdvance = useCallback(async () => {
    if (!reviewItem || !workspace || !reviewItem.item.targetYear || !reviewItem.item.targetMonth) return
    const confirmed = { year: reviewItem.item.targetYear, month: reviewItem.item.targetMonth }
    const clusterKey = reviewItem.clusterKey
    const code = reviewItem.item.suggestedCode
    setReviewMonthFeedbackStatus('confirmed')
    confirmedPeriodsRef.current[reviewItem.item.sourceHash] = confirmed
    setClusterResult((current) => {
      if (!current) return current
      return {
        ...current,
        clusters: current.clusters.map((cluster) => cluster.key !== clusterKey ? cluster : {
          ...cluster,
          items: cluster.items.map((item) => item.sourceHash === reviewItem.item.sourceHash ? { ...item, targetYear: confirmed.year, targetMonth: confirmed.month, confidence: 1, routeSource: 'operator' } : item),
        }),
      }
    })
    // Build freshAllItems first so the search below and navigateReviewTo both use a consistent array
    // (setReviewItem is async — the closure value would still be stale at the findIndex call)
    const freshAllItems = reviewItem.allItems.map((it) => it.sourceHash === reviewItem.item.sourceHash ? { ...it, targetYear: confirmed.year, targetMonth: confirmed.month, confidence: 1, routeSource: 'operator' as const } : it)
    setReviewItem((cur) => cur ? { ...cur, allItems: freshAllItems } : null)
    try {
      await fetch('/api/smartcomprovante/reassign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: workspace.company.id,
          sourceHash: reviewItem.item.sourceHash,
          documentCode: code,
          targetYear: confirmed.year,
          targetMonth: confirmed.month,
        }),
      })
    } catch {
      // Non-fatal: the local confirmation is enough for this session.
    }
    const currentIdx = freshAllItems.findIndex((it) => it.sourceHash === reviewItem.item.sourceHash)
    const nextItem = currentIdx >= 0 ? freshAllItems.slice(currentIdx + 1).find((it) => it.suggestedCode === code) : undefined
    if (nextItem) {
      navigateReviewTo(nextItem, clusterKey, freshAllItems)
    } else {
      setReviewItem(null)
      const snapshot = { ...confirmedPeriodsRef.current }
      confirmedPeriodsRef.current = {}
      void runLocalMonthCluster(clusterKey, snapshot)
    }
  }, [reviewItem, reviewMark, workspace, navigateReviewTo])

  // Shared: save anchor phrase + period, then advance to next same-type file (or run clustering)
  const saveAnchorAndAdvance = useCallback(async (phrase: string, year: number, month: number) => {
    if (!reviewItem || !workspace) return
    const taughtCode = reviewItem.item.suggestedCode
    const clusterKey = reviewItem.clusterKey
    setReviewScanStatus('saving')
    try {
      if (/^[a-f0-9]{64}$/i.test(reviewItem.item.sourceHash)) {
        await fetch('/api/smartcomprovante/reassign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId: workspace.company.id,
            sourceHash: reviewItem.item.sourceHash,
            documentCode: taughtCode,
            targetYear: year,
            targetMonth: month,
          }),
        })
      }
      try {
        await fetch('/api/smartcomprovante/learn-anchor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId: workspace.company.id, documentCode: taughtCode, anchorPhrase: phrase }),
        })
      } catch {
        // Non-fatal: the exact file correction above is the ground truth for this run.
      }
      if (reviewMark) try {
        await fetch('/api/smartcomprovante/learn-mark', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId: workspace.company.id,
            documentCode: taughtCode,
            mark: { page: reviewMark.page, x: reviewMark.x, y: reviewMark.y },
            label: reviewMark.label,
            dateText: reviewMark.dateText,
            contextText: reviewMark.contextText,
          }),
        })
      } catch {
        // Non-fatal: selected text can still be used as this file's confirmed period.
      }
      confirmedPeriodsRef.current[reviewItem.item.sourceHash] = { year, month }
      setLastTaughtCode(taughtCode)
      setClusterResult((current) => {
        if (!current) return current
        return { ...current, clusters: current.clusters.map((c) => c.key !== clusterKey ? c : { ...c, items: c.items.map((ci2) => ci2.sourceHash === reviewItem.item.sourceHash ? { ...ci2, targetYear: year, targetMonth: month, confidence: 1, routeSource: 'operator' } : ci2) }) }
      })
      setReviewScanStatus('saved')
      const freshAllItems = reviewItem.allItems.map((it) => it.sourceHash === reviewItem.item.sourceHash ? { ...it, targetYear: year, targetMonth: month, confidence: 1, routeSource: 'operator' } : it)
      setReviewItem((cur) => cur ? { ...cur, allItems: freshAllItems } : null)
      const currentIdx = freshAllItems.findIndex((it) => it.sourceHash === reviewItem.item.sourceHash)
      const nextItem = freshAllItems.slice(currentIdx + 1).find((it) => it.suggestedCode === taughtCode)
      if (nextItem) {
        navigateReviewTo(nextItem, clusterKey, freshAllItems, { autoVerifyCode: taughtCode })
      } else {
        setReviewItem(null)
        const snapshot = { ...confirmedPeriodsRef.current }
        confirmedPeriodsRef.current = {}
        void runLocalMonthCluster(clusterKey, snapshot)
      }
    } catch { setReviewScanStatus('idle') }
  }, [reviewItem, workspace, navigateReviewTo])

  const handleReassign = async () => {
    if (!reviewItem || !reviewReassignTarget || !clusterResult || !workspace) return
    const targetCluster = clusterResult.clusters.find((c) => c.key === reviewReassignTarget)
    if (!targetCluster) return
    // Persist the operator correction so the next clustering run reads it from cache.
    // Skip for OUTLIERS, which has no real folder code to teach.
    if (reviewReassignTarget !== 'OUTLIERS') {
      try {
        await fetch('/api/smartcomprovante/reassign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId: workspace.company.id,
            sourceHash: reviewItem.item.sourceHash,
            documentCode: targetCluster.code,
            targetYear: reviewItem.item.targetYear,
            targetMonth: reviewItem.item.targetMonth,
          }),
        })
      } catch {
        // Non-fatal: local reassignment still applies for this session.
      }
    }
    setClusterResult((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        clusters: prev.clusters.map((cluster) => {
          if (cluster.key === reviewItem.clusterKey) {
            return { ...cluster, items: cluster.items.filter((i) => i.sourceHash !== reviewItem.item.sourceHash) }
          }
          if (cluster.key === reviewReassignTarget) {
            return { ...cluster, items: [...cluster.items, { ...reviewItem.item, suggestedCode: targetCluster.code, suggestedLabel: targetCluster.label }] }
          }
          return cluster
        }),
      }
    })
    setReviewItem(null)
    setReviewReassignTarget('')
  }

  // confirmedPeriods: hash→{year,month} map of items already confirmed during review — skip re-detection for these
  const runLocalMonthCluster = async (clusterKey: string, confirmedPeriods: Record<string, { year: number; month: number }> = {}) => {
    if (!clusterResult || !workspace) return
    const cluster = clusterResult.clusters.find((item) => item.key === clusterKey)
    if (!cluster) return
    setClusterViewMode('matrix')

    const ptMonthNames = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

    const stagedFiles = stagedFolderFilesRef.current
    const allItemFiles: Array<{ file: File; hash: string; filename: string; hadPeriod: boolean }> = []
    const noFileItems: Array<{ hash: string; filename: string; hadPeriod: boolean; year: number | null; month: number | null }> = []
    for (const item of cluster.items) {
      const basename = item.filename.includes('/') ? item.filename.split('/').pop()! : item.filename
      // Skip items that were already confirmed during the review flow — preserve them
      if (confirmedPeriods[item.sourceHash]) {
        noFileItems.push({ hash: item.sourceHash, filename: basename, hadPeriod: true, year: confirmedPeriods[item.sourceHash].year, month: confirmedPeriods[item.sourceHash].month })
        continue
      }
      const file = stagedFiles.find((f) => f.name === basename || f.webkitRelativePath === item.filename)
      if (file) {
        allItemFiles.push({ file, hash: item.sourceHash, filename: item.filename, hadPeriod: Boolean(item.targetYear && item.targetMonth) })
      } else {
        noFileItems.push({ hash: item.sourceHash, filename: basename, hadPeriod: Boolean(item.targetYear && item.targetMonth), year: item.targetYear ?? null, month: item.targetMonth ?? null })
      }
    }

    // If no files are in memory at all, show existing detections as a read-only log and explain how to re-run
    if (!allItemFiles.length) {
      const existingLog: LocalMonthClusterLogEntry[] = noFileItems.map((item) => {
        if (item.year && item.month) {
          return { filename: item.filename, result: `${ptMonthNames[item.month - 1]} ${item.year} — from initial cluster (rules)`, source: 'rules' as const }
        }
        return { filename: item.filename, result: 'Unknown — re-select folder 0 and re-run to try Groq', source: 'unknown' as const }
      })
      const detectedKeys = new Set(noFileItems.filter((i) => i.year && i.month).map((i) => `${i.year}-${String(i.month).padStart(2, '0')}`))
      setLocalMonthClusters((current) => ({
        ...current,
        [clusterKey]: {
          status: 'done', detected: detectedKeys.size, unknown: noFileItems.filter((i) => !i.year).length,
          detail: 'Files not in memory — re-select folder 0, then run "Group by type" and re-cluster months to correct any wrong detections.',
          log: existingLog,
        },
      }))
      return
    }

    setLocalMonthClusters((current) => ({
      ...current,
      [clusterKey]: { status: 'running', detected: 0, unknown: allItemFiles.length, detail: `Starting Groq reclassification for ${allItemFiles.length} file(s)...` },
    }))

    const log: LocalMonthClusterLogEntry[] = []
    const resolvedPeriods: Array<{ hash: string; year: number; month: number }> = []

    for (let i = 0; i < allItemFiles.length; i++) {
      const { file, hash, filename, hadPeriod } = allItemFiles[i]
      const basename = filename.includes('/') ? filename.split('/').pop()! : filename
      setLocalMonthClusters((current) => ({
        ...current,
        [clusterKey]: {
          status: 'running',
          detected: resolvedPeriods.length,
          unknown: allItemFiles.length - i,
          detail: `Processing ${i + 1}/${allItemFiles.length} · ${basename}`,
          log: [...log],
        },
      }))
      try {
        // Check if the file came from a month-named sub-folder — if so, use that period directly
        if (hadPeriod) {
          const existing = cluster.items.find((item) => item.sourceHash === hash)
          if (existing?.routeSource === 'operator' && existing.targetYear && existing.targetMonth) {
            resolvedPeriods.push({ hash, year: existing.targetYear, month: existing.targetMonth })
            const periodLabel = `${ptMonthNames[existing.targetMonth - 1]} ${existing.targetYear}`
            log.push({ filename: basename, result: `${periodLabel} preserved from confirmed correction`, source: 'rules', hash })
            continue
          }
        }

        const fileParts = (file.webkitRelativePath || '').split('/')
        const subFolderName = fileParts.length >= 3 ? fileParts[1] : null
        const folderHint = subFolderName ? stagedSubFolderHints[subFolderName] : null

        if (folderHint) {
          resolvedPeriods.push({ hash, year: folderHint.year, month: folderHint.month })
          const periodLabel = `${ptMonthNames[folderHint.month - 1]} ${folderHint.year}`
          const corrected = hadPeriod ? ' ✓ corrected' : ''
          log.push({ filename: basename, result: `${periodLabel} via folder name${corrected}`, source: 'rules', hash })
          setClusterResult((current) => {
            if (!current) return current
            return {
              ...current,
              clusters: current.clusters.map((c) => {
                if (c.key !== clusterKey) return c
                return { ...c, items: c.items.map((ci) => ci.sourceHash === hash ? { ...ci, targetYear: folderHint.year, targetMonth: folderHint.month } : ci) }
              }),
            }
          })
        } else {
          const formData = new FormData()
          formData.set('companyId', workspace.company.id)
          formData.set('year', String(workspace.year))
          formData.set('month', String(workspace.month))
          formData.append('files', file, file.name)
          formData.append('hashes', hash)
          formData.append('documentCodes', cluster.code)
          const response = await fetch('/api/smartcomprovante/reclassify-months', { method: 'POST', body: formData })
          const result = await response.json()
          if (!response.ok) throw new Error(result.error || 'Month reclassification failed.')
          const item = (result.results as Array<{ hash: string; year: number | null; month: number | null; reason: string; source: string; phrase?: string | null }>)[0]
          if (item?.year && item?.month) {
            resolvedPeriods.push({ hash, year: item.year, month: item.month })
            const periodLabel = `${ptMonthNames[item.month - 1]} ${item.year}`
            const corrected = hadPeriod ? ' ✓ corrected' : ''
            log.push({ filename: basename, result: `${periodLabel} via ${item.source === 'groq' ? 'Groq ✦' : 'rules'}${corrected}`, source: item.source as LocalMonthClusterLogEntry['source'], hash, phrase: item.phrase ?? null })
            setClusterResult((current) => {
              if (!current) return current
              return {
                ...current,
                clusters: current.clusters.map((c) => {
                  if (c.key !== clusterKey) return c
                  return { ...c, items: c.items.map((ci) => ci.sourceHash === hash ? { ...ci, targetYear: item.year, targetMonth: item.month } : ci) }
                }),
              }
            })
          } else {
            log.push({ filename: basename, result: 'Still unknown — open file and mark the date', source: 'unknown', hash })
          }
        }
      } catch {
        log.push({ filename: basename, result: 'Error processing this file', source: 'error' })
      }
    }

    // Append log entries for no-file items (includes confirmed-from-review items that were skipped above)
    for (const item of noFileItems) {
      if (item.year && item.month) {
        const isConfirmed = Boolean(confirmedPeriods[item.hash])
        log.push({ filename: item.filename, result: `${ptMonthNames[item.month - 1]} ${item.year}${isConfirmed ? ' ✓ confirmed in review' : ' — from initial cluster'}`, source: 'rules' as const })
        resolvedPeriods.push({ hash: item.hash, year: item.year, month: item.month })
      }
    }

    // Final summary — also apply confirmed periods to clusterResult so they aren't lost
    if (Object.keys(confirmedPeriods).length) {
      setClusterResult((current) => {
        if (!current) return current
        return { ...current, clusters: current.clusters.map((c) => c.key !== clusterKey ? c : { ...c, items: c.items.map((ci) => confirmedPeriods[ci.sourceHash] ? { ...ci, targetYear: confirmedPeriods[ci.sourceHash].year, targetMonth: confirmedPeriods[ci.sourceHash].month } : ci) }) }
      })
    }

    const allItems = cluster.items.map((item) => {
      const resolved = resolvedPeriods.find((r) => r.hash === item.sourceHash)
      return resolved ? { ...item, targetYear: resolved.year, targetMonth: resolved.month } : item
    })
    const nowDetected = new Set(allItems.filter((i) => i.targetYear && i.targetMonth).map((i) => `${i.targetYear}-${String(i.targetMonth).padStart(2, '0')}`))
    const nowUnknown = allItems.filter((i) => !i.targetYear || !i.targetMonth).length
    const groqCount = log.filter((e) => e.source === 'groq').length
    const groqNote = groqCount ? ` · ${groqCount} detected by Groq (phrase auto-saved)` : ''
    setLocalMonthClusters((current) => ({
      ...current,
      [clusterKey]: {
        status: 'done',
        detected: nowDetected.size,
        unknown: nowUnknown,
        detail: nowUnknown
          ? `${nowDetected.size} month group(s) found. ${resolvedPeriods.length} resolved${groqNote}, ${nowUnknown} still unknown — open a file and mark the date, then re-run.`
          : `All ${nowDetected.size} month group(s) resolved${groqNote}.`,
        log,
      },
    }))
  }

  const handleSaveMark = async () => {
    if (!reviewItem || !workspace || !reviewMark) return
    const reviewClusterKey = reviewItem.clusterKey
    setAnchorSaveStatus('saving')
    try {
      const response = await fetch('/api/smartcomprovante/learn-mark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: workspace.company.id,
          documentCode: reviewItem.item.suggestedCode,
          mark: { page: reviewMark.page, x: reviewMark.x, y: reviewMark.y },
          label: reviewMark.label || undefined,
          dateText: reviewMark.dateText || undefined,
          contextText: reviewMark.contextText || undefined,
        }),
      })
      if (!response.ok) { const err = await response.json(); throw new Error(err.error || 'Failed') }
      setAnchorSaveStatus('saved')
      setLocalMonthClusters((current) => {
        const existing = current[reviewClusterKey]
        return {
          ...current,
          [reviewClusterKey]: {
            status: 'done',
            detected: existing?.detected ?? 0,
            unknown: existing?.unknown ?? 0,
            detail: 'New month rule saved. Click "Cluster months in this folder" to apply it.',
          },
        }
      })
      setTimeout(() => setAnchorSaveStatus('idle'), 3000)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to save the learned date location.')
      setAnchorSaveStatus('error')
      setTimeout(() => setAnchorSaveStatus('idle'), 3000)
    }
  }

  const loadDateCandidates = async (logKey: string, file: File | null | undefined, documentCode: string) => {
    if (!file || !workspace) return
    setCandidateStates((current) => ({ ...current, [logKey]: { status: 'loading' } }))
    try {
      const formData = new FormData()
      formData.set('file', file, file.name)
      formData.set('companyId', workspace.company.id)
      formData.set('documentCode', documentCode)
      const response = await fetch('/api/smartcomprovante/extract-dates', { method: 'POST', body: formData })
      const data = await response.json() as { candidates?: DateCandidate[]; error?: string }
      if (!response.ok) throw new Error(data.error || 'Extraction failed')
      setCandidateStates((current) => ({ ...current, [logKey]: { status: 'loaded', candidates: data.candidates ?? [] } }))
    } catch {
      setCandidateStates((current) => ({ ...current, [logKey]: { status: 'idle' } }))
    }
  }

  const acceptCandidate = async (logKey: string, clusterKey: string, hash: string, documentCode: string, candidate: DateCandidate) => {
    if (!workspace) return
    setCandidateStates((current) => ({ ...current, [logKey]: { ...current[logKey], status: 'saving' } }))
    try {
      await fetch('/api/smartcomprovante/learn-mark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: workspace.company.id,
          documentCode,
          mark: { page: candidate.page, x: candidate.x, y: candidate.y },
          dateText: candidate.phrase,
          contextText: candidate.context,
        }),
      })
      if (/^[a-f0-9]{64}$/i.test(hash)) {
        await fetch('/api/smartcomprovante/reassign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId: workspace.company.id,
            sourceHash: hash,
            documentCode,
            targetYear: candidate.year,
            targetMonth: candidate.month,
          }),
        })
      }
      setCandidateStates((current) => ({ ...current, [logKey]: { status: 'saved' } }))
      setClusterResult((current) => {
        if (!current) return current
        return {
          ...current,
          clusters: current.clusters.map((c) => {
            if (c.key !== clusterKey) return c
            return { ...c, items: c.items.map((ci) => ci.sourceHash === hash ? { ...ci, targetYear: candidate.year, targetMonth: candidate.month, confidence: 1, routeSource: 'operator' } : ci) }
          }),
        }
      })
      setLocalMonthClusters((current) => {
        const mc = current[clusterKey]
        if (!mc) return current
        return { ...current, [clusterKey]: { ...mc, log: mc.log?.map((entry) => entry.hash === hash ? { ...entry, result: `${candidate.phrase} → selected as period`, source: 'rules' as const } : entry) } }
      })
    } catch {
      setCandidateStates((current) => ({ ...current, [logKey]: { status: 'loaded' } }))
    }
  }

  const saveAnchorPhrase = async (logKey: string, documentCode: string, phrase: string) => {
    if (!workspace) return
    setCandidateStates((current) => ({ ...current, [logKey]: { ...current[logKey], status: 'saving' } }))
    try {
      await fetch('/api/smartcomprovante/learn-anchor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: workspace.company.id, documentCode, anchorPhrase: phrase }),
      })
      setCandidateStates((current) => ({ ...current, [logKey]: { status: 'saved' } }))
    } catch {
      setCandidateStates((current) => ({ ...current, [logKey]: { status: 'loaded' } }))
    }
  }

  const trainRulesFromExamples = async () => {
    if (!workspace) return
    const markTrainingStep = (id: string, status: TrainingStepStatus) => {
      setTrainingSteps((current) => current.map((step) => step.id === id ? { ...step, status } : step))
    }
    setBusy('train-examples')
    setError('')
    setTrainingSteps(initialTrainingSteps.map((step, index) => ({ ...step, status: index === 0 ? 'running' : 'pending' })))
    setTrainingProgress({ active: true, percent: 8, label: 'Input validation: checking uploaded Base/Final Join examples...', done: false })
    const timers = [
      window.setTimeout(() => {
        markTrainingStep('input', 'done')
        markTrainingStep('structure', 'running')
        setTrainingProgress((current) => current?.done ? current : { active: true, percent: 14, label: 'PDF structure: extracting text and mapping section headers 1-13...', done: false })
      }, 500),
      window.setTimeout(() => {
        markTrainingStep('structure', 'done')
        markTrainingStep('ocr', 'running')
        setTrainingProgress((current) => current?.done ? current : { active: true, percent: 28, label: 'OCR advisory: flagging scanned pages and recording scan ratios...', done: false })
      }, 1100),
      window.setTimeout(() => {
        markTrainingStep('ocr', 'done')
        markTrainingStep('tfidf', 'running')
        setTrainingProgress((current) => current?.done ? current : { active: true, percent: 42, label: 'TF-IDF + n-grams: scoring distinctive tokens and phrase patterns per section...', done: false })
      }, 1800),
      window.setTimeout(() => {
        markTrainingStep('tfidf', 'done')
        markTrainingStep('llm', 'running')
        setTrainingProgress((current) => current?.done ? current : { active: true, percent: 57, label: 'LLM enrichment: Gemini batch call extracting key Portuguese descriptors...', done: false })
      }, 2700),
      window.setTimeout(() => {
        markTrainingStep('llm', 'done')
        markTrainingStep('aggregate', 'running')
        setTrainingProgress((current) => current?.done ? current : { active: true, percent: 71, label: 'Cross-example merge: combining required and optional term sets...', done: false })
      }, 4000),
      window.setTimeout(() => {
        markTrainingStep('aggregate', 'done')
        markTrainingStep('validate', 'running')
        setTrainingProgress((current) => current?.done ? current : { active: true, percent: 85, label: 'Self-validation: testing each fingerprint against all others...', done: false })
      }, 5500),
    ]
    try {
      const response = await fetch('/api/smartcomprovante/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'train-examples', companyId: workspace.company.id, projectId: selectedProjectId, year: workspace.year, month: workspace.month }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Training failed.')
      setWorkspace(result)
      setTrainingSteps((current) => current.map((step) => ({ ...step, status: 'done' })))
      setTrainingProgress({ active: false, percent: 100, label: `Training complete. Rules v${result.company?.rulesVersion ?? workspace.company.rulesVersion} are ready for folder 0.`, done: true })
    } catch (cause) {
      setTrainingSteps((current) => current.map((step) => step.status === 'running' ? { ...step, status: 'error' } : step))
      setTrainingProgress({ active: false, percent: 100, label: 'Training failed. Check the message above and try again.', done: true })
      setError(cause instanceof Error ? cause.message : 'Training failed.')
    } finally {
      timers.forEach((timer) => window.clearTimeout(timer))
      setBusy(null)
    }
  }

  const resetSystem = async () => {
    if (!workspace) return
    const companyName = workspace.company.legalName
    if (!window.confirm(`Clean reboot ${companyName}? This will permanently remove this company test workspace, rules, customer uploads, staged files, cached previews, and local session state.`)) return
    if (!window.confirm(`Final confirmation: delete ALL testing data for ${companyName}? This cannot be undone.`)) return
    setBusy('reset-system')
    setError('')
    clearWorkspaceSessionState()
    Object.keys(localStorage).filter((k) => k.startsWith(SC_SESSION_PREFIX)).forEach((k) => localStorage.removeItem(k))
    setSessionRestored(false)
    try {
      const response = await fetch('/api/smartcomprovante/actions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset-company', companyId: workspace.company.id, projectId: selectedProjectId }),
      })
      await readApiJson<{ empty?: boolean; companyId?: string }>(response, 'Could not reset the active company.')
      clearWorkspaceSessionState()
      Object.keys(localStorage).filter((k) => k.startsWith(SC_SESSION_PREFIX)).forEach((k) => localStorage.removeItem(k))
      setSessionRestored(false)
      // Clean wipe — back to the empty onboarding state with no company or project.
      setWorkspace(null)
      setSelectedMonths([])
      const [databaseResponse, projectsResponse] = await Promise.all([
        fetch('/api/smartcomprovante/companies', { cache: 'no-store' }),
        fetch('/api/smartcomprovante/projects', { cache: 'no-store' }),
      ])
      if (databaseResponse.ok) setDatabaseTree(await readApiJson<DatabaseTree>(databaseResponse, 'Could not load companies.'))
      if (projectsResponse.ok) setProjects(await readApiJson<ProjectRecord[]>(projectsResponse, 'Could not load projects.'))
      setView('workspace')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reset the active company.')
    } finally {
      setBusy(null)
    }
  }

  const stageFolderFiles = (files: FileList | null) => {
    if (!workspace) return
    setBusy('stage-folder')
    const totalSelected = files?.length || 0
    setFolderProgress(totalSelected ? { current: 0, total: totalSelected, filename: 'Reading selected folder...' } : null)
    const selectedFiles = Array.from(files || []).filter((file) => /\.(pdf|png|jpe?g)$/i.test(file.name))
    if (!selectedFiles.length) {
      setError('The selected folder does not contain supported PDF, PNG, or JPG files.')
      setStagedFolderFiles([])
      setStagedFolderContext(null)
      stagedFolderFilesRef.current = []
      setBusy(null)
      return
    }
    setError('')
    setStagedFolderFiles(selectedFiles)
    setStagedFolderContext({
      companyId: workspace.company.id,
      companyName: workspace.company.legalName,
      projectId: selectedProjectId,
      rulesVersion: workspace.company.rulesVersion,
    })
    stagedFolderFilesRef.current = selectedFiles
    setClusterResult(null)
    setSelectedPeriodKeys([])
    setPreviewClusterHash(null)

    // Detect month-named sub-folders (e.g. "setembro_2025/", "09/", "October/")
    const hints: Record<string, { year: number; month: number }> = {}
    for (const file of selectedFiles) {
      const parts = (file.webkitRelativePath || '').split('/')
      if (parts.length >= 3) {
        const sub = parts[1]
        if (!(sub in hints)) {
          const period = detectPeriodFromFolderName(sub)
          if (period) hints[sub] = period
        }
      }
    }
    setStagedSubFolderHints(hints)

    setFolderProgress({ current: selectedFiles.length, total: selectedFiles.length, filename: 'Folder staged' })
    if (folderInputRef.current) folderInputRef.current.value = ''
    window.setTimeout(() => {
      setFolderProgress((current) => current?.filename === 'Folder staged' ? null : current)
      setBusy((current) => current === 'stage-folder' ? null : current)
    }, 900)
  }

  const stageCustomerUpload = (files: FileList | null) => {
    if (!files?.length) return
    const selectedFiles = Array.from(files).filter((file) => /\.(pdf|png|jpe?g)$/i.test(file.name))
    if (!selectedFiles.length) {
      setError('The selected folder does not contain supported PDF, PNG, or JPG files.')
      if (customerUploadInputRef.current) customerUploadInputRef.current.value = ''
      return
    }
    setError('')
    const folderNumber = customerCell?.folderNumber ?? 0
    const key = customerUploadKey(folderNumber, customerCell?.month ?? null)
    setCustomerPendingUploads((current) => ({ ...current, [key]: selectedFiles }))
    setCustomerPreviewFile(null)
    setCustomerPreviewUploadedFile(null)
    if (customerUploadInputRef.current) customerUploadInputRef.current.value = ''
  }

  const submitCustomerUpload = async () => {
    if (!customerCell || !workspace) return
    const key = customerUploadKey(customerCell.folderNumber, customerCell.month)
    const selectedFiles = customerPendingUploads[key] || []
    if (!selectedFiles.length) return
    setBusy('submit-upload')
    setError('')
    let persistedUpload: CustomerUpload | null = null
    try {
      const formData = new FormData()
      formData.set('companyId', workspace.company.id)
      formData.set('year', String(customerCell.year || customerActiveYear || workspace.year))
      formData.set('folderNumber', String(customerCell.folderNumber))
      if (customerCell.month) formData.set('month', String(customerCell.month))
      selectedFiles.forEach((file) => formData.append('files', file, file.name))
      const response = await fetch('/api/smartcomprovante/uploads', { method: 'POST', body: formData })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not submit upload.')
      persistedUpload = result.upload as CustomerUpload
      setCustomerSubmittedUploads((current) => [...current.filter((upload) => upload.id !== persistedUpload!.id), persistedUpload!])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not submit upload.')
      setBusy(null)
      return
    }
    setCustomerFolderUploads((current) => ({ ...current, [key]: selectedFiles }))
    setCustomerPendingUploads((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
    if (customerCell.folderNumber === 0) {
      setStagedFolderFiles(selectedFiles)
      setStagedFolderContext({
        companyId: workspace.company.id,
        companyName: workspace.company.legalName,
        projectId: selectedProjectId,
        rulesVersion: workspace.company.rulesVersion,
      })
      stagedFolderFilesRef.current = selectedFiles
      setClusterResult(null)
      setSelectedPeriodKeys([])
      setPreviewClusterHash(null)
      setFolderProgress({ current: selectedFiles.length, total: selectedFiles.length, filename: 'Customer upload submitted' })
      window.setTimeout(() => {
        setFolderProgress((current) => current?.filename === 'Customer upload submitted' ? null : current)
      }, 900)
      setBusy(null)
      setCustomerCell(null)
      return
    }
    const folder = workspace.folders.find((item) => item.number === customerCell.folderNumber)
    if (!folder) {
      setBusy(null)
      return
    }
    const persistedFiles = persistedUpload?.files || []
    const directItems: ClusterItem[] = selectedFiles.map((file, index) => ({
      filename: file.webkitRelativePath || file.name,
      sourceHash: persistedFiles[index]?.hash || `customer-${customerCell.folderNumber}-${file.name}-${file.size}-${file.lastModified}`,
      confidence: 1,
      reason: customerCell.month ? 'Customer uploaded directly into this folder and month.' : 'Customer uploaded directly into this folder without month separation.',
      routeSource: 'customer-folder-upload',
      suggestedCode: folder.code,
      suggestedLabel: folder.label,
      evidence: [customerCell.month ? `Customer selected ${monthNames[customerCell.month - 1]} ${customerCell.year}.` : 'Customer selected this folder/type.'],
      funnelLayer: 'customer_direct_folder',
      funnelTrace: [{ layer: 'customer_direct_folder', status: 'matched', detail: customerCell.month ? 'Customer already selected the folder/type and month.' : 'Customer already selected the folder/type; month is still unknown.' }],
      targetYear: customerCell.month ? customerCell.year : null,
      targetMonth: customerCell.month ?? null,
    }))
    setClusterResult((current) => {
      const existingCluster = (current?.clusters || []).find((cluster) => cluster.folderNumber === customerCell.folderNumber)
      const otherClusters = (current?.clusters || []).filter((cluster) => cluster.folderNumber !== customerCell.folderNumber)
      const mergedItems = [...(existingCluster?.items || [])]
      for (const item of directItems) {
        if (!mergedItems.some((existing) => existing.sourceHash === item.sourceHash)) mergedItems.push(item)
      }
      const clusters = [
        ...otherClusters,
        { key: folder.code, folderNumber: folder.number, code: folder.code, label: folder.label, averageConfidence: 1, items: mergedItems },
      ].sort((a, b) => (a.folderNumber || 99) - (b.folderNumber || 99))
      const totalItems = clusters.reduce((sum, cluster) => sum + cluster.items.length, 0)
      return {
        runId: current?.runId || `customer-direct-${Date.now()}`,
        totalItems,
        groupedItems: totalItems,
        outliers: current?.outliers || 0,
        reportPath: current?.reportPath,
        reportJsonPath: current?.reportJsonPath,
        detectedPeriods: current?.detectedPeriods,
        funnelSummary: current?.funnelSummary,
        periodSignals: current?.periodSignals,
        clusters,
      }
    })
    setLocalMonthClusters((current) => {
      const next = { ...current }
      delete next[folder.code]
      return next
    })
    setBusy(null)
    setCustomerCell(null)
  }

  const clearStagedFolder = () => {
    setStagedFolderFiles([])
    setStagedFolderContext(null)
    stagedFolderFilesRef.current = []
    setFolderProgress(null)
    setClusterResult(null)
    setSelectedPeriodKeys([])
    setPreviewClusterHash(null)
    setStagedSubFolderHints({})
  }

  const stageSubmittedFolder0Uploads = async () => {
    if (!workspace) return null
    const year = internalActiveYear ?? workspace.year
    const uploads = customerSubmittedUploads.filter((upload) =>
      upload.companyId === workspace.company.id
      && upload.year === year
      && upload.folderNumber === 0
      && upload.status !== 'archived'
    )
    const uploadedFiles = uploads.flatMap((upload) => upload.files).filter((file) => Boolean(file.url))
    if (!uploadedFiles.length) {
      setError('No Folder 0 files are available to group. Select Folder 0 locally or refresh customer submissions.')
      return null
    }
    setBusy('stage-folder0-submissions')
    setError('')
    setFolderProgress({ current: 0, total: uploadedFiles.length, filename: 'Loading submitted Folder 0 files...' })
    try {
      const files: File[] = []
      for (let index = 0; index < uploadedFiles.length; index += 1) {
        const file = uploadedFiles[index]
        setFolderProgress({ current: index + 1, total: uploadedFiles.length, filename: `Loading ${file.name}` })
        const response = await fetch(file.url!, { cache: 'no-store' })
        if (!response.ok) throw new Error(`Could not load ${file.name} from submitted uploads.`)
        const blob = await response.blob()
        files.push(new File([blob], file.name, { type: file.contentType || blob.type || 'application/pdf' }))
      }
      const context = {
        companyId: workspace.company.id,
        companyName: workspace.company.legalName,
        projectId: selectedProjectId,
        rulesVersion: workspace.company.rulesVersion,
      }
      setStagedFolderFiles(files)
      setStagedFolderContext(context)
      stagedFolderFilesRef.current = files
      setFolderProgress({ current: files.length, total: files.length, filename: 'Submitted Folder 0 files loaded' })
      return { files, context }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load submitted Folder 0 files.')
      return null
    } finally {
      setBusy(null)
    }
  }

  const runFolderGrouping = async () => {
    const canUseLocalFolder0 = Boolean(
      workspace
      && stagedFolderContext
      && stagedFolderContext.companyId === workspace.company.id
      && stagedFolderContext.projectId === selectedProjectId
    )
    const localFiles = canUseLocalFolder0
      ? (stagedFolderFilesRef.current.length ? stagedFolderFilesRef.current : stagedFolderFiles)
      : []
    if (localFiles.length) {
      await clusterStagedFolder()
      return
    }
    const staged = await stageSubmittedFolder0Uploads()
    if (!staged) return
    await clusterStagedFolder({ filesOverride: staged.files, contextOverride: staged.context })
  }

  const clusterStagedFolder = async (options?: {
    quiet?: boolean
    filesOverride?: File[]
    contextOverride?: NonNullable<typeof stagedFolderContext>
  }) => {
    const filesToCluster = options?.filesOverride ?? (stagedFolderFilesRef.current.length ? stagedFolderFilesRef.current : stagedFolderFiles)
    const contextToUse = options?.contextOverride ?? stagedFolderContext
    if (!workspace) return null
    if (filesToCluster.length === 0) {
      setError('Folder 0 is not staged yet. Select folder 0 first, then run Step 2a.')
      return null
    }
    if (
      !contextToUse
      || contextToUse.companyId !== workspace.company.id
      || contextToUse.projectId !== selectedProjectId
    ) {
      setError('Folder 0 was staged under another company/project. Clear it and select folder 0 again for the active company.')
      return null
    }
    setBusy('cluster-folder')
    setError('')
    setFolderProgress({ current: 0, total: filesToCluster.length, filename: 'Sending folder 0 to clustering...' })
    if (!options?.quiet) {
      setClusterResult(null)
      setPreviewClusterHash(null)
    }
    try {
      const formData = new FormData()
      formData.set('companyId', workspace.company.id)
      formData.set('projectId', selectedProjectId)
      formData.set('year', String(workspace.year))
      formData.set('month', String(workspace.month))
      for (let index = 0; index < filesToCluster.length; index += 1) {
        const file = filesToCluster[index]
        formData.append('files', file, file.name)
        formData.append('relativePaths', file.webkitRelativePath || file.name)
      }
      // Yield so React flushes the batch above and shows the "Sending..." state before the long fetch
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
      setFolderProgress({ current: 0, total: filesToCluster.length, filename: `Analyzing ${filesToCluster.length} file(s) on server — may take a minute...` })
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
      const response = await fetch('/api/smartcomprovante/cluster', { method: 'POST', body: formData })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Clustering failed.')
      const nextCluster = result as ClusterResult
      setClusterResult(nextCluster)
      setSelectedPeriodKeys((nextCluster.detectedPeriods || []).map((period) => period.key))
      setFolderProgress({ current: filesToCluster.length, total: filesToCluster.length, filename: `Clustered ${filesToCluster.length} file(s)` })
      // Refresh upload statuses — cluster route marks matching uploads as grouped
      void refreshCustomerUploads(workspace.company.id)
      return nextCluster
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Clustering failed.')
      return null
    } finally {
      setBusy(null)
      window.setTimeout(() => {
        setFolderProgress((current) => current?.filename.startsWith('Clustered ') ? null : current)
      }, 1200)
    }
  }

  const classifySelectedFiles = async (files: FileList | File[] | null, source: 'folder' | 'files' = 'files') => {
    if (!workspace || !files?.length) return
    if (source === 'folder' && !Array.isArray(files)) {
      stageFolderFiles(files)
      return
    }
    if (source === 'folder' && Array.isArray(files) && !clusterResult) {
      await clusterStagedFolder()
      return
    }
    const selectedFiles = Array.from(files).filter((file) => /\.(pdf|png|jpe?g)$/i.test(file.name))
    if (!selectedFiles.length) {
      setError('The selected folder contains no supported PDF, PNG, or JPG files.')
      return
    }
    setBusy(source === 'folder' ? 'classify-folder' : 'classify-files')
    setError('')
    try {
      let result: MonthlyWorkspace | null = null
      for (let index = 0; index < selectedFiles.length; index += 1) {
        const file = selectedFiles[index]
        setFolderProgress({ current: index + 1, total: selectedFiles.length, filename: file.webkitRelativePath || file.name })
        const formData = new FormData()
        formData.set('companyId', workspace.company.id)
        formData.set('projectId', selectedProjectId)
        formData.set('year', String(workspace.year))
        formData.set('month', String(workspace.month))
        formData.set('mode', source === 'folder' || index > 0 ? 'append' : 'replace')
        formData.set('batchPosition', String(index + 1))
        formData.set('batchTotal', String(selectedFiles.length))
        formData.append('files', file, file.name)
        formData.append('relativePaths', file.webkitRelativePath || file.name)
        const response = await fetch('/api/smartcomprovante/classify', { method: 'POST', body: formData })
        const responseBody = await response.json()
        if (!response.ok) throw new Error(`${file.name}: ${responseBody.error || 'Classification failed.'}`)
        result = responseBody as MonthlyWorkspace
        setWorkspace(result)
      }
      if (!result) return
      setReviewDestinations(Object.fromEntries(result.reviews.map((review) => [review.id, review.proposedCode])))
      setView(result.reviews.some((review) => review.status === 'pending') ? 'review' : 'workspace')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Classification failed.') }
    finally {
      setBusy(null)
      setFolderProgress(null)
      if (source === 'folder') setStagedFolderFiles([])
      if (uploadInputRef.current) uploadInputRef.current.value = ''
      if (folderInputRef.current) folderInputRef.current.value = ''
    }
  }

  const uploadJoinReference = async (kind: 'base_join' | 'final_join', files: FileList | null) => {
    const selectedFiles = Array.from(files || []).filter((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))
    if (!workspace || selectedFiles.length === 0) return
    const workspaceForUpload = workspace
    const file = selectedFiles[0]
    setBusy(`reference-${kind}`)
    setError('')
    setTrainingProgress(null)
    setTrainingSteps(initialTrainingSteps)
    try {
      let multiResult: MonthlyWorkspace | null = null
      for (const referenceFile of selectedFiles) {
        const formData = new FormData()
        formData.set('companyId', workspace.company.id)
        formData.set('projectId', selectedProjectId)
        formData.set('year', String(workspace.year))
        formData.set('month', String(workspace.month))
        formData.set('kind', kind)
        formData.set('file', referenceFile, referenceFile.name)
        const response = await fetch('/api/smartcomprovante/references', { method: 'POST', body: formData })
        const responseBody = await response.json()
        if (!response.ok) throw new Error(`${referenceFile.name}: ${responseBody.error || 'Could not save reference.'}`)
        multiResult = responseBody as MonthlyWorkspace
      }
      if (multiResult) setWorkspace(multiResult)
      return
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save reference.')
    } finally {
      setBusy(null)
      if (baseReferenceInputRef.current) baseReferenceInputRef.current.value = ''
      if (finalReferenceInputRef.current) finalReferenceInputRef.current.value = ''
    }
  }

  const createCompany = async () => {
    setBusy('create-company')
    setError('')
    try {
      const response = await fetch('/api/smartcomprovante/companies', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...companyForm, projectId: selectedProjectId }),
      })
      const result = await readApiJson<MonthlyWorkspace & { error?: string }>(response, 'Could not create company.')
      if (!response.ok) throw new Error(result.error)
      clearWorkspaceSessionState()
      setWorkspace(result)
      const databaseResponse = await fetch('/api/smartcomprovante/companies', { cache: 'no-store' })
      if (databaseResponse.ok) setDatabaseTree(await readApiJson<DatabaseTree>(databaseResponse, 'Could not load companies.'))
      setShowCompanyDialog(false)
      setCompanyForm({ legalName: '', nif: '', code: '' })
      setView('workspace')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create company.') }
    finally { setBusy(null) }
  }

  const createProject = async () => {
    setBusy('create-project')
    setError('')
    try {
      const response = await fetch('/api/smartcomprovante/projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(projectForm),
      })
      const result = await readApiJson<ProjectRecord & { error?: string }>(response, 'Could not create project.')
      if (!response.ok) throw new Error(result.error)
      setProjects((current) => [...current, result as ProjectRecord])
      setSelectedProjectId((result as ProjectRecord).id)
      setShowProjectDialog(false)
      setProjectForm({ name: '', code: '' })
      void load((result as ProjectRecord).id)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create project.') }
    finally { setBusy(null) }
  }

  const exitWorkspace = () => {
    clearWorkspaceSessionState()
    setWorkspace(null)
    setView('workspace')
    setError('')
  }

  const saveKey = async () => {
    if (!window.smartComprovante) return
    setBusy('save-key')
    const result = await window.smartComprovante.saveGeminiKey(keyValue)
    if (!result.ok) setError(result.error || 'Could not save the API key.')
    else { setKeyValue(''); setCredential(await window.smartComprovante.credentialStatus()) }
    setBusy(null)
  }

  const deleteKey = async () => {
    if (!window.smartComprovante) return
    setBusy('delete-key')
    await window.smartComprovante.deleteGeminiKey()
    setCredential(await window.smartComprovante.credentialStatus())
    setBusy(null)
  }

  const approvedFolders = useMemo(() => workspace?.folders.filter((folder) => folder.status === 'approved' || folder.status === 'passed').length || 0, [workspace])
  const pendingReviews = workspace?.reviews.filter((review) => review.status === 'pending').length || 0
  const currentFinals = workspace?.employees.filter((employee) => employee.finalStatus === 'current').length || 0
  const baseReferenceCount = (workspace?.joinReferences || []).filter((item) => item.kind === 'base_join').length
  const finalReferenceCount = (workspace?.joinReferences || []).filter((item) => item.kind === 'final_join').length
  const referenceGuideReady = baseReferenceCount > 0 && finalReferenceCount > 0
  const hasElectronBridge = typeof window !== 'undefined' && Boolean(window.smartComprovante)
  const activeProviderName = provider?.provider === 'groq' ? 'Groq' : 'Gemini'
  const learningCoverage = useMemo(() => {
    if (!workspace) return { final: new Map<number, any[]>(), base: new Map<number, any[]>() }
    const build = (kind: 'base_join' | 'final_join') => {
      const map = new Map<number, any[]>()
      for (const reference of workspace.joinReferences || []) {
        if (reference.kind !== kind) continue
        const enrichedByLabel = new Map<string, any>()
        for (const es of (reference as any).enrichedSections || []) {
          enrichedByLabel.set(es.label, es)
        }
        for (const section of reference.learnedSections || []) {
          const current = map.get(section.folder_number) || []
          current.push({ ...section, enriched: enrichedByLabel.get(section.label), filename: reference.filename })
          map.set(section.folder_number, current)
        }
      }
      return map
    }
    return { final: build('final_join'), base: build('base_join') }
  }, [workspace])

  const dialogs = (
    <>
      {showProjectDialog ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-center justify-between"><div><h2 className="text-lg font-bold">Create new project</h2><p className="mt-1 text-sm text-slate-500">A project groups one or more companies and their monthly workspaces.</p></div><button onClick={() => setShowProjectDialog(false)} className="rounded-lg p-2 hover:bg-slate-100"><X className="h-5 w-5" /></button></div><div className="mt-6 space-y-4"><label className="block text-sm font-semibold">Project name<input value={projectForm.name} onChange={(event) => setProjectForm({ ...projectForm, name: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 font-normal outline-none focus:border-teal-600" placeholder="e.g. Innovation 2026" /></label><label className="block text-sm font-semibold">Short code<input value={projectForm.code} onChange={(event) => setProjectForm({ ...projectForm, code: event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12) })} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 font-normal outline-none focus:border-teal-600" placeholder="PROJ-001" /></label></div><div className="mt-6 flex justify-end gap-2"><button onClick={() => setShowProjectDialog(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold">Cancel</button><button onClick={() => void createProject()} disabled={!projectForm.name || !projectForm.code || Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl bg-[#176b61] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy === 'create-project' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Create project</button></div></div></div> : null}

      {showCompanyDialog ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"><div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-center justify-between"><div><h2 className="text-lg font-bold">Create new company</h2><p className="mt-1 text-sm text-slate-500">A v1 rules JSON will be created automatically. Assigned to project: {projects.find((p) => p.id === selectedProjectId)?.name || selectedProjectId}.</p></div><button onClick={() => setShowCompanyDialog(false)} className="rounded-lg p-2 hover:bg-slate-100"><X className="h-5 w-5" /></button></div><div className="mt-6 space-y-4"><label className="block text-sm font-semibold">Legal name<input value={companyForm.legalName} onChange={(event) => setCompanyForm({ ...companyForm, legalName: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 font-normal outline-none focus:border-teal-600" placeholder="e.g. Company, LDA" /></label><div className="grid grid-cols-2 gap-4"><label className="block text-sm font-semibold">NIF<input value={companyForm.nif} onChange={(event) => setCompanyForm({ ...companyForm, nif: event.target.value.replace(/\D/g, '').slice(0, 9) })} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 font-normal outline-none focus:border-teal-600" placeholder="9 digits" /></label><label className="block text-sm font-semibold">Short code<input value={companyForm.code} onChange={(event) => setCompanyForm({ ...companyForm, code: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) })} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 font-normal outline-none focus:border-teal-600" placeholder="COMPANY" /></label></div></div><div className="mt-6 flex justify-end gap-2"><button onClick={() => setShowCompanyDialog(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold">Cancel</button><button onClick={() => void createCompany()} disabled={!companyForm.legalName || companyForm.nif.length !== 9 || !companyForm.code || Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl bg-[#176b61] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy === 'create-company' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Create company</button></div></div></div> : null}
    </>
  )

  if (!workspace && busy === 'loading') return <div className="flex min-h-screen items-center justify-center bg-slate-50"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div>
  if (!workspace) return (
    <div className="min-h-screen bg-[#f5f7f8] text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 py-16">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-teal-400/15 p-2.5"><FileCheck2 className="h-7 w-7 text-teal-600" /></div>
          <div><p className="text-lg font-bold tracking-tight">SmartComprovante</p><p className="text-xs text-slate-500">HR comprovante processing</p></div>
        </div>
        <h1 className="mt-8 text-2xl font-bold">Start a new workspace</h1>
        <p className="mt-2 max-w-md text-center text-sm text-slate-500">Create a project, then add a company under it. The SmartComprovante module opens automatically once a company exists.</p>
        {error ? <div className="mt-5 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><AlertTriangle className="h-4 w-4" />{error}</div> : null}
        <div className="mt-8 grid w-full gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-600 text-xs font-bold text-white">1</span><p className="font-semibold">Project</p></div>
            <p className="mt-2 text-sm text-slate-500">{projects.length ? `${projects.length} project(s) available.` : 'No projects yet. Create the first one.'}</p>
            {projects.length ? (
              <div className="mt-3 space-y-1">
                {projects.map((project) => (
                  <button key={project.id} onClick={() => setSelectedProjectId(project.id)} className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm ${selectedProjectId === project.id ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-slate-200 hover:bg-slate-50'}`}>
                    <span className="truncate font-medium">{project.name}</span><span className="font-mono text-[11px] text-slate-400">{project.code}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <button onClick={() => setShowProjectDialog(true)} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold hover:bg-slate-50"><Plus className="h-4 w-4" />New project</button>
          </div>
          <div className={`rounded-2xl border bg-white p-5 shadow-sm ${projects.length ? 'border-slate-200' : 'border-slate-100 opacity-60'}`}>
            <div className="flex items-center gap-2"><span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white ${projects.length ? 'bg-teal-600' : 'bg-slate-300'}`}>2</span><p className="font-semibold">Company</p></div>
            {databaseTree?.companies?.length ? (
              <>
                <p className="mt-2 text-sm text-slate-500">Reopen an existing company:</p>
                <div className="mt-2 space-y-1">
                  {databaseTree.companies.map((node) => (
                    <button key={node.company.id} onClick={() => void openCompany(node.company.id, (node.company as { projectId?: string }).projectId || selectedProjectId)} className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:border-teal-400 hover:bg-teal-50">
                      <span className="truncate font-medium">{node.company.legalName}</span><span className="font-mono text-[11px] text-slate-400">{node.company.code}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-2 text-sm text-slate-500">{projects.length ? `Will be created under "${projects.find((p) => p.id === selectedProjectId)?.name || projects[0]?.name}".` : 'Create a project first to enable this step.'}</p>
            )}
            <button onClick={() => { if (!projects.some((p) => p.id === selectedProjectId) && projects[0]) setSelectedProjectId(projects[0].id); setShowCompanyDialog(true) }} disabled={!projects.length} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#176b61] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#12584f] disabled:opacity-40"><Plus className="h-4 w-4" />New company</button>
          </div>
        </div>
      </div>
      {dialogs}
    </div>
  )

  const nav = [
    { id: 'workspace' as const, label: 'Monthly workspace', icon: LayoutDashboard },
    { id: 'settings' as const, label: 'Settings', icon: Settings },
  ]

  const customerFolders = [
    { number: 0, code: 'INBOX', label: 'Folder 0 · Documents to submit / classify' },
    ...workspace.folders.map((folder) => ({ number: folder.number, code: folder.code, label: folder.label })),
  ]
  const customerMonthStatus = (folderNumber: number, month: number) => {
    const isActiveMonth = month === workspace.month && (selectedYear ?? workspace.year) === workspace.year
    if (!isActiveMonth) return { label: 'Empty', className: 'border-slate-200 bg-white text-slate-400' }
    if (folderNumber === 0 && (stagedFolderFiles.length || workspace.intakeCount)) return { label: 'New files', className: 'border-blue-200 bg-blue-50 text-blue-700' }
    const folder = workspace.folders.find((item) => item.number === folderNumber)
    if (folder?.status === 'approved' || folder?.status === 'passed') return { label: 'Used', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
    if (folder?.status === 'detected' || folder?.status === 'review') return { label: 'Uploaded', className: 'border-amber-200 bg-amber-50 text-amber-700' }
    return { label: 'Empty', className: 'border-slate-200 bg-white text-slate-400' }
  }
  const customerCellFiles = customerCell
    ? customerPendingUploads[customerUploadKey(customerCell.folderNumber, customerCell.month)] || customerFolderUploads[customerUploadKey(customerCell.folderNumber, customerCell.month)] || (customerCell.folderNumber === 0 && !customerCell.month ? stagedFolderFiles : [])
    : []
  const customerCellSubmittedFiles = customerCell
    ? customerYearUploads.filter((upload) => upload.folderNumber === customerCell.folderNumber && (upload.month ?? null) === (customerCell.month ?? null) && upload.status === 'submitted').flatMap((upload) => upload.files)
    : []
  const customerCellIsProcessing = customerCell
    ? customerYearUploads.some((u) => u.folderNumber === customerCell.folderNumber && (u.status === 'grouped' || u.status === 'month_detected' || u.status === 'approved' || u.status === 'archived'))
    : false
  const customerCellHasPending = Boolean(customerCell && customerPendingUploads[customerUploadKey(customerCell.folderNumber, customerCell.month)]?.length)
  const internalFolder0SubmittedFileCount = customerSubmittedUploads
    .filter((upload) => upload.companyId === workspace.company.id && upload.year === (internalActiveYear ?? workspace.year) && upload.folderNumber === 0 && upload.status !== 'archived')
    .reduce((total, upload) => total + upload.files.length, 0)
  const submittedFileCount = customerYearUploads.filter((u) => u.status === 'submitted').reduce((total, upload) => total + upload.files.length, 0)
  const receivedFileCount = Math.max(stagedFolderFiles.length, submittedFileCount, internalFolder0SubmittedFileCount)
  const groupedItems = clusterResult?.clusters.flatMap((cluster) => cluster.items) ?? []
  const groupedFileCount = groupedItems.filter((item) => item.suggestedCode !== 'UNKNOWN').length
  const needsReviewCount = groupedItems.filter((item) => !item.targetYear || !item.targetMonth || item.confidence < 0.7).length
  const monthsReadyCount = new Set(groupedItems.filter((item) => item.targetYear && item.targetMonth).map((item) => `${item.targetYear}-${item.targetMonth}`)).size
  const workflowSteps = [
    { id: 'receive', label: 'Receive files', count: receivedFileCount, done: receivedFileCount > 0, active: receivedFileCount === 0 },
    { id: 'group', label: 'Group by folder', count: groupedFileCount, done: Boolean(clusterResult && groupedFileCount > 0), active: receivedFileCount > 0 && !clusterResult },
    { id: 'months', label: 'Detect months', count: monthsReadyCount, done: monthsReadyCount > 0 && needsReviewCount === 0, active: Boolean(clusterResult && groupedFileCount > 0 && monthsReadyCount === 0), attention: Boolean(clusterResult && groupedFileCount > 0 && needsReviewCount > 0) },
    { id: 'review', label: 'Review exceptions', count: needsReviewCount, done: Boolean(clusterResult && needsReviewCount === 0 && groupedFileCount > 0), active: needsReviewCount > 0, attention: needsReviewCount > 0 },
    { id: 'generate', label: 'Generate joins', count: selectedPeriods.length, done: false, active: Boolean(monthsReadyCount > 0 && needsReviewCount === 0) },
  ]
  return (
    <div className="min-h-screen bg-[#f5f7f8] text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-20 flex w-64 flex-col border-r border-slate-200 bg-[#112d2a] text-white">
        <div className="flex h-20 items-center gap-3 border-b border-white/10 px-6">
          <div className="rounded-xl bg-teal-400/15 p-2"><FileCheck2 className="h-6 w-6 text-teal-300" /></div>
          <div><p className="font-semibold tracking-tight">SmartComprovante</p><p className="text-xs text-teal-100/60">Operational prototype</p></div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          {nav.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setView(id)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition ${view === id ? 'bg-white/12 text-white' : 'text-teal-50/70 hover:bg-white/7 hover:text-white'}`}>
              <Icon className="h-4 w-4" />
              <span className="flex-1">{label}</span>
            </button>
          ))}
          <button onClick={exitWorkspace} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-teal-50/70 transition hover:bg-white/7 hover:text-white">
            <X className="h-4 w-4" />
            <span className="flex-1">Exit workspace</span>
          </button>
          <div className="my-4 border-t border-white/10" />
          <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-teal-100/40">Projects</p>
          {projects.map((project) => (
            <button key={project.id} onClick={() => { clearWorkspaceSessionState(); setWorkspace(null); setSelectedProjectId(project.id); void load(project.id) }} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${selectedProjectId === project.id ? 'bg-white/12 text-white' : 'text-teal-50/70 hover:bg-white/7 hover:text-white'}`}>
              <Search className="h-4 w-4 shrink-0" /><span className="flex-1 truncate">{project.name}</span><span className="rounded text-[10px] font-mono text-teal-100/40">{project.code}</span>
            </button>
          ))}
          <button onClick={() => setShowProjectDialog(true)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-teal-50/40 hover:bg-white/7 hover:text-white">
            <Plus className="h-4 w-4" /><span>New project</span>
          </button>
          <div className="my-4 border-t border-white/10" />
          <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-teal-100/40">Companies</p>
          {(databaseTree?.companies || []).map((node) => (
            <button key={node.company.id} onClick={() => void openCompany(node.company.id, (node.company as { projectId?: string }).projectId || selectedProjectId)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${workspace?.company.id === node.company.id ? 'bg-white/12 text-white' : 'text-teal-50/70 hover:bg-white/7 hover:text-white'}`}>
              <Building2 className="h-4 w-4 shrink-0" /><span className="flex-1 truncate">{node.company.legalName}</span><span className="rounded text-[10px] font-mono text-teal-100/40">{node.company.code}</span>
            </button>
          ))}
          {!(databaseTree?.companies || []).length ? <p className="px-3 py-1 text-xs text-teal-50/40">No companies yet.</p> : null}
          <button onClick={() => setShowCompanyDialog(true)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-teal-50/40 hover:bg-white/7 hover:text-white">
            <Plus className="h-4 w-4" /><span>New company</span>
          </button>
        </nav>
        <div className="m-4 rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-teal-100"><ShieldCheck className="h-4 w-4 text-teal-300" /> Local data protected</div>
          <p className="mt-2 text-xs leading-5 text-teal-50/55">{activeProviderName} cloud only with explicit consent. Rules v{workspace.company.rulesVersion}.</p>
        </div>
      </aside>

      <main className="ml-64 min-h-screen">
        <header className="sticky top-0 z-10 flex h-20 items-center justify-between border-b border-slate-200 bg-white/95 px-8 backdrop-blur">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500"><span>{workspace.program.name}</span><span>/</span><span>{workspace.project.code}</span></div>
            <h1 className="mt-1 text-lg font-bold">{workspace.company.legalName}</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-1 text-sm font-semibold">
              <button onClick={() => setAppSide('internal')} className={`rounded-lg px-3 py-1.5 transition ${appSide === 'internal' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>Internal view</button>
              <button onClick={() => setAppSide('customer')} className={`rounded-lg px-3 py-1.5 transition ${appSide === 'customer' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>Customer view</button>
            </div>
            <div className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${provider?.configured || credential?.configured ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}><Bot className="h-4 w-4" />{activeProviderName} · {provider?.configured || credential?.configured ? 'Configured' : 'Demo mode'}</div>
            <button onClick={() => void resetSystem()} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700 shadow-sm hover:bg-rose-100 disabled:opacity-50">{busy === 'reset-system' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Reboot company test</button>
            <button onClick={() => setShowProjectDialog(true)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"><Plus className="h-4 w-4" />New project</button>
            <button onClick={() => setShowCompanyDialog(true)} className="inline-flex items-center gap-2 rounded-xl bg-[#176b61] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#12584f]"><Plus className="h-4 w-4" />New company</button>
          </div>
        </header>

        <div className="mx-auto max-w-[1500px] p-8">
          {error ? <div className="mb-5 flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{error}</span><button onClick={() => setError('')}><X className="h-4 w-4" /></button></div> : null}
          {downloadNotice ? (
            <div className="mb-5 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <div className="flex items-center gap-3">
                <Download className="h-4 w-4 shrink-0 text-emerald-700" />
                <div>
                  <p className="font-bold">File saved: <span className="font-mono font-normal">{downloadNotice}</span></p>
                  <p className="mt-0.5 text-xs text-emerald-700">Check your browser&apos;s <strong>Downloads folder</strong> (usually <code>C:\Users\…\Downloads\</code> on Windows). You can also open it from the browser download bar at the bottom of the screen.</p>
                </div>
              </div>
              <button onClick={() => setDownloadNotice(null)} className="ml-4 shrink-0 rounded-lg border border-emerald-200 bg-white p-1.5 hover:bg-emerald-100"><X className="h-4 w-4 text-slate-500" /></button>
            </div>
          ) : null}

          {appSide === 'customer' ? (
            <section className="space-y-6">
              <input
                ref={customerUploadInputRef}
                type="file"
                multiple
                accept="application/pdf,image/jpeg,image/png"
                className="hidden"
                {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                onChange={(event) => { customerUploadOpenedForMonthRef.current = false; stageCustomerUpload(event.target.files) }}
              />

              {customerActiveYear === null ? (
                /* Year picker — customer must pick a year before seeing the folder grid */
                <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
                  <p className="text-xs font-bold uppercase tracking-widest text-teal-700">Step 1</p>
                  <h3 className="mt-1 text-xl font-bold">Select a year to submit documents</h3>
                  <p className="mt-1 text-sm text-slate-500">{workspace.company.legalName} · NIF {workspace.company.nif}. Choose the payroll year or start a new one.</p>
                  {(() => {
                    const submittedYears = new Map<number, { count: number; lastDate: string }>()
                    for (const u of customerSubmittedUploads) {
                      const existing = submittedYears.get(u.year) || { count: 0, lastDate: '' }
                      submittedYears.set(u.year, { count: existing.count + u.files.length, lastDate: u.submittedAt > existing.lastDate ? u.submittedAt : existing.lastDate })
                    }
                    const currentYear = new Date().getFullYear()
                    // Always include currentYear-1, currentYear, currentYear+1 plus any years with actual submissions
                    const allYearSet = new Set([...Array.from(submittedYears.keys()), currentYear - 1, currentYear, currentYear + 1])
                    const availableYears = Array.from(allYearSet).sort((a, b) => a - b)
                    return (
                      <div className="mt-6 flex flex-wrap gap-4">
                        {availableYears.map((year) => {
                          const info = submittedYears.get(year)
                          const isCurrent = year === currentYear
                          return (
                            <button
                              key={year}
                              type="button"
                              onClick={() => setCustomerActiveYear(year)}
                              className={`flex min-w-[140px] flex-col items-center gap-1 rounded-2xl border-2 p-5 text-center transition hover:-translate-y-0.5 hover:shadow-md ${isCurrent ? 'border-teal-500 bg-teal-50' : info ? 'border-slate-200 bg-white hover:border-teal-300' : 'border-dashed border-slate-300 bg-slate-50 hover:border-teal-400 hover:bg-teal-50'}`}
                            >
                              <span className="text-2xl font-extrabold text-slate-800">{year}</span>
                              {isCurrent && <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-bold text-teal-700">Current year</span>}
                              {info ? <span className="text-xs text-slate-500">{info.count} file{info.count !== 1 ? 's' : ''} · {new Date(info.lastDate).toLocaleDateString()}</span> : <span className="text-xs text-slate-400">No files yet</span>}
                            </button>
                          )
                        })}
                      </div>
                    )
                  })()}
                </div>
              ) : (
                /* Folder grid for the selected year */
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <h3 className="text-lg font-bold">Submit documents</h3>
                      <p className="mt-1 text-sm text-slate-500">{workspace.company.legalName} · NIF {workspace.company.nif}. Choose the best destination. If not sure, use Inbox and the internal team will group the files.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => setCustomerActiveYear(null)} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">← Change year</button>
                      <span className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-extrabold text-teal-700">{customerActiveYear}</span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-500">{submittedFileCount} file(s) submitted</span>
                    </div>
                  </div>
                  <div className="mt-5 space-y-6">
                    {(() => {
                      const sections: Array<{ label: string; folderNumbers: number[]; accent: string; iconBg: string; cardBg: string; borderColor: string; sectionBg: string; accentBar: string }> = [
                        { label: 'Inbox', folderNumbers: [0], accent: 'text-blue-800', iconBg: 'bg-blue-600 text-white', cardBg: 'bg-blue-50', borderColor: 'border-blue-300', sectionBg: 'bg-blue-50/70 border-blue-200', accentBar: 'bg-blue-600' },
                        { label: 'Pay documents', folderNumbers: [1, 2, 3, 4], accent: 'text-emerald-800', iconBg: 'bg-emerald-600 text-white', cardBg: 'bg-emerald-50/60', borderColor: 'border-emerald-300', sectionBg: 'bg-emerald-50/70 border-emerald-200', accentBar: 'bg-emerald-600' },
                        { label: 'Meal allowance', folderNumbers: [5, 6], accent: 'text-amber-800', iconBg: 'bg-amber-500 text-white', cardBg: 'bg-amber-50/70', borderColor: 'border-amber-300', sectionBg: 'bg-amber-50/80 border-amber-200', accentBar: 'bg-amber-500' },
                        { label: 'Social Security & IRS declarations', folderNumbers: [7, 8, 9, 10], accent: 'text-indigo-800', iconBg: 'bg-indigo-600 text-white', cardBg: 'bg-indigo-50/70', borderColor: 'border-indigo-300', sectionBg: 'bg-indigo-50/80 border-indigo-200', accentBar: 'bg-indigo-600' },
                        { label: 'Tax payments', folderNumbers: [11, 12, 13], accent: 'text-violet-800', iconBg: 'bg-violet-600 text-white', cardBg: 'bg-violet-50/70', borderColor: 'border-violet-300', sectionBg: 'bg-violet-50/80 border-violet-200', accentBar: 'bg-violet-600' },
                      ]
                      return sections.map((section) => {
                        const sectionFolders = customerFolders.filter((f) => section.folderNumbers.includes(f.number))
                        if (!sectionFolders.length) return null
                        return (
                          <div key={section.label} className={`rounded-2xl border p-4 ${section.sectionBg}`}>
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <p className={`text-xs font-extrabold uppercase tracking-widest ${section.accent}`}>{section.label}</p>
                              <span className={`h-1 flex-1 rounded-full ${section.accentBar}`} />
                            </div>
                            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                              {sectionFolders.map((folder) => {
                                const folderUploads = customerYearUploads.filter((u) => u.folderNumber === folder.number)
                                const pending = Object.entries(customerPendingUploads).filter(([key]) => key.startsWith(`${folder.number}:`)).reduce((total, [, files]) => total + files.length, 0)
                                const isInbox = folder.number === 0
                                const isArchived = folderUploads.length > 0 && folderUploads.every((u) => u.status === 'archived')
                                const isProcessing = !isArchived && folderUploads.some((u) => u.status === 'grouped' || u.status === 'month_detected' || u.status === 'approved')
                                const submittedCount = folderUploads.filter((u) => u.status === 'submitted').reduce((t, u) => t + u.files.length, 0)
                                const cellKey = customerUploadKey(folder.number, null)
                                const isLastOpened = lastCustomerCellKey === cellKey
                                return (
                                  <button
                                    key={`simple-${folder.number}`}
                                    type="button"
                                    disabled={isArchived}
                                    onClick={() => {
                                      if (isArchived) return
                                      setLastCustomerCellKey(cellKey)
                                      setCustomerCell({ folderNumber: folder.number, folderCode: folder.code, folderLabel: folder.label, month: null, year: customerActiveYear ?? workspace.year })
                                    }}
                                    className={`group relative flex min-h-[185px] overflow-hidden flex-col justify-between rounded-2xl border p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md disabled:cursor-default disabled:hover:translate-y-0 disabled:hover:shadow-sm ${isLastOpened ? 'ring-4 ring-teal-300 ring-offset-2 ring-offset-white shadow-lg' : ''} ${section.borderColor} ${section.cardBg}`}
                                  >
                                    <span className={`absolute inset-x-0 top-0 h-1.5 ${section.accentBar}`} />
                                    {isLastOpened ? (
                                      <span className="absolute right-3 top-3 rounded-full bg-teal-700 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-white shadow-sm">
                                        Last opened
                                      </span>
                                    ) : null}
                                    <div>
                                      <div className={`flex items-start justify-between gap-3 ${isLastOpened ? 'pr-28' : ''}`}>
                                        <div className={`rounded-2xl p-3 ${section.iconBg}`}>
                                          <Folder className="h-6 w-6" />
                                        </div>
                                        {!isInbox && <span className="shrink-0 rounded-lg bg-white/80 px-2 py-1 font-mono text-[10px] font-black text-slate-400">{String(folder.number).padStart(2, '0')}_{folder.code}</span>}
                                      </div>
                                      <p className="mt-4 line-clamp-2 text-sm font-extrabold leading-5 text-slate-900">{isInbox ? "I don't know where this belongs" : folder.label}</p>
                                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{isInbox ? 'Upload here if you are not sure about the folder.' : 'Upload documents for this category.'}</p>
                                    </div>
                                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                                      {isArchived ? (
                                        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">Included in output ✓</span>
                                      ) : isProcessing ? (
                                        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">{folderUploads.reduce((t, u) => t + u.files.length, 0)} files · Being processed…</span>
                                      ) : submittedCount > 0 ? (
                                        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">{submittedCount} file(s) waiting</span>
                                      ) : pending > 0 ? (
                                        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">{pending} waiting confirmation</span>
                                      ) : (
                                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500">No files</span>
                                      )}
                                      {!isArchived && (
                                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#176b61] px-3 py-2 text-xs font-bold text-white group-hover:bg-[#12584f]">
                                          <Upload className="h-3.5 w-3.5" />
                                          Upload
                                        </span>
                                      )}
                                    </div>
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })
                    })()}
                  </div>
                </div>
              )}

              {customerCell ? (
                <>
                  <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setCustomerCell(null)} />
                  <aside className="fixed inset-y-0 right-0 z-50 flex w-[min(860px,calc(100vw-16rem))] flex-col border-l border-slate-200 bg-white shadow-2xl">
                    <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-widest text-teal-700">Manage documents</p>
                        <div className="mt-1 flex items-center gap-2">
                          <h3 className="text-lg font-bold">{customerCell.folderLabel}</h3>
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-400">{String(customerCell.folderNumber).padStart(2, '0')}_{customerCell.folderCode}</span>
                        </div>
                        <p className="mt-1 text-xs font-semibold text-slate-400">
                          {customerCell.month ? `${monthNames[customerCell.month - 1]} ${customerCell.year}` : `Unclassified inbox · ${customerCell.year}`}
                        </p>
                      </div>
                      <button onClick={() => setCustomerCell(null)} className="rounded-lg p-1.5 hover:bg-slate-100" aria-label="Close customer folder panel"><X className="h-4 w-4" /></button>
                    </div>
                    <div className="flex-1 space-y-5 overflow-y-auto p-5">
                      {/* ── Drop zone ── */}
                      <div
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => { e.preventDefault(); stageCustomerUpload(e.dataTransfer.files) }}
                        onClick={() => customerUploadInputRef.current?.click()}
                        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-teal-300 bg-teal-50 px-4 py-8 text-center transition hover:border-teal-500 hover:bg-teal-100"
                      >
                        <Upload className="h-7 w-7 text-teal-400" />
                        <p className="text-sm font-bold text-teal-700">Drop files here or click to browse</p>
                        <p className="text-xs text-teal-500">PDF, JPG or PNG · up to 25 MB each</p>
                      </div>

                      {/* ── Month selection (optional) ── */}
                      <div>
                        <p className="mb-2 text-xs font-bold text-slate-500 uppercase tracking-wide">Which month? <span className="font-normal normal-case">(optional)</span></p>
                        <div className="flex flex-wrap gap-1.5">
                          {monthNames.map((name, i) => {
                            const m = i + 1
                            const submitted = customerSubmittedUploads
                              .filter((u) => u.folderNumber === customerCell.folderNumber && u.month === m && u.year === customerCell.year)
                              .reduce((t, u) => t + u.files.length, 0)
                            const isSelected = customerCell.month === m
                            return (
                              <button
                                key={m}
                                type="button"
                                onClick={() => {
                                  if (isSelected) {
                                    setCustomerCell({ ...customerCell, month: null })
                                  } else {
                                    setCustomerCell({ ...customerCell, month: m })
                                    customerUploadOpenedForMonthRef.current = true
                                    customerUploadInputRef.current?.click()
                                  }
                                }}
                                className={`relative rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${isSelected ? 'bg-teal-600 text-white' : submitted ? 'border border-emerald-200 bg-emerald-50 text-emerald-700' : 'border border-slate-200 bg-white text-slate-600 hover:border-teal-300 hover:bg-teal-50'}`}
                              >
                                {name.slice(0, 3)}
                                {submitted > 0 && !isSelected && <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 text-[8px] font-black text-white">{submitted}</span>}
                              </button>
                            )
                          })}
                        </div>
                        {customerCell.month && (
                          <p className="mt-2 text-xs text-teal-600 font-semibold">Files will be tagged as {monthNames[customerCell.month - 1]} {customerCell.year}</p>
                        )}
                      </div>

                      {customerCellFiles.length > 0 && (
                        <div className="rounded-xl border border-teal-200 bg-teal-50 p-3">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <p className="text-sm font-bold text-teal-900">{customerCellFiles.length} file{customerCellFiles.length !== 1 ? 's' : ''} ready</p>
                              <p className="mt-0.5 text-xs text-teal-700">Send now, then preview or clear the list below if needed.</p>
                            </div>
                            <button onClick={submitCustomerUpload} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-3 text-sm font-bold text-white hover:bg-teal-800">
                              <Check className="h-4 w-4" />
                              Send to internal team
                            </button>
                          </div>
                        </div>
                      )}

                      {/* ── Staged files (pending confirm) ── */}
                      {customerCellFiles.length > 0 && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-bold text-slate-700">Ready to send ({customerCellFiles.length})</p>
                            <button type="button" onClick={() => { const key = customerUploadKey(customerCell.folderNumber, customerCell.month ?? null); setCustomerPendingUploads((c) => { const n = { ...c }; delete n[key]; return n }); setCustomerPreviewFile(null) }} className="text-[10px] text-slate-400 hover:text-rose-600">Clear</button>
                          </div>
                          <div className="space-y-1 rounded-xl border border-slate-200 bg-white p-2">
                            {customerCellFiles.map((file, idx) => (
                              <button key={`${file.name}-${idx}`} type="button" onClick={() => setCustomerPreviewFile(file)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-slate-50">
                                <FileStack className="h-3.5 w-3.5 shrink-0 text-teal-500" />
                                <span className="min-w-0 flex-1 truncate font-semibold text-slate-700">{file.webkitRelativePath || file.name}</span>
                                <span className="shrink-0 font-bold text-teal-600">Preview</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* ── Inline PDF preview ── */}
                      {customerPreviewFile && (
                        <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                          <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2">
                            <p className="truncate text-xs font-bold text-slate-700">{customerPreviewFile.name}</p>
                            <button onClick={() => setCustomerPreviewFile(null)} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
                          </div>
                          {/\.pdf$/i.test(customerPreviewFile.name) ? (
                            <div className="p-3"><PdfDateMarker file={customerPreviewFile} onPick={() => {}} picked={null} /></div>
                          ) : (
                            <img alt={customerPreviewFile.name} src={customerPreviewUrl} className="max-h-[420px] w-full bg-slate-200 object-contain" />
                          )}
                        </div>
                      )}

                      {/* ── Processing notice (once internal team has picked them up) ── */}
                      {customerCellIsProcessing && (
                        <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700 font-semibold flex items-center gap-2">
                          <span className="text-base">🔄</span>
                          Files received — internal team is processing them. You&rsquo;ll see updates here.
                        </div>
                      )}

                      {/* ── Already submitted ── */}
                      {!customerCellIsProcessing && customerCellSubmittedFiles.length > 0 && (
                        <div>
                          <p className="mb-2 text-xs font-bold text-slate-500 uppercase tracking-wide">Already submitted</p>
                          <div className="space-y-1 rounded-xl border border-emerald-100 bg-emerald-50 p-2">
                            {customerCellSubmittedFiles.map((file, idx) => (
                              <button key={`${file.name}-${file.hash || idx}`} type="button" onClick={() => { setCustomerPreviewFile(null); setCustomerPreviewUploadedFile(file) }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-emerald-100">
                                <FileCheck2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                                <span className="min-w-0 flex-1 truncate font-semibold text-slate-700">{file.name}</span>
                                <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Received ✓</span>
                              </button>
                            ))}
                          </div>
                          {customerPreviewUploadedFile && (
                            <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                              <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2">
                                <p className="truncate text-xs font-bold text-slate-700">{customerPreviewUploadedFile.name}</p>
                                <button onClick={() => setCustomerPreviewUploadedFile(null)} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
                              </div>
                              {customerPreviewUploadedFile.url && customerPreviewUploadedFile.contentType === 'application/pdf' ? (
                                <div className="p-3"><PdfDateMarker sourceUrl={customerPreviewUploadedFile.url} onPick={() => {}} picked={null} /></div>
                              ) : customerPreviewUploadedFile.url ? (
                                <img alt={customerPreviewUploadedFile.name} src={customerPreviewUploadedFile.url} className="max-h-[420px] w-full bg-slate-200 object-contain" />
                              ) : null}
                            </div>
                          )}
                        </div>
                      )}

                      {/* ── Empty state ── */}
                      {!customerCellFiles.length && !customerCellSubmittedFiles.length && !customerCellIsProcessing && (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
                          <FileStack className="mx-auto h-8 w-8 text-slate-300" />
                          <p className="mt-2 text-sm font-semibold text-slate-600">No files here yet</p>
                          <p className="mt-1 text-xs text-slate-400">
                            {customerCell.folderNumber === 0 ? 'Drop files above — the internal team will sort them.' : 'Drop files above. Select a month if you know it.'}
                          </p>
                        </div>
                      )}
                    </div>
                  </aside>
                </>
              ) : null}
            </section>
          ) : null}

          {appSide === 'internal' && view === 'workspace' ? (internalActiveYear === null ? (
            /* ── Year dashboard ── */
            (() => {
              const companyNode = databaseTree?.companies.find((c) => c.company.id === workspace.company.id)
              const dbYears = companyNode?.years ?? []
              const currentYear = new Date().getFullYear()
              const allYearSet = new Set([...dbYears.map((y) => y.year), ...customerSubmittedUploads.map((u) => u.year), currentYear])
              const allYears = Array.from(allYearSet).sort((a, b) => a - b)
              const monthShortNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
              const activeUploads = customerSubmittedUploads.filter((u) => u.status !== 'archived')
              const newFileCount = activeUploads.filter((u) => u.status === 'submitted').reduce((sum, upload) => sum + upload.files.length, 0)
              const processingFileCount = activeUploads.filter((u) => u.status === 'grouped' || u.status === 'month_detected' || u.status === 'approved').reduce((sum, upload) => sum + upload.files.length, 0)
              const completedMonthCount = dbYears.reduce((sum, year) => sum + year.comprovantesRh.filter((month) => month.baseJoin?.status === 'approved' || month.baseJoin?.status === 'done' || month.baseJoin?.status === 'generated').length, 0)
              const activeMonthCount = new Set([
                ...dbYears.flatMap((year) => year.comprovantesRh.map((month) => `${year.year}-${month.month}`)),
                ...activeUploads.filter((upload) => upload.month).map((upload) => `${upload.year}-${upload.month}`),
              ]).size
              const latestUpload = activeUploads.slice().sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0]
              return (
                <div className="space-y-6">
                  <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
                      <span>{workspace.program.code}</span><span>/</span>
                      <span>{workspace.project.code}</span><span>/</span>
                      <span className="text-slate-900">{workspace.company.code}</span>
                    </div>
                    <h2 className="mt-1 text-xl font-bold">Annual overview</h2>
                    <p className="mt-0.5 text-sm text-slate-500">Select a year to start or continue processing.</p>
                  </section>

                  <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
                      <p className="text-xs font-bold uppercase tracking-widest text-amber-700">New files</p>
                      <p className="mt-2 text-2xl font-black text-amber-900">{newFileCount}</p>
                      <p className="mt-1 text-xs text-amber-700">Waiting for internal action</p>
                    </div>
                    <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 shadow-sm">
                      <p className="text-xs font-bold uppercase tracking-widest text-blue-700">In progress</p>
                      <p className="mt-2 text-2xl font-black text-blue-900">{processingFileCount}</p>
                      <p className="mt-1 text-xs text-blue-700">Grouped, month detected, or approved</p>
                    </div>
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
                      <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Completed months</p>
                      <p className="mt-2 text-2xl font-black text-emerald-900">{completedMonthCount}</p>
                      <p className="mt-1 text-xs text-emerald-700">Base Join generated/approved</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Latest update</p>
                      <p className="mt-2 text-sm font-black text-slate-900">{latestUpload ? new Date(latestUpload.submittedAt).toLocaleDateString() : 'No uploads yet'}</p>
                      <p className="mt-1 text-xs text-slate-500">{activeMonthCount} active month{activeMonthCount !== 1 ? 's' : ''} across all years</p>
                    </div>
                  </section>

                  <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-bold text-slate-500 shadow-sm">
                    <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-slate-200" />No data</span>
                    <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-blue-500" />Files received</span>
                    <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-amber-400" />Needs processing</span>
                    <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-emerald-500" />Completed</span>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {allYears.map((year) => {
                      const dbYear = dbYears.find((y) => y.year === year)
                      const monthsWithData = dbYear?.comprovantesRh ?? []
                      const uploadFiles = customerSubmittedUploads.filter((u) => u.year === year)
                      const totalFiles = uploadFiles.reduce((s, u) => s + u.files.length, 0)
                      const pendingFiles = uploadFiles.filter((u) => u.status === 'submitted').reduce((s, u) => s + u.files.length, 0)
                      const processingFiles = uploadFiles.filter((u) => u.status === 'grouped' || u.status === 'month_detected' || u.status === 'approved').reduce((s, u) => s + u.files.length, 0)
                      const baseJoinsDone = monthsWithData.filter((m) => m.baseJoin?.status === 'approved' || m.baseJoin?.status === 'done' || m.baseJoin?.status === 'generated').length
                      const isCurrent = year === currentYear
                      const hasData = monthsWithData.length > 0 || totalFiles > 0
                      const latestYearUpload = uploadFiles.slice().sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0]
                      const statusBadge = pendingFiles > 0
                        ? { label: `${pendingFiles} file(s) pending`, cls: 'bg-amber-100 text-amber-700' }
                        : monthsWithData.length > 0
                          ? { label: `${baseJoinsDone}/${monthsWithData.length} months done`, cls: 'bg-blue-100 text-blue-700' }
                          : { label: 'No data yet', cls: 'bg-slate-100 text-slate-500' }
                      const latestMonth = monthsWithData.at(-1)?.month ?? (new Date().getMonth() + 1)
                      return (
                        <button
                          key={year}
                          type="button"
                          onClick={() => { setInternalActiveYear(year); void openPeriod(year, latestMonth) }}
                          className={`group flex flex-col gap-3 rounded-2xl border-2 p-5 text-left transition hover:-translate-y-0.5 hover:shadow-md ${isCurrent ? 'border-teal-400 bg-teal-50/40' : hasData ? 'border-slate-200 bg-white hover:border-teal-300' : 'border-dashed border-slate-200 bg-slate-50 hover:border-teal-300'}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-2xl font-extrabold text-slate-800">{year}</span>
                            {isCurrent && <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-bold text-teal-700">Current</span>}
                          </div>
                          {/* Mini 12-cell month grid */}
                          <div className="grid grid-cols-6 gap-1">
                            {monthShortNames.map((name, i) => {
                              const m = i + 1
                              const monthData = monthsWithData.find((md) => md.month === m)
                              const monthUploads = uploadFiles.filter((upload) => upload.month === m)
                              const isDone = monthData && (monthData.baseJoin?.status === 'approved' || monthData.baseJoin?.status === 'done' || monthData.baseJoin?.status === 'generated')
                              const hasMonthData = Boolean(monthData || monthUploads.length)
                              const hasSubmittedFiles = monthUploads.some((upload) => upload.status === 'submitted')
                              return (
                                <div
                                  key={m}
                                  title={name}
                                  className={`flex h-6 items-center justify-center rounded text-[9px] font-bold ${isDone ? 'bg-emerald-500 text-white' : hasSubmittedFiles ? 'bg-blue-500 text-white' : hasMonthData ? 'bg-amber-400 text-white' : 'bg-slate-100 text-slate-400'}`}
                                >
                                  {name.slice(0, 1)}
                                </div>
                              )
                            })}
                          </div>
                          <div className="space-y-1 text-xs text-slate-500">
                            <p>{monthsWithData.length > 0 ? `${monthsWithData.length} active month${monthsWithData.length !== 1 ? 's' : ''}` : 'No outputs generated yet'}</p>
                            {totalFiles > 0 && <p>{totalFiles} file{totalFiles !== 1 ? 's' : ''} received</p>}
                            {processingFiles > 0 && <p>{processingFiles} file{processingFiles !== 1 ? 's' : ''} already in progress</p>}
                            {latestYearUpload ? <p>Last upload: {new Date(latestYearUpload.submittedAt).toLocaleDateString()}</p> : null}
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${statusBadge.cls}`}>{statusBadge.label}</span>
                            <span className="rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-white group-hover:bg-teal-700">
                              {pendingFiles > 0 ? 'Review files' : hasData ? 'Open year' : 'Start year'}
                            </span>
                          </div>
                        </button>
                      )
                    })}
                    {/* Add year card */}
                    {showNewYearInput ? (
                      <div className="flex flex-col gap-3 rounded-2xl border-2 border-teal-400 bg-teal-50/40 p-5">
                        <p className="text-sm font-bold text-slate-700">Open a new year</p>
                        <input
                          type="number"
                          min={2020}
                          max={2099}
                          value={newYearEntry}
                          onChange={(e) => setNewYearEntry(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const yr = parseInt(newYearEntry, 10)
                              if (yr >= 2020 && yr <= 2099) { setInternalActiveYear(yr); void openPeriod(yr, new Date().getMonth() + 1) }
                              setShowNewYearInput(false); setNewYearEntry('')
                            }
                            if (e.key === 'Escape') { setShowNewYearInput(false); setNewYearEntry('') }
                          }}
                          placeholder={String(new Date().getFullYear() + 1)}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-base font-bold focus:border-teal-400 focus:outline-none"
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const yr = parseInt(newYearEntry, 10)
                              if (yr >= 2020 && yr <= 2099) { setInternalActiveYear(yr); void openPeriod(yr, new Date().getMonth() + 1) }
                              setShowNewYearInput(false); setNewYearEntry('')
                            }}
                            className="flex-1 rounded-lg bg-teal-600 px-3 py-2 text-xs font-bold text-white hover:bg-teal-700"
                          >Open →</button>
                          <button
                            type="button"
                            onClick={() => { setShowNewYearInput(false); setNewYearEntry('') }}
                            className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-50"
                          >Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setShowNewYearInput(true); setNewYearEntry(String(new Date().getFullYear() + 1)) }}
                        className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 p-5 text-slate-400 transition hover:border-teal-400 hover:text-teal-600"
                      >
                        <span className="text-3xl font-light">+</span>
                        <span className="text-sm font-semibold">Add year</span>
                      </button>
                    )}
                  </div>
                </div>
              )
            })()
          ) : (<>
            <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
                <button type="button" onClick={() => setInternalActiveYear(null)} className="font-semibold text-teal-600 hover:underline">← All years</button>
                <span>/</span>
                <span>{workspace.program.code}</span>
                <span>/</span>
                <span>{workspace.project.code}</span>
                <span>/</span>
                <span className="text-slate-900">{workspace.company.code}</span>
              </div>
              <h2 className="mt-1 text-xl font-bold">Monthly processing · {workspace.year}</h2>
            </section>

            {sessionRestored && (
              <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
                <span className="font-semibold text-amber-800">Session restored — your classification work from a previous visit was recovered.</span>
                <button
                  type="button"
                  onClick={() => { clearWorkspaceSessionState(); localStorage.removeItem(sessionKey(workspace.company.id, workspace.year, workspace.month)); setSessionRestored(false) }}
                  className="text-xs font-bold text-amber-700 underline hover:text-amber-900"
                >Clear &amp; start fresh</button>
                <button type="button" onClick={() => setSessionRestored(false)} className="ml-auto text-amber-400 hover:text-amber-700">✕</button>
              </div>
            )}

            <section className="sticky top-24 z-[8] mb-6 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-sm backdrop-blur">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex flex-wrap gap-2">
                  {workflowSteps.map((step, index) => {
                    const stateClass = step.attention
                      ? 'border-amber-200 bg-amber-50 text-amber-800'
                      : step.done
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : step.active
                          ? 'border-blue-200 bg-blue-50 text-blue-800'
                          : 'border-slate-200 bg-slate-50 text-slate-500'
                    return (
                      <button
                        key={step.id}
                        type="button"
                        onClick={() => document.getElementById(step.id === 'receive' ? 'inbox-section' : step.id === 'group' ? 'inbox-section' : step.id === 'months' ? 'organized-folders-section' : step.id === 'review' ? 'organized-folders-section' : 'generate-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-bold transition hover:-translate-y-0.5 hover:shadow-sm ${stateClass}`}
                      >
                        <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${step.done ? 'bg-emerald-600 text-white' : step.attention ? 'bg-amber-500 text-white' : step.active ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                          {step.done ? <Check className="h-3 w-3" /> : index + 1}
                        </span>
                        {step.active && !step.attention ? <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" /> : null}
                        <span>{step.label}</span>
                        {step.count ? <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[10px]">{step.count}</span> : null}
                      </button>
                    )
                  })}
                </div>
                <div className="flex flex-wrap gap-2 text-xs font-bold text-slate-600">
                  <button type="button" onClick={() => document.getElementById('inbox-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="rounded-full bg-slate-100 px-3 py-1.5">{receivedFileCount} received</button>
                  <button type="button" onClick={() => document.getElementById('organized-folders-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-700">{groupedFileCount} grouped</button>
                  <button type="button" onClick={() => document.getElementById('organized-folders-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="rounded-full bg-amber-50 px-3 py-1.5 text-amber-700">{needsReviewCount} need review</button>
                  <button type="button" onClick={() => document.getElementById('generate-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="rounded-full bg-blue-50 px-3 py-1.5 text-blue-700">{monthsReadyCount} months ready</button>
                </div>
              </div>
            </section>


            <section className="mb-6 rounded-2xl border border-teal-200 bg-gradient-to-r from-teal-50 to-white p-6 shadow-sm">
              <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-700 text-xs font-bold text-white">1</span><p className="text-xs font-bold uppercase tracking-widest text-teal-700">Step 1 · Train your company guide</p></div>
              <div className="mt-4 flex flex-col gap-6 xl:flex-row xl:items-start">
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-bold">Upload examples then train structural rules</h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Upload Base Join and Final Join PDFs as learning examples. {activeProviderName} runs a 7-layer engine — text extraction, TF-IDF scoring, LLM enrichment, and a self-validation loop — to build company-specific section fingerprints. Reference copies are discarded after analysis.</p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <input ref={baseReferenceInputRef} type="file" multiple accept="application/pdf" className="hidden" onChange={(event) => void uploadJoinReference('base_join', event.target.files)} />
                    <input ref={finalReferenceInputRef} type="file" multiple accept="application/pdf" className="hidden" onChange={(event) => void uploadJoinReference('final_join', event.target.files)} />
                    <button onClick={() => baseReferenceInputRef.current?.click()} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl border border-teal-200 bg-white px-4 py-2.5 text-sm font-semibold text-teal-800 hover:bg-teal-50 disabled:opacity-50">{busy === 'reference-base_join' ? <Loader2 className="h-4 w-4 animate-spin" /> : baseReferenceCount ? <Check className="h-4 w-4" /> : <Upload className="h-4 w-4" />}Base Join examples {baseReferenceCount ? `(${baseReferenceCount})` : ''}</button>
                    <button onClick={() => finalReferenceInputRef.current?.click()} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl border border-teal-200 bg-white px-4 py-2.5 text-sm font-semibold text-teal-800 hover:bg-teal-50 disabled:opacity-50">{busy === 'reference-final_join' ? <Loader2 className="h-4 w-4 animate-spin" /> : finalReferenceCount ? <Check className="h-4 w-4" /> : <Upload className="h-4 w-4" />}Final Join examples {finalReferenceCount ? `(${finalReferenceCount})` : ''}</button>
                  </div>
                  <p className="mt-3 text-xs font-semibold text-teal-700">Uploaded: {baseReferenceCount} Base Join · {finalReferenceCount} Final Join · rules v{workspace.company.rulesVersion}</p>
                </div>
                <div className="shrink-0">
                  <button onClick={() => void trainRulesFromExamples()} disabled={baseReferenceCount + finalReferenceCount === 0 || Boolean(busy)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500">{busy === 'train-examples' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{busy === 'train-examples' ? 'Training rules...' : 'Train rules from examples'}</button>
                </div>
              </div>
              {trainingProgress ? (
                <div className={`mt-4 rounded-xl border p-4 ${trainingProgress.done ? 'border-emerald-200 bg-emerald-50' : 'border-teal-200 bg-teal-50'}`}>
                  <div className="flex items-center justify-between gap-4">
                    <p className={`text-sm font-semibold ${trainingProgress.done ? 'text-emerald-800' : 'text-teal-800'}`}>{trainingProgress.label}</p>
                    <span className={`text-xs font-bold ${trainingProgress.done ? 'text-emerald-700' : 'text-teal-700'}`}>{trainingProgress.percent}%</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                    <div className={`h-full rounded-full transition-all duration-500 ${trainingProgress.done ? 'bg-emerald-600' : 'bg-teal-600'}`} style={{ width: `${trainingProgress.percent}%` }} />
                  </div>
                  <div className="mt-4 grid gap-2 md:grid-cols-7">
                    {trainingSteps.map((step) => (
                      <div key={step.id} className={`rounded-lg border p-3 ${step.status === 'done' ? 'border-emerald-200 bg-white' : step.status === 'running' ? 'border-teal-300 bg-white shadow-sm' : step.status === 'error' ? 'border-rose-200 bg-white' : 'border-slate-200 bg-white/70'}`}>
                        <div className="flex items-center gap-2">
                          {step.status === 'done' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : step.status === 'running' ? <Loader2 className="h-3.5 w-3.5 animate-spin text-teal-700" /> : step.status === 'error' ? <AlertTriangle className="h-3.5 w-3.5 text-rose-600" /> : <Clock3 className="h-3.5 w-3.5 text-slate-400" />}
                          <p className="text-xs font-bold text-slate-800">{step.label}</p>
                        </div>
                        <p className="mt-1 text-[11px] leading-4 text-slate-500">{step.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>

              <input ref={folderInputRef} type="file" multiple accept="application/pdf,image/jpeg,image/png" className="hidden" {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} onChange={(event) => stageFolderFiles(event.target.files)} />
              <input ref={filesOnlyInputRef} type="file" multiple accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={(event) => stageFolderFiles(event.target.files)} />
              <input ref={uploadInputRef} type="file" multiple accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={(event) => void classifySelectedFiles(event.target.files, 'files')} />

            {reviewItem ? (
              <>
                <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setReviewItem(null)} />
                <aside className="fixed inset-y-0 right-0 z-50 flex w-[min(1040px,calc(100vw-16rem))] flex-col border-l border-slate-200 bg-white shadow-2xl">
                  <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-widest text-teal-700">Internal preview / month validation</p>
                      <h3 className="mt-1 truncate text-sm font-bold text-slate-900">{reviewItem.item.filename}</h3>
                      <p className="mt-1 text-xs text-slate-500">{reviewItem.item.suggestedCode} · {reviewItem.item.suggestedLabel}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-400">
                        {reviewItem.item.targetYear && reviewItem.item.targetMonth ? `Detected month: ${String(reviewItem.item.targetMonth).padStart(2, '0')}/${reviewItem.item.targetYear}` : 'Month not confirmed yet'}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${reviewItem.item.confidence >= 0.7 ? 'bg-emerald-100 text-emerald-700' : reviewItem.item.confidence >= 0.5 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                        {Math.round(reviewItem.item.confidence * 100)}%
                      </span>
                      <button onClick={() => setReviewItem(null)} className="rounded-lg p-1.5 hover:bg-slate-100" aria-label="Close internal preview"><X className="h-4 w-4" /></button>
                    </div>
                  </div>
                  <div className="flex-1 space-y-4 overflow-y-auto p-5">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Document preview</p>
                        {(() => {
                          const idx = reviewItem.allItems.findIndex((item) => item.sourceHash === reviewItem.item.sourceHash)
                          const prev = idx > 0 ? reviewItem.allItems[idx - 1] : null
                          const next = idx >= 0 && idx < reviewItem.allItems.length - 1 ? reviewItem.allItems[idx + 1] : null
                          return (
                            <div className="flex items-center gap-1 text-xs font-semibold text-slate-500">
                              <button onClick={() => prev && navigateReviewTo(prev, reviewItem.clusterKey, reviewItem.allItems)} disabled={!prev} className="rounded px-2 py-1 hover:bg-white disabled:opacity-30">Prev</button>
                              <span>{idx + 1}/{reviewItem.allItems.length}</span>
                              <button onClick={() => next && navigateReviewTo(next, reviewItem.clusterKey, reviewItem.allItems)} disabled={!next} className="rounded px-2 py-1 hover:bg-white disabled:opacity-30">Next</button>
                            </div>
                          )
                        })()}
                      </div>
                      {(reviewLocalFile && !/\.pdf$/i.test(reviewLocalFile.name)) || (reviewUploadedFile?.url && reviewUploadedFile.contentType && reviewUploadedFile.contentType !== 'application/pdf') ? (
                        <img alt={`Preview ${reviewItem.item.filename}`} src={reviewLocalPreviewUrl || reviewUploadedFile?.url || ''} className="max-h-[520px] w-full rounded-lg border border-slate-200 bg-slate-200 object-contain" />
                      ) : (
                        <PdfDateMarker
                          hash={reviewLocalFile || reviewUploadedFile?.url ? undefined : reviewItem.item.sourceHash}
                          file={reviewLocalFile}
                          sourceUrl={reviewUploadedFile?.url}
                          mode="select"
                          onPick={setReviewMark}
                          picked={reviewMark}
                          onSelect={(text, mark) => {
                            setReviewAnchorText(text)
                            if (mark) setReviewMark(mark)
                            if (!reviewManualPeriod) setReviewManualPeriod({ year: selectedYear ?? workspace?.year ?? new Date().getFullYear(), month: reviewItem.item.targetMonth ?? workspace?.month ?? (new Date().getMonth() + 1) })
                          }}
                        />
                      )}
                      {(reviewLocalFile && /\.pdf$/i.test(reviewLocalFile.name)) || (reviewUploadedFile?.contentType === 'application/pdf') ? (
                        <p className="mt-1 text-[11px] text-teal-700">Drag to select the text that identifies the month.</p>
                      ) : reviewLocalFile || reviewUploadedFile ? (
                        <p className="mt-2 text-[11px] text-amber-700">Image preview loaded. Text selection is only available for PDF files.</p>
                      ) : null}
                    </div>

                    {/* Verification banner — shown when auto-checking the anchor on this file */}
                    {reviewVerifyStatus !== 'idle' && (
                      <div className={`rounded-xl border p-3 ${reviewVerifyStatus === 'verifying' ? 'border-blue-200 bg-blue-50' : reviewVerifyStatus === 'verified' ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                        <div className="flex items-center gap-2">
                          {reviewVerifyStatus === 'verifying' ? (
                            <><Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" /><span className="text-xs font-semibold text-blue-700">Checking if learned anchor works on this file…</span></>
                          ) : reviewVerifyStatus === 'verified' && reviewVerifyResult ? (
                            <><Check className="h-3.5 w-3.5 text-emerald-600" /><span className="text-xs font-semibold text-emerald-700">Anchor confirmed — detected <span className="font-mono">{reviewVerifyResult.phrase}</span> ({['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][reviewVerifyResult.month - 1]} {reviewVerifyResult.year})</span></>
                          ) : (
                            <><span className="text-[11px] font-semibold text-amber-700">Anchor not found in this file — select different text to update the anchor.</span></>
                          )}
                          <button type="button" onClick={() => { setReviewVerifyStatus('idle'); setReviewVerifyResult(null) }} className="ml-auto text-[10px] text-slate-400 underline">Dismiss</button>
                        </div>
                        {reviewVerifyStatus === 'verified' && reviewVerifyResult && (
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={async () => {
                                if (!workspace) return
                                const result = reviewVerifyResult
                                const code = reviewItem.item.suggestedCode
                                const clusterKey = reviewItem.clusterKey
                                // Accumulate this confirmation so clustering won't overwrite it
                                confirmedPeriodsRef.current[reviewItem.item.sourceHash] = { year: result.year, month: result.month }
                                setReviewVerifyStatus('idle')
                                setClusterResult((current) => {
                                  if (!current) return current
                                  return { ...current, clusters: current.clusters.map((c) => c.key !== clusterKey ? c : { ...c, items: c.items.map((ci2) => ci2.sourceHash === reviewItem.item.sourceHash ? { ...ci2, targetYear: result.year, targetMonth: result.month, confidence: 1, routeSource: 'operator' } : ci2) }) }
                                })
                                // Keep allItems fresh so next-item search is correct
                                const freshAllItems = reviewItem.allItems.map((it) => it.sourceHash === reviewItem.item.sourceHash ? { ...it, targetYear: result.year, targetMonth: result.month, confidence: 1, routeSource: 'operator' } : it)
                                setReviewItem((cur) => cur ? { ...cur, allItems: freshAllItems } : null)
                                // Advance to next file of same type, or run clustering (with confirmed periods protected) if no more
                                const currentIdx = freshAllItems.findIndex((it) => it.sourceHash === reviewItem.item.sourceHash)
                                const nextItem = freshAllItems.slice(currentIdx + 1).find((it) => it.suggestedCode === code)
                                if (nextItem) {
                                  navigateReviewTo(nextItem, clusterKey, freshAllItems, { autoVerifyCode: code })
                                } else {
                                  setReviewItem(null)
                                  const snapshot = { ...confirmedPeriodsRef.current }
                                  confirmedPeriodsRef.current = {}
                                  void runLocalMonthCluster(clusterKey, snapshot)
                                }
                              }}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
                            >
                              <Check className="h-3 w-3" />
                              Confirm {['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][reviewVerifyResult.month - 1]} {reviewVerifyResult.year}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setReviewVerifyStatus('idle')
                                setReviewVerifyResult(null)
                                void scanReviewDateCandidates()
                              }}
                              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50"
                            >
                              Wrong — scan again
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {reviewVerifyStatus === 'idle' && <div className={`rounded-xl border p-3 ${reviewMonthFeedbackStatus === 'confirmed' ? 'border-emerald-200 bg-emerald-50' : reviewMonthFeedbackStatus === 'wrong' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Quick month check</p>
                          <p className="mt-1 text-sm font-semibold text-slate-900">
                            {reviewItem.item.targetYear && reviewItem.item.targetMonth
                              ? `Is this ${monthNames[reviewItem.item.targetMonth - 1]} ${reviewItem.item.targetYear}?`
                              : 'No month detected yet — teach the correct one below.'}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">Use this like a small validation step: confirm when right, or mark wrong and update the learning evidence.</p>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={!reviewItem.item.targetYear || !reviewItem.item.targetMonth || reviewMonthFeedbackStatus === 'confirmed'}
                            onClick={() => void confirmDetectedMonthAndAdvance()}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-500"
                          >
                            <Check className="h-3.5 w-3.5" />
                            Confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const fallbackMonth = reviewItem.item.targetMonth ?? workspace?.month ?? (new Date().getMonth() + 1)
                              const fallbackYear = selectedYear ?? reviewItem.item.targetYear ?? workspace?.year ?? new Date().getFullYear()
                              setReviewMonthFeedbackStatus('wrong')
                              setReviewManualPeriod({ year: fallbackYear, month: fallbackMonth })
                              setReviewAnchorText('')
                              setReviewScanCandidates([])
                              setReviewScanStatus('idle')
                              void scanReviewDateCandidates()
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-700 hover:bg-amber-50"
                          >
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Wrong / teach
                          </button>
                        </div>
                      </div>
                      {reviewMonthFeedbackStatus === 'wrong' ? (
                        <p className="mt-2 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-amber-800">Marked as wrong. Select the month text in the preview, scan for dates, or type the reference date below to update the learning rule.</p>
                      ) : null}
                    </div>}

                    {(!reviewLocalFile || /\.pdf$/i.test(reviewLocalFile.name)) ? (
                      <div className="rounded-xl border border-teal-200 bg-teal-50 p-3 space-y-2.5">
                        <p className="text-xs font-bold uppercase tracking-wide text-teal-800">Month learning</p>

                        {reviewScanStatus === 'saved' ? (
                          <div className="flex items-center gap-2 text-xs font-bold text-emerald-700">
                            <Check className="h-3.5 w-3.5" />
                            Saved — re-cluster months to apply
                            <button type="button" onClick={() => { setReviewScanStatus('idle'); setReviewScanCandidates([]); setReviewAnchorText(''); setReviewManualPeriod(null) }} className="ml-auto text-[10px] font-normal text-slate-400 underline">Redo</button>
                          </div>
                        ) : (
                          <>
                            {/* ── Option 1: Auto-scan ── */}
                            <div className="space-y-1.5">
                              <p className="text-[10px] font-bold uppercase tracking-wide text-teal-600">Auto-detect</p>
                              {reviewScanStatus === 'loading' ? (
                                <div className="flex items-center gap-2 text-xs text-teal-700"><Loader2 className="h-3.5 w-3.5 animate-spin" />Scanning…</div>
                              ) : reviewScanCandidates.length > 0 ? (
                                <div className="space-y-2">
                                  {/* Month/year cards — tap = save + advance immediately */}
                                  <div className="flex flex-col gap-2">
                                    {reviewScanCandidates.map((candidate, ci) => {
                                      const monthNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
                                      return (
                                        <button
                                          key={ci}
                                          type="button"
                                          disabled={reviewScanStatus === 'saving'}
                                          onClick={() => void saveAnchorAndAdvance(candidate.phrase, candidate.year, candidate.month)}
                                          className="group relative flex items-start gap-3 rounded-xl border-2 border-teal-200 bg-white px-3 py-2.5 text-left transition hover:border-teal-500 hover:bg-teal-600 disabled:opacity-40"
                                        >
                                          {/* Month/year pill */}
                                          <div className="flex shrink-0 flex-col items-center rounded-lg bg-teal-50 px-2.5 py-1.5 group-hover:bg-teal-500">
                                            <p className="text-sm font-black leading-none text-slate-900 group-hover:text-white">{monthNames[candidate.month - 1].slice(0,3)}</p>
                                            <p className="text-[11px] font-bold text-slate-500 group-hover:text-teal-100">{candidate.year}</p>
                                          </div>
                                          {/* Context text — what the system read from the document */}
                                          <div className="min-w-0 flex-1">
                                            <p className="font-mono text-[11px] font-bold text-slate-700 group-hover:text-white">{candidate.phrase}</p>
                                            <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-slate-500 group-hover:text-teal-100">{candidate.context}</p>
                                          </div>
                                          {/* Score + best badge */}
                                          <div className="flex shrink-0 flex-col items-end gap-1">
                                            {ci === 0 && <span className="rounded-full bg-teal-500 px-1.5 py-0.5 text-[9px] font-bold text-white group-hover:bg-white group-hover:text-teal-600">Best</span>}
                                            <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${candidate.score >= 0.7 ? 'bg-emerald-100 text-emerald-700' : candidate.score >= 0.5 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>{Math.round(candidate.score * 100)}%</span>
                                          </div>
                                        </button>
                                      )
                                    })}
                                  </div>
                                  <button type="button" onClick={() => { setReviewScanCandidates([]); setReviewScanStatus('idle') }} className="text-[10px] text-slate-400 underline hover:text-slate-600">Scan again</button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  disabled={reviewScanStatus === 'saving'}
                                  onClick={() => void scanReviewDateCandidates()}
                                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-teal-300 bg-white px-3 py-2 text-xs font-bold text-teal-800 hover:bg-teal-100 disabled:opacity-40"
                                >
                                  <Search className="h-3.5 w-3.5" />
                                  Scan for date suggestions
                                </button>
                              )}
                            </div>

                            {/* ── Divider ── */}
                            <div className="flex items-center gap-2">
                              <div className="h-px flex-1 bg-teal-200" />
                              <span className="text-[10px] font-semibold text-teal-400">or select from preview above</span>
                              <div className="h-px flex-1 bg-teal-200" />
                            </div>

                            {/* ── Option 2: Text selection from PDF ── */}
                            <div className="space-y-1.5">
                              <p className="text-[10px] font-bold uppercase tracking-wide text-teal-600">Manual selection</p>
                              {reviewAnchorText ? (
                                <div className="rounded-lg border border-teal-300 bg-white px-3 py-2">
                                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Selected text</p>
                                  <p className="mt-1 font-mono text-xs text-slate-900 whitespace-pre-wrap break-all">{reviewAnchorText}</p>
                                  {reviewMark ? (
                                    <div className="mt-2 grid gap-1 rounded-lg bg-slate-50 px-2 py-2 text-[11px] text-slate-600">
                                      <p><span className="font-bold text-slate-700">Label/context:</span> {reviewMark.label || 'No nearby label detected'}</p>
                                      <p><span className="font-bold text-slate-700">Position:</span> page {reviewMark.page}, x {Math.round(reviewMark.x * 100)}%, y {Math.round(reviewMark.y * 100)}%</p>
                                      {reviewMark.contextText ? <p className="line-clamp-2"><span className="font-bold text-slate-700">Nearby text:</span> {reviewMark.contextText}</p> : null}
                                    </div>
                                  ) : null}
                                  <button type="button" onClick={() => setReviewAnchorText('')} className="mt-1 text-[10px] text-slate-400 underline hover:text-slate-600">Clear</button>
                                </div>
                              ) : (
                                <p className="text-[11px] text-slate-500">
                                  {reviewLocalFile ? 'Drag to highlight text in the preview above.' : 'File not loaded.'}
                                </p>
                              )}
                              {!reviewLocalFile && (
                                <input
                                  type="text"
                                  placeholder="Type the identifying text (e.g. 30.09.2025)"
                                  value={reviewAnchorText}
                                  onChange={(e) => setReviewAnchorText(e.target.value)}
                                  className="w-full rounded-lg border border-teal-300 bg-white px-3 py-2 text-xs placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400"
                                />
                              )}
                            </div>

                            {/* ── Period chips + Save (shown once text is selected) ── */}
                            {reviewAnchorText.trim() && (() => {
                              const selMonth = reviewManualPeriod?.month ?? reviewItem.item.targetMonth ?? workspace?.month ?? new Date().getMonth() + 1
                              const selYear = reviewManualPeriod?.year ?? selectedYear ?? workspace?.year ?? new Date().getFullYear()
                              const monthShort = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
                              return (
                                <div className="space-y-2 border-t border-teal-200 pt-2">
                                  <p className="text-[10px] font-bold uppercase tracking-wide text-teal-600">Confirm period</p>
                                  {/* Month chips */}
                                  <div className="flex flex-wrap gap-1">
                                    {monthShort.map((name, i) => {
                                      const m = i + 1
                                      return (
                                        <button
                                          key={m}
                                          type="button"
                                          onClick={() => setReviewManualPeriod({ year: selYear, month: m })}
                                          className={`rounded-lg px-2 py-1 text-xs font-bold transition ${selMonth === m ? 'bg-teal-600 text-white' : 'border border-teal-200 bg-white text-slate-600 hover:border-teal-400 hover:bg-teal-50'}`}
                                        >
                                          {name}
                                        </button>
                                      )
                                    })}
                                  </div>
                                  {/* Year chips */}
                                  <div className="flex gap-1">
                                    {yearOptions.map((y) => (
                                      <button
                                        key={y}
                                        type="button"
                                        onClick={() => setReviewManualPeriod({ year: y, month: selMonth })}
                                        className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${selYear === y ? 'bg-teal-600 text-white' : 'border border-teal-200 bg-white text-slate-600 hover:border-teal-400 hover:bg-teal-50'}`}
                                      >
                                        {y}
                                      </button>
                                    ))}
                                  </div>
                                  <button
                                    type="button"
                                    disabled={reviewScanStatus === 'saving'}
                                    onClick={() => void saveAnchorAndAdvance(reviewAnchorText.trim(), selYear, selMonth)}
                                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-teal-700 px-3 py-2 text-xs font-bold text-white hover:bg-teal-800 disabled:opacity-40"
                                  >
                                    {reviewScanStatus === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Tag className="h-3.5 w-3.5" />}
                                    Save for {monthShort[selMonth - 1]} {selYear}
                                  </button>
                                </div>
                              )
                            })()}
                          </>
                        )}
                      </div>
                    ) : null}

                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Move to another folder</p>
                      <div className="mt-3 flex gap-2">
                        <select value={reviewReassignTarget} onChange={(event) => setReviewReassignTarget(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold outline-none focus:border-teal-600">
                          <option value="">Select destination…</option>
                          {clusterResult?.clusters.map((cluster) => (
                            <option key={cluster.key} value={cluster.key}>{cluster.key === 'OUTLIERS' ? 'OUTLIERS · Review group' : `${String(cluster.folderNumber ?? 0).padStart(2, '0')}_${cluster.code} · ${cluster.label}`}</option>
                          ))}
                        </select>
                        <button onClick={handleReassign} disabled={!reviewReassignTarget || reviewReassignTarget === reviewItem.clusterKey} className="rounded-lg bg-teal-700 px-3 py-2 text-xs font-bold text-white hover:bg-teal-800 disabled:opacity-40">Move</button>
                      </div>
                    </div>
                  </div>
                </aside>
              </>
            ) : null}


            {/* Customer submissions panel — reads customerSubmittedUploads directly, immune to clusterResult resets */}
            <section className="mb-6 rounded-2xl border border-blue-100 bg-blue-50/60 p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-blue-500">Customer submissions</p>
                  <h2 className="mt-0.5 text-base font-bold text-slate-800">Files received from customers</h2>
                </div>
                <div className="flex items-center gap-2">
                  {customerUploadsLastRefreshed ? <span className="text-xs text-slate-400">Updated {Math.round((Date.now() - customerUploadsLastRefreshed.getTime()) / 60_000)} min ago</span> : null}
                  <button
                    type="button"
                    onClick={() => workspace && void refreshCustomerUploads(workspace.company.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />Refresh
                  </button>
                </div>
              </div>
              {(() => {
                const activeYearFolders = customerSubmissionsByYear.get(internalActiveYear ?? workspace.year)
                if (!activeYearFolders || activeYearFolders.size === 0) return <p className="text-sm text-slate-400">No customer submissions for {internalActiveYear ?? workspace.year}.</p>
                return (
                <div className="space-y-2">
                  {Array.from(activeYearFolders.entries()).sort((a, b) => a[0] - b[0]).map(([folderNumber, { label, uploads }]) => {
                          const folderInfo = workspace?.folders.find((f) => f.number === folderNumber)
                          const displayLabel = folderInfo?.label ?? label
                          const displayCode = folderNumber === 0 ? '00_IN' : folderInfo?.code ?? `F${String(folderNumber).padStart(2, '0')}`
                          const totalFiles = uploads.reduce((s, u) => s + u.files.length, 0)
                          const latestUpload = uploads.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0]
                          const statusColors: Record<string, string> = {
                            submitted: 'bg-amber-100 text-amber-700',
                            grouped: 'bg-blue-100 text-blue-700',
                            month_detected: 'bg-violet-100 text-violet-700',
                            approved: 'bg-emerald-100 text-emerald-700',
                          }
                          const dominantStatus = latestUpload?.status ?? 'submitted'
                          return (
                            <div key={folderNumber} className="rounded-xl border border-blue-100 bg-white p-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">{displayCode}</span>
                                <span className="text-sm font-semibold text-slate-800">{displayLabel}</span>
                                <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-bold ${statusColors[dominantStatus] ?? 'bg-slate-100 text-slate-500'}`}>{dominantStatus}</span>
                                <span className="rounded-full bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-500">{totalFiles} file{totalFiles !== 1 ? 's' : ''}</span>
                              </div>
                              <div className="mt-2 space-y-0.5">
                                {uploads.flatMap((u) => u.files).slice(0, 10).map((file, fi) => (
                                  <div key={fi} className="flex items-center gap-1.5 text-xs text-slate-600">
                                    <span className="truncate">{file.name}</span>
                                    {file.url ? (
                                      <a href={file.url} target="_blank" rel="noreferrer" className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-blue-600 hover:bg-blue-50">
                                        <Download className="h-3 w-3" />
                                      </a>
                                    ) : null}
                                  </div>
                                ))}
                                {uploads.flatMap((u) => u.files).length > 10 ? (
                                  <p className="text-xs text-slate-400">+{uploads.flatMap((u) => u.files).length - 10} more</p>
                                ) : null}
                              </div>
                              {latestUpload ? <p className="mt-1.5 text-xs text-slate-400">Submitted {new Date(latestUpload.submittedAt).toLocaleString()}</p> : null}
                            </div>
                          )
                        })}
                </div>
                )
              })()}
            </section>

            <section id="organized-folders-section" className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Step 2 · Folder board</p>
                  <h2 className="mt-1 text-lg font-bold">Folders 0–13</h2>
                  <p className="mt-1 text-sm text-slate-500">Folder 0 is the only folder with the first clustering action. Folders 1–13 show the organized files and can be opened for preview/review.</p>
                </div>
                {clusterResult ? <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">{clusterResult.groupedItems}/{clusterResult.totalItems} files organized</span> : <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-500">No clustering result yet</span>}
              </div>
              {!groupedFileCount ? (
                <p className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  Folders 1-13 are shown even when empty. Use Folder 0 / Inbox and click “Group by folder” to populate them.
                </p>
              ) : null}
              <div className="mt-5 space-y-6">
                <div id="inbox-section" className="rounded-2xl border border-blue-200 bg-blue-50/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-teal-950">00_INBOX · Folder 0</p>
                      <p className="mt-1 text-xs text-teal-700">Select a folder or pick individual files. Sub-folders named by month are detected automatically.</p>
                    </div>
                    <span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-teal-700">
                      {stagedFolderFiles.length ? `${stagedFolderFiles.length} staged` : internalFolder0SubmittedFileCount ? `${internalFolder0SubmittedFileCount} available` : '0 staged'}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button onClick={() => folderInputRef.current?.click()} disabled={Boolean(busy)} className="inline-flex items-center gap-1.5 rounded-lg border border-teal-300 bg-white px-3 py-2 text-xs font-bold text-teal-800 hover:bg-teal-50 disabled:opacity-50">
                      <FolderInput className="h-3.5 w-3.5" />
                      {stagedFolderFiles.length ? 'Replace folder' : 'Select folder'}
                    </button>
                    <button onClick={() => filesOnlyInputRef.current?.click()} disabled={Boolean(busy)} className="inline-flex items-center gap-1.5 rounded-lg border border-teal-300 bg-white px-3 py-2 text-xs font-bold text-teal-800 hover:bg-teal-50 disabled:opacity-50">
                      <Upload className="h-3.5 w-3.5" />
                      Choose files
                    </button>
                    <button onClick={() => void runFolderGrouping()} disabled={(!stagedFolderFiles.length && !internalFolder0SubmittedFileCount) || Boolean(busy)} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:bg-slate-200 disabled:text-slate-500">
                      {busy === 'cluster-folder' || busy === 'stage-folder0-submissions' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                      {busy === 'cluster-folder' ? 'Grouping...' : busy === 'stage-folder0-submissions' ? 'Loading files...' : 'Group by folder'}
                    </button>
                  </div>
                  {(folderProgress || busy === 'cluster-folder' || busy === 'stage-folder0-submissions') ? (
                    <div className="mt-3 rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs text-blue-800 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="inline-flex min-w-0 items-center gap-2 font-bold">
                          {(busy === 'cluster-folder' || busy === 'stage-folder0-submissions') ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                          <span className="truncate">{folderProgress?.filename || 'Preparing folder grouping...'}</span>
                        </span>
                        {folderProgress ? <span className="shrink-0 font-mono text-[11px]">{folderProgress.current}/{folderProgress.total}</span> : null}
                      </div>
                      {folderProgress?.total ? (
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-blue-100">
                          <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${Math.max(8, Math.min(100, Math.round((folderProgress.current / Math.max(1, folderProgress.total)) * 100)))}%` }} />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {Object.keys(stagedSubFolderHints).length > 0 && (
                    <div className="mt-3 rounded-lg border border-teal-200 bg-white/70 px-3 py-2">
                      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-teal-700">Month sub-folders detected — period pre-assigned</p>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(stagedSubFolderHints).map(([folder, period]) => (
                          <span key={folder} className="rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-bold text-teal-900">
                            {folder} → {monthNames[period.month - 1]} {period.year}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {stagedFolderFiles.length ? (
                    <div className="mt-3 max-h-32 space-y-1 overflow-y-auto rounded-lg border border-teal-100 bg-white/70 p-2">
                      {stagedFolderFiles.slice(0, 8).map((file, index) => (
                        <button
                          key={`${file.name}-${index}`}
                          type="button"
                          onClick={() => { const url = URL.createObjectURL(file); window.open(url, '_blank', 'noopener,noreferrer'); window.setTimeout(() => URL.revokeObjectURL(url), 60_000) }}
                          className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1 text-left text-xs font-semibold text-slate-700 hover:bg-teal-50"
                        >
                          <span className="min-w-0 truncate">{file.webkitRelativePath || file.name}</span>
                          <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-teal-700">Preview</span>
                        </button>
                      ))}
                      {stagedFolderFiles.length > 8 ? <p className="text-xs text-teal-700">+{stagedFolderFiles.length - 8} more file(s)</p> : null}
                    </div>
                  ) : <p className="mt-3 rounded-lg border border-dashed border-teal-200 bg-white/60 p-3 text-xs text-teal-700">No files staged yet. Select a folder or choose individual PDFs above.</p>}
                </div>

                {([
                  { label: 'Step A — Payslips · Folder 01_RV (Recibos de Vencimento)', folderNumbers: [1], accent: 'text-teal-800', sectionBg: 'bg-teal-50/70 border-teal-300', accentBar: 'bg-teal-600', cardBg: 'bg-teal-50/40 border-teal-200', isFolderOne: true },
                  { label: 'Step B — Evidence Documents · Folders 02–04', folderNumbers: [2, 3, 4], accent: 'text-emerald-800', sectionBg: 'bg-emerald-50/70 border-emerald-200', accentBar: 'bg-emerald-600', cardBg: 'bg-emerald-50/40 border-emerald-200', isFolderOne: false },
                  { label: 'Meal allowance · Folders 05–06', folderNumbers: [5, 6], accent: 'text-amber-800', sectionBg: 'bg-amber-50/80 border-amber-200', accentBar: 'bg-amber-500', cardBg: 'bg-amber-50/50 border-amber-200', isFolderOne: false },
                  { label: 'Social Security & IRS declarations · Folders 07–10', folderNumbers: [7, 8, 9, 10], accent: 'text-indigo-800', sectionBg: 'bg-indigo-50/80 border-indigo-200', accentBar: 'bg-indigo-600', cardBg: 'bg-indigo-50/50 border-indigo-200', isFolderOne: false },
                  { label: 'Tax payments · Folders 11–13', folderNumbers: [11, 12, 13], accent: 'text-violet-800', sectionBg: 'bg-violet-50/80 border-violet-200', accentBar: 'bg-violet-600', cardBg: 'bg-violet-50/50 border-violet-200', isFolderOne: false },
                ] as Array<{ label: string; folderNumbers: number[]; accent: string; sectionBg: string; accentBar: string; cardBg: string; isFolderOne: boolean }>).map((section) => {
                  const sectionFolders = workspace.folders.filter((folder) => section.folderNumbers.includes(folder.number))
                  if (!sectionFolders.length) return null
                  return (
                    <div key={section.label} className={`rounded-2xl border p-4 ${section.sectionBg}`}>
                      <div className="mb-3 flex flex-wrap items-center gap-3">
                        <p className={`text-xs font-extrabold uppercase tracking-widest ${section.accent}`}>{section.label}</p>
                        <span className={`h-1 flex-1 rounded-full ${section.accentBar}`} />
                        {section.isFolderOne
                          ? <span className="rounded-full bg-teal-700 px-2 py-0.5 text-[11px] font-bold text-white">Used in Final Join per employee</span>
                          : <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-600">Included in Base Join (shared)</span>}
                      </div>
                      <div className="grid gap-4 xl:grid-cols-2">
                {sectionFolders.map((folder) => {
                  const cluster = clusterResult?.clusters.find((item) => item.folderNumber === folder.number)
                  const items = [...(cluster?.items || [])].sort((a, b) => {
                    const aPeriod = (a.targetYear || 9999) * 100 + (a.targetMonth || 99)
                    const bPeriod = (b.targetYear || 9999) * 100 + (b.targetMonth || 99)
                    if (aPeriod !== bPeriod) return aPeriod - bPeriod
                    return a.filename.localeCompare(b.filename)
                  })
                  const monthGroups = items.reduce<Array<{ key: string; label: string; sort: number; items: ClusterItem[] }>>((groups, item) => {
                    const hasPeriod = Boolean(item.targetYear && item.targetMonth)
                    const key = hasPeriod ? `${item.targetYear}-${String(item.targetMonth).padStart(2, '0')}` : 'unknown'
                    const label = hasPeriod ? `${monthNames[(item.targetMonth || 1) - 1]} ${item.targetYear}` : 'No month detected'
                    const sort = hasPeriod ? (item.targetYear || 9999) * 100 + (item.targetMonth || 99) : 999999
                    const existing = groups.find((group) => group.key === key)
                    if (existing) existing.items.push(item)
                    else groups.push({ key, label, sort, items: [item] })
                    return groups
                  }, []).sort((a, b) => a.sort - b.sort)
                  const monthCluster = cluster ? localMonthClusters[cluster.key] : null
                  const hasLastPreviewedItem = Boolean(lastInternalPreviewHash && items.some((item) => item.sourceHash === lastInternalPreviewHash))
                  return (
                    <div key={folder.number} className={`relative rounded-xl border p-4 ${hasLastPreviewedItem ? 'ring-4 ring-teal-200 ring-offset-2 ring-offset-white shadow-md' : ''} ${section.cardBg}`}>
                      {hasLastPreviewedItem ? (
                        <span className="absolute right-3 top-3 rounded-full bg-teal-700 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-white shadow-sm">
                          Last preview
                        </span>
                      ) : null}
                      <div className={`flex items-start justify-between gap-3 ${hasLastPreviewedItem ? 'pr-28' : ''}`}>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-slate-900">{String(folder.number).padStart(2, '0')}_{folder.code} · {folder.label}</p>
                          <p className="mt-1 text-xs text-slate-500">{folder.number === 1 ? 'Final Join source folder' : 'Base Join evidence folder'}</p>
                        </div>
                        <span className={`rounded-full px-2 py-1 text-xs font-bold ${items.length ? 'bg-emerald-50 text-emerald-700' : 'bg-white text-slate-400'}`}>{items.length} file(s)</span>
                      </div>
                      <div className="mt-3 space-y-2">
                        {monthGroups.length ? monthGroups.map((group) => (
                          <div key={`${folder.code}-${group.key}`} className="rounded-lg border border-white bg-white p-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className={`text-xs font-bold ${group.key === 'unknown' ? 'text-amber-700' : 'text-blue-700'}`}>{group.label}</p>
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">{group.items.length} file(s)</span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {group.items.slice(0, 8).map((item, index) => {
                                const shortCode = buildDocumentDisplayCode(workspace.company.code || workspace.company.id, folder.number, item.targetMonth, index)
                                const isLastPreviewed = lastInternalPreviewHash === item.sourceHash
                                return (
                                  <span
                                    key={`${folder.code}-${group.key}-${item.sourceHash}-${index}`}
                                    title={`${shortCode} · ${item.filename} · ${Math.round(item.confidence * 100)}%`}
                                    className={`inline-flex overflow-hidden rounded-full border text-[11px] font-bold transition ${isLastPreviewed ? 'ring-2 ring-teal-500 ring-offset-2 ring-offset-white shadow-sm' : ''} ${item.confidence >= 0.7 ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : item.confidence >= 0.5 ? 'border-amber-100 bg-amber-50 text-amber-700' : 'border-red-100 bg-red-50 text-red-700'}`}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => navigateReviewTo(item, cluster?.key || folder.code, items)}
                                      className="px-2 py-1 transition hover:bg-white/70"
                                    >
                                      {shortCode}{isLastPreviewed ? ' · last' : ''}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.preventDefault()
                                        event.stopPropagation()
                                        void removeClusterFile(item, cluster?.key || folder.code)
                                      }}
                                      aria-label={`Remove ${item.filename}`}
                                      className="border-l border-current/20 px-1.5 py-1 transition hover:bg-rose-100 hover:text-rose-700"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  </span>
                                )
                              })}
                              {group.items.length > 8 ? <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-500">+{group.items.length - 8}</span> : null}
                            </div>
                          </div>
                        )) : <div className="rounded-lg border border-dashed border-slate-200 bg-white/60 p-3 text-xs text-slate-400">No organized files yet.</div>}
                      </div>
                      {cluster && items.length ? (
                        <div className="mt-3 rounded-lg border border-white bg-white p-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <p className="text-xs font-bold text-slate-800">Monthly classification</p>
                              <p className="mt-0.5 text-[11px] text-slate-500">Active only after files are grouped into folders 1-13.</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => runLocalMonthCluster(cluster.key)}
                              disabled={Boolean(busy) || monthCluster?.status === 'running'}
                              className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                            >
                              {monthCluster?.status === 'running' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock3 className="h-3.5 w-3.5" />}
                              Detect months
                            </button>
                          </div>
                          {monthCluster ? (
                            <div className="mt-2">
                              <p className="text-[11px] font-semibold text-slate-500">
                                {monthCluster.status === 'running' ? monthCluster.detail : `${monthCluster.detected} month(s) detected · ${monthCluster.unknown} unknown`}
                              </p>
                              {monthCluster.log && monthCluster.log.length > 0 && (
                                <div className="mt-2 space-y-1">
                                  {monthCluster.log.map((entry, idx) => {
                                    const logKey = `${cluster.key}::${entry.hash ?? idx}`
                                    const cs = candidateStates[logKey]
                                    const stagedFiles = stagedFolderFilesRef.current
                                    const entryFile = entry.hash ? stagedFiles.find((f) => {
                                      const bn = f.webkitRelativePath ? f.webkitRelativePath.split('/').pop()! : f.name
                                      return bn === entry.filename || f.name === entry.filename
                                    }) : null
                                    return (
                                      <div key={logKey} className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5">
                                        <div className="flex flex-wrap items-start gap-1.5">
                                          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${entry.source === 'rules' ? 'bg-emerald-100 text-emerald-700' : entry.source === 'groq' ? 'bg-violet-100 text-violet-700' : entry.source === 'error' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                                            {entry.source === 'rules' ? 'rules' : entry.source === 'groq' ? 'AI detected' : entry.source === 'error' ? 'error' : 'Needs review'}
                                          </span>
                                          <span className="truncate text-[11px] text-slate-700">{entry.filename}</span>
                                          <span className="text-[11px] text-slate-500">· {entry.result}</span>
                                          {entry.phrase && <span className="rounded bg-slate-200 px-1 py-0.5 font-mono text-[10px] text-slate-600">{entry.phrase}</span>}
                                        </div>
                                        {/* Interactive zone: always shown for unknown/groq entries */}
                                        {(entry.source === 'unknown' || entry.source === 'groq') && (
                                          <div className="mt-2 space-y-1.5 pl-0.5">
                                            {/* "Find dates" scan — only available when file is in memory */}
                                            {cs?.status !== 'saved' && cs?.status !== 'saving' && cs?.status !== 'loading' && (
                                              <div className="flex flex-wrap items-center gap-1.5">
                                                {entryFile ? (
                                                  <button
                                                    type="button"
                                                    onClick={() => void loadDateCandidates(logKey, entryFile, cluster.code)}
                                                    className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-600 hover:bg-slate-100"
                                                  >
                                                    <Search className="h-2.5 w-2.5" />
                                                    Find dates in this file
                                                  </button>
                                                ) : (
                                                  <span className="text-[10px] text-slate-400">File not in memory — type the date below</span>
                                                )}
                                              </div>
                                            )}
                                            {/* Scanning spinner */}
                                            {cs?.status === 'loading' && (
                                              <span className="inline-flex items-center gap-1 text-[10px] text-slate-400"><Loader2 className="h-2.5 w-2.5 animate-spin" />Scanning for dates…</span>
                                            )}
                                            {/* Candidate list after scan */}
                                            {cs?.status === 'loaded' && (
                                              <div className="space-y-1">
                                                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                                                  {(cs.candidates ?? []).length > 0 ? 'Which date is the reference period?' : 'No date candidates found — type below'}
                                                </p>
                                                {(cs.candidates ?? []).map((candidate, ci) => (
                                                  <button
                                                    key={ci}
                                                    type="button"
                                                    onClick={() => void acceptCandidate(logKey, cluster.key, entry.hash ?? '', cluster.code, candidate)}
                                                    className="flex w-full items-start gap-2 rounded border border-slate-200 bg-white px-2 py-1 text-left hover:border-teal-400 hover:bg-teal-50"
                                                  >
                                                    <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full border border-slate-400 bg-white" />
                                                    <div className="min-w-0 flex-1">
                                                      <span className="font-mono text-[11px] font-bold text-slate-800">{candidate.phrase}</span>
                                                      <span className="ml-1.5 text-[10px] text-slate-500 line-clamp-1">{candidate.context}</span>
                                                    </div>
                                                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${candidate.score >= 0.7 ? 'bg-emerald-100 text-emerald-700' : candidate.score >= 0.5 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                                                      {Math.round(candidate.score * 100)}%
                                                    </span>
                                                  </button>
                                                ))}
                                              </div>
                                            )}
                                            {/* Text input: always visible as fallback (idle + loaded states) */}
                                            {(!cs || cs.status === 'idle' || cs.status === 'loaded') && (
                                              <div className="flex items-center gap-1.5">
                                                <input
                                                  type="text"
                                                  placeholder={cs?.status === 'loaded' ? 'Or type the date you see…' : 'Type the reference date (e.g. 30.09.2025)'}
                                                  value={cs?.phraseInput ?? ''}
                                                  onChange={(e) => setCandidateStates((current) => ({ ...current, [logKey]: { ...(current[logKey] ?? { status: 'idle' }), phraseInput: e.target.value } }))}
                                                  className="flex-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
                                                />
                                                <button
                                                  type="button"
                                                  disabled={!cs?.phraseInput?.trim()}
                                                  onClick={() => void saveAnchorPhrase(logKey, cluster.code, cs!.phraseInput!.trim())}
                                                  className="rounded border border-teal-300 bg-teal-50 px-2 py-1 text-[10px] font-bold text-teal-800 hover:bg-teal-100 disabled:opacity-40"
                                                >
                                                  Save
                                                </button>
                                              </div>
                                            )}
                                            {cs?.status === 'saving' && (
                                              <span className="inline-flex items-center gap-1 text-[10px] text-slate-400"><Loader2 className="h-2.5 w-2.5 animate-spin" />Saving…</span>
                                            )}
                                            {cs?.status === 'saved' && (
                                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700"><Check className="h-2.5 w-2.5" />Saved — re-cluster to apply</span>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>




            {clusterResult ? (
              <section id="generate-section" className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Step 3 · Confirm detected periods</p>
                    <h2 className="mt-1 text-lg font-bold">Available year/months found after clustering</h2>
                    <p className="mt-1 text-sm text-slate-500">The system detects periods from valid clustered documents first. All available periods are selected by default; deselect any month you do not want to generate now.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => setSelectedPeriodKeys(detectedPeriods.map((period) => period.key))} disabled={!detectedPeriods.length} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Select all</button>
                    <button onClick={() => setSelectedPeriodKeys([])} disabled={!detectedPeriods.length} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Clear</button>
                    <button
                      onClick={() => void confirmClassification()}
                      disabled={confirmClassificationStatus === 'saving' || !clusterResult?.groupedItems}
                      className={`inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-xs font-bold transition disabled:opacity-50 ${confirmClassificationStatus === 'saved' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : confirmClassificationStatus === 'error' ? 'border-rose-300 bg-rose-50 text-rose-800' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
                    >
                      {confirmClassificationStatus === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : confirmClassificationStatus === 'saved' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <FolderCheck className="h-3.5 w-3.5" />}
                      {confirmClassificationStatus === 'saving' ? 'Confirming...' : confirmClassificationStatus === 'saved' ? 'Classification confirmed' : confirmClassificationStatus === 'error' ? 'Error — retry' : 'Confirm classification'}
                    </button>
                    <button onClick={() => void generateSelectedBaseJoins()} disabled={!selectedPeriods.length || Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl bg-[#176b61] px-4 py-2 text-xs font-bold text-white disabled:bg-slate-200 disabled:text-slate-500">{busy === 'generate-selected-base' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileStack className="h-4 w-4" />}Generate Base Join ({selectedPeriods.length})</button>
                  </div>
                </div>
                {pendingDownloads.length > 0 ? (
                  <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                    <p className="text-sm font-bold text-emerald-800">Base Joins ready — download your files:</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {pendingDownloads.map((dl) => (
                        <button key={`${dl.year}-${dl.month}`} onClick={() => downloadBaseJoin(workspace.company.id, selectedProjectId, dl.year, dl.month, dl.filename)} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800">
                          <FileStack className="h-3.5 w-3.5" />{monthNames[dl.month - 1]} {dl.year}
                        </button>
                      ))}
                      <button onClick={() => setPendingDownloads([])} className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-50">Dismiss</button>
                    </div>
                  </div>
                ) : null}

                {detectedPeriods.length ? (
                  <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
                    {detectedPeriods.map((period) => {
                      const selected = selectedPeriodKeys.includes(period.key)
                      return (
                        <button key={period.key} type="button" onClick={() => toggleSelectedPeriod(period.key)} className={`rounded-xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${selected ? 'border-teal-600 bg-teal-50 ring-2 ring-teal-100' : 'border-slate-200 bg-slate-50 hover:bg-white'}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-bold text-slate-900">{monthNames[period.month - 1]} {period.year}</p>
                              <p className="mt-1 text-xs text-slate-500">{period.groupedCount}/{period.count} valid clustered file(s)</p>
                            </div>
                            <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${selected ? 'bg-teal-600 text-white' : 'bg-white text-slate-500'}`}>{selected ? 'Selected' : 'Skipped'}</span>
                          </div>
                          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                            <div className="h-full rounded-full bg-teal-600" style={{ width: `${Math.max(8, Math.round((period.groupedCount / Math.max(1, period.count)) * 100))}%` }} />
                          </div>
                          <span onClick={(event) => { event.stopPropagation(); void openPeriod(period.year, period.month) }} className="mt-3 inline-flex text-xs font-bold text-teal-700 hover:underline">Open workspace</span>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">No reliable year/month was detected yet. Grouping by type is still available, but period generation needs review.</div>
                )}
              </section>
            ) : null}

            {/* Folder 14 — Base Joins organized by month (cards are divs, no nested buttons) */}
            <section className="mb-6 rounded-2xl border-2 border-emerald-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-4 mb-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-700 text-white text-sm font-black">14</span>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Folder 14 — Base Join</p>
                    <h2 className="mt-0.5 text-lg font-bold">Base Joins by month — folders 02–13 merged</h2>
                  </div>
                </div>
                <button onClick={() => { void loadBaseJoinLibrary(workspace.company.id) }} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">
                  <RefreshCw className="h-3.5 w-3.5" />Refresh
                </button>
              </div>
              {baseJoinLibrary.filter((e) => e.companyId === workspace.company.id).length === 0 ? (
                <p className="rounded-xl border border-dashed border-emerald-200 bg-emerald-50/40 px-4 py-6 text-center text-sm text-emerald-700">No Base Joins generated yet. Use <strong>Generate Base Join</strong> above to create one.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {baseJoinLibrary.filter((e) => e.companyId === workspace.company.id).map((entry) => {
                    const isSelected = selectedBaseJoinFilename === entry.filename
                    const isCurrentPeriod = entry.year === workspace.year && entry.month === workspace.month
                    return (
                      <div key={entry.filename}
                        className={`rounded-xl border transition ${isSelected ? 'border-teal-600 bg-teal-50 ring-2 ring-teal-100' : 'border-slate-200 bg-slate-50'}`}>
                        {/* Top: click to select */}
                        <div className="cursor-pointer p-4 hover:bg-black/[.03] rounded-t-xl"
                          onClick={() => setSelectedBaseJoinFilename(isSelected ? null : entry.filename)}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-slate-900">{monthNames[entry.month - 1]} {entry.year}</p>
                              <p className="mt-0.5 truncate font-mono text-[10px] text-slate-400">{entry.filename}</p>
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-1">
                              {isSelected && <span className="rounded-full bg-teal-600 px-2 py-0.5 text-[10px] font-black text-white">Selected</span>}
                              {isCurrentPeriod && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Current</span>}
                            </div>
                          </div>
                          <p className="mt-2 text-[11px] text-slate-400">{(entry.sizeBytes / 1024).toFixed(0)} KB · {new Date(entry.generatedAt).toLocaleDateString()}</p>
                          <p className="mt-1 text-[10px] text-slate-400">{isSelected ? '✓ Selected for Final Join' : 'Click to select for Final Join'}</p>
                        </div>
                        {/* Bottom: action buttons — completely separate from the select area */}
                        <div className="flex border-t border-slate-200">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              openPdfPreview(entry.filename, setPreviewBaseJoinFilename, previewBaseJoinFilename)
                            }}
                            className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-[11px] font-bold transition rounded-bl-xl ${previewBaseJoinFilename === entry.filename ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                            <Search className="h-3 w-3" />{previewBaseJoinFilename === entry.filename ? 'Close' : 'Preview'}
                          </button>
                          <div className="w-px bg-slate-200" />
                          <a
                            href={`/api/smartcomprovante/download?type=file&filename=${encodeURIComponent(entry.filename)}`}
                            download={entry.filename}
                            onClick={(e) => e.stopPropagation()}
                            className="flex flex-1 items-center justify-center gap-1.5 rounded-br-xl bg-white py-2 text-[11px] font-bold text-slate-600 hover:bg-slate-50">
                            <Download className="h-3 w-3" />Download
                          </a>
                          <div className="w-px bg-slate-200" />
                          <button
                            type="button"
                            onClick={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              void deleteGeneratedPdf(entry.filename, 'base', entry.year, entry.month)
                            }}
                            aria-label={`Delete ${entry.filename}`}
                            className="flex w-10 items-center justify-center rounded-br-xl bg-white py-2 text-rose-500 transition hover:bg-rose-50 hover:text-rose-700"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              {selectedBaseJoinFilename && (
                <div className="mt-4 flex items-center gap-3 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3">
                  <FileStack className="h-5 w-5 shrink-0 text-teal-700" />
                  <p className="flex-1 text-sm font-bold text-teal-900">Selected for Final Join: <span className="font-mono font-normal">{selectedBaseJoinFilename}</span></p>
                  <button onClick={() => setSelectedBaseJoinFilename(null)} className="rounded-lg border border-teal-200 bg-white p-1.5 hover:bg-slate-50"><X className="h-3.5 w-3.5 text-slate-500" /></button>
                </div>
              )}

              {previewBaseJoinFilename && (
                <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                  <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <FileStack className="h-4 w-4 text-emerald-700" />
                      <p className="text-xs font-bold text-slate-700">{previewBaseJoinFilename}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <a href={`/api/smartcomprovante/download?type=file&filename=${encodeURIComponent(previewBaseJoinFilename)}`} download={previewBaseJoinFilename}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                        <Download className="h-3.5 w-3.5" />Download
                      </a>
                      {(() => {
                        const entry = baseJoinLibrary.find((item) => item.filename === previewBaseJoinFilename)
                        return entry ? (
                          <button
                            type="button"
                            onClick={() => void deleteGeneratedPdf(entry.filename, 'base', entry.year, entry.month)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50"
                          >
                            <X className="h-3.5 w-3.5" />Delete
                          </button>
                        ) : null
                      })()}
                      <button onClick={() => setPreviewBaseJoinFilename(null)} className="rounded-lg p-1.5 hover:bg-slate-100"><X className="h-4 w-4 text-slate-500" /></button>
                    </div>
                  </div>
                  <PdfDateMarker
                    key={previewBaseJoinFilename}
                    sourceUrl={`/api/smartcomprovante/download?type=file&inline=1&filename=${encodeURIComponent(previewBaseJoinFilename)}`}
                    mode="preview"
                    picked={null}
                    onPick={() => undefined}
                  />
                </div>
              )}
            </section>

            {/* Folder 15 — Final Join per employee per month */}
            <section className="mb-6 rounded-2xl border-2 border-violet-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-4 mb-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-700 text-white text-sm font-black">15</span>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-violet-700">Folder 15 — Final Comprovante</p>
                    <h2 className="mt-0.5 text-lg font-bold">Final Join per employee — payslip + Base Join</h2>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => void loadFolder1Payslips(workspace.company.id, workspace.year)} disabled={!selectedBaseJoinFilename}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-violet-700 px-3 py-2 text-xs font-bold text-white hover:bg-violet-800 disabled:bg-slate-200 disabled:text-slate-500">
                    <Search className="h-3.5 w-3.5" />
                    {folder1Loaded ? 'Re-read names' : 'Read names from Folder 1'}
                  </button>
                  <button onClick={() => void loadFinalJoinLibrary(workspace.company.id)} disabled={!selectedBaseJoinFilename}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                    <RefreshCw className="h-3.5 w-3.5" />Refresh library
                  </button>
                </div>
              </div>

              {/* Step 1: Base Join selection reminder */}
              {!selectedBaseJoinFilename ? (
                <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <strong>Step 1:</strong> Select a Base Join from Folder 14 above to use as the shared evidence for this month.
                </div>
              ) : (
                <div className="mb-5 flex items-center gap-3 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm">
                  <Check className="h-4 w-4 shrink-0 text-teal-700" />
                  <p className="text-teal-800"><strong>Base Join selected:</strong> <span className="font-mono text-xs">{selectedBaseJoinFilename}</span></p>
                </div>
              )}

              {selectedBaseJoinFilename ? (
                <>
              {/* Step 2: Employees from Folder 1 */}
              <p className="mb-3 text-sm font-bold text-slate-700">Step 2 — Payslips from Folder 01_RV{folder1Loaded ? ` (${folder1Payslips.length} detected)` : ''}</p>

              {!folder1Loaded ? (
                <p className="rounded-xl border border-dashed border-violet-200 bg-violet-50/40 px-4 py-8 text-center text-sm text-violet-700">
                  Click <strong>Read names from Folder 1</strong> above to detect employees from uploaded payslips (01_RV_ files).
                </p>
              ) : folder1Payslips.length === 0 ? (
                <p className="rounded-xl border border-dashed border-violet-200 bg-violet-50/40 px-4 py-6 text-center text-sm text-violet-700">No payslips detected in Folder 01_RV. Upload files with <strong>01_RV_</strong> prefix or directly to folder 1.</p>
              ) : (
                <>
                  {/* Batch toolbar */}
                  <div className="mb-3 flex items-center gap-3 rounded-xl border border-violet-100 bg-violet-50/50 px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={selectedPayslipFilenames.length === folder1Payslips.length}
                      ref={(el) => { if (el) el.indeterminate = selectedPayslipFilenames.length > 0 && selectedPayslipFilenames.length < folder1Payslips.length }}
                      onChange={(e) => setSelectedPayslipFilenames(e.target.checked ? folder1Payslips.map((p) => p.filename) : [])}
                      className="h-4 w-4 rounded accent-violet-700"
                    />
                    <span className="flex-1 text-xs font-bold text-slate-600">
                      {selectedPayslipFilenames.length > 0 ? `${selectedPayslipFilenames.length} of ${folder1Payslips.length} selected` : 'Select employees to generate'}
                    </span>
                    <button
                      disabled={!selectedPayslipFilenames.length || !selectedBaseJoinFilename || batchGeneratingFinals}
                      onClick={() => void generateBatchFinals()}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-violet-700 px-4 py-2 text-xs font-bold text-white hover:bg-violet-800 disabled:opacity-40"
                    >
                      {batchGeneratingFinals ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
                      Generate for selected ({selectedPayslipFilenames.length})
                    </button>
                  </div>

                  <div className="overflow-hidden rounded-xl border border-slate-200">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50">
                          <th className="px-3 py-2.5 w-8" />
                          <th className="px-4 py-2.5 text-left text-xs font-bold text-slate-500">Employee / File</th>
                          <th className="px-4 py-2.5 text-left text-xs font-bold text-slate-500">Period</th>
                          <th className="px-4 py-2.5 text-left text-xs font-bold text-slate-500">Generated</th>
                          <th className="px-4 py-2.5 text-right text-xs font-bold text-slate-500">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {folder1Payslips.map((payslip) => {
                          const safeCode = payslip.filename.replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 40)
                          const existingFinals = finalJoinLibrary.filter((f) => f.companyId === workspace.company.id && f.employeeCode === safeCode)
                          const isGenerating = generatingFinalFor === payslip.filename
                          const isChecked = selectedPayslipFilenames.includes(payslip.filename)
                          return (
                            <tr key={payslip.filename} className={`hover:bg-slate-50 ${isChecked ? 'bg-violet-50/40' : ''}`}>
                              <td className="px-3 py-3">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => setSelectedPayslipFilenames((prev) =>
                                    e.target.checked ? [...prev, payslip.filename] : prev.filter((f) => f !== payslip.filename)
                                  )}
                                  className="h-4 w-4 rounded accent-violet-700"
                                />
                              </td>
                              <td className="px-4 py-3">
                                <p className="font-semibold text-slate-900">{payslip.employeeName}</p>
                                <p className="font-mono text-[11px] text-slate-400 truncate max-w-[220px]">{payslip.filename}</p>
                              </td>
                              <td className="px-4 py-3">
                                {selectedBaseJoinFilename ? (() => {
                                  const bjMatch = selectedBaseJoinFilename.match(/^BJ_(\d{4})(\d{2})_/)
                                  return bjMatch ? <span className="rounded-full bg-teal-50 px-2 py-1 text-xs font-bold text-teal-700">{monthNames[parseInt(bjMatch[2]) - 1]} {bjMatch[1]}</span> : <span className="text-xs text-slate-400">—</span>
                                })() : <span className="text-xs text-slate-400">Select Base Join first</span>}
                              </td>
                              <td className="px-4 py-3">
                                {existingFinals.length > 0 ? (
                                  <div className="flex flex-wrap gap-1">
                                    {existingFinals.map((f) => (
                                      <span key={f.filename} className="inline-flex overflow-hidden rounded-lg border border-violet-100 bg-violet-50 text-[11px] font-bold text-violet-700">
                                        <button
                                          type="button"
                                          onClick={() => openPdfPreview(f.filename, setPreviewFinalJoinFilename, previewFinalJoinFilename)}
                                          className={`inline-flex items-center gap-1 px-2 py-1 hover:bg-violet-100 ${previewFinalJoinFilename === f.filename ? 'bg-violet-700 text-white' : ''}`}
                                        >
                                          <Search className="h-3 w-3" />{monthNames[f.month - 1]} {f.year}
                                        </button>
                                        <a href={`/api/smartcomprovante/download?type=file&filename=${encodeURIComponent(f.filename)}`} download={f.filename}
                                          className="inline-flex items-center border-l border-violet-200 px-1.5 py-1 hover:bg-violet-100" aria-label={`Download ${f.filename}`}>
                                          <Download className="h-3 w-3" />
                                        </a>
                                        <button
                                          type="button"
                                          onClick={() => void deleteGeneratedPdf(f.filename, 'final', f.year, f.month)}
                                          className="inline-flex items-center border-l border-violet-200 px-1.5 py-1 text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                                          aria-label={`Delete ${f.filename}`}
                                        >
                                          <X className="h-3 w-3" />
                                        </button>
                                      </span>
                                    ))}
                                  </div>
                                ) : <span className="text-xs text-slate-400">Not generated yet</span>}
                              </td>
                              <td className="px-4 py-3 text-right">
                                {selectedBaseJoinFilename ? (() => {
                                  const bjMatch = selectedBaseJoinFilename.match(/^BJ_(\d{4})(\d{2})_/)
                                  const bjYear = bjMatch ? parseInt(bjMatch[1]) : workspace.year
                                  const bjMonth = bjMatch ? parseInt(bjMatch[2]) : workspace.month
                                  return (
                                    <button
                                      disabled={isGenerating || batchGeneratingFinals}
                                      onClick={() => void generateCustomFinal(payslip, selectedBaseJoinFilename, bjYear, bjMonth)}
                                      className="inline-flex items-center gap-1.5 rounded-xl bg-violet-700 px-3 py-2 text-xs font-bold text-white hover:bg-violet-800 disabled:opacity-40"
                                    >
                                      {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
                                      {isGenerating ? 'Generating...' : 'Generate'}
                                    </button>
                                  )
                                })() : (
                                  <span className="text-xs text-slate-400">Select Base Join</span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              <div className="mt-5 rounded-xl border border-violet-100 bg-violet-50/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-violet-950">Generated Final Joins by month</p>
                    <p className="mt-0.5 text-xs text-violet-700">Previously generated comprovantes stay grouped here for preview or download.</p>
                  </div>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-violet-700">{finalJoinLibrary.filter((entry) => entry.companyId === workspace.company.id).length} file(s)</span>
                </div>
                {finalJoinMonthGroups.length ? (
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    {finalJoinMonthGroups.map((group) => (
                      <div key={group.key} className="rounded-xl border border-violet-100 bg-white p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-black uppercase tracking-wide text-violet-700">{group.label}</p>
                          <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-700">{group.items.length} file(s)</span>
                        </div>
                        <div className="mt-2 space-y-1.5">
                          {group.items.map((entry) => (
                            <div key={entry.filename} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[11px] font-bold text-slate-700">{entry.employeeCode}</p>
                                <p className="truncate font-mono text-[10px] text-slate-400">{entry.filename}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => openPdfPreview(entry.filename, setPreviewFinalJoinFilename, previewFinalJoinFilename)}
                                className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold ${previewFinalJoinFilename === entry.filename ? 'bg-violet-700 text-white' : 'bg-white text-violet-700 hover:bg-violet-50'}`}
                              >
                                <Search className="h-3 w-3" />{previewFinalJoinFilename === entry.filename ? 'Close' : 'Preview'}
                              </button>
                              <a href={`/api/smartcomprovante/download?type=file&filename=${encodeURIComponent(entry.filename)}`} download={entry.filename}
                                className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-100">
                                <Download className="h-3 w-3" />Download
                              </a>
                              <button
                                type="button"
                                onClick={() => void deleteGeneratedPdf(entry.filename, 'final', entry.year, entry.month)}
                                className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-[11px] font-bold text-rose-600 hover:bg-rose-50"
                                aria-label={`Delete ${entry.filename}`}
                              >
                                <X className="h-3 w-3" />Delete
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 rounded-lg border border-dashed border-violet-200 bg-white/70 p-3 text-xs text-violet-700">No Final Joins generated yet.</p>
                )}
              </div>

              {previewFinalJoinFilename && (
                <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                  <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <FileCheck2 className="h-4 w-4 shrink-0 text-violet-700" />
                      <p className="truncate text-xs font-bold text-slate-700">{previewFinalJoinFilename}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <a href={`/api/smartcomprovante/download?type=file&filename=${encodeURIComponent(previewFinalJoinFilename)}`} download={previewFinalJoinFilename}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                        <Download className="h-3.5 w-3.5" />Download
                      </a>
                      {(() => {
                        const entry = finalJoinLibrary.find((item) => item.filename === previewFinalJoinFilename)
                        return entry ? (
                          <button
                            type="button"
                            onClick={() => void deleteGeneratedPdf(entry.filename, 'final', entry.year, entry.month)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50"
                          >
                            <X className="h-3.5 w-3.5" />Delete
                          </button>
                        ) : null
                      })()}
                      <button onClick={() => setPreviewFinalJoinFilename(null)} className="rounded-lg p-1.5 hover:bg-slate-100"><X className="h-4 w-4 text-slate-500" /></button>
                    </div>
                  </div>
                  <PdfDateMarker
                    key={previewFinalJoinFilename}
                    sourceUrl={`/api/smartcomprovante/download?type=file&inline=1&filename=${encodeURIComponent(previewFinalJoinFilename)}`}
                    mode="preview"
                    picked={null}
                    onPick={() => undefined}
                  />
                </div>
              )}
                </>
              ) : null}

            </section>


          </>)) : null}

          {appSide === 'internal' && view === 'review' ? <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-6 py-5"><h2 className="text-lg font-bold">Human review</h2><p className="mt-1 text-sm text-slate-500">Validate the destination. Approved corrections are added to this company's rules.</p></div>
            <div className="divide-y divide-slate-100">
              {workspace.reviews.map((review) => <div key={review.id} className="grid grid-cols-[1fr_110px_250px_220px] items-center gap-5 px-6 py-5">
                <div><div className="flex items-center gap-2"><FileCheck2 className="h-4 w-4 text-slate-400" /><p className="font-semibold">{review.filename}</p></div><p className="mt-2 text-sm text-slate-500">{review.reason}</p><p className="mt-2 text-xs text-slate-400">{review.targetMonth && review.targetYear ? `Period detected: ${String(review.targetMonth).padStart(2, '0')}/${review.targetYear}` : 'Period not confirmed'}{review.employeeName ? ` · ${review.employeeName}` : ''}</p>{review.sourceHash ? <button onClick={() => setPreviewReviewId((current) => current === review.id ? null : review.id)} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-50"><FileCheck2 className="h-3.5 w-3.5" />{previewReviewId === review.id ? 'Close preview' : 'View first 3 pages'}</button> : <p className="mt-3 text-xs text-slate-400">Preview available for uploaded files.</p>}</div>
                <div><p className="text-xs text-slate-400">Confidence</p><p className="mt-1 font-bold text-amber-700">{Math.round(review.confidence * 100)}%</p></div>
                <div>{review.status === 'pending' ? <><label className="text-xs font-semibold text-slate-500">Destination folder</label><select value={reviewDestinations[review.id] ?? review.proposedCode} onChange={(event) => setReviewDestinations((current) => ({ ...current, [review.id]: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-teal-600"><option value="UNKNOWN" disabled>Choose destination</option>{workspace.folders.map((folder) => <option key={folder.code} value={folder.code}>{String(folder.number).padStart(2, '0')}_{folder.code} · {folder.label}</option>)}</select></> : <div><StatusPill status={review.status} /><p className="mt-2 font-mono text-xs text-slate-400">{review.proposedCode} · rules v{workspace.company.rulesVersion}</p></div>}</div>
                <div className="flex justify-end gap-2">{review.status === 'pending' ? <><button onClick={() => void runAction('pass-review', review.id)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold hover:bg-slate-50">Pass</button><button onClick={() => void runAction('approve-review', review.id, reviewDestinations[review.id] ?? review.proposedCode)} disabled={(reviewDestinations[review.id] ?? review.proposedCode) === 'UNKNOWN'} className="inline-flex items-center gap-2 rounded-xl bg-[#176b61] px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500"><Check className="h-4 w-4" />Approve &amp; learn</button></> : <span className="text-sm text-slate-400">Decision recorded</span>}</div>
                {previewReviewId === review.id && review.sourceHash ? <div className="col-span-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-100"><div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2"><p className="text-xs font-semibold text-slate-600">Protected excerpt · max 3 pages · original is not downloaded</p><button onClick={() => setPreviewReviewId(null)} className="rounded p-1 hover:bg-slate-100" aria-label="Close preview"><X className="h-4 w-4" /></button></div><iframe title={`Preview ${review.filename}`} src={`/api/smartcomprovante/preview?hash=${encodeURIComponent(review.sourceHash)}`} className="h-[620px] w-full bg-slate-200" /></div> : null}
              </div>)}
              {pendingReviews === 0 ? <div className="p-12 text-center"><Check className="mx-auto h-8 w-8 text-emerald-600" /><p className="mt-3 font-semibold">Review complete</p><button onClick={() => setView('workspace')} className="mt-4 text-sm font-semibold text-teal-700">Back to workspace</button></div> : null}
            </div>
          </section> : null}

          {appSide === 'internal' && view === 'settings' ? <div className="grid gap-6 xl:grid-cols-2"><section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center gap-3"><div className="rounded-xl bg-violet-50 p-2.5 text-violet-700"><KeyRound className="h-5 w-5" /></div><div><h2 className="font-bold">AI provider</h2><p className="text-sm text-slate-500">{provider?.model || 'gemini-2.5-flash'} · per-batch consent</p></div></div><div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-center justify-between"><span className="text-sm font-semibold">Credential</span><span className={`text-xs font-bold ${provider?.configured || credential?.configured ? 'text-emerald-700' : 'text-amber-700'}`}>{provider?.configured || credential?.configured ? 'Configured' : 'Not configured'}</span></div><p className="mt-2 text-xs leading-5 text-slate-500">The key is never stored in the browser, JSON rules, or logs.</p></div>{hasElectronBridge ? <div className="mt-5"><label className="text-sm font-semibold">New Gemini API key</label><input value={keyValue} onChange={(event) => setKeyValue(event.target.value)} type="password" autoComplete="off" placeholder="Enter to save encrypted" className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-teal-600" /><div className="mt-3 flex gap-2"><button onClick={() => void saveKey()} disabled={!keyValue || Boolean(busy)} className="rounded-xl bg-[#176b61] px-4 py-2.5 text-sm font-semibold text-white">Save encrypted</button><button onClick={() => void deleteKey()} disabled={!credential?.configured || Boolean(busy)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold">Delete</button></div>{credential && !credential.encryptionAvailable ? <p className="mt-3 text-sm text-rose-700">OS secure storage is not available. Gemini remains disabled.</p> : null}</div> : <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800"><p className="font-semibold">Browser mode</p><p className="mt-1 leading-6">Set <code>GEMINI_API_KEY</code> in <code>.env.local</code>. In the Electron app, the key is stored via the OS credential vault.</p></div>}</section><section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center gap-3"><div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-700"><LockKeyhole className="h-5 w-5" /></div><div><h2 className="font-bold">SharePoint &amp; retention</h2><p className="text-sm text-slate-500">Compact physical naming profile</p></div></div><dl className="mt-6 space-y-4 text-sm"><div className="flex justify-between border-b border-slate-100 pb-3"><dt className="text-slate-500">Max filename length</dt><dd className="font-semibold">80 characters</dd></div><div className="flex justify-between border-b border-slate-100 pb-3"><dt className="text-slate-500">Safe local path</dt><dd className="font-semibold">240 characters</dd></div><div className="flex justify-between border-b border-slate-100 pb-3"><dt className="text-slate-500">Temporary cache</dt><dd className="font-semibold">Cleared after delivery</dd></div><div className="flex justify-between"><dt className="text-slate-500">Company rules</dt><dd className="font-semibold">v{workspace.company.rulesVersion} · valid</dd></div></dl><div className="mt-6 flex flex-wrap gap-2"><button onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold"><RefreshCw className="h-4 w-4" />Refresh state</button><button onClick={() => void runAction('reset-demo')} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600"><Clock3 className="h-4 w-4" />Reset demo</button></div></section></div> : null}
        </div>
      </main>

      {dialogs}
    </div>
  )
}
