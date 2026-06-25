import { NextRequest, NextResponse } from 'next/server'
import { createProject, getAllProjects } from '@/lib/smartcomprovante/store'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET() {
  return NextResponse.json(await getAllProjects(), { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { name?: string; code?: string }
    if (!body.name || !body.code) {
      return NextResponse.json({ error: 'Project name and code are required.' }, { status: 400 })
    }
    return NextResponse.json(await createProject({ name: body.name, code: body.code }), { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not create project.' }, { status: 400 })
  }
}
