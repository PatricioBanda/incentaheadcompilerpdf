'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EvidenceStatus, JoinStatus, MonthlyWorkspace } from '@/lib/smartcomprovante/types'
import {
  AlertTriangle, Archive, Bot, Building2, Check, ChevronLeft, ChevronRight, CircleHelp,
  Clock3, Download, FileCheck2, FileStack, FolderInput, History, KeyRound, LayoutDashboard,
  Loader2, LockKeyhole, Plus, RefreshCw, Search, Settings, ShieldCheck, Sparkles, Upload, Users, X,
} from 'lucide-react'

type View = 'workspace' | 'review' | 'settings'
type ProviderStatus = { provider: string; model: string; configured: boolean; credentialState: string; mode: string }

declare global {
  interface Window {
    smartComprovante?: {
      credentialStatus: () => Promise<{ configured: boolean; encryptionAvailable: boolean }>
      saveGeminiKey: (key: string) => Promise<{ ok: boolean; configured: boolean; error?: string }>
      deleteGeminiKey: () => Promise<{ ok: boolean; configured: boolean }>
    }
  }
}

const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

const statusLabel: Partial<Record<EvidenceStatus | JoinStatus, string>> = {
  missing: 'Em falta', detected: 'Detetado', review: 'Revisão', approved: 'Aprovado', passed: 'Passado',
  blocked: 'Bloqueado', ready: 'Pronto', current: 'Atual', stale: 'Desatualizado', failed: 'Falhou',
}

const statusClasses: Partial<Record<EvidenceStatus | JoinStatus, string>> = {
  missing: 'bg-slate-100 text-slate-600', detected: 'bg-blue-50 text-blue-700', review: 'bg-amber-50 text-amber-700',
  approved: 'bg-emerald-50 text-emerald-700', passed: 'bg-violet-50 text-violet-700', blocked: 'bg-rose-50 text-rose-700',
  ready: 'bg-blue-50 text-blue-700', current: 'bg-emerald-50 text-emerald-700', stale: 'bg-amber-50 text-amber-700', failed: 'bg-rose-50 text-rose-700',
}

