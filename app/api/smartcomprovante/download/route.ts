import { NextRequest, NextResponse } from 'next/server'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { getWorkspace } from '@/lib/smartcomprovante/store'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get('type') === 'final' ? 'final' : 'base'
  const employeeCode = request.nextUrl.searchParams.get('employee') || 'E0042'
  const workspace = await getWorkspace()
  const employee = workspace.employees.find((item) => item.employeeCode === employeeCode)
  const filename = type === 'base' ? workspace.baseJoin.filename : employee?.filename || `CF_202601_${employeeCode}.pdf`

  if (type === 'base' && workspace.baseJoin.status !== 'current') return NextResponse.json({ error: 'Base Join ainda não está atual.' }, { status: 409 })
  if (type === 'final' && employee?.finalStatus !== 'current') return NextResponse.json({ error: 'Comprovante Final ainda não está atual.' }, { status: 409 })

  const pdf = await PDFDocument.create()
  const page = pdf.addPage([595.28, 841.89])
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  page.drawText(type === 'base' ? 'BASE JOIN - PROTOTIPO' : 'COMPROVANTE FINAL - PROTOTIPO', { x: 54, y: 760, size: 18, font: bold, color: rgb(0.08, 0.35, 0.31) })
  page.drawText(`${workspace.company.legalName} - NIF ${workspace.company.nif}`, { x: 54, y: 720, size: 12, font: regular })
  page.drawText(`Periodo: ${String(workspace.month).padStart(2, '0')}/${workspace.year}`, { x: 54, y: 696, size: 12, font: regular })
  if (type === 'final' && employee) page.drawText(`Colaborador: ${employee.employeeName} - ${employee.employeeCode}`, { x: 54, y: 672, size: 12, font: regular })
  page.drawText('Este ficheiro demonstra o download e a convencao SharePoint-safe.', { x: 54, y: 620, size: 10, font: regular, color: rgb(0.35, 0.4, 0.43) })
  page.drawText('Na implementacao real, as paginas aprovadas serao reconciliadas e unidas aqui.', { x: 54, y: 602, size: 10, font: regular, color: rgb(0.35, 0.4, 0.43) })

  return new NextResponse(Uint8Array.from(await pdf.save()).buffer, {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' },
  })
}
