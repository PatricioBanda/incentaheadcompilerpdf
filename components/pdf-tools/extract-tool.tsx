'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Upload, Download, FileText } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

export default function ExtractTool() {
  const [file, setFile] = useState<{ name: string; data: string; pageCount: number } | null>(null)
  const [pages, setPages] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const { toast } = useToast()

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0]
    if (!uploadedFile) return

    if (uploadedFile.type !== 'application/pdf') {
      toast({
        title: 'Erro',
        description: 'Selecione um PDF válido.',
        variant: 'destructive',
      })
      return
    }

    setIsProcessing(true)

    try {
      const arrayBuffer = await uploadedFile.arrayBuffer()
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
      )

      const formData = new FormData()
      formData.append('file', uploadedFile)

      const response = await fetch('/api/pdf/extract-pages', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) throw new Error('Erro ao processar PDF')

      const result = await response.json()

      setFile({
        name: uploadedFile.name,
        data: base64,
        pageCount: result.pageCount,
      })

      toast({
        title: 'Sucesso!',
        description: `PDF carregado: ${result.pageCount} páginas.`,
      })
    } catch (error) {
      console.error('Error processing PDF:', error)
      toast({
        title: 'Erro',
        description: 'Ocorreu um erro ao processar o PDF.',
        variant: 'destructive',
      })
    } finally {
      setIsProcessing(false)
      e.target.value = ''
    }
  }

  const handleExtract = async () => {
    if (!file || !pages) {
      toast({
        title: 'Erro',
        description: 'Carregue um PDF e defina as páginas a extrair.',
        variant: 'destructive',
      })
      return
    }

    setIsProcessing(true)

    try {
      const response = await fetch('/api/pdf/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file: { name: file.name, data: file.data },
          pages,
        }),
      })

      if (!response.ok) throw new Error('Erro ao extrair páginas')

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `extracted_${Date.now()}.pdf`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast({
        title: 'Sucesso!',
        description: 'Páginas extraídas com sucesso.',
      })
    } catch (error) {
      console.error('Error extracting pages:', error)
      toast({
        title: 'Erro',
        description: 'Ocorreu um erro ao extrair as páginas.',
        variant: 'destructive',
      })
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Extract Pages</CardTitle>
          <CardDescription>Extrai páginas específicas de um PDF</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="extract-upload">Selecionar PDF</Label>
            <Input
              id="extract-upload"
              type="file"
              accept="application/pdf"
              onChange={handleFileUpload}
              disabled={isProcessing}
            />
          </div>

          {file && (
            <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center gap-3">
              <FileText className="h-8 w-8 text-red-500" />
              <div>
                <p className="text-sm font-medium truncate">{file.name}</p>
                <p className="text-xs text-slate-500">{file.pageCount} páginas</p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="extract-pages">Páginas a extrair</Label>
            <Input
              id="extract-pages"
              value={pages}
              onChange={(e) => setPages(e.target.value)}
              placeholder="ex: 1,3,5 ou 2-5"
            />
            <p className="text-xs text-slate-500">Use vírgulas para páginas individuais ou hífen para intervalos</p>
          </div>

          <Button onClick={handleExtract} disabled={!file || !pages || isProcessing} className="w-full">
            <Download className="mr-2 h-4 w-4" />
            {isProcessing ? 'Processando...' : 'Extract Pages'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Como usar</CardTitle>
          <CardDescription>Instruções para extração de páginas</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-slate-600 dark:text-slate-400">
          <div>
            <p className="font-semibold mb-2">Formatos aceites:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>Páginas individuais:</strong> 1,3,5
              </li>
              <li>
                <strong>Intervalos:</strong> 2-5 (páginas 2, 3, 4, 5)
              </li>
              <li>
                <strong>Combinação:</strong> 1,3-5,7 (páginas 1, 3, 4, 5, 7)
              </li>
            </ul>
          </div>
          <div>
            <p className="font-semibold mb-2">Exemplos:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>1-10: extrai as primeiras 10 páginas</li>
              <li>2,4,6: extrai as páginas pares</li>
              <li>1,5-8,12: extrai páginas 1, 5, 6, 7, 8 e 12</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
