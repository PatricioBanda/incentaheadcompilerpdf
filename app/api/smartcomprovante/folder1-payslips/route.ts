import { NextRequest, NextResponse } from 'next/server'
import { detectFolder1Payslips } from '@/lib/smartcomprovante/store'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(request: NextRequest) {
  const companyId = request.nextUrl.searchParams.get('companyId') || 'agix'
  const year = Number(request.nextUrl.searchParams.get('year') || new Date().getFullYear())
  const monthParam = request.nextUrl.searchParams.get('month')
  const month = monthParam ? Number(monthParam) : null
  try {
    const payslips = await detectFolder1Payslips(companyId, year, month)
    return NextResponse.json({ payslips })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
