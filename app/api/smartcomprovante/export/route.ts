import { NextRequest, NextResponse } from 'next/server'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { generateAuditManifest, createExportBundle, getBatchStatistics } from '@/lib/smartcomprovante/store'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      batchId: string
      companyId: string
      year: number
      month: number
      provider: 'gemini' | 'groq' | 'ollama'
      includeAudit?: boolean
    }

    // Generate audit manifest
    const stats = await getBatchStatistics(body.batchId)
    const manifest = await generateAuditManifest(
      body.batchId,
      body.companyId,
      body.year,
      body.month,
      body.provider,
      [] // In real implementation, pass actual call records
    )

    // Create mock PDF for export (in real implementation, merge approved documents)
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([595.28, 841.89])
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
    const regular = await pdf.embedFont(StandardFonts.Helvetica)

    page.drawText('BASE JOIN - APPROVED DOCUMENTS', {
      x: 54,
      y: 760,
      size: 18,
      font: bold,
      color: rgb(0.08, 0.35, 0.31),
    })
    page.drawText(`Batch ID: ${body.batchId}`, { x: 54, y: 720, size: 12, font: regular })
    page.drawText(`Period: ${String(body.month).padStart(2, '0')}/${body.year}`, {
      x: 54,
      y: 696,
      size: 12,
      font: regular,
    })
    page.drawText(`Approved Documents: ${stats.approvedCount}`, {
      x: 54,
      y: 672,
      size: 12,
      font: regular,
    })
    page.drawText(`Review Required: ${stats.reviewCount}`, { x: 54, y: 648, size: 12, font: regular })

    const pdfBuffer = Buffer.from(await pdf.save())

    // Create export bundle
    const bundle = await createExportBundle(body.batchId, body.companyId, body.year, body.month, pdfBuffer)

    return NextResponse.json({
      bundleId: bundle.id,
      filename: bundle.filename,
      batchId: body.batchId,
      status: 'ready',
      manifest: body.includeAudit ? manifest : undefined,
      statistics: stats,
      timestamp: bundle.timestamp,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Não foi possível gerar o ficheiro de exportação.' },
      { status: 400 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const bundleId = request.nextUrl.searchParams.get('bundleId')
    const type = request.nextUrl.searchParams.get('type') || 'base'

    if (!bundleId) return NextResponse.json({ error: 'bundleId é obrigatório.' }, { status: 400 })

    // In real implementation, retrieve from storage
    const filename = type === 'base' ? `BJ_exported.pdf` : `CF_exported.pdf`

    return new NextResponse('PDF content would be here', {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Não foi possível fazer o download.' },
      { status: 400 }
    )
  }
}
