import { NextRequest, NextResponse } from 'next/server'
import { classifyGeminiDocument, GeminiProviderError } from '@/lib/smartcomprovante/providers/gemini'
import { classifyGroqDocument, GroqProviderError } from '@/lib/smartcomprovante/providers/groq'
import {
  cacheIntakeFile,
  getCachedClassification,
  getCompanyRuleContext,
  getWorkspace,
  saveCachedClassification,
  updateWorkspace,
} from '@/lib/smartcomprovante/store'
import { localRouteDocument, normalizeLlmRoute, storedClassificationToRoute } from '@/lib/smartcomprovante/routing'
import type { RoutedClassification, RoutingSource } from '@/lib/smartcomprovante/routing'
import { RH_FOLDERS } from '@/lib/smartcomprovante/taxonomy'
import { routeLogger } from '@/lib/smartcomprovante/logger'

export const runtime = 'nodejs'
export const maxDuration = 60

const log = routeLogger('classify')

const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png'])
const MAX_FILE_SIZE = 15 * 1024 * 1024
const MAX_TOTAL_SIZE = 100 * 1024 * 1024
const REVIEW_CONFIDENCE_THRESHOLD = 0.7

export async function POST(request: NextRequest) {
  const t0 = Date.now()
  try {
    const formData = await request.formData()
    const files = formData.getAll('files').filter((item): item is File => item instanceof File)
    const relativePaths = formData.getAll('relativePaths').map((item) => String(item || ''))
    const companyId = String(formData.get('companyId') || 'agix')
    const projectId = String(formData.get('projectId') || 'project-inovacao-01')
    const year = Number(formData.get('year') || 2026)
    const month = Number(formData.get('month') || 1)
    if (month < 1 || month > 12 || year < 2000 || year > 2100) {
      return NextResponse.json({ error: 'year must be 2000–2100 and month must be 1–12.' }, { status: 400 })
    }
    log.info({ companyId, year, month, fileCount: files.length }, 'Classify request')
    const mode = formData.get('mode') === 'append' ? 'append' : 'replace'
    const batchPosition = Math.max(1, Number(formData.get('batchPosition') || 1))
    const batchTotal = Math.max(batchPosition, Number(formData.get('batchTotal') || files.length))

    if (!files.length || files.length > 20) return NextResponse.json({ error: 'Select between 1 and 20 files per test batch.' }, { status: 400 })
    const inferredType = (file: File) => file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : file.name.toLowerCase().endsWith('.png') ? 'image/png' : /\.jpe?g$/i.test(file.name) ? 'image/jpeg' : '')
    if (files.some((file) => !allowedTypes.has(inferredType(file)) || file.size > MAX_FILE_SIZE)) return NextResponse.json({ error: 'Use PDF, JPG, or PNG up to 15 MB per file.' }, { status: 400 })
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_SIZE) return NextResponse.json({ error: 'The batch exceeds the 100 MB limit.' }, { status: 400 })

    const useGroq = Boolean(process.env.GROQ_API_KEY)
    const useGemini = !useGroq && Boolean(process.env.GEMINI_API_KEY)
    const hasCloudFallback = useGroq || useGemini
    const providerLabel = useGroq ? 'Groq' : useGemini ? 'Gemini' : 'local rules'
    const ruleContext = await getCompanyRuleContext(companyId)
    const existingWorkspace = mode === 'append' ? await getWorkspace(companyId, year, month, projectId) : null
    const existingHashes = new Set(existingWorkspace?.reviews.map((review) => review.sourceHash).filter(Boolean))
    const results: Array<{ file: File; sourceName: string; sourceHash: string; classification: RoutedClassification; targetYear: number; targetMonth: number }> = []
    const routeCounts: Record<RoutingSource, number> = { cache: 0, rules: 0, heuristic: 0, llm: 0, fallback: 0 }
    let providerFailureCount = 0

    for (const [index, file] of files.entries()) {
      const sourceName = relativePaths[index] || file.name
      const sourceHash = await cacheIntakeFile(file, crypto.randomUUID())
      if (existingHashes.has(sourceHash)) continue

      const cached = await getCachedClassification(companyId, sourceHash, ruleContext.rulesVersion)
      let classification: RoutedClassification = cached
        ? storedClassificationToRoute(cached)
        : await localRouteDocument(file, { year, month }, ruleContext, sourceName)

      const folder = RH_FOLDERS.find((item) => item.code === classification.document_code)
      const eligibleForAutomaticFolder = Boolean(folder && folder.number >= 2 && folder.number <= 13)
      const localPeriodMismatch = Boolean(
        (classification.target_year && classification.target_year !== year)
        || (classification.target_month && classification.target_month !== month)
      )
      const shouldAskCloud = hasCloudFallback
        && classification.route_source !== 'cache'
        && (!eligibleForAutomaticFolder || classification.confidence < REVIEW_CONFIDENCE_THRESHOLD || localPeriodMismatch)

      if (shouldAskCloud) {
        try {
          classification = normalizeLlmRoute(useGroq ? await classifyGroqDocument(file, ruleContext) : await classifyGeminiDocument(file, ruleContext))
        } catch (error) {
          if ((error instanceof GeminiProviderError || error instanceof GroqProviderError) && [401, 403, 429].includes(error.status)) throw error
          providerFailureCount += 1
          classification = {
            document_code: classification.document_code || 'UNKNOWN',
            confidence: Math.min(classification.confidence, 0.69),
            reason: `${classification.reason} Cloud fallback failed: ${error instanceof Error ? error.message : 'provider did not answer'}.`,
            target_year: classification.target_year,
            target_month: classification.target_month,
            employee_name: classification.employee_name,
            route_source: 'fallback',
          }
        }
      }

      routeCounts[classification.route_source] += 1

      const finalFolder = RH_FOLDERS.find((item) => item.code === classification.document_code)
      const finalPeriodMismatch = Boolean(
        (classification.target_year && classification.target_year !== year)
        || (classification.target_month && classification.target_month !== month)
      )
      if (finalFolder && finalFolder.number >= 2 && finalFolder.number <= 13 && classification.confidence >= REVIEW_CONFIDENCE_THRESHOLD && !finalPeriodMismatch) {
        await saveCachedClassification(companyId, sourceHash, {
          document_code: classification.document_code,
          confidence: classification.confidence,
          reason: classification.reason,
          target_year: classification.target_year,
          target_month: classification.target_month,
          employee_name: classification.employee_name,
          route_source: classification.route_source,
          rules_version: ruleContext.rulesVersion,
        })
      }

      results.push({ file, sourceName, sourceHash, classification, targetYear: year, targetMonth: month })
    }

    if (!results.length && existingWorkspace) return NextResponse.json(existingWorkspace)

    const periodGroups = new Map<string, Array<typeof results[number]>>()
    for (const result of results) {
      const key = `${result.targetYear}:${result.targetMonth}`
      const group = periodGroups.get(key) || []
      group.push(result)
      periodGroups.set(key, group)
    }

    let currentWorkspace = null
    for (const [key, group] of periodGroups.entries()) {
      const [workspaceYear, workspaceMonth] = key.split(':').map(Number)
      const updated = await updateWorkspace(companyId, workspaceYear, workspaceMonth, (draft) => {
        if (!draft.approvedDocuments) draft.approvedDocuments = []
        draft.provider = useGroq ? 'groq' : useGemini ? 'gemini' : draft.provider
        if (workspaceYear === year && workspaceMonth === month && mode === 'replace') {
          draft.folders = draft.folders.map((folder) => ({ ...folder, status: 'missing', documentCount: 0, approvedCount: 0, reviewCount: 0 }))
          draft.reviews = []
          draft.employees = []
          draft.intakeCount = 0
        }

        if (draft.baseJoin.status === 'current' || draft.baseJoin.status === 'ready' || draft.baseJoin.status === 'needs_confirmation') {
          draft.baseJoin = { status: 'blocked', filename: `BJ_${workspaceYear}${String(workspaceMonth).padStart(2, '0')}.pdf`, includedFolders: 0, pageCount: null, updatedAt: null }
        }

        group.forEach((result) => {
          const folder = RH_FOLDERS.find((item) => item.code === result.classification.document_code)
          const blockedFolderOne = folder?.number === 1
          const detectedDifferentPeriod = Boolean(
            (result.classification.target_year && result.classification.target_year !== workspaceYear)
            || (result.classification.target_month && result.classification.target_month !== workspaceMonth)
          )
          const needsReview = !folder
            || blockedFolderOne
            || result.classification.document_code === 'UNKNOWN'
            || result.classification.confidence < REVIEW_CONFIDENCE_THRESHOLD
            || detectedDifferentPeriod

          if (folder) {
            const target = draft.folders.find((item) => item.code === folder.code)
            if (target) {
              target.documentCount += 1
              if (needsReview) {
                target.status = 'review'
                target.reviewCount += 1
              } else {
                target.status = 'approved'
                target.approvedCount += 1
                if (!draft.approvedDocuments) draft.approvedDocuments = []
                draft.approvedDocuments.push({
                  id: crypto.randomUUID(),
                  sourceHash: result.sourceHash,
                  folderCode: folder.code,
                  folderNumber: folder.number,
                  filename: result.sourceName,
                  pageCount: 1,
                  confidence: result.classification.confidence,
                  approvedAt: new Date().toISOString(),
                  approvedBy: 'auto',
                })
              }
            }
          }

          if (needsReview) {
            draft.reviews.push({
              id: crypto.randomUUID(),
              filename: result.sourceName,
              proposedCode: result.classification.document_code,
              proposedLabel: folder?.label || 'Unknown document type',
              confidence: result.classification.confidence,
              reason: blockedFolderOne
                ? `${result.classification.reason} Folder 1 is not auto-filled from folder 0; confirm manually if this file really belongs there.`
                : detectedDifferentPeriod
                  ? `${result.classification.reason} The document seems to be from ${String(result.classification.target_month).padStart(2, '0')}/${result.classification.target_year}, but the active test month is ${String(workspaceMonth).padStart(2, '0')}/${workspaceYear}.`
                  : result.classification.reason,
              status: 'pending' as const,
              sourceHash: result.sourceHash,
              employeeName: result.classification.employee_name,
              targetYear: result.classification.target_year || result.targetYear,
              targetMonth: result.classification.target_month || result.targetMonth,
            })
          }

          if (result.classification.document_code === 'RV') {
            const employeeOffset = draft.employees.length
            draft.employees.push({
              id: `employee-${crypto.randomUUID()}`,
              employeeCode: `E${String(employeeOffset + 1).padStart(4, '0')}`,
              employeeName: result.classification.employee_name || `Employee ${employeeOffset + 1}`,
              payslipStatus: needsReview ? 'review' as const : 'approved' as const,
              finalStatus: 'blocked' as const,
              filename: `CF_${workspaceYear}${String(workspaceMonth).padStart(2, '0')}_E${String(employeeOffset + 1).padStart(4, '0')}.pdf`,
              pageCount: null,
              payslipHash: result.sourceHash,
            })
          }
        })

        if (workspaceYear === year && workspaceMonth === month) {
          draft.activity.unshift({
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            text: providerFailureCount
              ? `${results.length} files were preserved; ${providerFailureCount} did not get a valid ${providerLabel} response and were sent to human review.`
              : `${results.length} files classified. Auto path: ${routeCounts.cache} cache, ${routeCounts.rules} rules, ${routeCounts.heuristic} heuristics, ${routeCounts.llm} LLM fallback. Only files below 70%, UNKNOWN, folder 1, or outside the target month were sent to review.`,
            tone: providerFailureCount ? 'warning' : 'success',
          })
          if (batchTotal > 1 && batchPosition >= batchTotal) draft.activity.unshift({
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            text: `${batchTotal} files from folder 0 were checked one by one.`,
            tone: 'success',
          })
        }
        return draft
      }, projectId)
      if (workspaceYear === year && workspaceMonth === month) currentWorkspace = updated
    }

    if (!currentWorkspace) currentWorkspace = await getWorkspace(companyId, year, month, projectId)
    return NextResponse.json(currentWorkspace)
  } catch (error) {
    const status = error instanceof GeminiProviderError || error instanceof GroqProviderError ? error.status : 400
    const response = NextResponse.json({ error: error instanceof Error ? error.message : 'Classification failed.' }, { status })
    if ((error instanceof GeminiProviderError || error instanceof GroqProviderError) && error.retryAfterSeconds) response.headers.set('Retry-After', String(error.retryAfterSeconds))
    return response
  }
}
