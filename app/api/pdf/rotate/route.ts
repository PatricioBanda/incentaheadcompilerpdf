import { NextRequest, NextResponse } from 'next/server'
import { PDFDocument, degrees } from 'pdf-lib'

export async function POST(request: NextRequest) {
  try {
    const { file, pages, rotation } = await request.json()

    if (!file || !rotation) {
      return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
    }

    const pdfBytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0))
    const pdf = await PDFDocument.load(pdfBytes)
    const pageCount = pdf.getPageCount()

    let pageIndices: number[] = []

    if (pages === 'all') {
      pageIndices = Array.from({ length: pageCount }, (_, i) => i)
    } else {
      // Parse pages
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
    }

    // Rotate pages
    pageIndices.forEach((index) => {
      const page = pdf.getPage(index)
      page.setRotation(degrees(rotation))
    })

    const rotatedPdfBytes = await pdf.save()

    return new NextResponse(rotatedPdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="rotated.pdf"',
      },
    })
  } catch (error) {
    console.error('Error rotating pages:', error)
    return NextResponse.json({ error: 'Erro ao rodar páginas' }, { status: 500 })
  }
}
