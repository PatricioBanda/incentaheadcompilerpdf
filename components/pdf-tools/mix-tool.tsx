'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Upload, Download, FileText, Shuffle } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

export default function MixTool() {
  const [file1, setFile1] = useState<{ name: string; data: string; pageCount: number } | null>(null)
  const [file2, setFile2] = useState<{ name: string; data: string; pageCount: number } | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const { toast } = useToast()

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, fileNumber: 1 | 2) => {
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

      const fileData = {
        name: uploadedFile.name,
        data: base64,
        pageCount: result.pageCount,
      }

      if (fileNumber === 1) {
        setFile1(fileData)
      } else {
        setFile2(fileData)
      }

      toast({
        title: 'Sucesso!',
        description: `PDF ${fileNumber} carregado: ${result.pageCount} páginas.`,
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

  const handleMix = async () => {
    if (!file1 || !file2) {
      toast({
        title: 'Erro',
        description: 'Carregue 2 PDFs para fazer mix.',
        variant: 'destructive',
      })
      return
    }

    setIsProcessing(true)

    try {
      const response = await fetch('/api/pdf/mix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file1: { name: file1.name, data: file1.data },
          file2: { name: file2.name, data: file2.data },
        }),
      })

      if (!response.ok) throw new Error('Erro ao fazer mix')

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `mixed_${Date.now()}.pdf`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast({
        title: 'Sucesso!',
        description: 'PDFs misturados com sucesso.',
      })
    } catch (error) {
      console.error('Error mixing PDFs:', error)
      toast({
        title: 'Erro',
        description: 'Ocorreu um erro ao misturar os PDFs.',
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
          <CardTitle>Mix PDFs</CardTitle>
          <CardDescription>Mistura 2 PDFs alternando as páginas</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mix-upload-1">PDF 1 (páginas ímpares)</Label>
            <Input
              id="mix-upload-1"
              type="file"
              accept="application/pdf"
              onChange={(e) => handleFileUpload(e, 1)}
              disabled={isProcessing}
            />
            {file1 && (
              <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center gap-3">
                <FileText className="h-6 w-6 text-red-500" />
                <div>
                  <p className="text-sm font-medium truncate">{file1.name}</p>
                  <p className="text-xs text-slate-500">{file1.pageCount} páginas</p>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="mix-upload-2">PDF 2 (páginas pares)</Label>
            <Input
              id="mix-upload-2"
              type="file"
              accept="application/pdf"
              onChange={(e) => handleFileUpload(e, 2)}
              disabled={isProcessing}
            />
            {file2 && (
              <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center gap-3">
                <FileText className="h-6 w-6 text-blue-500" />
                <div>
                  <p className="text-sm font-medium truncate">{file2.name}</p>
                  <p className="text-xs text-slate-500">{file2.pageCount} páginas</p>
                </div>
              </div>
            )}
          </div>

          <Button onClick={handleMix} disabled={!file1 || !file2 || isProcessing} className="w-full mt-4">
            <Shuffle className="mr-2 h-4 w-4" />
            {isProcessing ? 'Processando...' : 'Mix PDFs'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Como usar</CardTitle>
          <CardDescription>Instruções para mix de PDFs</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-slate-600 dark:text-slate-400">
          <div>
            <p className="font-semibold mb-2">O que faz o Mix:</p>
            <p className="mb-2">
              Combina 2 PDFs alternando as páginas entre eles. Ideal para quando você tem documentos frente e verso
              scaneados separadamente.
            </p>
          </div>
          <div>
            <p className="font-semibold mb-2">Resultado:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Página 1: vem do PDF 1</li>
              <li>Página 2: vem do PDF 2</li>
              <li>Página 3: vem do PDF 1</li>
              <li>Página 4: vem do PDF 2</li>
              <li>E assim sucessivamente...</li>
            </ul>
          </div>
          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <p className="text-xs font-semibold text-blue-800 dark:text-blue-300 mb-1">Dica:</p>
            <p className="text-xs text-blue-700 dark:text-blue-400">
              Perfeito para scanners sem alimentador duplex. Scaneie todas as frentes, depois todos os versos, e use
              Mix para criar o documento completo.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
