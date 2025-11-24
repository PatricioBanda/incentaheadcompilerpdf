import { NextRequest, NextResponse } from 'next/server'
import { PDFDocument } from 'pdf-lib'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const personName = formData.get('personName') as string
    const month = formData.get('month') as string
    const baseFile = formData.get('baseFile')
    const personFile = formData.get('personFile')

    if (!baseFile || !personFile || !(baseFile instanceof File) || !(personFile instanceof File)) {
      return NextResponse.json(
        { error: 'Base file and person file are required' },
        { status: 400 }
      )
    }

    console.log(`[v0] Merging final PDF for ${personName} - ${month}`)

    const mergedPdf = await PDFDocument.create()

    console.log('[v0] Processing person PDF (FIRST)...')
    const personBytes = new Uint8Array(await personFile.arrayBuffer())
    const personPdf = await PDFDocument.load(personBytes)
    const personPages = await mergedPdf.copyPages(personPdf, personPdf.getPageIndices())
    personPages.forEach(page => mergedPdf.addPage(page))

    console.log('[v0] Processing base PDF (SECOND)...')
    const baseBytes = new Uint8Array(await baseFile.arrayBuffer())
    const basePdf = await PDFDocument.load(baseBytes)
    const basePages = await mergedPdf.copyPages(basePdf, basePdf.getPageIndices())
    basePages.forEach(page => mergedPdf.addPage(page))

    const pdfBytes = await mergedPdf.save()
    console.log(`[v0] Final PDF created successfully for ${personName} - ${month} (Person first, then Base)`)

    return new NextResponse(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="final_${month}_${personName.replace(/[^a-zA-Z0-9]/g, '_')}.pdf"`
      }
    })
  } catch (error) {
    console.error('[v0] Error creating final PDF:', error)
    return NextResponse.json(
      { error: `Error creating final PDF: ${(error as Error).message}` },
      { status: 500 }
    )
  }
}
