import { NextRequest, NextResponse } from 'next/server'
import { getCachedPreview } from '@/lib/smartcomprovante/store'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(request: NextRequest) {
  try {
    const sourceHash = request.nextUrl.searchParams.get('hash') || ''
    const preview = await getCachedPreview(sourceHash)
    return new NextResponse(new Uint8Array(preview.bytes), {
      headers: {
        'Content-Type': preview.mimeType,
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
        'X-Preview-Pages': String(preview.pageCount),
      },
    })
  } catch {
    return NextResponse.json({ error: 'Pré-visualização indisponível. Volte a carregar o ficheiro se a cache já tiver sido limpa.' }, { status: 404 })
  }
}
