import { promises as fs } from 'fs'
import path from 'path'
import type { CustomerUpload, UploadStatus } from './upload-types'
import { SMARTCOMPROVANTE_DATA_ROOT } from './paths'

const DATA_ROOT = SMARTCOMPROVANTE_DATA_ROOT
const UPLOADS_ROOT = path.join(DATA_ROOT, 'uploads')

const safeSegment = (v: string) => v.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'item'

async function collectMetadataFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const nested = await Promise.all(entries.map(async (e) => {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) return collectMetadataFiles(full)
      return e.isFile() && e.name === 'metadata.json' ? [full] : []
    }))
    return nested.flat()
  } catch { return [] }
}

export async function listUploads(companyId: string, year: number): Promise<CustomerUpload[]> {
  const root = path.join(UPLOADS_ROOT, safeSegment(companyId), String(year))
  const files = await collectMetadataFiles(root)
  const results = await Promise.all(files.map(async (f) => {
    try { return JSON.parse(await fs.readFile(f, 'utf8')) as CustomerUpload } catch { return null }
  }))
  return results.filter((u): u is CustomerUpload => Boolean(u))
}

export async function updateUploadStatus(companyId: string, year: number, uploadId: string, status: UploadStatus): Promise<void> {
  const pattern = path.join(UPLOADS_ROOT, safeSegment(companyId), String(year))
  const files = await collectMetadataFiles(pattern)
  const target = files.find((f) => f.includes(path.sep + uploadId + path.sep))
  if (!target) return
  try {
    const upload = JSON.parse(await fs.readFile(target, 'utf8')) as CustomerUpload
    upload.status = status
    await fs.writeFile(target, `${JSON.stringify(upload, null, 2)}\n`, 'utf8')
  } catch { /* non-fatal */ }
}

export async function updateUploadStatusByHash(companyId: string, year: number, fileHash: string, status: UploadStatus): Promise<void> {
  const uploads = await listUploads(companyId, year)
  for (const upload of uploads) {
    if (upload.files.some((f) => f.hash === fileHash)) {
      await updateUploadStatus(companyId, year, upload.id, status)
    }
  }
}

export async function archiveUploadsForPeriod(companyId: string, year: number): Promise<void> {
  const uploads = await listUploads(companyId, year)
  const active: UploadStatus[] = ['submitted', 'grouped', 'month_detected', 'approved']
  await Promise.all(
    uploads
      .filter((u) => active.includes(u.status))
      .map((u) => updateUploadStatus(companyId, year, u.id, 'archived'))
  )
}

export async function deleteUploadFileByHash(companyId: string, year: number, fileHash: string): Promise<number> {
  if (!/^[0-9a-f]{64}$/i.test(fileHash)) return 0
  const root = path.join(UPLOADS_ROOT, safeSegment(companyId), String(year))
  const metadataFiles = await collectMetadataFiles(root)
  let deleted = 0

  for (const metadataPath of metadataFiles) {
    try {
      const upload = JSON.parse(await fs.readFile(metadataPath, 'utf8')) as CustomerUpload
      const filesToDelete = upload.files.filter((file) => file.hash === fileHash)
      if (!filesToDelete.length) continue

      const uploadDir = path.dirname(metadataPath)
      for (const file of filesToDelete) {
        await fs.rm(path.join(uploadDir, safeSegment(file.name)), { force: true })
        deleted += 1
      }

      upload.files = upload.files.filter((file) => file.hash !== fileHash)
      if (upload.files.length === 0) {
        await fs.rm(uploadDir, { recursive: true, force: true })
      } else {
        await fs.writeFile(metadataPath, `${JSON.stringify(upload, null, 2)}\n`, 'utf8')
      }
    } catch {
      // Keep deleting other matches even if one stale metadata file is broken.
    }
  }

  return deleted
}

export async function deleteUploadsForCompany(companyId: string): Promise<void> {
  await fs.rm(path.join(UPLOADS_ROOT, safeSegment(companyId)), { recursive: true, force: true })
}