function StatusPill({ status }: { status: EvidenceStatus | JoinStatus }) {
  const fallbackLabel: Record<string, string> = {
    confirmed_missing: 'Falta confirmada',
    needs_confirmation: 'Confirmar faltas',
    ready_with_warnings: 'Pronto c/ avisos',
  }
  const fallbackClass = status === 'confirmed_missing' || status === 'needs_confirmation' || status === 'ready_with_warnings'
    ? 'bg-orange-50 text-orange-700'
    : 'bg-slate-100 text-slate-600'
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClasses[status] || fallbackClass}`}>{statusLabel[status] || fallbackLabel[status] || status}</span>
}

function MetricCard({ icon: Icon, label, value, detail, tone }: { icon: typeof FolderInput; label: string; value: string | number; detail: string; tone: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div><p className="text-sm font-medium text-slate-500">{label}</p><p className="mt-2 text-3xl font-bold tracking-tight text-slate-950">{value}</p></div>
        <div className={`rounded-xl p-2.5 ${tone}`}><Icon className="h-5 w-5" /></div>
      </div>
      <p className="mt-3 text-xs text-slate-500">{detail}</p>
    </div>
  )
}

export function PrototypeDashboard() {
  const [workspace, setWorkspace] = useState<MonthlyWorkspace | null>(null)
  const [provider, setProvider] = useState<ProviderStatus | null>(null)
  const [view, setView] = useState<View>('workspace')
  const [busy, setBusy] = useState<string | null>('loading')
  const [error, setError] = useState('')
  const [showCompanyDialog, setShowCompanyDialog] = useState(false)
  const [companyForm, setCompanyForm] = useState({ legalName: '', nif: '', code: '' })
  const [keyValue, setKeyValue] = useState('')
  const [credential, setCredential] = useState<{ configured: boolean; encryptionAvailable: boolean } | null>(null)
  const [reviewDestinations, setReviewDestinations] = useState<Record<string, string>>({})
  const [previewReviewId, setPreviewReviewId] = useState<string | null>(null)
  const [folderProgress, setFolderProgress] = useState<{ current: number; total: number; filename: string } | null>(null)
  const [selectedMonths, setSelectedMonths] = useState<number[]>([])
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const baseReferenceInputRef = useRef<HTMLInputElement>(null)
  const finalReferenceInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setBusy('loading')
    setError('')
    try {
      const [workspaceResponse, providerResponse] = await Promise.all([
        fetch('/api/smartcomprovante/workspace', { cache: 'no-store' }),
        fetch('/api/smartcomprovante/provider', { cache: 'no-store' }),
      ])
      if (!workspaceResponse.ok) throw new Error('Não foi possível carregar o workspace.')
      setWorkspace(await workspaceResponse.json())
      setProvider(await providerResponse.json())
      if (window.smartComprovante) setCredential(await window.smartComprovante.credentialStatus())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'O carregamento falhou.')
    } finally {
      setBusy(null)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const openMonth = async (month: number) => {
    if (!workspace) return
    setBusy(`month-${month}`)
    setError('')
    try {
      const response = await fetch(`/api/smartcomprovante/workspace?companyId=${encodeURIComponent(workspace.company.id)}&year=${workspace.year}&month=${month}`, { cache: 'no-store' })
      if (!response.ok) throw new Error('Não foi possível abrir o mês selecionado.')
      setWorkspace(await response.json())
      setView('workspace')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível abrir o mês selecionado.')
    } finally {
      setBusy(null)
    }
  }

  const toggleSelectedMonth = (month: number) => {
    setSelectedMonths((current) => current.includes(month) ? current.filter((item) => item !== month) : [...current, month].sort((a, b) => a - b))
  }

  const generateSelectedBaseJoins = async () => {
    if (!workspace || selectedMonths.length === 0) return
    setBusy('generate-selected-base')
    setError('')
    try {
      let currentWorkspace: MonthlyWorkspace | null = null
      for (const month of selectedMonths) {
        const response = await fetch('/api/smartcomprovante/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'generate-base', companyId: workspace.company.id, year: workspace.year, month }),
        })
        const result = await response.json()
        if (!response.ok) throw new Error(`${monthNames[month - 1]}: ${result.error || 'A geração da Base Join falhou.'}`)
        if (month === workspace.month) currentWorkspace = result as MonthlyWorkspace
      }
      if (currentWorkspace) setWorkspace(currentWorkspace)
      setSelectedMonths([])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'A geração das Base Joins falhou.')
    } finally {
      setBusy(null)
    }
  }

  const generateSelectedBaseAndFinals = async () => {
    if (!workspace || selectedMonths.length === 0) return
    setBusy('generate-selected-all')
    setError('')
    try {
      let currentWorkspace: MonthlyWorkspace | null = null
      for (const month of selectedMonths) {
        const baseResponse = await fetch('/api/smartcomprovante/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'generate-base', companyId: workspace.company.id, year: workspace.year, month }),
        })
        const baseResult = await baseResponse.json()
        if (!baseResponse.ok) throw new Error(`${monthNames[month - 1]}: ${baseResult.error || 'A geração da Base Join falhou.'}`)
        const finalsResponse = await fetch('/api/smartcomprovante/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'generate-finals', companyId: workspace.company.id, year: workspace.year, month }),
        })
        const finalsResult = await finalsResponse.json()
        if (!finalsResponse.ok) throw new Error(`${monthNames[month - 1]}: ${finalsResult.error || 'A geração dos Comprovantes Finais falhou.'}`)
        if (month === workspace.month) currentWorkspace = finalsResult as MonthlyWorkspace
      }
      if (currentWorkspace) setWorkspace(currentWorkspace)
      setSelectedMonths([])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'A geração dos meses selecionados falhou.')
    } finally {
      setBusy(null)
    }
  }

  const runAction = async (action: string, reviewId?: string, destinationCode?: string) => {
    if (!workspace) return
    setBusy(reviewId || action)
    setError('')
    try {
      const response = await fetch('/api/smartcomprovante/actions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reviewId, destinationCode, companyId: workspace.company.id, year: workspace.year, month: workspace.month }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'A ação falhou.')
      setWorkspace(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'A ação falhou.')
    } finally { setBusy(null) }
  }

  const classifySelectedFiles = async (files: FileList | null, source: 'folder' | 'files' = 'files') => {
    if (!workspace || !files?.length) return
    const selectedFiles = Array.from(files).filter((file) => /\.(pdf|png|jpe?g)$/i.test(file.name))
    if (!selectedFiles.length) {
      setError('A pasta selecionada não contém ficheiros PDF, PNG ou JPG suportados.')
      return
    }
    setBusy(source === 'folder' ? 'classify-folder' : 'classify-files')
    setError('')
    try {
      let result: MonthlyWorkspace | null = null
      for (let index = 0; index < selectedFiles.length; index += 1) {
        const file = selectedFiles[index]
        setFolderProgress({ current: index + 1, total: selectedFiles.length, filename: file.webkitRelativePath || file.name })
        const formData = new FormData()
        formData.set('companyId', workspace.company.id)
        formData.set('year', String(workspace.year))
        formData.set('month', String(workspace.month))
        formData.set('mode', source === 'folder' || index > 0 ? 'append' : 'replace')
        formData.set('batchPosition', String(index + 1))
        formData.set('batchTotal', String(selectedFiles.length))
        formData.append('files', file, file.name)
        const response = await fetch('/api/smartcomprovante/classify', { method: 'POST', body: formData })
        const responseBody = await response.json()
        if (!response.ok) throw new Error(`${file.name}: ${responseBody.error || 'A classificação falhou.'}`)
        result = responseBody as MonthlyWorkspace
        setWorkspace(result)
      }
      if (!result) return
      setReviewDestinations(Object.fromEntries(result.reviews.map((review) => [review.id, review.proposedCode])))
      setView('review')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'A classificação falhou.') }
    finally {
      setBusy(null)
      setFolderProgress(null)
      if (uploadInputRef.current) uploadInputRef.current.value = ''
      if (folderInputRef.current) folderInputRef.current.value = ''
    }
  }

  const uploadJoinReference = async (kind: 'base_join' | 'final_join', files: FileList | null) => {
    const selectedFiles = Array.from(files || []).filter((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))
    if (!workspace || selectedFiles.length === 0) return
    const workspaceForUpload = workspace
    const file = selectedFiles[0]
    setBusy(`reference-${kind}`)
    setError('')
    try {
      let multiResult: MonthlyWorkspace | null = null
      for (const referenceFile of selectedFiles) {
        const formData = new FormData()
        formData.set('companyId', workspace.company.id)
        formData.set('year', String(workspace.year))
        formData.set('month', String(workspace.month))
        formData.set('kind', kind)
        formData.set('file', referenceFile, referenceFile.name)
        const response = await fetch('/api/smartcomprovante/references', { method: 'POST', body: formData })
        const responseBody = await response.json()
        if (!response.ok) throw new Error(`${referenceFile.name}: ${responseBody.error || 'Não foi possível guardar a referência.'}`)
        multiResult = responseBody as MonthlyWorkspace
      }
      if (multiResult) setWorkspace(multiResult)
      return
      const formData = new FormData()
      formData.set('companyId', workspaceForUpload.company.id)
      formData.set('year', String(workspaceForUpload.year))
      formData.set('month', String(workspaceForUpload.month))
      formData.set('kind', kind)
      formData.set('file', file, file.name)
      const response = await fetch('/api/smartcomprovante/references', { method: 'POST', body: formData })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Não foi possível guardar a referência.')
      setWorkspace(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível guardar a referência.')
    } finally {
      setBusy(null)
      if (baseReferenceInputRef.current) baseReferenceInputRef.current.value = ''
      if (finalReferenceInputRef.current) finalReferenceInputRef.current.value = ''
    }
  }

  const createCompany = async () => {
    setBusy('create-company')
    setError('')
    try {
      const response = await fetch('/api/smartcomprovante/companies', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(companyForm),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      setWorkspace(result)
      setShowCompanyDialog(false)
      setCompanyForm({ legalName: '', nif: '', code: '' })
      setView('workspace')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível criar a empresa.') }
    finally { setBusy(null) }
  }

  const saveKey = async () => {
    if (!window.smartComprovante) return
    setBusy('save-key')
    const result = await window.smartComprovante.saveGeminiKey(keyValue)
    if (!result.ok) setError(result.error || 'Não foi possível guardar a chave.')
    else { setKeyValue(''); setCredential(await window.smartComprovante.credentialStatus()) }
    setBusy(null)
  }

  const deleteKey = async () => {
    if (!window.smartComprovante) return
    setBusy('delete-key')
    await window.smartComprovante.deleteGeminiKey()
    setCredential(await window.smartComprovante.credentialStatus())
    setBusy(null)
  }

  const approvedFolders = useMemo(() => workspace?.folders.filter((folder) => folder.status === 'approved' || folder.status === 'passed').length || 0, [workspace])
  const pendingReviews = workspace?.reviews.filter((review) => review.status === 'pending').length || 0
  const currentFinals = workspace?.employees.filter((employee) => employee.finalStatus === 'current').length || 0
  const baseReferenceCount = (workspace?.joinReferences || []).filter((item) => item.kind === 'base_join').length
  const finalReferenceCount = (workspace?.joinReferences || []).filter((item) => item.kind === 'final_join').length
  const referenceGuideReady = baseReferenceCount > 0 && finalReferenceCount > 0
  const hasElectronBridge = typeof window !== 'undefined' && Boolean(window.smartComprovante)
  const activeProviderName = provider?.provider === 'groq' ? 'Groq' : 'Gemini'

  if (!workspace && busy === 'loading') return <div className="flex min-h-screen items-center justify-center bg-slate-50"><Loader2 className="h-7 w-7 animate-spin text-teal-700" /></div>
  if (!workspace) return <div className="p-10 text-rose-700">{error || 'Workspace indisponível.'}</div>

  const nav = [
    { id: 'workspace' as const, label: 'Workspace mensal', icon: LayoutDashboard },
    { id: 'review' as const, label: 'Revisão', icon: CircleHelp, count: pendingReviews },
    { id: 'settings' as const, label: 'Definições', icon: Settings },
  ]

  return (
    <div className="min-h-screen bg-[#f5f7f8] text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-20 flex w-64 flex-col border-r border-slate-200 bg-[#112d2a] text-white">
        <div className="flex h-20 items-center gap-3 border-b border-white/10 px-6">
          <div className="rounded-xl bg-teal-400/15 p-2"><FileCheck2 className="h-6 w-6 text-teal-300" /></div>
          <div><p className="font-semibold tracking-tight">SmartComprovante</p><p className="text-xs text-teal-100/60">Protótipo operacional</p></div>
        </div>
        <nav className="flex-1 space-y-1 p-4">
          {nav.map(({ id, label, icon: Icon, count }) => (
            <button key={id} onClick={() => setView(id)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition ${view === id ? 'bg-white/12 text-white' : 'text-teal-50/70 hover:bg-white/7 hover:text-white'}`}>
              <Icon className="h-4 w-4" /><span className="flex-1">{label}</span>{count ? <span className="rounded-full bg-amber-400 px-2 py-0.5 text-xs font-bold text-amber-950">{count}</span> : null}
            </button>
          ))}
          <div className="my-4 border-t border-white/10" />
          <button className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-teal-50/55"><Building2 className="h-4 w-4" />Empresas</button>
          <button className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-teal-50/55"><History className="h-4 w-4" />Histórico</button>
          <button className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-teal-50/55"><Archive className="h-4 w-4" />Backups</button>
        </nav>
        <div className="m-4 rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-teal-100"><ShieldCheck className="h-4 w-4 text-teal-300" /> Dados locais protegidos</div>
          <p className="mt-2 text-xs leading-5 text-teal-50/55">{activeProviderName} cloud apenas com consentimento explícito. Regras v{workspace.company.rulesVersion}.</p>
        </div>
      </aside>

      <main className="ml-64 min-h-screen">
        <header className="sticky top-0 z-10 flex h-20 items-center justify-between border-b border-slate-200 bg-white/95 px-8 backdrop-blur">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500"><span>{workspace.program.name}</span><span>/</span><span>{workspace.project.code}</span><span>/</span><span className="text-slate-800">{workspace.company.legalName}</span></div>
            <div className="mt-1 flex items-center gap-2"><button className="rounded-lg p-1 hover:bg-slate-100"><ChevronLeft className="h-4 w-4" /></button><h1 className="text-lg font-bold">{monthNames[workspace.month - 1]} {workspace.year}</h1><button className="rounded-lg p-1 hover:bg-slate-100"><ChevronRight className="h-4 w-4" /></button></div>
          </div>
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${provider?.configured || credential?.configured ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}><Bot className="h-4 w-4" />{activeProviderName} · {provider?.configured || credential?.configured ? 'Configurado' : 'Modo demonstração'}</div>
            <button onClick={() => setShowCompanyDialog(true)} className="inline-flex items-center gap-2 rounded-xl bg-[#176b61] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#12584f]"><Plus className="h-4 w-4" />Nova empresa</button>
          </div>
        </header>

        <div className="mx-auto max-w-[1500px] p-8">
          {error ? <div className="mb-5 flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{error}</span><button onClick={() => setError('')}><X className="h-4 w-4" /></button></div> : null}

          {view === 'workspace' ? <>
            <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Workspace anual</p>
                  <h2 className="mt-1 text-xl font-bold">{workspace.company.legalName} · {workspace.year}</h2>
                  <p className="mt-1 text-sm text-slate-500">Escolha um dos 12 meses para classificar, rever, gerar Base Join e Comprovantes Finais.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setSelectedMonths(selectedMonths.length === 12 ? [] : monthNames.map((_, index) => index + 1))} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold hover:bg-slate-50">{selectedMonths.length === 12 ? 'Limpar meses' : 'Selecionar 12 meses'}</button>
                  <button onClick={() => void generateSelectedBaseJoins()} disabled={!selectedMonths.length || Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl bg-[#176b61] px-4 py-2.5 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500">{busy === 'generate-selected-base' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileStack className="h-4 w-4" />}Gerar Base Joins {selectedMonths.length ? `(${selectedMonths.length})` : ''}</button>
                  <button onClick={() => void generateSelectedBaseAndFinals()} disabled={!selectedMonths.length || Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500">{busy === 'generate-selected-all' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}Gerar Base + Finais {selectedMonths.length ? `(${selectedMonths.length})` : ''}</button>
                  <button onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold hover:bg-slate-50"><RefreshCw className="h-4 w-4" />Atualizar ano</button>
                </div>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
                {monthNames.map((name, index) => {
                  const month = index + 1
                  const active = month === workspace.month
                  const seeded = month === 1
                  return (
                    <button type="button" key={name} onClick={() => toggleSelectedMonth(month)} className={`rounded-xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${selectedMonths.includes(month) ? 'border-teal-600 bg-teal-50 ring-2 ring-teal-100' : active ? 'border-teal-500 bg-white ring-1 ring-teal-100' : 'border-slate-200 bg-slate-50 hover:bg-white'}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-slate-800">{name}</span>
                        {busy === `month-${month}` ? <Loader2 className="h-4 w-4 animate-spin text-teal-700" /> : <span className={`h-2.5 w-2.5 rounded-full ${seeded ? active ? 'bg-teal-600' : 'bg-amber-400' : 'bg-slate-300'}`} />}
                      </div>
                      <p className="mt-2 text-xs text-slate-500">{active ? 'Aberto agora' : seeded ? 'Com dados demo' : 'Sem ficheiros ainda'}</p>
                      <span className={`mt-3 flex w-full items-center justify-center rounded-lg border px-2 py-1.5 text-xs font-semibold transition ${selectedMonths.includes(month) ? 'border-teal-600 bg-teal-600 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>
                        {selectedMonths.includes(month) ? 'Selecionado' : 'Selecionar p/ Base Join'}
                      </span>
                      <span onClick={(event) => { event.stopPropagation(); void openMonth(month) }} className="mt-2 flex w-full items-center justify-center rounded-lg px-2 py-1 text-xs font-semibold text-teal-700 hover:bg-white">Abrir mês</span>
                    </button>
                  )
                })}
              </div>
            </section>

            <section className="mb-6 rounded-2xl border border-teal-200 bg-gradient-to-r from-teal-50 to-white p-6 shadow-sm">
              <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
                <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-700 text-xs font-bold text-white">1</span><p className="text-xs font-bold uppercase tracking-widest text-teal-700">Preparar o guia da empresa</p></div><h2 className="mt-3 text-xl font-bold">Carregue primeiro os exemplos Base Join e Final Join</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">O {activeProviderName} extrai apenas o perfil estrutural reutilizável. A cópia temporária do PDF de referência é descartada após a análise e não aparece como ficheiro descarregável.</p><div className="mt-4 flex flex-wrap gap-3"><input ref={baseReferenceInputRef} type="file" multiple accept="application/pdf" className="hidden" onChange={(event) => void uploadJoinReference('base_join', event.target.files)} /><input ref={finalReferenceInputRef} type="file" multiple accept="application/pdf" className="hidden" onChange={(event) => void uploadJoinReference('final_join', event.target.files)} /><button onClick={() => baseReferenceInputRef.current?.click()} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl border border-teal-200 bg-white px-4 py-2.5 text-sm font-semibold text-teal-800 hover:bg-teal-50 disabled:opacity-50">{busy === 'reference-base_join' ? <Loader2 className="h-4 w-4 animate-spin" /> : baseReferenceCount ? <Check className="h-4 w-4" /> : <Upload className="h-4 w-4" />}Base Join modelos {baseReferenceCount ? `(${baseReferenceCount})` : ''}</button><button onClick={() => finalReferenceInputRef.current?.click()} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl border border-teal-200 bg-white px-4 py-2.5 text-sm font-semibold text-teal-800 hover:bg-teal-50 disabled:opacity-50">{busy === 'reference-final_join' ? <Loader2 className="h-4 w-4 animate-spin" /> : finalReferenceCount ? <Check className="h-4 w-4" /> : <Upload className="h-4 w-4" />}Final Join modelos {finalReferenceCount ? `(${finalReferenceCount})` : ''}</button></div></div>
                <div className="w-full rounded-xl border border-slate-200 bg-white p-5 xl:w-[420px]"><div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">2</span><p className="text-xs font-bold uppercase tracking-widest text-slate-600">Selecionar a pasta 0</p></div><p className="mt-3 text-sm leading-6 text-slate-600">{referenceGuideReady ? 'Os modelos estão prontos. Selecione 0. A Classificar; os ficheiros serão verificados um de cada vez.' : 'Pode continuar sem modelos, mas a primeira classificação exigirá mais orientação humana.'}</p><input ref={folderInputRef} type="file" multiple accept="application/pdf,image/jpeg,image/png" className="hidden" {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} onChange={(event) => void classifySelectedFiles(event.target.files, 'folder')} /><input ref={uploadInputRef} type="file" multiple accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={(event) => void classifySelectedFiles(event.target.files, 'files')} /><div className="mt-4 grid gap-2"><button onClick={() => folderInputRef.current?.click()} disabled={Boolean(busy)} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#176b61] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#12584f] disabled:opacity-50">{busy === 'classify-folder' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderInput className="h-4 w-4" />}{folderProgress ? `${folderProgress.current}/${folderProgress.total} · ${folderProgress.filename}` : 'Selecionar pasta 0. A Classificar'}</button><div className="flex gap-2"><button onClick={() => uploadInputRef.current?.click()} disabled={Boolean(busy)} className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold hover:bg-slate-50">Escolher ficheiros manualmente</button><button onClick={() => void runAction('process-demo')} disabled={Boolean(busy)} aria-label="Executar demonstração" className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold hover:bg-slate-50"><Sparkles className="h-4 w-4 text-teal-700" /></button></div></div></div>
              </div>
            </section>

            <section className="mb-6 rounded-2xl border border-teal-100 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-800">Treino estrutural dos exemplos</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Pode selecionar vários PDFs Base/Final na mesma janela com Ctrl/Shift. Depois clique aqui para criar o fingerprint/regras da empresa antes de classificar a pasta 0.
                  </p>
                  <p className="mt-2 text-xs font-semibold text-teal-700">Carregados: {baseReferenceCount} Base Join · {finalReferenceCount} Final Join · regras v{workspace.company.rulesVersion}</p>
                </div>
                <button
                  onClick={() => void runAction('train-examples')}
                  disabled={baseReferenceCount + finalReferenceCount === 0 || Boolean(busy)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500"
                >
                  {busy === 'train-examples' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Treinar regras dos exemplos
                </button>
              </div>
            </section>

            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard icon={FolderInput} label="00_IN por classificar" value={workspace.intakeCount} detail="Ficheiros em cache aguardam processamento" tone="bg-blue-50 text-blue-700" />
              <MetricCard icon={CircleHelp} label="Revisão necessária" value={pendingReviews} detail="Decisões humanas antes da Base Join" tone="bg-amber-50 text-amber-700" />
              <MetricCard icon={FileStack} label="Evidência mensal" value={`${approvedFolders}/13`} detail="Pastas aprovadas ou passadas" tone="bg-violet-50 text-violet-700" />
              <MetricCard icon={FileCheck2} label="Comprovantes atuais" value={`${currentFinals}/${workspace.employees.length}`} detail="Entregáveis prontos para download" tone="bg-emerald-50 text-emerald-700" />
            </section>

            <section className="mt-6 grid gap-6 xl:grid-cols-[1.45fr_.8fr]">
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
                  <div><h2 className="font-bold">Evidência de Recursos Humanos</h2><p className="mt-1 text-sm text-slate-500">Pastas canónicas 1–13 · nomes físicos compactos para SharePoint</p></div>
                  <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-500">Passo 2 · resultados</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {workspace.folders.map((folder) => (
                    <div key={folder.number} className="grid grid-cols-[52px_1fr_88px_92px] items-center gap-3 px-6 py-3.5 hover:bg-slate-50/70">
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 font-mono text-xs font-bold text-slate-600">{String(folder.number).padStart(2, '0')}</span>
                      <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-800">{folder.label}</p><p className="mt-0.5 font-mono text-xs text-slate-400">{String(folder.number).padStart(2, '0')}_{folder.code}</p></div>
                      <span className="text-center text-sm font-semibold text-slate-600">{folder.documentCount} doc.</span>
                      <div className="text-right"><StatusPill status={folder.status} /></div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-6">
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-widest text-slate-400">14_BJ</p><h2 className="mt-1 text-lg font-bold">Base Join mensal</h2></div><StatusPill status={workspace.baseJoin.status} /></div>
                  <div className="mt-5 rounded-xl bg-slate-50 p-4"><p className="font-mono text-sm font-semibold">{workspace.baseJoin.filename}</p><p className="mt-1 text-xs text-slate-500">Pastas 2–13 · {workspace.baseJoin.pageCount ? `${workspace.baseJoin.pageCount} páginas` : 'aguarda reconciliação'}</p></div>
                  <button onClick={() => void runAction('generate-base')} disabled={!['ready', 'needs_confirmation'].includes(workspace.baseJoin.status) || Boolean(busy)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#176b61] px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">{busy === 'generate-base' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileStack className="h-4 w-4" />}{workspace.baseJoin.status === 'needs_confirmation' ? 'Gerar com faltas confirmadas' : 'Gerar Base Join'}</button>
                  {workspace.baseJoin.status === 'current' ? <a href="/api/smartcomprovante/download?type=base" className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold hover:bg-slate-50"><Download className="h-4 w-4" />Descarregar protótipo</a> : null}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h2 className="font-bold">Atividade recente</h2>
                  <div className="mt-4 space-y-4">{workspace.activity.slice(0, 5).map((item) => <div key={item.id} className="flex gap-3"><div className={`mt-1 h-2 w-2 shrink-0 rounded-full ${item.tone === 'success' ? 'bg-emerald-500' : item.tone === 'warning' ? 'bg-amber-500' : 'bg-blue-500'}`} /><div><p className="text-sm leading-5 text-slate-700">{item.text}</p><p className="mt-1 text-xs text-slate-400">{new Date(item.at).toLocaleString('pt-PT')}</p></div></div>)}</div>
                </div>
              </div>
            </section>

            <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5"><div><p className="text-xs font-bold uppercase tracking-widest text-slate-400">15_CF</p><h2 className="mt-1 font-bold">Comprovantes Finais por colaborador</h2></div><button onClick={() => void runAction('generate-finals')} disabled={workspace.baseJoin.status !== 'current' || !workspace.employees.some((employee) => employee.finalStatus === 'ready' || employee.finalStatus === 'ready_with_warnings') || Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500"><Users className="h-4 w-4" />Gerar todos os prontos</button></div>
              <div className="divide-y divide-slate-100">{workspace.employees.map((employee) => <div key={employee.id} className="grid grid-cols-[1fr_140px_140px_190px_54px] items-center gap-4 px-6 py-4"><div><p className="text-sm font-semibold">{employee.employeeName}</p><p className="mt-1 font-mono text-xs text-slate-400">{employee.filename}</p></div><StatusPill status={employee.payslipStatus} /><span className="text-sm text-slate-500">Base: {statusLabel[workspace.baseJoin.status]}</span><StatusPill status={employee.finalStatus} />{employee.finalStatus === 'current' ? <a aria-label={`Descarregar ${employee.employeeName}`} href={`/api/smartcomprovante/download?type=final&employee=${employee.employeeCode}`} className="rounded-lg p-2 text-teal-700 hover:bg-teal-50"><Download className="h-5 w-5" /></a> : <span />}</div>)}</div>
            </section>
          </> : null}

          {view === 'review' ? <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-6 py-5"><h2 className="text-lg font-bold">Revisão humana</h2><p className="mt-1 text-sm text-slate-500">Valide o destino. A correção aprovada é adicionada às regras desta empresa.</p></div>
            <div className="divide-y divide-slate-100">
              {workspace.reviews.map((review) => <div key={review.id} className="grid grid-cols-[1fr_110px_250px_220px] items-center gap-5 px-6 py-5">
                <div><div className="flex items-center gap-2"><FileCheck2 className="h-4 w-4 text-slate-400" /><p className="font-semibold">{review.filename}</p></div><p className="mt-2 text-sm text-slate-500">{review.reason}</p><p className="mt-2 text-xs text-slate-400">{review.targetMonth && review.targetYear ? `Período detetado: ${String(review.targetMonth).padStart(2, '0')}/${review.targetYear}` : 'Período não confirmado'}{review.employeeName ? ` · ${review.employeeName}` : ''}</p>{review.sourceHash ? <button onClick={() => setPreviewReviewId((current) => current === review.id ? null : review.id)} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-50"><FileCheck2 className="h-3.5 w-3.5" />{previewReviewId === review.id ? 'Fechar pré-visualização' : 'Ver primeiras 3 páginas'}</button> : <p className="mt-3 text-xs text-slate-400">Pré-visualização disponível para ficheiros carregados.</p>}</div>
                <div><p className="text-xs text-slate-400">Confiança</p><p className="mt-1 font-bold text-amber-700">{Math.round(review.confidence * 100)}%</p></div>
                <div>{review.status === 'pending' ? <><label className="text-xs font-semibold text-slate-500">Pasta de destino</label><select value={reviewDestinations[review.id] ?? review.proposedCode} onChange={(event) => setReviewDestinations((current) => ({ ...current, [review.id]: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-teal-600"><option value="UNKNOWN" disabled>Escolher destino</option>{workspace.folders.map((folder) => <option key={folder.code} value={folder.code}>{String(folder.number).padStart(2, '0')}_{folder.code} · {folder.label}</option>)}</select></> : <div><StatusPill status={review.status} /><p className="mt-2 font-mono text-xs text-slate-400">{review.proposedCode} · regras v{workspace.company.rulesVersion}</p></div>}</div>
                <div className="flex justify-end gap-2">{review.status === 'pending' ? <><button onClick={() => void runAction('pass-review', review.id)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold hover:bg-slate-50">Passar</button><button onClick={() => void runAction('approve-review', review.id, reviewDestinations[review.id] ?? review.proposedCode)} disabled={(reviewDestinations[review.id] ?? review.proposedCode) === 'UNKNOWN'} className="inline-flex items-center gap-2 rounded-xl bg-[#176b61] px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500"><Check className="h-4 w-4" />Validar e aprender</button></> : <span className="text-sm text-slate-400">Decisão registada</span>}</div>
                {previewReviewId === review.id && review.sourceHash ? <div className="col-span-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-100"><div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2"><p className="text-xs font-semibold text-slate-600">Excerto protegido · máximo de 3 páginas · não é criado um download do original</p><button onClick={() => setPreviewReviewId(null)} className="rounded p-1 hover:bg-slate-100" aria-label="Fechar pré-visualização"><X className="h-4 w-4" /></button></div><iframe title={`Pré-visualização de ${review.filename}`} src={`/api/smartcomprovante/preview?hash=${encodeURIComponent(review.sourceHash)}`} className="h-[620px] w-full bg-slate-200" /></div> : null}
              </div>)}
              {pendingReviews === 0 ? <div className="p-12 text-center"><Check className="mx-auto h-8 w-8 text-emerald-600" /><p className="mt-3 font-semibold">Revisão concluída</p><button onClick={() => setView('workspace')} className="mt-4 text-sm font-semibold text-teal-700">Voltar ao workspace</button></div> : null}
            </div>
          </section> : null}

          {view === 'settings' ? <div className="grid gap-6 xl:grid-cols-2"><section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center gap-3"><div className="rounded-xl bg-violet-50 p-2.5 text-violet-700"><KeyRound className="h-5 w-5" /></div><div><h2 className="font-bold">Gemini para testes</h2><p className="text-sm text-slate-500">{provider?.model || 'gemini-2.5-flash'} · consentimento por lote</p></div></div><div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-center justify-between"><span className="text-sm font-semibold">Credencial</span><span className={`text-xs font-bold ${provider?.configured || credential?.configured ? 'text-emerald-700' : 'text-amber-700'}`}>{provider?.configured || credential?.configured ? 'Configurada' : 'Não configurada'}</span></div><p className="mt-2 text-xs leading-5 text-slate-500">A chave nunca é guardada no browser, regras JSON ou logs.</p></div>{hasElectronBridge ? <div className="mt-5"><label className="text-sm font-semibold">Nova chave Gemini</label><input value={keyValue} onChange={(event) => setKeyValue(event.target.value)} type="password" autoComplete="off" placeholder="Introduza para guardar encriptada" className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-teal-600" /><div className="mt-3 flex gap-2"><button onClick={() => void saveKey()} disabled={!keyValue || Boolean(busy)} className="rounded-xl bg-[#176b61] px-4 py-2.5 text-sm font-semibold text-white">Guardar encriptada</button><button onClick={() => void deleteKey()} disabled={!credential?.configured || Boolean(busy)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold">Eliminar</button></div>{credential && !credential.encryptionAvailable ? <p className="mt-3 text-sm text-rose-700">O armazenamento seguro do sistema operativo não está disponível. Gemini permanece desativado.</p> : null}</div> : <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800"><p className="font-semibold">Modo browser</p><p className="mt-1 leading-6">Configure <code>GEMINI_API_KEY</code> em <code>.env.local</code>. Na aplicação Electron, a chave é guardada através do cofre do sistema operativo.</p></div>}</section><section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center gap-3"><div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-700"><LockKeyhole className="h-5 w-5" /></div><div><h2 className="font-bold">SharePoint e retenção</h2><p className="text-sm text-slate-500">Perfil físico compacto</p></div></div><dl className="mt-6 space-y-4 text-sm"><div className="flex justify-between border-b border-slate-100 pb-3"><dt className="text-slate-500">Nome máximo</dt><dd className="font-semibold">80 caracteres</dd></div><div className="flex justify-between border-b border-slate-100 pb-3"><dt className="text-slate-500">Caminho local seguro</dt><dd className="font-semibold">240 caracteres</dd></div><div className="flex justify-between border-b border-slate-100 pb-3"><dt className="text-slate-500">Cache temporária</dt><dd className="font-semibold">Limpeza após entrega</dd></div><div className="flex justify-between"><dt className="text-slate-500">Regras da empresa</dt><dd className="font-semibold">v{workspace.company.rulesVersion} · válidas</dd></div></dl><div className="mt-6 flex flex-wrap gap-2"><button onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold"><RefreshCw className="h-4 w-4" />Atualizar estado</button><button onClick={() => void runAction('reset-demo')} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600"><Clock3 className="h-4 w-4" />Repor demonstração</button></div></section></div> : null}
        </div>
      </main>

      {showCompanyDialog ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"><div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-center justify-between"><div><h2 className="text-lg font-bold">Criar nova empresa</h2><p className="mt-1 text-sm text-slate-500">O JSON de regras v1 será criado automaticamente.</p></div><button onClick={() => setShowCompanyDialog(false)} className="rounded-lg p-2 hover:bg-slate-100"><X className="h-5 w-5" /></button></div><div className="mt-6 space-y-4"><label className="block text-sm font-semibold">Nome legal<input value={companyForm.legalName} onChange={(event) => setCompanyForm({ ...companyForm, legalName: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 font-normal outline-none focus:border-teal-600" placeholder="Ex.: Empresa, LDA" /></label><div className="grid grid-cols-2 gap-4"><label className="block text-sm font-semibold">NIF<input value={companyForm.nif} onChange={(event) => setCompanyForm({ ...companyForm, nif: event.target.value.replace(/\D/g, '').slice(0, 9) })} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 font-normal outline-none focus:border-teal-600" placeholder="9 dígitos" /></label><label className="block text-sm font-semibold">Código curto<input value={companyForm.code} onChange={(event) => setCompanyForm({ ...companyForm, code: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) })} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 font-normal outline-none focus:border-teal-600" placeholder="EMPRESA" /></label></div></div><div className="mt-6 flex justify-end gap-2"><button onClick={() => setShowCompanyDialog(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold">Cancelar</button><button onClick={() => void createCompany()} disabled={!companyForm.legalName || companyForm.nif.length !== 9 || !companyForm.code || Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl bg-[#176b61] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy === 'create-company' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Criar empresa</button></div></div></div> : null}
    </div>
  )
}
