import { NextRequest, NextResponse } from 'next/server'
import { PDFDocument } from 'pdf-lib'

export async function POST(request: NextRequest) {
  try {
    const { files } = await request.json()

    if (!files || files.length < 2) {
      return NextResponse.json({ error: 'Pelo menos 2 PDFs são necessários' }, { status: 400 })
    }

    const mergedPdf = await PDFDocument.create()

    for (const file of files) {
      const pdfBytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0))
      const pdf = await PDFDocument.load(pdfBytes)
      const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices())
      copiedPages.forEach((page) => mergedPdf.addPage(page))
    }

    const mergedPdfBytes = await mergedPdf.save()

    return new NextResponse(mergedPdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="merged.pdf"',
      },
    })
  } catch (error) {
    console.error('Error merging PDFs:', error)
    return NextResponse.json({ error: 'Erro ao unir PDFs' }, { status: 500 })
  }
}
