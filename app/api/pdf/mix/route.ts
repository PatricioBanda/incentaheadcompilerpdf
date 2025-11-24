import { NextRequest, NextResponse } from 'next/server'
import { PDFDocument } from 'pdf-lib'

export async function POST(request: NextRequest) {
  try {
    const { file1, file2 } = await request.json()

    if (!file1 || !file2) {
      return NextResponse.json({ error: '2 PDFs são necessários' }, { status: 400 })
    }

    const pdf1Bytes = Uint8Array.from(atob(file1.data), (c) => c.charCodeAt(0))
    const pdf2Bytes = Uint8Array.from(atob(file2.data), (c) => c.charCodeAt(0))

    const pdf1 = await PDFDocument.load(pdf1Bytes)
    const pdf2 = await PDFDocument.load(pdf2Bytes)

    const mixedPdf = await PDFDocument.create()

    const maxPages = Math.max(pdf1.getPageCount(), pdf2.getPageCount())

    for (let i = 0; i < maxPages; i++) {
      if (i < pdf1.getPageCount()) {
        const [page] = await mixedPdf.copyPages(pdf1, [i])
        mixedPdf.addPage(page)
      }
      if (i < pdf2.getPageCount()) {
        const [page] = await mixedPdf.copyPages(pdf2, [i])
        mixedPdf.addPage(page)
      }
    }

    const mixedPdfBytes = await mixedPdf.save()

    return new NextResponse(mixedPdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="mixed.pdf"',
      },
    })
  } catch (error) {
    console.error('Error mixing PDFs:', error)
    return NextResponse.json({ error: 'Erro ao misturar PDFs' }, { status: 500 })
  }
}
