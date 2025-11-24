'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Upload, Download, FileText, RotateCw } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

export default function RotateTool() {
  const [file, setFile] = useState<{ name: string; data: string; pageCount: number } | null>(null)
  const [pages, setPages] = useState('')
  const [rotation, setRotation] = useState('90')
  const [applyToAll, setApplyToAll] = useState(true)
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

  const handleRotate = async () => {
    if (!file || (!applyToAll && !pages)) {
      toast({
        title: 'Erro',
        description: 'Carregue um PDF e defina as páginas a rodar.',
        variant: 'destructive',
      })
      return
    }

    setIsProcessing(true)

    try {
      const response = await fetch('/api/pdf/rotate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file: { name: file.name, data: file.data },
          pages: applyToAll ? 'all' : pages,
          rotation: parseInt(rotation),
        }),
      })

      if (!response.ok) throw new Error('Erro ao rodar páginas')

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `rotated_${Date.now()}.pdf`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast({
        title: 'Sucesso!',
        description: 'Páginas rodadas com sucesso.',
      })
    } catch (error) {
      console.error('Error rotating pages:', error)
      toast({
        title: 'Erro',
        description: 'Ocorreu um erro ao rodar as páginas.',
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
          <CardTitle>Rotate Pages</CardTitle>
          <CardDescription>Roda páginas do PDF por 90°, 180° ou 270°</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rotate-upload">Selecionar PDF</Label>
            <Input
              id="rotate-upload"
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
            <Label>Ângulo de rotação</Label>
            <RadioGroup value={rotation} onValueChange={setRotation}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="90" id="90" />
                <Label htmlFor="90" className="cursor-pointer">
                  90° (sentido horário)
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="180" id="180" />
                <Label htmlFor="180" className="cursor-pointer">
                  180° (inverter)
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="270" id="270" />
                <Label htmlFor="270" className="cursor-pointer">
                  270° (sentido anti-horário)
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-3 pt-4 border-t">
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="apply-all"
                checked={applyToAll}
                onChange={(e) => setApplyToAll(e.target.checked)}
                className="rounded"
              />
              <Label htmlFor="apply-all" className="cursor-pointer">
                Aplicar a todas as páginas
              </Label>
            </div>

            {!applyToAll && (
              <div className="space-y-2">
                <Label htmlFor="rotate-pages">Páginas específicas</Label>
                <Input
                  id="rotate-pages"
                  value={pages}
                  onChange={(e) => setPages(e.target.value)}
                  placeholder="ex: 1,3,5 ou 2-5"
                />
              </div>
            )}
          </div>

          <Button onClick={handleRotate} disabled={!file || isProcessing} className="w-full">
            <RotateCw className="mr-2 h-4 w-4" />
            {isProcessing ? 'Processando...' : 'Rotate Pages'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Como usar</CardTitle>
          <CardDescription>Instruções para rotação de páginas</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-slate-600 dark:text-slate-400">
          <div>
            <p className="font-semibold mb-2">Opções de rotação:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>90°:</strong> roda no sentido horário
              </li>
              <li>
                <strong>180°:</strong> inverte a página completamente
              </li>
              <li>
                <strong>270°:</strong> roda no sentido anti-horário (equivalente a -90°)
              </li>
            </ul>
          </div>
          <div>
            <p className="font-semibold mb-2">Aplicação:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>Todas as páginas:</strong> marca a checkbox
              </li>
              <li>
                <strong>Páginas específicas:</strong> desmarca e define as páginas (ex: 1,3,5 ou 2-5)
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
