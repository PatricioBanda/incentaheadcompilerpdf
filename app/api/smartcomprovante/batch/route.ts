import { NextRequest, NextResponse } from 'next/server'
import { createDocumentBatch, groupAndSortDocuments, getBatchStatistics, getWorkspace, updateWorkspace } from '@/lib/smartcomprovante/store'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      companyId: string
      year: number
      month: number
      documents: Array<{
        sourceHash: string
        filename: string
        mimeType: string
        classification: { code: string; label: string; confidence: number; reason: string; ruleName?: string; cacheHit?: boolean }
        pageCount: number
        employeeCode?: string
        employeeName?: string
      }>
    }

    const batch = await createDocumentBatch(body.companyId, body.year, body.month, body.documents)
    const grouped = await groupAndSortDocuments(batch.id, body.companyId)

    // Update workspace with batch info
    await updateWorkspace(body.companyId, body.year, body.month, (workspace) => {
      const totalApproved = batch.documents.filter((d: any) => d.confidence > 0.8).length
      const totalReview = batch.documents.filter((d: any) => d.confidence <= 0.8).length

      return {
        ...workspace,
        intakeCount: batch.documents.length,
        folders: workspace.folders.map((folder) => {
          const folderDocs = batch.documents.filter((d: any) => d.folderNumber === folder.number)
          return {
            ...folder,
            status: folderDocs.length > 0 ? 'detected' : folder.status,
            documentCount: folderDocs.length,
            approvedCount: folderDocs.filter((d: any) => d.confidence > 0.8).length,
            reviewCount: folderDocs.filter((d: any) => d.confidence <= 0.8).length,
          }
        }),
      }
    })

    return NextResponse.json({
      batchId: batch.id,
      status: batch.status,
      totalDocuments: batch.documents.length,
      totalPages: batch.totalPages,
      approvedCount: batch.approvedCount,
      reviewCount: batch.reviewCount,
      grouped,
      createdAt: batch.createdAt,
    }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Não foi possível criar o lote.' },
      { status: 400 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const batchId = request.nextUrl.searchParams.get('batchId')
    if (!batchId) return NextResponse.json({ error: 'batchId é obrigatório.' }, { status: 400 })

    const stats = await getBatchStatistics(batchId)
    return NextResponse.json(stats)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Não foi possível obter as estatísticas do lote.' },
      { status: 400 }
    )
  }
}
