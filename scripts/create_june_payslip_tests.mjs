import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const people = [
  ['Ana Silva', 'TEC-001', '243581902', 1850.00, 1398.25],
  ['Bruno Costa', 'TEC-002', '219475638', 2100.00, 1582.40],
  ['Carla Mendes', 'TEC-003', '287394615', 1725.00, 1324.75],
  ['Diogo Ferreira', 'TEC-004', '254638179', 2350.00, 1741.10],
  ['Elisa Rocha', 'TEC-005', '298176543', 1950.00, 1475.60],
  ['Miguel Santos', 'TEC-006', '231964587', 2600.00, 1908.20],
]

const money = (value) => `${value.toFixed(2)} EUR`

async function createPayslip(filePath, [name, code, nif, gross, net]) {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([595.28, 841.89])
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const { width, height } = page.getSize()

  page.drawRectangle({ x: 0, y: height - 96, width, height: 96, color: rgb(0.06, 0.45, 0.41) })
  page.drawText('Recibo de Vencimento', { x: 52, y: height - 48, size: 20, font: bold, color: rgb(1, 1, 1) })
  page.drawText('Periodo: Junho 2026 | Pasta 01_RV | Documento de teste', { x: 52, y: height - 72, size: 10, font: regular, color: rgb(1, 1, 1) })

  let y = height - 140
  page.drawText('Dados do trabalhador', { x: 52, y, size: 13, font: bold, color: rgb(0.07, 0.09, 0.15) })
  y -= 24
  for (const [label, value] of [
    ['Nome', name],
    ['Codigo interno', code],
    ['NIF', nif],
    ['Empresa', 'SmartComprovante Testes, Lda.'],
    ['Mes de referencia', 'Junho de 2026'],
  ]) {
    page.drawText(`${label}:`, { x: 58, y, size: 10, font: regular, color: rgb(0.42, 0.45, 0.5) })
    page.drawText(String(value), { x: 168, y, size: 10, font: regular, color: rgb(0.07, 0.09, 0.15) })
    y -= 20
  }

  y -= 12
  page.drawText('Remuneracoes e descontos', { x: 52, y, size: 13, font: bold, color: rgb(0.07, 0.09, 0.15) })
  y -= 28
  const tableX = 52
  const tableW = width - 104
  page.drawRectangle({ x: tableX, y: y - 8, width: tableW, height: 26, color: rgb(0.9, 0.91, 0.92) })
  page.drawText('Descricao', { x: tableX + 12, y, size: 9, font: bold, color: rgb(0.07, 0.09, 0.15) })
  page.drawText('Valor', { x: tableX + tableW - 55, y, size: 9, font: bold, color: rgb(0.07, 0.09, 0.15) })
  y -= 26

  const lines = [
    ['Vencimento base', gross],
    ['Subsidio de alimentacao', 154.00],
    ['Seguranca Social trabalhador', -gross * 0.11],
    ['Retencao IRS', -(gross * 0.125)],
  ]
  for (const [index, [label, value]] of lines.entries()) {
    if (index % 2 === 0) page.drawRectangle({ x: tableX, y: y - 8, width: tableW, height: 24, color: rgb(0.98, 0.98, 0.99) })
    page.drawText(label, { x: tableX + 12, y, size: 9, font: regular, color: rgb(0.07, 0.09, 0.15) })
    page.drawText(money(value), { x: tableX + tableW - 85, y, size: 9, font: regular, color: rgb(0.07, 0.09, 0.15) })
    y -= 24
  }

  y -= 10
  page.drawRectangle({ x: tableX, y: y - 14, width: tableW, height: 38, color: rgb(0.93, 0.99, 0.96) })
  page.drawText('Liquido a receber', { x: tableX + 12, y, size: 13, font: bold, color: rgb(0.02, 0.37, 0.27) })
  page.drawText(money(net), { x: tableX + tableW - 95, y, size: 13, font: bold, color: rgb(0.02, 0.37, 0.27) })

  page.drawText('Documento sintetico para testes SmartComprovante. Nao usar para fins contabilisticos.', { x: 52, y: 62, size: 8, font: regular, color: rgb(0.42, 0.45, 0.5) })
  page.drawText(`Marcadores de classificacao: recibo vencimento, RV, Junho 2026, ${name}.`, { x: 52, y: 44, size: 8, font: regular, color: rgb(0.42, 0.45, 0.5) })

  await writeFile(filePath, await pdf.save())
}

if (process.argv.length !== 3) {
  console.error('Usage: node create_june_payslip_tests.mjs OUTPUT_DIR')
  process.exit(2)
}

const root = process.argv[2]
const target = path.join(root, 'june-2026-recibos-vencimento-6-people', '01_RV_recibos_vencimento')
await mkdir(target, { recursive: true })

for (const [index, person] of people.entries()) {
  const safeName = person[0].replaceAll(' ', '_')
  const filename = `01_RV_JUN_2026_${String(index + 1).padStart(2, '0')}_${safeName}.pdf`
  await createPayslip(path.join(target, filename), person)
}

console.log(target)
