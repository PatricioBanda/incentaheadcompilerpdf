import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const useGroq = Boolean(process.env.GROQ_API_KEY)
  const configured = useGroq || Boolean(process.env.GEMINI_API_KEY)
  return NextResponse.json({
    provider: useGroq ? 'groq' : 'gemini',
    model: useGroq ? process.env.GROQ_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct' : process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    configured,
    credentialState: configured ? useGroq ? 'development-environment' : 'stored-securely' : 'not-configured',
    mode: configured ? 'live-test' : 'prototype-demo',
  }, { headers: { 'Cache-Control': 'no-store' } })
}
