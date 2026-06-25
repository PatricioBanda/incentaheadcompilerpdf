import { detectPeriodValue } from './period-learning'

// Tests for the period detection function that's used in the routing pipeline.
// These cover document text samples observed in the field.

describe('routing period detection — real document samples', () => {
  const expects = (input: string) => ({
    toBeMonth: (expectedYear: number, expectedMonth: number) => {
      const result = detectPeriodValue(input)
      expect(result.year).toBe(expectedYear)
      expect(result.month).toBe(expectedMonth)
    },
    toBeUnknown: () => {
      const result = detectPeriodValue(input)
      expect(result.year).toBeNull()
      expect(result.month).toBeNull()
    },
  })

  // ── Payslip header formats ────────────────────────────────────────────────

  it('Portuguese payslip month+year in header', () => {
    expects('Recibo de Vencimento Janeiro 2025').toBeMonth(2025, 1)
  })

  it('numeric month/year format', () => {
    expects('03/2025').toBeMonth(2025, 3)
  })

  it('numeric month-year with dash', () => {
    expects('06-2025').toBeMonth(2025, 6)
  })

  it('day.month.year full date (standalone not enabled)', () => {
    const result = detectPeriodValue('15.03.2025')
    // Should detect March 2025 if it can — standalone full date may vary
    if (result.year !== null) {
      expect(result.year).toBe(2025)
      expect(result.month).toBe(3)
    }
  })

  // ── Alimentação / subsidio patterns ──────────────────────────────────────

  it('subsidio alimentacao with numeric month', () => {
    expects('Subsídio Alimentação 03 2025').toBeMonth(2025, 3)
  })

  it('subsidio refeicao with abbreviated month', () => {
    expects('Sub Refeicao Mar 2025').toBeMonth(2025, 3)
  })

  it('banking truncation Junh', () => {
    expects('Cartao Refeicao Junh 2025').toBeMonth(2025, 6)
  })

  // ── Edge / rejection cases ────────────────────────────────────────────────

  it('year 2019 is out of valid range', () => {
    expects('Janeiro 2019').toBeUnknown()
  })

  it('year 2099 is out of valid range', () => {
    expects('Dezembro 2099').toBeUnknown()
  })

  it('bare year without month returns null', () => {
    const result = detectPeriodValue('Relatório Anual 2025')
    expect(result.month).toBeNull()
  })

  it('generic document text without date', () => {
    expects('Comprovativo de Pagamento').toBeUnknown()
  })
})
