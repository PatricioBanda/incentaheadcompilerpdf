import { NextRequest, NextResponse } from 'next/server'
import { PDFDocument } from 'pdf-lib'

export async function POST(request: NextRequest) {
  try {
    const { file, pages } = await request.json()

    if (!file || !pages) {
      return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
    }

    const pdfBytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0))
    const pdf = await PDFDocument.load(pdfBytes)
    const pageCount = pdf.getPageCount()

    // Parse pages
    const pageIndices: number[] = []
    const parts = pages.split(',')

    for (const part of parts) {
      if (part.includes('-')) {
        const [start, end] = part.split('-').map((n: string) => parseInt(n.trim()))
        for (let i = start; i <= end; i++) {
          if (i > 0 && i <= pageCount) pageIndices.push(i - 1)
        }
      } else {
        const pageNum = parseInt(part.trim())
        if (pageNum > 0 && pageNum <= pageCount) pageIndices.push(pageNum - 1)
      }
    }

    const newPdf = await PDFDocument.create()
    const copiedPages = await newPdf.copyPages(pdf, pageIndices)
    copiedPages.forEach((page) => newPdf.addPage(page))

    const extractedPdfBytes = await newPdf.save()

    return new NextResponse(extractedPdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="extracted.pdf"',
      },
    })
  } catch (error) {
    console.error('Error extracting pages:', error)
    return NextResponse.json({ error: 'Erro ao extrair páginas' }, { status: 500 })
  }
}
