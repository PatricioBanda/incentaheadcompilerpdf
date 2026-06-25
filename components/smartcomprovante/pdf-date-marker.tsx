'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import * as pdfjs from 'pdfjs-dist'

const getPdfWorkerSrc = () => (
  typeof window === 'undefined'
    ? '/pdf.worker.min.mjs'
    : new URL('/pdf.worker.min.mjs', window.location.origin).toString()
)

const configurePdfWorker = () => {
  pdfjs.GlobalWorkerOptions.workerSrc = getPdfWorkerSrc()
}

configurePdfWorker()

export type DateMark = { page: number; x: number; y: number; dateText: string; label: string; contextText: string }

type TextSpan = {
  str: string
  left: number
  top: number
  width: number
  height: number
  rawX: number
  rawY: number
  baseline: number
}

// mode="click"  — click a single token to pick it (original behaviour)
// mode="select" — renders a transparent selectable text layer; onSelect fires on mouseup
export function PdfDateMarker({ hash, file, sourceUrl, onPick, picked, mode = 'click', onSelect }: {
  hash?: string
  file?: File | null
  sourceUrl?: string | null
  onPick: (mark: DateMark) => void
  picked: DateMark | null
  mode?: 'click' | 'select'
  onSelect?: (text: string, mark?: DateMark) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const pdfRef = useRef<unknown>(null)
  const pageDims = useRef<{ w: number; h: number }>({ w: 1, h: 1 })
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [pageNum, setPageNum] = useState(1)
  const [pageCount, setPageCount] = useState(1)
  const [spans, setSpans] = useState<TextSpan[]>([])
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    let cancelled = false
    setStatus('loading'); setErrorMsg(''); setPageNum(1); setSpans([])
    void (async () => {
      try {
        let buf: ArrayBuffer
        if (file) {
          buf = await file.arrayBuffer()
        } else if (sourceUrl) {
          const res = await fetch(sourceUrl)
          if (!res.ok) throw new Error('Preview unavailable.')
          buf = await res.arrayBuffer()
        } else if (hash) {
          const res = await fetch(`/api/smartcomprovante/preview?hash=${encodeURIComponent(hash)}`)
          if (!res.ok) throw new Error('Preview unavailable (cache may have been cleared).')
          buf = await res.arrayBuffer()
        } else {
          throw new Error('Preview source missing.')
        }
        if (cancelled) return
        configurePdfWorker()
        const doc = await pdfjs.getDocument({
          data: new Uint8Array(buf),
          isEvalSupported: false,
          useSystemFonts: true,
        }).promise
        if (cancelled) return
        pdfRef.current = doc
        setPageCount(doc.numPages)
        setStatus('ready')
      } catch (cause) {
        if (!cancelled) { setStatus('error'); setErrorMsg(cause instanceof Error ? cause.message : 'Failed to load PDF.') }
      }
    })()
    return () => { cancelled = true }
  }, [hash, file, sourceUrl])

  useEffect(() => {
    if (status !== 'ready' || !pdfRef.current) return
    let cancelled = false
    void (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const doc = pdfRef.current as any
        const page = await doc.getPage(pageNum)
        const base = page.getViewport({ scale: 1 })
        pageDims.current = { w: base.width, h: base.height }
        const scale = 820 / base.width
        const viewport = page.getViewport({ scale })
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        canvas.width = viewport.width
        canvas.height = viewport.height
        setSize({ w: viewport.width, h: viewport.height })
        await page.render({ canvasContext: ctx, viewport }).promise
        if (cancelled) return
        const content = await page.getTextContent()
        const next: TextSpan[] = []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const item of content.items as any[]) {
          if (!item.str || !item.str.trim()) continue
          const tx = pdfjs.Util.transform(viewport.transform, item.transform)
          const fontHeight = Math.hypot(tx[2], tx[3]) || (item.height || 8) * scale
          next.push({
            str: item.str,
            left: tx[4],
            top: tx[5] - fontHeight,
            width: (item.width || 0) * scale,
            height: fontHeight,
            rawX: item.transform[4],
            rawY: item.transform[5],
            baseline: tx[5],
          })
        }
        if (!cancelled) setSpans(next)
      } catch (cause) {
        if (!cancelled) { setStatus('error'); setErrorMsg(cause instanceof Error ? cause.message : 'Render failed.') }
      }
    })()
    return () => { cancelled = true }
  }, [status, pageNum])

  const handlePick = useCallback((span: TextSpan) => {
    const { w, h } = pageDims.current
    const sameLine = spans
      .filter((other) => Math.abs(other.baseline - span.baseline) < span.height * 0.6 && other.left < span.left)
      .sort((a, b) => a.left - b.left)
    const label = sameLine.map((other) => other.str).join(' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).slice(-6).join(' ')
    const contextText = spans
      .filter((other) => {
        const sameBand = Math.abs(other.baseline - span.baseline) < span.height * 0.75
        const nearAboveBelow = Math.abs(other.baseline - span.baseline) < span.height * 4.6 && Math.abs((other.left + other.width / 2) - (span.left + span.width / 2)) < 420
        return sameBand || nearAboveBelow
      })
      .sort((a, b) => a.baseline === b.baseline ? a.left - b.left : b.baseline - a.baseline)
      .map((other) => other.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    onPick({ page: pageNum, x: span.rawX / w, y: span.rawY / h, dateText: span.str.trim(), label, contextText })
  }, [spans, pageNum, onPick])

  const handleMouseUp = useCallback(() => {
    if (mode !== 'select' || !onSelect) return
    const sel = window.getSelection()
    if (!sel) return
    const text = sel.toString().trim()
    if (text.length <= 0) return
    const range = sel.rangeCount ? sel.getRangeAt(0) : null
    const overlay = overlayRef.current
    if (!range || !overlay) {
      onSelect(text)
      return
    }
    const overlayRect = overlay.getBoundingClientRect()
    const selectionRect = range.getBoundingClientRect()
    const centerX = selectionRect.left + selectionRect.width / 2 - overlayRect.left
    const centerY = selectionRect.top + selectionRect.height / 2 - overlayRect.top
    const selectedSpans = spans.filter((span) => {
      const spanRight = span.left + span.width
      const spanBottom = span.top + span.height
      const selLeft = selectionRect.left - overlayRect.left
      const selTop = selectionRect.top - overlayRect.top
      const selRight = selLeft + selectionRect.width
      const selBottom = selTop + selectionRect.height
      return span.left <= selRight && spanRight >= selLeft && span.top <= selBottom && spanBottom >= selTop
    })
    const nearest = selectedSpans[0] ?? spans
      .slice()
      .sort((a, b) => {
        const acx = a.left + a.width / 2
        const acy = a.top + a.height / 2
        const bcx = b.left + b.width / 2
        const bcy = b.top + b.height / 2
        return Math.hypot(acx - centerX, acy - centerY) - Math.hypot(bcx - centerX, bcy - centerY)
      })[0]
    if (!nearest) {
      onSelect(text)
      return
    }
    const { w, h } = pageDims.current
    const sameLine = spans
      .filter((other) => Math.abs(other.baseline - nearest.baseline) < nearest.height * 0.7)
      .sort((a, b) => a.left - b.left)
    const selectedLeft = Math.min(...(selectedSpans.length ? selectedSpans : [nearest]).map((span) => span.left))
    const selectedRight = Math.max(...(selectedSpans.length ? selectedSpans : [nearest]).map((span) => span.left + span.width))
    const label = sameLine
      .filter((span) => span.left + span.width < selectedLeft)
      .map((span) => span.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean)
      .slice(-10)
      .join(' ')
    const rightLabel = sameLine
      .filter((span) => span.left > selectedRight)
      .map((span) => span.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean)
      .slice(0, 8)
      .join(' ')
    const contextText = spans
      .filter((other) => {
        const sameBand = Math.abs(other.baseline - nearest.baseline) < nearest.height * 0.9
        const nearAboveBelow = Math.abs(other.baseline - nearest.baseline) < nearest.height * 4.8 && Math.abs((other.left + other.width / 2) - centerX) < 520
        return sameBand || nearAboveBelow
      })
      .sort((a, b) => a.baseline === b.baseline ? a.left - b.left : b.baseline - a.baseline)
      .map((other) => other.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    onSelect(text, {
      page: pageNum,
      x: nearest.rawX / w,
      y: nearest.rawY / h,
      dateText: text,
      label: [label, rightLabel].filter(Boolean).join(' | '),
      contextText,
    })
  }, [mode, onSelect, pageNum, spans])

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-[11px] text-slate-500">
          {mode === 'select' ? 'Drag to select the text that identifies the month.' : 'Click the date on the page.'}
        </p>
        {pageCount > 1 ? (
          <div className="flex items-center gap-1">
            <button onClick={() => setPageNum((p) => Math.max(1, p - 1))} disabled={pageNum <= 1} className="rounded p-0.5 hover:bg-slate-100 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
            <span className="text-[11px] font-semibold text-slate-600">{pageNum}/{pageCount}</span>
            <button onClick={() => setPageNum((p) => Math.min(pageCount, p + 1))} disabled={pageNum >= pageCount} className="rounded p-0.5 hover:bg-slate-100 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
          </div>
        ) : null}
      </div>
      <div className="relative overflow-auto rounded-lg border border-slate-200 bg-slate-100" style={{ maxHeight: 680 }}>
        {status === 'loading' ? <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-teal-600" /></div> : null}
        {status === 'error' ? <div className="p-4 text-xs text-rose-600">{errorMsg}</div> : null}
        <div
          className="relative"
          style={{ width: size.w, height: size.h }}
          onMouseUp={mode === 'select' ? handleMouseUp : undefined}
        >
          <canvas ref={canvasRef} className="block" />
          {status === 'ready' && mode === 'click' ? spans.map((span, idx) => {
            const isPicked = Boolean(picked && picked.page === pageNum && picked.dateText === span.str.trim() && Math.abs(picked.x - span.rawX / pageDims.current.w) < 0.01)
            return (
              <button
                key={idx}
                onClick={() => handlePick(span)}
                title={span.str}
                className={`absolute cursor-pointer rounded-[2px] transition-colors ${isPicked ? 'bg-teal-500/40 ring-1 ring-teal-600' : 'hover:bg-amber-300/40'}`}
                style={{ left: span.left, top: span.top, width: Math.max(span.width, 6), height: Math.max(span.height, 8) }}
              />
            )
          }) : null}
          {/* Selectable transparent text layer for select mode */}
          {status === 'ready' && mode === 'select' ? (
            <div
              ref={overlayRef}
              aria-hidden="false"
              style={{ position: 'absolute', inset: 0, userSelect: 'text', cursor: 'text', overflow: 'hidden' }}
            >
              {spans.map((span, idx) => (
                <span
                  key={idx}
                  style={{
                    position: 'absolute',
                    left: span.left,
                    top: span.top,
                    width: Math.max(span.width, 1),
                    height: Math.max(span.height, 8),
                    fontSize: Math.max(span.height * 0.85, 6),
                    lineHeight: 1,
                    whiteSpace: 'nowrap',
                    color: 'rgba(15,23,42,0.01)',
                    cursor: 'text',
                    userSelect: 'text',
                  }}
                >
                  {span.str}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
