import { NextRequest, NextResponse } from 'next/server'
import { PDFDocument } from 'pdf-lib'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    console.log('[v0] API: Join request received')
    const formData = await request.formData()
    const year = formData.get('year') as string
    const monthsRaw = formData.get('months') as string
    const months: string[] = monthsRaw ? JSON.parse(monthsRaw) : []
    const files = formData.getAll('files').filter((f): f is File => f instanceof File)

    if (!year || !months || months.length === 0) {
      return NextResponse.json(
        { error: 'Year and months are required' },
        { status: 400 }
      )
    }

    console.log('[v0] API: Processing', files?.length || 0, 'files')

    const mergedPdf = await PDFDocument.create()

    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        console.log(`[v0] API: Processing file ${i + 1}/${files.length}:`, file.name)

        try {
          const buffer = await file.arrayBuffer()
          const bytes = new Uint8Array(buffer)

          const ext = file.name.split('.').pop()?.toLowerCase()

          if (ext === 'pdf') {
            console.log('[v0] API: Loading PDF:', file.name)
            const existingPdf = await PDFDocument.load(bytes)
            const pages = await mergedPdf.copyPages(existingPdf, existingPdf.getPageIndices())
            
            // Add all pages preserving their original orientation
            for (const page of pages) {
              mergedPdf.addPage(page)
            }
            console.log('[v0] API: Added', pages.length, 'pages from', file.name)
          } else if (ext === 'jpg' || ext === 'jpeg' || ext === 'png') {
            console.log('[v0] API: Converting image to PDF:', file.name)
            
            let image
            if (ext === 'jpg' || ext === 'jpeg') {
              image = await mergedPdf.embedJpg(bytes)
            } else {
              image = await mergedPdf.embedPng(bytes)
            }

            // Get image dimensions
            const imgWidth = image.width
            const imgHeight = image.height
            
            // Determine page orientation based on image dimensions
            const isLandscape = imgWidth > imgHeight
            
            // Standard A4 dimensions in points (72 points per inch)
            const A4_WIDTH = 595.28
            const A4_HEIGHT = 841.89
            
            let pageWidth, pageHeight
            if (isLandscape) {
              pageWidth = A4_HEIGHT
              pageHeight = A4_WIDTH
            } else {
              pageWidth = A4_WIDTH
              pageHeight = A4_HEIGHT
            }

            // Create page with correct orientation
            const page = mergedPdf.addPage([pageWidth, pageHeight])
            
            // Calculate scaling to fit image on page while maintaining aspect ratio
            const scaleX = pageWidth / imgWidth
            const scaleY = pageHeight / imgHeight
            const scale = Math.min(scaleX, scaleY) * 0.95 // 95% to add small margin
            
            const scaledWidth = imgWidth * scale
            const scaledHeight = imgHeight * scale
            
            // Center the image on the page
            const x = (pageWidth - scaledWidth) / 2
            const y = (pageHeight - scaledHeight) / 2
            
            page.drawImage(image, {
              x,
              y,
              width: scaledWidth,
              height: scaledHeight
            })
            
            console.log('[v0] API: Image converted to PDF page with', isLandscape ? 'landscape' : 'portrait', 'orientation')
          }
        } catch (error) {
          console.error('[v0] API: Error processing file:', file.name, error)
          throw new Error(`Erro ao processar ${file.name}: ${(error as Error).message}`)
        }
      }
    }

    console.log('[v0] API: Finalizing merged PDF with', mergedPdf.getPageCount(), 'pages')

    // Serialize the PDF
    const pdfBytes = await mergedPdf.save()

    const filename = months.length === 1 
      ? `base_${months[0]}.pdf`
      : `base_${months[0]}_to_${months[months.length - 1]}.pdf`

    console.log('[v0] API: Sending PDF:', filename)

    return new NextResponse(Uint8Array.from(pdfBytes).buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`
      }
    })
  } catch (error) {
    console.error('[v0] API: Error joining PDFs:', error)
    return NextResponse.json(
      { error: `Failed to join PDFs: ${(error as Error).message}` },
      { status: 500 }
    )
  }
}
