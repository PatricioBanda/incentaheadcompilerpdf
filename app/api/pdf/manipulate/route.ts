import { NextRequest, NextResponse } from 'next/server'
import { PDFDocument, degrees } from 'pdf-lib'

interface PDFPage {
  id: string
  fileName: string
  pageNumber: number
  rotation: number
  pdfData: string
}

export async function POST(request: NextRequest) {
  try {
    const { pages } = await request.json() as { pages: PDFPage[] }

    if (!pages || pages.length === 0) {
      return NextResponse.json({ error: 'No pages provided' }, { status: 400 })
    }

    const mergedPdf = await PDFDocument.create()

    for (const page of pages) {
      try {
        const pdfBytes = Uint8Array.from(atob(page.pdfData), c => c.charCodeAt(0))
        
        const sourcePdf = await PDFDocument.load(pdfBytes)
        
        const [copiedPage] = await mergedPdf.copyPages(sourcePdf, [page.pageNumber - 1])
        
        if (page.rotation !== 0) {
          const currentRotation = copiedPage.getRotation().angle
          copiedPage.setRotation(degrees(currentRotation + page.rotation))
        }
        
        mergedPdf.addPage(copiedPage)
      } catch (error) {
        console.error(`Error processing page ${page.pageNumber} from ${page.fileName}:`, error)
        // Continue with other pages even if one fails
      }
    }

    const pdfBytes = await mergedPdf.save()

    return new NextResponse(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="manipulated.pdf"'
      }
    })
  } catch (error) {
    console.error('Error manipulating PDF:', error)
    return NextResponse.json(
      { error: 'Failed to manipulate PDF' },
      { status: 500 }
    )
  }
}
