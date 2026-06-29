import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { cacheIntakeFile, getCachedClassification, getCompanyRuleContext, saveCachedClassification } from '@/lib/smartcomprovante/store'
import { localRouteDocument, storedClassificationToRoute } from '@/lib/smartcomprovante/routing'
import { RH_FOLDERS } from '@/lib/smartcomprovante/taxonomy'
import { updateUploadStatusByHash } from '@/lib/smartcomprovante/upload-store'
import { SMARTCOMPROVANTE_DATA_ROOT } from '@/lib/smartcomprovante/paths'

export const runtime = 'nodejs'
export const maxDuration = 300

const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png'])
const MAX_FILE_SIZE = 15 * 1024 * 1024
const MAX_TOTAL_SIZE = 150 * 1024 * 1024
const CLUSTER_CONFIDENCE_THRESHOLD = 0.34

type ClusterItem = {
  filename: string
  sourceHash: string
  confidence: number
  reason: string
  routeSource: string
  suggestedCode: string
  suggestedLabel: string
  evidence: string[]
  funnelLayer: string
  funnelTrace: Array<{ layer: string; status: 'matched' | 'missed' | 'skipped' | 'rejected'; detail: string }>
  targetYear: number | null
  targetMonth: number | null
}

type ClusterBucket = {
  key: string
  folderNumber: number | null
  code: string
  label: string
  averageConfidence: number
  items: ClusterItem[]
}

type DetectedPeriod = {
  key: string
  year: number
  month: number
  count: number
  groupedCount: number
}

type FunnelCounter = {
  key: string
  label: string
  matched: number
  rejected: number
  missed: number
}

const funnelLayers = [
  { key: 'input', label: 'Input accepted' },
  { key: 'cache', label: 'Exact cache match' },
  { key: 'learned_sections', label: 'Learned Base/Final Join section fingerprints' },
  { key: 'filename_taxonomy', label: 'Filename / folder-code taxonomy' },
  { key: 'pdf_text_layout', label: 'PDF text, metadata, layout, numbering and hierarchy' },
  { key: 'period_gate', label: 'Selected month/year gate' },
  { key: 'confidence_gate', label: 'Confidence gate' },
  { key: 'cluster_bucket', label: 'Final cluster bucket' },
] as const

const detectFunnelLayer = (cached: boolean, reason: string) => {
  if (cached) return 'cache'
  if (reason.startsWith('Learned join-section similarity')) return 'learned_sections'
  if (reason.startsWith('Similarity cluster hint')) return 'filename_taxonomy'
  if (reason.startsWith('Local ')) return 'pdf_text_layout'
  if (reason.includes('payslip/folder 1')) return 'pdf_text_layout'
  return 'unmatched'
}

