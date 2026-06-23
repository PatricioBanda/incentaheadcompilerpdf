export const RH_FOLDERS = [
  { number: 1, code: 'RV', label: 'Recibos de Vencimento' },
  { number: 2, code: 'LC', label: 'Lançamentos Contabilísticos' },
  { number: 3, code: 'TV', label: 'Transferências de Vencimento' },
  { number: 4, code: 'EBV', label: 'Extratos Bancários de Vencimento' },
  { number: 5, code: 'TSA', label: 'Transferências de Subsídio de Alimentação' },
  { number: 6, code: 'EBSA', label: 'Extratos Bancários de Subsídio de Alimentação' },
  { number: 7, code: 'SSR', label: 'DMR Segurança Social — Resumo' },
  { number: 8, code: 'SSD', label: 'DMR Segurança Social — Detalhe' },
  { number: 9, code: 'GIR', label: 'Guias de IRS' },
  { number: 10, code: 'LIR', label: 'Listagens de IRS' },
  { number: 11, code: 'PSS', label: 'Pagamentos de Segurança Social' },
  { number: 12, code: 'PIR', label: 'Pagamentos de IRS' },
  { number: 13, code: 'EBI', label: 'Extratos Bancários de Impostos' },
] as const

export const monthKey = (year: number, month: number) => `${year}${String(month).padStart(2, '0')}`

