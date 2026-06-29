import { detectPeriodValue, normalizePeriodText } from './period-learning'

describe('normalizePeriodText', () => {
  it('strips diacritics and lowercases', () => {
    expect(normalizePeriodText('Março 2025')).toBe('marco 2025')
  })

  it('replaces punctuation with spaces', () => {
    expect(normalizePeriodText('01/02/2025')).toBe('01 02 2025')
  })
})

describe('detectPeriodValue', () => {
  const cases: [string, { year: number | null; month: number | null }][] = [
    // Full date formats
    ['01/2025', { year: 2025, month: 1 }],
    ['02/2026', { year: 2026, month: 2 }],
    ['12/2024', { year: 2024, month: 12 }],
    // Month name + year
    ['Janeiro 2025', { year: 2025, month: 1 }],
    ['Fevereiro 2026', { year: 2026, month: 2 }],
    ['Março 2024', { year: 2024, month: 3 }],
    ['Abril 2025', { year: 2025, month: 4 }],
    ['Maio 2026', { year: 2026, month: 5 }],
    ['Junho 2025', { year: 2025, month: 6 }],
    ['Julho 2025', { year: 2025, month: 7 }],
    ['Agosto 2024', { year: 2024, month: 8 }],
    ['Setembro 2025', { year: 2025, month: 9 }],
    ['Outubro 2025', { year: 2025, month: 10 }],
    ['Novembro 2025', { year: 2025, month: 11 }],
    ['Dezembro 2025', { year: 2025, month: 12 }],
    // RH salary phrases
    ['Vencimento 01 2025', { year: 2025, month: 1 }],
    ['Salario 12 2024', { year: 2024, month: 12 }],
    // Abbreviated month names
    ['Jan 2025', { year: 2025, month: 1 }],
    ['Dez 2025', { year: 2025, month: 12 }],
    // Banking truncation "Junh"
    ['Subsidio Alimentacao Junh 2025', { year: 2025, month: 6 }],
    // Year only - no month
    ['2025', { year: null, month: null }],
    // Nothing useful
    ['Invoice document', { year: null, month: null }],
    // Out-of-range year
    ['Jan 2019', { year: null, month: null }],
    ['Jan 2099', { year: null, month: null }],
  ]

  test.each(cases)('"%s" → year=%d month=%d', (input, expected) => {
    const result = detectPeriodValue(input)
    expect(result.year).toBe(expected.year)
    expect(result.month).toBe(expected.month)
  })

  it('returns null for standalone year without allowStandaloneFullDate', () => {
    const result = detectPeriodValue('Relatório 2025')
    expect(result.month).toBeNull()
  })
})