const buildFunnelTrace = (input: {
  cached: boolean
  matchedLayer: string
  isAutoFolder: boolean
  periodMismatch: boolean
  confidence: number
  isOutlier: boolean
  documentCode: string
  reason: string
}) => {
  const matchedOrder = funnelLayers.findIndex((layer) => layer.key === input.matchedLayer)
  const layerStatus = (key: string) => {
    if (key === 'input') return { status: 'matched' as const, detail: 'File accepted for clustering.' }
    if (key === 'cache') {
      if (input.cached) return { status: 'matched' as const, detail: 'Previously seen exact file hash was reused.' }
      return { status: matchedOrder > 1 ? 'missed' as const : 'skipped' as const, detail: 'No exact cached classification for this file hash.' }
    }
    if (key === 'learned_sections') {
      if (input.matchedLayer === key) return { status: 'matched' as const, detail: input.reason }
      return { status: matchedOrder > 2 || input.matchedLayer === 'unmatched' ? 'missed' as const : 'skipped' as const, detail: 'No strong match against learned Base/Final Join section fingerprints.' }
    }
    if (key === 'filename_taxonomy') {
      if (input.matchedLayer === key) return { status: 'matched' as const, detail: input.reason }
      return { status: matchedOrder > 3 || input.matchedLayer === 'unmatched' ? 'missed' as const : 'skipped' as const, detail: 'No enough direct folder-code/filename taxonomy evidence.' }
    }
    if (key === 'pdf_text_layout') {
      if (input.matchedLayer === key) return { status: 'matched' as const, detail: input.reason }
      return { status: input.matchedLayer === 'unmatched' ? 'missed' as const : 'skipped' as const, detail: 'PDF text/layout layer was not the deciding layer.' }
    }
    if (key === 'period_gate') {
      if (input.periodMismatch) return { status: 'matched' as const, detail: 'Detected period does not match the selected month/year, but global clustering does not block by month. Month filtering happens after clustering.' }
      return { status: 'matched' as const, detail: 'No month/year mismatch detected. Global clustering continues.' }
    }
    if (key === 'confidence_gate') {
      if (input.confidence < CLUSTER_CONFIDENCE_THRESHOLD) return { status: 'rejected' as const, detail: `Confidence ${Math.round(input.confidence * 100)}% is below ${Math.round(CLUSTER_CONFIDENCE_THRESHOLD * 100)}%.` }
      if (!input.isAutoFolder) return { status: 'rejected' as const, detail: `Suggested code ${input.documentCode} is not an automatic folder 1-13 target.` }
      return { status: 'matched' as const, detail: `Confidence ${Math.round(input.confidence * 100)}% passed the clustering gate.` }
    }
    if (key === 'cluster_bucket') {
      return input.isOutlier
        ? { status: 'rejected' as const, detail: 'Sent to OUTLIERS for preview/review because confidence or document-family target failed.' }
        : { status: 'matched' as const, detail: `Accepted into ${input.documentCode} cluster.` }
    }
    return { status: 'skipped' as const, detail: '' }
  }
  return funnelLayers.map((layer) => ({ layer: layer.key, ...layerStatus(layer.key) }))
}

