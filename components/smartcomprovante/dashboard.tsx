'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { MonthlyWorkspace, ReviewItem } from '@/lib/smartcomprovante/types'

export default function SmartComprovanteOverview() {
  const [workspace, setWorkspace] = useState<MonthlyWorkspace | null>(null)
  const [activeMonth, setActiveMonth] = useState(1)
  const [batchStats, setBatchStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [selectedReview, setSelectedReview] = useState<ReviewItem | null>(null)

  useEffect(() => {
    const loadWorkspace = async () => {
      try {
        const res = await fetch(`/api/smartcomprovante/workspace?companyId=agix&year=2026&month=${activeMonth}`)
        const data = await res.json()
        setWorkspace(data)
        setLoading(false)
      } catch (error) {
        console.error('Failed to load workspace:', error)
        setLoading(false)
      }
    }
    loadWorkspace()
  }, [activeMonth])

  const handleApproveReview = async (reviewId: string, approved: boolean) => {
    if (!workspace) return
    try {
      const res = await fetch('/api/smartcomprovante/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: workspace.company.id,
          year: workspace.year,
          month: workspace.month,
          reviewId,
          approved,
        }),
      })
      if (res.ok) {
        // Reload workspace
        const reloadRes = await fetch(
          `/api/smartcomprovante/workspace?companyId=${workspace.company.id}&year=${workspace.year}&month=${workspace.month}`
        )
        const updated = await reloadRes.json()
        setWorkspace(updated)
        setSelectedReview(null)
      }
    } catch (error) {
      console.error('Failed to approve review:', error)
    }
  }

  const handleExport = async () => {
    if (!workspace) return
    try {
      const res = await fetch('/api/smartcomprovante/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId: 'current-batch', // In real implementation, use actual batch ID
          companyId: workspace.company.id,
          year: workspace.year,
          month: workspace.month,
          provider: workspace.provider,
          includeAudit: true,
        }),
      })
      const data = await res.json()
      setBatchStats(data)
    } catch (error) {
      console.error('Failed to export:', error)
    }
  }

  if (loading) {
    return <div className="p-8 text-center">Carregando workspace...</div>
  }

  if (!workspace) {
    return <div className="p-8 text-center text-red-600">Não foi possível carregar o workspace.</div>
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold">SmartComprovante - {workspace.company.legalName}</h1>
        <p className="text-muted-foreground">
          NIF: {workspace.company.nif} | Projeto: {workspace.project.name}
        </p>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="folders">Pastas</TabsTrigger>
          <TabsTrigger value="reviews">Revisões ({workspace.reviews.length})</TabsTrigger>
          <TabsTrigger value="export">Exportação</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Mês: {String(workspace.month).padStart(2, '0')}/{workspace.year}</CardTitle>
              <CardDescription>Seleção de mês para processamento</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-12 gap-2">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                  <Button
                    key={month}
                    variant={activeMonth === month ? 'default' : 'outline'}
                    onClick={() => setActiveMonth(month)}
                    className="text-sm"
                  >
                    {String(month).padStart(2, '0')}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Estatísticas do Mês</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-4 gap-4">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Ficheiros Processados</p>
                <p className="text-2xl font-bold">{workspace.intakeCount}</p>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Aprovados</p>
                <p className="text-2xl font-bold text-green-600">
                  {workspace.folders.reduce((sum, f) => sum + (f.approvedCount || 0), 0)}
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Para Revisão</p>
                <p className="text-2xl font-bold text-yellow-600">
                  {workspace.folders.reduce((sum, f) => sum + (f.reviewCount || 0), 0)}
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Faltando</p>
                <p className="text-2xl font-bold text-red-600">
                  {workspace.folders.filter((f) => f.status === 'missing').length}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Atividade Recente</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {workspace.activity.slice(-5).map((item) => (
                  <div key={item.id} className="flex items-start gap-3 border-b last:border-0 pb-3 last:pb-0">
                    <Badge variant={item.tone === 'success' ? 'default' : item.tone === 'warning' ? 'destructive' : 'secondary'}>
                      {item.tone}
                    </Badge>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{item.text}</p>
                      <p className="text-xs text-muted-foreground">{new Date(item.at).toLocaleString('pt-PT')}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="folders" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Pastas de Prova - Recursos Humanos</CardTitle>
              <CardDescription>Estado de cada categoria obrigatória</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Pasta</TableHead>
                    <TableHead>Código</TableHead>
                    <TableHead>Designação</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Documentos</TableHead>
                    <TableHead>Aprovados</TableHead>
                    <TableHead>Para Revisão</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workspace.folders.map((folder) => (
                    <TableRow key={folder.number}>
                      <TableCell className="font-mono text-sm">{folder.number}</TableCell>
                      <TableCell className="font-mono font-medium">{folder.code}</TableCell>
                      <TableCell className="text-sm">{folder.label}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            folder.status === 'approved'
                              ? 'default'
                              : folder.status === 'review'
                                ? 'secondary'
                                : folder.status === 'detected'
                                  ? 'outline'
                                  : 'destructive'
                          }
                        >
                          {folder.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{folder.documentCount}</TableCell>
                      <TableCell className="text-green-600 font-medium">{folder.approvedCount}</TableCell>
                      <TableCell className="text-yellow-600 font-medium">{folder.reviewCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reviews" className="space-y-4">
          {workspace.reviews.length === 0 ? (
            <Alert>
              <AlertDescription>Nenhuma revisão pendente.</AlertDescription>
            </Alert>
          ) : (
            workspace.reviews.map((review) => (
              <Card key={review.id} className="relative">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">{review.filename}</CardTitle>
                      <CardDescription>
                        {review.proposedLabel} ({review.proposedCode})
                      </CardDescription>
                    </div>
                    <Badge
                      variant={
                        review.status === 'approved'
                          ? 'default'
                          : review.status === 'pending'
                            ? 'secondary'
                            : 'outline'
                      }
                    >
                      {review.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm font-medium">Motivo da Revisão:</p>
                    <p className="text-sm text-muted-foreground">{review.reason}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Confiança: {(review.confidence * 100).toFixed(1)}%</p>
                    <div className="w-full bg-gray-200 rounded h-2 mt-1">
                      <div
                        className="bg-blue-600 h-2 rounded"
                        style={{ width: `${review.confidence * 100}%` }}
                      />
                    </div>
                  </div>
                  {review.status === 'pending' && (
                    <div className="flex gap-2">
                      <Button
                        onClick={() => handleApproveReview(review.id, true)}
                        className="flex-1"
                        variant="default"
                      >
                        Aprovar
                      </Button>
                      <Button
                        onClick={() => handleApproveReview(review.id, false)}
                        className="flex-1"
                        variant="outline"
                      >
                        Rejeitar
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="export" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Exportação e Relatório de Auditoria</CardTitle>
              <CardDescription>Gerar Base Join com manifesto de auditoria</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button onClick={handleExport} className="w-full" size="lg">
                Gerar Exportação com Auditoria
              </Button>

              {batchStats && (
                <div className="space-y-4 mt-4 border-t pt-4">
                  <Alert>
                    <AlertDescription>Exportação gerada com sucesso!</AlertDescription>
                  </Alert>

                  <div className="grid grid-cols-2 gap-4">
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base">Ficheiro Exportado</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="font-mono text-sm text-muted-foreground break-all">{batchStats.filename}</p>
                        <Button variant="outline" className="mt-3 w-full" size="sm">
                          Descarregar
                        </Button>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base">Estatísticas do Lote</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-1 text-sm">
                        <p>Total: {batchStats.statistics?.totalDocuments} docs</p>
                        <p className="text-green-600">Aprovados: {batchStats.statistics?.approvedCount}</p>
                        <p className="text-yellow-600">Revisão: {batchStats.statistics?.reviewCount}</p>
                      </CardContent>
                    </Card>
                  </div>

                  {batchStats.manifest && (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base">Relatório de Auditoria</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2 text-sm">
                        <p>Cache Hits: {batchStats.manifest.metrics.cacheHitRate.toFixed(1)}%</p>
                        <p>Tokens Utilizados: {batchStats.manifest.metrics.totalTokensUsed}</p>
                        <p>Custo Estimado: €{batchStats.manifest.metrics.estimatedCost.toFixed(2)}</p>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
