import { NextRequest, NextResponse } from 'next/server'
import { deleteCachedClassification, updateWorkspace } from '@/lib/smartcomprovante/store'
import { RH_FOLDERS } from '@/lib/smartcomprovante/taxonomy'
import { deleteUploadFileByHash } from '@/lib/smartcomprovante/upload-store'

export const runtime = 'nodejs'
export const maxDuration = 120

type RemoveFileBody = {
  companyId?: string
  projectId?: string
  year?: number
  month?: number | null
  sourceHash?: string
}

const isHash = (value: string) => /^[0-9a-f]{64}$/i.test(value)

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as RemoveFileBody
    const companyId = body.companyId || ''
    const projectId = body.projectId || 'project-inovacao-01'
    const year = Number(body.year || 0)
    const month = Number(body.month || 0)
    const sourceHash = body.sourceHash || ''

    if (!companyId || !Number.isInteger(year) || year < 2000 || year > 2100 || !isHash(sourceHash)) {
      return NextResponse.json({ error: 'companyId, year, and a valid sourceHash are required.' }, { status: 400 })
    }

    await deleteCachedClassification(companyId, sourceHash)
    const deletedUploads = await deleteUploadFileByHash(companyId, year, sourceHash)

    let workspaceUpdated = false
    if (Number.isInteger(month) && month >= 1 && month <= 12) {
      await updateWorkspace(companyId, year, month, (draft) => {
        const removedReviews = draft.reviews.filter((review) => review.sourceHash === sourceHash)
        const removedApproved = (draft.approvedDocuments || []).filter((doc) => doc.sourceHash === sourceHash)
        draft.reviews = draft.reviews.filter((review) => review.sourceHash !== sourceHash)
        draft.approvedDocuments = (draft.approvedDocuments || []).filter((doc) => doc.sourceHash !== sourceHash)

        const touchedCodes = new Set<string>([
          ...removedReviews.map((review) => review.proposedCode),
          ...removedApproved.map((doc) => doc.folderCode),
        ])
        const touchedNumbers = new Set<number>(removedApproved.map((doc) => doc.folderNumber))
        for (const code of touchedCodes) {
          const folder = RH_FOLDERS.find((item) => item.code === code)
          if (folder) touchedNumbers.add(folder.number)
        }

        draft.folders = draft.folders.map((folder) => {
          if (!touchedNumbers.has(folder.number)) return folder
          const approvedCount = draft.approvedDocuments.filter((doc) => doc.folderNumber === folder.number).length
          const reviewCount = draft.reviews.filter((review) => review.proposedCode === folder.code).length
          const documentCount = approvedCount + reviewCount
          return {
            ...folder,
            documentCount,
            approvedCount,
            reviewCount,
            status: documentCount > 0 ? (approvedCount > 0 ? 'approved' : 'review') : 'missing',
          }
        })

        draft.activity.unshift({
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          text: 'A clustered file was removed from the folder board.',
          tone: 'warning',
        })
        workspaceUpdated = true
        return draft
      }, projectId)
    }

    return NextResponse.json({ ok: true, deletedUploads, workspaceUpdated })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'File removal failed.' }, { status: 400 })
  }
}