const writeClusterReport = async (report: Record<string, unknown>, markdown: string) => {
  const reportsDir = path.join(SMARTCOMPROVANTE_DATA_ROOT, 'reports', 'clustering')
  await fs.mkdir(reportsDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const jsonPath = path.join(reportsDir, `cluster-${stamp}.json`)
  const mdPath = path.join(reportsDir, `cluster-${stamp}.md`)
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await fs.writeFile(mdPath, markdown, 'utf8')
  return { jsonPath, mdPath }
}

const toMarkdown = (report: {
  runId: string
  companyId: string
  year: number
  month: number
  totalItems: number
  groupedItems: number
  outliers: number
  funnelSummary: FunnelCounter[]
  clusters: ClusterBucket[]
}) => [
  `# SmartComprovante clustering report`,
  ``,
  `Run: ${report.runId}`,
  `Company: ${report.companyId}`,
  `Period: ${String(report.month).padStart(2, '0')}/${report.year}`,
  `Total files: ${report.totalItems}`,
  `Grouped: ${report.groupedItems}`,
  `Outliers: ${report.outliers}`,
  ``,
  `## Funnel summary`,
  ``,
  `| Layer | Matched | Rejected | Missed |`,
  `|---|---:|---:|---:|`,
  ...report.funnelSummary.map((stage) => `| ${stage.label} | ${stage.matched} | ${stage.rejected} | ${stage.missed} |`),
  ``,
  `## Cluster buckets`,
  ``,
  ...report.clusters.flatMap((cluster) => [
    `### ${cluster.folderNumber ? `${String(cluster.folderNumber).padStart(2, '0')}_${cluster.code}` : cluster.code} - ${cluster.label}`,
    ``,
    `Files: ${cluster.items.length} | Average confidence: ${Math.round(cluster.averageConfidence * 100)}%`,
    ``,
    ...(cluster.items.length ? cluster.items.map((item) => `- ${item.filename} -> ${item.suggestedCode} (${Math.round(item.confidence * 100)}%, ${item.funnelLayer}) :: ${item.reason}`) : ['- No files matched this bucket.']),
    ``,
  ]),
].join('\n')

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const files = formData.getAll('files').filter((item): item is File => item instanceof File)
    const relativePaths = formData.getAll('relativePaths').map((item) => String(item || ''))
    const companyId = String(formData.get('companyId') || 'agix')
    const year = Number(formData.get('year') || 2026)
    const month = Number(formData.get('month') || 1)

    if (!files.length) return NextResponse.json({ error: 'Load folder 0 before clustering.' }, { status: 400 })
    const inferredType = (file: File) => file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : file.name.toLowerCase().endsWith('.png') ? 'image/png' : /\.jpe?g$/i.test(file.name) ? 'image/jpeg' : '')
    if (files.some((file) => !allowedTypes.has(inferredType(file)) || file.size > MAX_FILE_SIZE)) return NextResponse.json({ error: 'Use PDF, JPG, or PNG up to 15 MB per file.' }, { status: 400 })
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_SIZE) return NextResponse.json({ error: 'The folder exceeds the 150 MB clustering limit.' }, { status: 400 })

    const ruleContext = await getCompanyRuleContext(companyId)
    // Build a map of document_code → period signal summary for the dashboard to show per-cluster
    const periodSignals: Record<string, { anchorPhrases: string[]; hasMark: boolean; detectionRate: number }> = {}
    for (const fp of ruleContext.enrichedFingerprints ?? []) {
      if (fp.period_signal) {
        periodSignals[fp.document_code] = {
          anchorPhrases: fp.period_signal.anchor_phrases ?? [],
          hasMark: Boolean(fp.period_signal.mark),
          detectionRate: fp.period_signal.detection_rate ?? 0,
        }
      }
    }
    const buckets = new Map<string, ClusterBucket>()
    const ensureBucket = (key: string, folderNumber: number | null, code: string, label: string) => {
      const existing = buckets.get(key)
      if (existing) return existing
      const created: ClusterBucket = { key, folderNumber, code, label, averageConfidence: 0, items: [] }
      buckets.set(key, created)
      return created
    }
    for (const folder of RH_FOLDERS.filter((item) => item.number >= 1 && item.number <= 13)) {
      ensureBucket(folder.code, folder.number, folder.code, folder.label)
    }
    const outlierBucket = ensureBucket('OUTLIERS', null, 'OUTLIERS', 'Needs grouping review')
    const runId = crypto.randomUUID()

    for (const [index, file] of files.entries()) {
      const sourceName = relativePaths[index] || file.name
      const sourceHash = await cacheIntakeFile(file, crypto.randomUUID())
      const cached = await getCachedClassification(companyId, sourceHash, ruleContext.rulesVersion)
      const routed = cached ? storedClassificationToRoute(cached) : await localRouteDocument(file, { year, month }, ruleContext, sourceName, { ignorePeriodConfidence: true })
      const funnelLayer = detectFunnelLayer(Boolean(cached), routed.reason)
      const folder = RH_FOLDERS.find((item) => item.code === routed.document_code)
      const isAutoFolder = Boolean(folder && folder.number >= 1 && folder.number <= 13)
      const periodMismatch = Boolean(
        (routed.target_year && routed.target_year !== year)
        || (routed.target_month && routed.target_month !== month)
      )
      const isOutlier = !isAutoFolder || routed.confidence < CLUSTER_CONFIDENCE_THRESHOLD
      const funnelTrace = buildFunnelTrace({
        cached: Boolean(cached),
        matchedLayer: funnelLayer,
        isAutoFolder,
        periodMismatch,
        confidence: routed.confidence,
        isOutlier,
        documentCode: routed.document_code,
        reason: routed.reason,
      })
      const suggestedLabel = folder?.label || 'Unknown document type'
      const evidence = [
        cached ? 'Exact file cache match' : null,
        ruleContext.approvedExamples.length ? 'Company example/rules similarity' : null,
        ruleContext.sectionFingerprints?.length ? `Learned section fingerprints: ${ruleContext.sectionFingerprints.length}` : 'No learned section fingerprints yet',
        'Filename pattern analysis',
        'PDF text/layout/metadata signal analysis',
        periodMismatch ? 'Period mismatch detected but not blocking global clustering' : routed.target_year || routed.target_month ? 'Period detection' : null,
        isOutlier ? 'Outlier gate: low confidence, unknown, or non-target family' : folder?.number === 1 ? 'Accepted into folder 1 payslip cluster for Final Join' : 'Accepted into folder 2-13 cluster',
      ].filter((item): item is string => Boolean(item))
      // Persist fresh, confident, on-target classifications so re-runs skip PDF re-parsing
      // and so manual reassignments (which overwrite this cache) are honoured next run.
      if (!cached && isAutoFolder && !isOutlier && !periodMismatch && routed.confidence >= CLUSTER_CONFIDENCE_THRESHOLD) {
        await saveCachedClassification(companyId, sourceHash, {
          document_code: routed.document_code,
          confidence: routed.confidence,
          reason: routed.reason,
          target_year: routed.target_year,
          target_month: routed.target_month,
          employee_name: routed.employee_name,
          route_source: routed.route_source,
          rules_version: ruleContext.rulesVersion,
        })
      }
      const bucket = isOutlier ? outlierBucket : buckets.get(routed.document_code)!
      bucket.items.push({
        filename: sourceName,
        sourceHash,
        confidence: routed.confidence,
        reason: routed.reason,
        routeSource: routed.route_source,
        suggestedCode: routed.document_code,
        suggestedLabel,
        evidence,
        funnelLayer,
        funnelTrace,
        targetYear: routed.target_year,
        targetMonth: routed.target_month,
      })
    }

    const clusters = Array.from(buckets.values())
      .map((bucket) => ({
        ...bucket,
        averageConfidence: bucket.items.length
          ? bucket.items.reduce((sum, item) => sum + item.confidence, 0) / bucket.items.length
          : 0,
      }))
      .sort((left, right) => {
        if (left.key === 'OUTLIERS') return 1
        if (right.key === 'OUTLIERS') return -1
        return (left.folderNumber || 99) - (right.folderNumber || 99)
      })

    const totalItems = clusters.reduce((sum, cluster) => sum + cluster.items.length, 0)
    const outliers = clusters.find((cluster) => cluster.key === 'OUTLIERS')?.items.length || 0
    const allItems = clusters.flatMap((cluster) => cluster.items)
    const periodMap = new Map<string, DetectedPeriod>()
    for (const cluster of clusters) {
      for (const item of cluster.items) {
        if (!item.targetYear || !item.targetMonth) continue
        const key = `${item.targetYear}-${String(item.targetMonth).padStart(2, '0')}`
        const current = periodMap.get(key) || { key, year: item.targetYear, month: item.targetMonth, count: 0, groupedCount: 0 }
        current.count += 1
        if (cluster.key !== 'OUTLIERS') current.groupedCount += 1
        periodMap.set(key, current)
      }
    }
    const detectedPeriods = Array.from(periodMap.values()).sort((left, right) => left.year - right.year || left.month - right.month)
    const funnelSummary: FunnelCounter[] = funnelLayers.map((layer) => {
      const layerTraces = allItems.map((item) => item.funnelTrace.find((trace) => trace.layer === layer.key)).filter(Boolean)
      return {
        key: layer.key,
        label: layer.label,
        matched: layerTraces.filter((trace) => trace?.status === 'matched').length,
        rejected: layerTraces.filter((trace) => trace?.status === 'rejected').length,
        missed: layerTraces.filter((trace) => trace?.status === 'missed').length,
      }
    })
    const report = {
      runId,
      createdAt: new Date().toISOString(),
      companyId,
      year,
      month,
      thresholds: { clusterConfidence: CLUSTER_CONFIDENCE_THRESHOLD },
      trainingContext: {
        approvedExamples: ruleContext.approvedExamples.length,
        learnedSectionFingerprints: ruleContext.sectionFingerprints?.length || 0,
      },
      totalItems,
      groupedItems: totalItems - outliers,
      outliers,
      detectedPeriods,
      funnelSummary,
      clusters,
    }
    const reportFiles = await writeClusterReport(report, toMarkdown(report))
    // Mark matching customer uploads as grouped (non-blocking)
    void Promise.all(
      allItems
        .filter((item) => /^[0-9a-f]{64}$/i.test(item.sourceHash))
        .map((item) => updateUploadStatusByHash(companyId, year, item.sourceHash, 'grouped'))
    )
    return NextResponse.json({
      runId,
      companyId,
      year,
      month,
      totalItems,
      groupedItems: totalItems - outliers,
      outliers,
      detectedPeriods,
      funnelSummary,
      periodSignals,
      reportPath: reportFiles.mdPath,
      reportJsonPath: reportFiles.jsonPath,
      clusters,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Clustering failed.' }, { status: 400 })
  }
}
