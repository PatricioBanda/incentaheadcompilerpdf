import { NextRequest, NextResponse } from 'next/server'
import { PDFDocument } from 'pdf-lib'

export async function POST(request: NextRequest) {
  try {
    const { file, mode, value } = await request.json()

    if (!file || !mode || !value) {
      return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
    }

    const pdfBytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0))
    const pdf = await PDFDocument.load(pdfBytes)
    const pageCount = pdf.getPageCount()

    let splitPoints: number[] = []

    if (mode === 'pages') {
      // Parse pages like "1,3,5" or "2-5"
      const parts = value.split(',')
      for (const part of parts) {
        if (part.includes('-')) {
          const [start, end] = part.split('-').map((n: string) => parseInt(n.trim()))
          for (let i = start; i <= end; i++) {
            if (i > 0 && i <= pageCount) splitPoints.push(i - 1)
          }
        } else {
          const pageNum = parseInt(part.trim())
          if (pageNum > 0 && pageNum <= pageCount) splitPoints.push(pageNum - 1)
        }
      }
      splitPoints = [...new Set(splitPoints)].sort((a, b) => a - b)
    } else if (mode === 'size') {
      const size = parseInt(value)
      for (let i = size; i < pageCount; i += size) {
        splitPoints.push(i)
      }
    }

    // Create split PDFs
    const splitPdfs: Uint8Array[] = []
    let lastIndex = 0

    for (const splitPoint of splitPoints) {
      const newPdf = await PDFDocument.create()
      const pagesToCopy = Array.from({ length: splitPoint - lastIndex }, (_, i) => lastIndex + i)
      const copiedPages = await newPdf.copyPages(pdf, pagesToCopy)
      copiedPages.forEach((page) => newPdf.addPage(page))
      splitPdfs.push(await newPdf.save())
      lastIndex = splitPoint
    }

    // Last chunk
    if (lastIndex < pageCount) {
      const newPdf = await PDFDocument.create()
      const pagesToCopy = Array.from({ length: pageCount - lastIndex }, (_, i) => lastIndex + i)
      const copiedPages = await newPdf.copyPages(pdf, pagesToCopy)
      copiedPages.forEach((page) => newPdf.addPage(page))
      splitPdfs.push(await newPdf.save())
    }

    // For simplicity, return the first split PDF (in production, you'd create a ZIP)
    return new NextResponse(splitPdfs[0], {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="split.pdf"',
      },
    })
  } catch (error) {
    console.error('Error splitting PDF:', error)
    return NextResponse.json({ error: 'Erro ao dividir PDF' }, { status: 500 })
  }
}
