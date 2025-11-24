import { NextRequest, NextResponse } from 'next/server'
import { PDFDocument } from 'pdf-lib'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const pdfDoc = await PDFDocument.load(arrayBuffer)
    const pageCount = pdfDoc.getPageCount()

    const pages = Array.from({ length: pageCount }, (_, i) => i + 1)

    return NextResponse.json({
      fileName: file.name,
      pageCount,
      pages
    })
  } catch (error) {
    console.error('Error extracting pages:', error)
    return NextResponse.json(
      { error: 'Failed to extract pages' },
      { status: 500 }
    )
  }
}
