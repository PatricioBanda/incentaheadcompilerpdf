import { NextRequest, NextResponse } from 'next/server'
import { getBatchStatistics, recordProviderCall, recordCacheHit } from '@/lib/smartcomprovante/store'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(request: NextRequest) {
  try {
    const batchId = request.nextUrl.searchParams.get('batchId')
    const metric = request.nextUrl.searchParams.get('metric') || 'all'

    if (!batchId) return NextResponse.json({ error: 'batchId é obrigatório.' }, { status: 400 })

    const stats = await getBatchStatistics(batchId)

    if (metric === 'all') {
      return NextResponse.json({
        batchId,
        statistics: {
          totalDocuments: stats.totalDocuments,
          totalPages: stats.totalPages,
          approvedCount: stats.approvedCount,
          reviewCount: stats.reviewCount,
          cacheHitCount: stats.cacheHitCount,
          cacheHitRate: stats.cacheHitCount / Math.max(1, stats.totalDocuments),
        },
        providerMetrics: {
          totalCalls: stats.totalProviderCalls,
          totalTokensUsed: stats.totalTokensUsed,
          totalCost: stats.totalCost,
          averageConfidence: stats.averageConfidence,
        },
      })
    } else if (metric === 'cache') {
      return NextResponse.json({
        batchId,
        cacheHitCount: stats.cacheHitCount,
        totalDocuments: stats.totalDocuments,
        cacheHitRate: stats.cacheHitCount / Math.max(1, stats.totalDocuments),
      })
    } else if (metric === 'provider') {
      return NextResponse.json({
        batchId,
        totalProviderCalls: stats.totalProviderCalls,
        totalTokensUsed: stats.totalTokensUsed,
        totalCost: stats.totalCost,
        estimatedCostPerDocument: stats.totalCost / Math.max(1, stats.totalDocuments),
      })
    }

    return NextResponse.json(stats)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Não foi possível obter as estatísticas.' },
      { status: 400 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      action: 'record_call' | 'record_cache_hit'
      batchId?: string
      providerId?: 'gemini' | 'groq' | 'ollama'
      documentType?: string
      status?: 'success' | 'cached' | 'failed'
      inputTokens?: number
      outputTokens?: number
      latencyMs?: number
      cost?: number
      sourceHash?: string
      documentCode?: string
      confidence?: number
      employeeCode?: string
    }

    if (body.action === 'record_call') {
      const record = await recordProviderCall(
        body.batchId!,
        body.providerId!,
        body.documentType || 'unknown',
        body.status || 'success',
        body.inputTokens || 0,
        body.outputTokens || 0,
        body.latencyMs || 0,
        body.cost || 0
      )
      return NextResponse.json({ status: 'recorded', record }, { status: 201 })
    } else if (body.action === 'record_cache_hit') {
      const entry = await recordCacheHit(
        body.sourceHash!,
        body.documentCode!,
        body.confidence || 0.85,
        body.employeeCode
      )
      return NextResponse.json({ status: 'recorded', entry }, { status: 201 })
    }

    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Não foi possível registar a métrica.' },
      { status: 400 }
    )
  }
}
