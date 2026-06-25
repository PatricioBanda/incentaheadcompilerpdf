export type UploadStatus = 'pending' | 'submitted' | 'processing' | 'grouped' | 'month_detected' | 'needs_review' | 'ready' | 'approved' | 'archived'

export type UploadedFile = {
  name: string
  size: number
  hash?: string
  url?: string
  contentType?: string
}

export type CustomerUpload = {
  id: string
  companyId: string
  year: number
  folderNumber: number
  month?: number | null
  status: UploadStatus
  files: UploadedFile[]
  submittedAt: string
}

export type FileStatus = 'Pending' | 'Submitted' | 'Grouped' | 'Month detected' | 'Needs review' | 'Ready'

export function getFileStatus(input: {
  upload?: CustomerUpload | null
  clusterItem?: { targetYear?: number | null; targetMonth?: number | null; confidence?: number | null } | null
}): FileStatus {
  if (input.clusterItem?.targetYear && input.clusterItem?.targetMonth) return 'Month detected'
  if (input.clusterItem && (input.clusterItem.confidence ?? 0) < 0.7) return 'Needs review'
  if (input.clusterItem) return 'Grouped'
  if (input.upload?.status === 'pending') return 'Pending'
  if (input.upload?.status === 'ready') return 'Ready'
  return 'Submitted'
}

const monthCodes = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

export function buildDocumentDisplayCode(companyCode: string, folderNumber: number, month: number | null | undefined, index: number): string {
  const safeCompany = (companyCode || 'COMP').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'COMP'
  const monthCode = month ? monthCodes[Math.max(0, Math.min(11, month - 1))] : 'UNK'
  return `${safeCompany}-F${String(folderNumber).padStart(2, '0')}-${monthCode}-${String(index + 1).padStart(2, '0')}`
}
