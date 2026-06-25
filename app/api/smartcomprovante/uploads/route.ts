import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { createHash, randomUUID } from 'crypto'
import type { CustomerUpload, UploadedFile } from '@/lib/smartcomprovante/upload-types'
import { isFirebaseConfigured, storageSave, storageRead, getStorage } from '@/lib/smartcomprovante/firebase'
import { routeLogger } from '@/lib/smartcomprovante/logger'

export const runtime = 'nodejs'
export const maxDuration = 120

const log = routeLogger('uploads')

const DATA_ROOT = process.env.SMARTCOMPROVANTE_DATA_DIR || path.join(process.cwd(), '.smartcomprovante-data')
const UPLOADS_ROOT = path.join(DATA_ROOT, 'uploads')
const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png'])
const MAX_FILE_SIZE = 25 * 1024 * 1024
const MAX_TOTAL_SIZE = 250 * 1024 * 1024

const safeSegment = (value: string) => value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'item'
const inferType = (file: File) => file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : file.name.toLowerCase().endsWith('.png') ? 'image/png' : /\.jpe?g$/i.test(file.name) ? 'image/jpeg' : '')
const storagePath = (companyId: string, year: number, folderNumber: number, uploadId: string) =>
  `uploads/${safeSegment(companyId)}/${year}/folder-${folderNumber}/${uploadId}`
const uploadDir = (companyId: string, year: number, folderNumber: number, uploadId: string) =>
  path.join(UPLOADS_ROOT, safeSegment(companyId), String(year), `folder-${folderNumber}`, uploadId)

// ── Firebase Storage helpers ───────────────────────────────────────────────────

const firebaseSaveUpload = async (upload: CustomerUpload, files: Array<{ name: string; bytes: Buffer; contentType: string }>) => {
  const base = storagePath(upload.companyId, upload.year, upload.folderNumber, upload.id)
  await Promise.all([
    ...files.map((f) => storageSave(`${base}/${f.name}`, f.bytes, f.contentType)),
    storageSave(`${base}/metadata.json`, Buffer.from(JSON.stringify(upload, null, 2)), 'application/json'),
  ])
}

const firebaseGetUpload = async (companyId: string, year: number | null): Promise<CustomerUpload[]> => {
  const bucket = getStorage()
  const prefix = year !== null
    ? `uploads/${safeSegment(companyId)}/${year}/`
    : `uploads/${safeSegment(companyId)}/`
  const [files] = await bucket.getFiles({ prefix, matchGlob: '**/metadata.json' })
  const results = await Promise.all(files.map(async (file) => {
    try {
      const [buf] = await file.download()
      return JSON.parse(buf.toString('utf8')) as CustomerUpload
    } catch { return null }
  }))
  return results.filter((item): item is CustomerUpload => Boolean(item))
}

// ── Local filesystem helpers ───────────────────────────────────────────────────

const listMetadataFiles = async (root: string): Promise<string[]> => {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true })
    const nested = await Promise.all(entries.map(async (entry) => {
      const full = path.join(root, entry.name)
      if (entry.isDirectory()) return listMetadataFiles(full)
      return entry.isFile() && entry.name === 'metadata.json' ? [full] : []
    }))
    return nested.flat()
  } catch {
    return []
  }
}

// ── Route handlers ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const companyId = safeSegment(String(formData.get('companyId') || ''))
    const year = Number(formData.get('year') || '')
    const folderNumber = Number(formData.get('folderNumber') || '')
    const rawMonth = formData.get('month')
    const month = rawMonth === null || rawMonth === '' ? null : Number(rawMonth)
    const files = formData.getAll('files').filter((item): item is File => item instanceof File)

    if (!companyId || !Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(folderNumber) || folderNumber < 0 || folderNumber > 13) {
      return NextResponse.json({ error: 'companyId, year, and folderNumber 0-13 are required.' }, { status: 400 })
    }
    if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) {
      return NextResponse.json({ error: 'month must be empty or between 1 and 12.' }, { status: 400 })
    }
    if (!files.length) return NextResponse.json({ error: 'At least one file is required.' }, { status: 400 })
    if (files.some((file) => !allowedTypes.has(inferType(file)) || file.size > MAX_FILE_SIZE)) {
      return NextResponse.json({ error: 'Use PDF, JPG, or PNG up to 25 MB per file.' }, { status: 400 })
    }
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_SIZE) {
      return NextResponse.json({ error: 'Upload exceeds the 250 MB batch limit.' }, { status: 400 })
    }

    const id = randomUUID()
    const uploadedFiles: UploadedFile[] = []
    const fileBuffers: Array<{ name: string; bytes: Buffer; contentType: string }> = []

    for (const file of files) {
      const bytes = Buffer.from(await file.arrayBuffer())
      const hash = createHash('sha256').update(bytes).digest('hex')
      const filename = safeSegment(file.name)
      const contentType = inferType(file)
      uploadedFiles.push({
        name: filename,
        size: file.size,
        hash,
        contentType,
        url: `/api/smartcomprovante/uploads/${encodeURIComponent(id)}/file/${encodeURIComponent(filename)}`,
      })
      fileBuffers.push({ name: filename, bytes, contentType })
    }

    const upload: CustomerUpload = {
      id,
      companyId,
      year,
      folderNumber,
      month,
      status: 'submitted',
      files: uploadedFiles,
      submittedAt: new Date().toISOString(),
    }

    if (isFirebaseConfigured) {
      await firebaseSaveUpload(upload, fileBuffers)
    } else {
      const dir = uploadDir(companyId, year, folderNumber, id)
      await fs.mkdir(dir, { recursive: true })
      for (const { name, bytes } of fileBuffers) await fs.writeFile(path.join(dir, name), bytes)
      await fs.writeFile(path.join(dir, 'metadata.json'), `${JSON.stringify(upload, null, 2)}\n`, 'utf8')
    }

    log.info({ companyId, year, folderNumber, fileCount: files.length }, 'Upload saved')
    return NextResponse.json({ uploadId: id, upload })
  } catch (error) {
    log.error({ error }, 'Upload POST failed')
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Upload failed.' }, { status: 400 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const companyId = safeSegment(String(request.nextUrl.searchParams.get('companyId') || ''))
    const rawYear = request.nextUrl.searchParams.get('year')
    const year = rawYear ? Number(rawYear) : null
    if (!companyId) return NextResponse.json({ error: 'companyId is required.' }, { status: 400 })
    if (year !== null && !Number.isInteger(year)) return NextResponse.json({ error: 'year must be an integer.' }, { status: 400 })

    let uploads: CustomerUpload[]

    if (isFirebaseConfigured) {
      uploads = await firebaseGetUpload(companyId, year)
    } else {
      const root = year !== null
        ? path.join(UPLOADS_ROOT, companyId, String(year))
        : path.join(UPLOADS_ROOT, companyId)
      const metadataFiles = await listMetadataFiles(root)
      uploads = (await Promise.all(metadataFiles.map(async (file) => {
        try { return JSON.parse(await fs.readFile(file, 'utf8')) as CustomerUpload } catch { return null }
      }))).filter((item): item is CustomerUpload => Boolean(item))
    }

    uploads.sort((left, right) => left.folderNumber - right.folderNumber || left.submittedAt.localeCompare(right.submittedAt))
    return NextResponse.json({ uploads })
  } catch (error) {
    log.error({ error }, 'Upload GET failed')
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not list uploads.' }, { status: 400 })
  }
}
