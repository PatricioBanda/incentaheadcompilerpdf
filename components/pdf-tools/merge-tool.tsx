'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Upload, Download, Trash2, GripVertical, FileText } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface PDFFile {
  id: string
  name: string
  data: string
  pageCount: number
}

function SortableFileItem({ file, onDelete }: { file: PDFFile; onDelete: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: file.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 p-3 bg-white dark:bg-slate-800 border rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
    >
      <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing">
        <GripVertical className="h-5 w-5 text-slate-400" />
      </div>
      <FileText className="h-5 w-5 text-red-500 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{file.name}</p>
        <p className="text-xs text-slate-500">{file.pageCount} páginas</p>
      </div>
      <Button size="icon" variant="ghost" onClick={() => onDelete(file.id)}>
        <Trash2 className="h-4 w-4 text-red-500" />
      </Button>
    </div>
  )
}

export default function MergeTool() {
  const [files, setFiles] = useState<PDFFile[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const { toast } = useToast()

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = e.target.files
    if (!uploadedFiles || uploadedFiles.length === 0) return

    setIsProcessing(true)

    try {
      const newFiles: PDFFile[] = []

      for (const file of Array.from(uploadedFiles)) {
        if (file.type !== 'application/pdf') {
          toast({
            title: 'Erro',
            description: `${file.name} não é um PDF válido.`,
            variant: 'destructive',
          })
          continue
        }

        const arrayBuffer = await file.arrayBuffer()
        const base64 = btoa(
          new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        )

        const formData = new FormData()
        formData.append('file', file)

        const response = await fetch('/api/pdf/extract-pages', {
          method: 'POST',
          body: formData,
        })

        if (!response.ok) throw new Error('Erro ao processar PDF')

        const result = await response.json()

        newFiles.push({
          id: `${file.name}-${Date.now()}-${Math.random()}`,
          name: file.name,
          data: base64,
          pageCount: result.pageCount,
        })
      }

      setFiles((prev) => [...prev, ...newFiles])

      toast({
        title: 'Sucesso!',
        description: `${newFiles.length} PDF(s) adicionado(s).`,
      })
    } catch (error) {
      console.error('Error processing PDFs:', error)
      toast({
        title: 'Erro',
        description: 'Ocorreu um erro ao processar os PDFs.',
        variant: 'destructive',
      })
    } finally {
      setIsProcessing(false)
      e.target.value = ''
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      setFiles((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id)
        const newIndex = items.findIndex((item) => item.id === over.id)
        return arrayMove(items, oldIndex, newIndex)
      })
    }
  }

  const deleteFile = (id: string) => {
    setFiles((prev) => prev.filter((file) => file.id !== id))
  }

  const handleMerge = async () => {
    if (files.length < 2) {
      toast({
        title: 'Erro',
        description: 'Adicione pelo menos 2 PDFs para fazer merge.',
        variant: 'destructive',
      })
      return
    }

    setIsProcessing(true)

    try {
      const response = await fetch('/api/pdf/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: files.map((f) => ({ name: f.name, data: f.data })) }),
      })

      if (!response.ok) throw new Error('Erro ao fazer merge')

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `merged_${Date.now()}.pdf`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast({
        title: 'Sucesso!',
        description: 'PDFs unidos com sucesso.',
      })
    } catch (error) {
      console.error('Error merging PDFs:', error)
      toast({
        title: 'Erro',
        description: 'Ocorreu um erro ao unir os PDFs.',
        variant: 'destructive',
      })
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle>Merge PDFs</CardTitle>
          <CardDescription>Une múltiplos PDFs num único documento</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="merge-upload">Adicionar PDFs</Label>
            <Input
              id="merge-upload"
              type="file"
              accept="application/pdf"
              multiple
              onChange={handleFileUpload}
              disabled={isProcessing}
            />
          </div>

          <div className="space-y-2 pt-4 border-t">
            <Button onClick={handleMerge} disabled={files.length < 2 || isProcessing} className="w-full">
              <Download className="mr-2 h-4 w-4" />
              {isProcessing ? 'Processando...' : 'Merge PDFs'}
            </Button>

            <Button
              onClick={() => setFiles([])}
              disabled={files.length === 0}
              variant="outline"
              className="w-full"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Limpar Tudo
            </Button>
          </div>

          {files.length > 0 && (
            <div className="mt-4 p-3 bg-slate-100 dark:bg-slate-800 rounded-lg">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Total: {files.length} PDF(s) • {files.reduce((sum, f) => sum + f.pageCount, 0)} páginas
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>PDFs para Merge ({files.length})</CardTitle>
          <CardDescription>Arraste para reordenar os PDFs antes de fazer merge</CardDescription>
        </CardHeader>
        <CardContent>
          {files.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Upload className="h-16 w-16 text-slate-400 mb-4" />
              <p className="text-slate-500 dark:text-slate-400">Nenhum PDF adicionado</p>
              <p className="text-sm text-slate-400 dark:text-slate-500 mt-2">
                Adicione 2 ou mais PDFs para começar
              </p>
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={files.map((f) => f.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2 max-h-[600px] overflow-y-auto">
                  {files.map((file) => (
                    <SortableFileItem key={file.id} file={file} onDelete={deleteFile} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
