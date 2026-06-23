import { NextRequest, NextResponse } from 'next/server'
import { getWorkspace, updateWorkspace, approveReviewItem } from '@/lib/smartcomprovante/store'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const companyId = request.nextUrl.searchParams.get('companyId') || 'agix'
    const year = Number(request.nextUrl.searchParams.get('year') || 2026)
    const month = Number(request.nextUrl.searchParams.get('month') || 1)

    const workspace = await getWorkspace(companyId, year, month)
    const pendingReviews = workspace.reviews.filter((r) => r.status === 'pending')

    return NextResponse.json({
      companyId,
      year,
      month,
      totalReviews: workspace.reviews.length,
      pendingReviews,
      approvedReviews: workspace.reviews.filter((r) => r.status === 'approved').length,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Não foi possível carregar as revisões.' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      companyId: string
      year: number
      month: number
      reviewId: string
      approved: boolean
      correctCode?: string
    }

    const workspace = await approveReviewItem(
      body.companyId,
      body.year,
      body.month,
      body.reviewId,
      body.approved,
      body.correctCode
    )

    return NextResponse.json({
      status: 'updated',
      reviewId: body.reviewId,
      action: body.approved ? 'approved' : 'rejected',
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Não foi possível atualizar a revisão.' },
      { status: 400 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json() as {
      companyId: string
      year: number
      month: number
      reviewId: string
      action: 'approve' | 'reject' | 'request_correction'
      correctedCode?: string
    }

    const workspace = await getWorkspace(body.companyId, body.year, body.month)
    const review = workspace.reviews.find((r) => r.id === body.reviewId)

    if (!review) return NextResponse.json({ error: 'Revisão não encontrada.' }, { status: 404 })

    const updated = await updateWorkspace(body.companyId, body.year, body.month, (ws) => {
      const updatedReview = ws.reviews.find((r) => r.id === body.reviewId)
      if (updatedReview) {
        if (body.action === 'approve') {
          updatedReview.status = 'approved'
        } else if (body.action === 'reject') {
          updatedReview.status = 'passed'
        } else if (body.action === 'request_correction' && body.correctedCode) {
          updatedReview.proposedCode = body.correctedCode
          updatedReview.status = 'pending'
        }
      }
      return ws
    })

    return NextResponse.json({
      status: 'updated',
      reviewId: body.reviewId,
      action: body.action,
      review: updated.reviews.find((r) => r.id === body.reviewId),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Não foi possível processar a revisão.' },
      { status: 400 }
    )
  }
}
