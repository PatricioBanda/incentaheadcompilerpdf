import { NextRequest, NextResponse } from 'next/server'
import { createCompany } from '@/lib/smartcomprovante/store'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { legalName?: string; nif?: string; code?: string }
    if (!body.legalName || !body.nif || !body.code) {
      return NextResponse.json({ error: 'Nome legal, NIF e código são obrigatórios.' }, { status: 400 })
    }
    return NextResponse.json(await createCompany({ legalName: body.legalName, nif: body.nif, code: body.code }), { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Não foi possível criar a empresa.' }, { status: 400 })
  }
}

