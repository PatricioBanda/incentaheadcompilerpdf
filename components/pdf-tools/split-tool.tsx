'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Upload, Download, FileText } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

export default function SplitTool() {
  const [file, setFile] = useState<{ name: string; data: string; pageCount: number } | null>(null)
  const [splitMode, setSplitMode] = useState<'pages' | 'size'>('pages')
  const [splitValue, setSplitValue] = useState('')
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

  const handleSplit = async () => {
    if (!file || !splitValue) {
      toast({
        title: 'Erro',
        description: 'Carregue um PDF e defina o critério de split.',
        variant: 'destructive',
      })
      return
    }

    setIsProcessing(true)

    try {
      const response = await fetch('/api/pdf/split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file: { name: file.name, data: file.data },
          mode: splitMode,
          value: splitValue,
        }),
      })

      if (!response.ok) throw new Error('Erro ao fazer split')

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `split_${Date.now()}.zip`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast({
        title: 'Sucesso!',
        description: 'PDF dividido com sucesso. Download do ZIP iniciado.',
      })
    } catch (error) {
      console.error('Error splitting PDF:', error)
      toast({
        title: 'Erro',
        description: 'Ocorreu um erro ao dividir o PDF.',
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
          <CardTitle>Split PDF</CardTitle>
          <CardDescription>Divide um PDF em múltiplos documentos</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="split-upload">Selecionar PDF</Label>
            <Input
              id="split-upload"
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

          <div className="space-y-3 pt-4 border-t">
            <Label>Modo de Split</Label>
            <RadioGroup value={splitMode} onValueChange={(v) => setSplitMode(v as 'pages' | 'size')}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="pages" id="pages" />
                <Label htmlFor="pages" className="cursor-pointer">
                  Por páginas (ex: 1,3,5 ou 2-5)
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="size" id="size" />
                <Label htmlFor="size" className="cursor-pointer">
                  Por tamanho (ex: 10 páginas por ficheiro)
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="split-value">
              {splitMode === 'pages' ? 'Páginas de split' : 'Páginas por ficheiro'}
            </Label>
            <Input
              id="split-value"
              value={splitValue}
              onChange={(e) => setSplitValue(e.target.value)}
              placeholder={splitMode === 'pages' ? 'ex: 1,3,5 ou 2-5' : 'ex: 10'}
            />
          </div>

          <Button onClick={handleSplit} disabled={!file || !splitValue || isProcessing} className="w-full">
            <Download className="mr-2 h-4 w-4" />
            {isProcessing ? 'Processando...' : 'Split PDF'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Como usar</CardTitle>
          <CardDescription>Instruções para split de PDFs</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-slate-600 dark:text-slate-400">
          <div>
            <p className="font-semibold mb-2">Split por páginas:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>Lista:</strong> 1,3,5 - divide nas páginas 1, 3 e 5
              </li>
              <li>
                <strong>Intervalo:</strong> 2-5 - divide da página 2 até 5
              </li>
            </ul>
          </div>
          <div>
            <p className="font-semibold mb-2">Split por tamanho:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>10:</strong> cria ficheiros com 10 páginas cada
              </li>
              <li>Ideal para dividir PDFs grandes em partes iguais</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
