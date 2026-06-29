import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { isFirebaseConfigured, storageRead } from '@/lib/smartcomprovante/firebase'
import { SMARTCOMPROVANTE_DATA_ROOT } from '@/lib/smartcomprovante/paths'

export const runtime = 'nodejs'
export const maxDuration = 30

const DATA_ROOT = SMARTCOMPROVANTE_DATA_ROOT
const UPLOADS_ROOT = path.join(DATA_ROOT, 'uploads')

const safeSegment = (value: string) => value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'item'
const contentTypeFor = (filename: string) => {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  return 'application/octet-stream'
}

const findUploadDirLocal = async (uploadId: string): Promise<string | null> => {
  const queue = [UPLOADS_ROOT]
  while (queue.length) {
    const current = queue.shift()!
    let entries: Array<{ name: string; isDirectory(): boolean }>
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const full = path.join(current, entry.name)
      if (entry.name === uploadId) return full
      queue.push(full)
    }
  }
  return null
}

const findStoragePath = async (uploadId: string, filename: string): Promise<string | null> => {
  const { getStorage } = await import('@/lib/smartcomprovante/firebase')
  const bucket = getStorage()
  // Search under uploads/**/uploadId/filename
  const [files] = await bucket.getFiles({ prefix: 'uploads/' })
  const match = files.find((f) => f.name.includes(`/${uploadId}/${filename}`))
  return match ? match.name : null
}

export async function GET(_request: NextRequest, context: { params: Promise<{ uploadId: string; filename: string }> }) {
  try {
    const params = await context.params
    const uploadId = safeSegment(decodeURIComponent(params.uploadId))
    const filename = safeSegment(decodeURIComponent(params.filename))

    if (isFirebaseConfigured) {
      const storagePath = await findStoragePath(uploadId, filename)
      if (!storagePath) return NextResponse.json({ error: 'Upload not found.' }, { status: 404 })
      const bytes = await storageRead(storagePath)
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          'Content-Type': contentTypeFor(filename),
          'Content-Disposition': 'inline',
          'Cache-Control': 'private, no-store, max-age=0',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }

    const dir = await findUploadDirLocal(uploadId)
    if (!dir) return NextResponse.json({ error: 'Upload not found.' }, { status: 404 })
    const filePath = path.join(dir, filename)
    const resolvedDir = path.resolve(dir)
    const resolvedFile = path.resolve(filePath)
    if (!resolvedFile.startsWith(resolvedDir + path.sep)) return NextResponse.json({ error: 'Invalid file path.' }, { status: 400 })
    const bytes = await fs.readFile(resolvedFile)
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': contentTypeFor(filename),
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return NextResponse.json({ error: 'File not available.' }, { status: 404 })
  }
}
