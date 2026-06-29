import { NextRequest, NextResponse } from 'next/server'
import { createProject, getAllProjects } from '@/lib/smartcomprovante/store'

export const runtime = 'nodejs'
export const maxDuration = 120

const withTimeout = async <T,>(operation: Promise<T>, label: string, ms = 20000): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out. Please retry.`)), ms)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export async function GET() {
  try {
    return NextResponse.json(await withTimeout(getAllProjects(), 'Loading projects'), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not load projects.' }, { status: 504 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { name?: string; code?: string }
    if (!body.name || !body.code) {
      return NextResponse.json({ error: 'Project name and code are required.' }, { status: 400 })
    }
    return NextResponse.json(await withTimeout(createProject({ name: body.name, code: body.code }), 'Creating project'), { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not create project.'
    return NextResponse.json({ error: message }, { status: message.includes('timed out') ? 504 : 400 })
  }
}
