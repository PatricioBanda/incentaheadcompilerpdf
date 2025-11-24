'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FolderOpen, FileText, Download, AlertCircle, CheckCircle2, Scan, Image, AlertTriangle, HardDrive, Users } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

interface MonthReport {
  month: string
  groups: {
    [key: string]: {
      path: string
      files: Array<{ name: string; type: 'pdf' | 'image'; file: File }>
    }
  }
  errors: string[]
  totalFiles: number
  hasChanges?: boolean
  previousScanDate?: string
}

interface ScanResult {
  year: string
  monthReports: MonthReport[]
  totalFiles: number
  scanTimestamp: string
}

interface PersonData {
  name: string
  months: string[]
}

interface PersonFileData {
  name: string
  months: string[]
  isSimple: boolean // true if just "MM_YYYY NAME.pdf", false if has extra text
  fullFilenames: string[] // Track all filenames for this person
  filesByMonth: Record<string, string>
}


export default function PDFCompilerPage() {
  const [year, setYear] = useState('2025')
  const [selectedMonths, setSelectedMonths] = useState<string[]>([])
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [isScanning, setIsScanning] = useState(false)
  const [isJoining, setIsJoining] = useState(false)
  const [rhDirectoryHandle, setRhDirectoryHandle] = useState<any>(null)
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; month: string; groupCount: number } | null>(null)
  const { toast } = useToast()

  const [availableMonthsForFinal, setAvailableMonthsForFinal] = useState<string[]>([])
  const [selectedMonthsForFinal, setSelectedMonthsForFinal] = useState<string[]>([])
  const [personsData, setPersonsData] = useState<PersonFileData[]>([]) // Changed to PersonFileData
  const [selectedPersons, setSelectedPersons] = useState<string[]>([])
  const [isScanningPersons, setIsScanningPersons] = useState(false)
  const [isJoiningFinal, setIsJoiningFinal] = useState(false)
  const [hasAutoScanned, setHasAutoScanned] = useState(false)
  const [rhFolderLabel, setRhFolderLabel] = useState('')
  const [rhRootName, setRhRootName] = useState('')
  const [finalScanStale, setFinalScanStale] = useState(true)
  const [activeFinalMonth, setActiveFinalMonth] = useState<string | null>(null)

  const getErrorMessage = (err: unknown, fallback: string) => {
    if (err instanceof Error && err.message?.trim()) return err.message
    if (typeof err === 'string' && err.trim()) return err
    try {
      const parsed = JSON.stringify(err)
      if (parsed && parsed !== '{}') return parsed
    } catch {}
    return fallback
  }

  useEffect(() => {
    // Load last label if available (best-effort)
    const savedLabel = localStorage.getItem('rh_folder_label')
    if (savedLabel) {
      setRhFolderLabel(savedLabel)
    }
    const savedRoot = localStorage.getItem('rh_root_name')
    if (savedRoot) {
      setRhRootName(savedRoot)
    }
  }, [])

  // Depth-limited search for a folder named "RH" that contains expected subfolders.
  const findRhFolder = async (
    dirHandle: any,
    segments: string[],
    depth = 0,
    maxDepth = 6
  ): Promise<{ handle: any; segments: string[] } | null> => {
    if (depth > maxDepth) return null

    const nameLower = (dirHandle?.name || '').toLowerCase()

    if (nameLower === 'rh') {
      let hasGroup = false
      try {
        await dirHandle.getDirectoryHandle('1')
        hasGroup = true
      } catch {}
      if (!hasGroup) {
        try {
          await dirHandle.getDirectoryHandle('2')
          hasGroup = true
        } catch {}
      }
      if (hasGroup) {
        return { handle: dirHandle, segments }
      }
    }

    try {
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'directory') {
          const childHandle = await dirHandle.getDirectoryHandle(entry.name)
          const found = await findRhFolder(childHandle, [...segments, entry.name], depth + 1, maxDepth)
          if (found) return found
        }
      }
    } catch (err) {
      console.warn('[v0] Error reading directory during RH search:', err)
    }

    return null
  }


  const months = Array.from({ length: 12 }, (_, i) => {
    const monthNum = String(i + 1).padStart(2, '0')
    return `${monthNum}_${year}`
  })

  const toggleMonth = (month: string) => {
    setSelectedMonths(prev =>
      prev.includes(month)
        ? prev.filter(m => m !== month)
        : [...prev, month]
    )
  }

  const handleSelectRHFolder = async () => {
    try {
      const selectedRoot = await window.showDirectoryPicker({
        mode: 'readwrite'
      })

      const searchResult = await findRhFolder(selectedRoot, [selectedRoot.name])
      if (!searchResult) {
        toast({
          title: 'Pasta RH não encontrada',
          description: 'Selecione a pasta raiz do projeto (acima de RH) ou a própria pasta RH.',
          variant: 'destructive'
        })
        return
      }

      const { handle: rhHandle, segments } = searchResult
      const isNewFolder =
        !rhDirectoryHandle ||
        rhDirectoryHandle.name !== rhHandle.name ||
        rhRootName !== selectedRoot.name

      setRhDirectoryHandle(rhHandle)
      setRhRootName(selectedRoot.name)

      if (isNewFolder) {
        // Reset state when changing the root folder to avoid mixing data
        setScanResult(null)
        setSelectedMonths([])
        setAvailableMonthsForFinal([])
        setSelectedMonthsForFinal([])
        setPersonsData([])
        setSelectedPersons([])
        setHasAutoScanned(false)
        setFinalScanStale(true)
        setActiveFinalMonth(null)
      }

      const label = segments.slice(-4).join(' / ')
      setRhFolderLabel(label)
      localStorage.setItem('rh_folder_label', label)
      localStorage.setItem('rh_root_name', selectedRoot.name)

      toast({
        title: 'Pasta Selecionada',
        description: isNewFolder
          ? `Pasta RH: ${label || rhHandle.name} (estado reiniciado)`
          : `Pasta RH: ${label || rhHandle.name}`,
      })

      if (isNewFolder) {
        toast({
          title: 'Nova pasta detectada',
          description: 'Faça novamente o scan dos meses/base e das pessoas.',
          variant: 'destructive'
        })
      }
      
      console.log('[v0] Selected RH folder:', rhHandle.name, 'label:', label, isNewFolder ? '(reset state)' : '')
    } catch (error) {
      console.error('[v0] Error selecting folder:', error)
      toast({
        title: 'Erro',
        description: getErrorMessage(error, 'Erro ao selecionar pasta. Use Chrome ou Edge.'),
        variant: 'destructive'
      })
    }
  }

  const handleScan = async () => {
    if (!rhDirectoryHandle) {
      toast({
        title: 'Erro',
        description: 'Por favor, selecione a pasta RH primeiro.',
        variant: 'destructive'
      })
      return
    }

    if (selectedMonths.length === 0) {
      toast({
        title: 'Erro',
        description: 'Por favor, selecione pelo menos um mês.',
        variant: 'destructive'
      })
      return
    }

    setIsScanning(true)

    try {
      const scanTimestamp = new Date().toISOString()
      const monthReports: MonthReport[] = []
      let totalFiles = 0

      for (const month of selectedMonths) {
        const groups: { [key: string]: { path: string; files: Array<{ name: string; type: 'pdf' | 'image'; file: File }> } } = {}
        const errors: string[] = []
        let monthTotalFiles = 0

        for (let i = 2; i <= 13; i++) {
          const groupKey = i.toString()
          
          try {
            const groupDirHandle = await rhDirectoryHandle.getDirectoryHandle(groupKey)
            const monthDirHandle = await groupDirHandle.getDirectoryHandle(month)
            
            const files: Array<{ name: string; type: 'pdf' | 'image'; file: File }> = []
            
            for await (const entry of monthDirHandle.values()) {
              if (entry.kind === 'file') {
                const file = await entry.getFile()
                const ext = file.name.split('.').pop()?.toLowerCase()
                if (ext === 'pdf' || ext === 'jpg' || ext === 'jpeg' || ext === 'png') {
                  files.push({
                    name: file.name,
                    type: ext === 'pdf' ? 'pdf' : 'image',
                    file: file
                  })
                }
              }
            }
            
            if (files.length > 0) {
              groups[groupKey] = {
                path: `RH/${groupKey}/${month}`,
                files
              }
              monthTotalFiles += files.length
            } else {
              errors.push(`Grupo ${i} sem ficheiros PDF/imagens válidos: RH/${i}/${month}`)
            }
          } catch (error) {
            errors.push(`Grupo ${i} não encontrado ou vazio: RH/${i}/${month}`)
          }
        }

        const previousScan = loadPreviousScanFromStorage(year, month)
        let hasChanges = false
        let previousScanDate: string | undefined

        if (previousScan) {
          previousScanDate = previousScan.scanDate
          hasChanges = detectChanges(previousScan.groups, groups)
        } else {
          hasChanges = true
        }

        saveScanStateToStorage(year, month, {
          scanDate: scanTimestamp,
          groups: Object.keys(groups).reduce((acc, key) => {
            acc[key] = {
              path: groups[key].path,
              files: groups[key].files.map(f => ({ name: f.name, type: f.type }))
            }
            return acc
          }, {} as any),
          totalFiles: monthTotalFiles
        })

        monthReports.push({
          month,
          groups,
          errors,
          totalFiles: monthTotalFiles,
          hasChanges,
          previousScanDate
        })

        totalFiles += monthTotalFiles
      }

      setScanResult({
        year,
        monthReports,
        totalFiles,
        scanTimestamp
      })

      const changedMonths = monthReports.filter(m => m.hasChanges).length
      if (changedMonths > 0) {
        toast({
          title: 'Scan Completo - Alterações Detectadas!',
          description: `${changedMonths} mês(es) com alterações. Total: ${totalFiles} ficheiros.`,
          variant: 'default'
        })
      } else {
        toast({
          title: 'Scan Completo',
          description: `${totalFiles} ficheiros encontrados. Nenhuma alteração detectada.`
        })
      }
    } catch (error) {
      console.error('[v0] Error scanning:', error)
      toast({
        title: 'Erro',
        description: `Erro ao fazer scan: ${getErrorMessage(error, 'Falha desconhecida')}`,
        variant: 'destructive'
      })
    } finally {
      setIsScanning(false)
    }
  }

  const handleJoinMonth = async (month: string, skipValidation = false) => {
    console.log('[v0] handleJoinMonth called for month:', month)
    
    if (!scanResult) {
      console.log('[v0] No scan result available')
      return
    }

    const monthReport = scanResult.monthReports.find(m => m.month === month)
    if (!monthReport) {
      console.log('[v0] Month report not found for:', month)
      return
    }

    if (!skipValidation) {
      const validation = validateMonthData(monthReport)
      if (!validation.valid) {
        setConfirmDialog({
          open: true,
          month: month,
          groupCount: validation.groupCount
        })
        return
      }
    }

    setIsJoining(true)

    try {
      const allFiles: File[] = []
      const groupKeys = Object.keys(monthReport.groups).sort((a, b) => parseInt(a) - parseInt(b))
      
      console.log('[v0] Processing groups:', groupKeys)
      
      for (const groupKey of groupKeys) {
        for (const fileData of monthReport.groups[groupKey].files) {
          allFiles.push(fileData.file)
        }
      }

      console.log('[v0] Total files to process:', allFiles.length)

      console.log('[v0] All files ready, sending to API via FormData')

      const formData = new FormData()
      formData.append('year', year)
      formData.append('months', JSON.stringify([month]))
      allFiles.forEach(file => formData.append('files', file, file.name))

      const response = await fetch('/api/rh/join/base', {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[v0] API error:', errorText)
        throw new Error(`Erro ao fazer join: ${errorText}`)
      }

      console.log('[v0] API call successful, saving to folder 14')

      const blob = await response.blob()
      const filename = `base_${month}.pdf`

      try {
        const folder14Handle = await rhDirectoryHandle.getDirectoryHandle('14', { create: true })
        const fileHandle = await folder14Handle.getFileHandle(filename, { create: true })
        const writable = await fileHandle.createWritable()
        await writable.write(blob)
        await writable.close()
        
        console.log('[v0] PDF saved to folder 14:', filename)
        
        toast({
          title: 'Sucesso!',
          description: `PDF salvo em RH/14/${filename}`,
        })
      } catch (error) {
        console.error('[v0] Error saving to folder 14:', error)
        throw new Error(`Erro ao salvar em pasta 14: ${(error as Error).message}`)
      }

    } catch (error) {
      console.error('[v0] Error joining PDFs:', error)
      toast({
        title: 'Erro',
        description: `Erro ao compilar: ${getErrorMessage(error, 'Falha desconhecida')}`,
        variant: 'destructive'
      })
    } finally {
      console.log('[v0] handleJoinMonth finished')
      setIsJoining(false)
    }
  }

  const handleJoinAll = async () => {
    if (!scanResult) {
      toast({
        title: 'Erro',
        description: 'Faça primeiro um scan dos meses.',
        variant: 'destructive'
      })
      return
    }

    const invalidMonths: string[] = []
    for (const monthReport of scanResult.monthReports) {
      const validation = validateMonthData(monthReport)
      if (!validation.valid) {
        invalidMonths.push(`${monthReport.month} (${validation.groupCount}/12 grupos)`)
      }
    }

    if (invalidMonths.length > 0) {
      toast({
        title: 'Aviso - Dados Insuficientes',
        description: `Os seguintes meses não têm dados suficientes e serão omitidos: ${invalidMonths.join(', ')}`,
        variant: 'destructive'
      })
      
      const validMonths = scanResult.monthReports.filter(m => validateMonthData(m).valid)
      
      if (validMonths.length === 0) {
        toast({
          title: 'Erro',
          description: 'Nenhum mês tem dados suficientes para compilar.',
          variant: 'destructive'
        })
        return
      }
    }

    setIsJoining(true)

    try {
      let successCount = 0
      let failCount = 0
      let skippedCount = 0

      for (const monthReport of scanResult.monthReports) {
        const validation = validateMonthData(monthReport)
        if (!validation.valid) {
          console.log(`[v0] Skipping month ${monthReport.month} - insufficient data (${validation.groupCount}/12 groups)`)
          skippedCount++
          continue
        }

        try {
          console.log(`[v0] Processing month: ${monthReport.month}`)
          
          const allFiles: File[] = []
          const groupKeys = Object.keys(monthReport.groups).sort((a, b) => parseInt(a) - parseInt(b))
          
          for (const groupKey of groupKeys) {
            for (const fileData of monthReport.groups[groupKey].files) {
              allFiles.push(fileData.file)
            }
          }

          console.log(`[v0] Total files for ${monthReport.month}:`, allFiles.length)

          const formData = new FormData()
          formData.append('year', year)
          formData.append('months', JSON.stringify([monthReport.month]))
          allFiles.forEach(file => formData.append('files', file, file.name))

          const response = await fetch('/api/rh/join/base', {
            method: 'POST',
            body: formData
          })

          if (!response.ok) {
            throw new Error(`Erro ao fazer join do mês ${monthReport.month}`)
          }

          const blob = await response.blob()
          const filename = `base_${monthReport.month}.pdf`

          const folder14Handle = await rhDirectoryHandle.getDirectoryHandle('14', { create: true })
          const fileHandle = await folder14Handle.getFileHandle(filename, { create: true })
          const writable = await fileHandle.createWritable()
          await writable.write(blob)
          await writable.close()
          
          console.log(`[v0] PDF saved for ${monthReport.month}:`, filename)
          successCount++
          
        } catch (error) {
          console.error(`[v0] Error processing month ${monthReport.month}:`, error)
          failCount++
        }
      }

      toast({
        title: 'Join All Completo!',
        description: `${successCount} PDF(s) criado(s) em RH/14/. ${skippedCount > 0 ? `${skippedCount} omitido(s). ` : ''}${failCount > 0 ? `${failCount} falharam.` : ''}`,
      })

    } catch (error) {
      console.error('[v0] Error in Join All:', error)
      toast({
        title: 'Erro',
        description: `Erro ao compilar: ${getErrorMessage(error, 'Falha desconhecida')}`,
        variant: 'destructive'
      })
    } finally {
      setIsJoining(false)
    }
  }

  const getFileIcon = (type: 'pdf' | 'image') => {
    return type === 'pdf' ? (
      <FileText className="h-4 w-4 text-red-500 flex-shrink-0" />
    ) : (
      <Image className="h-4 w-4 text-blue-500 flex-shrink-0" />
    )
  }

  const validateMonthData = (monthReport: MonthReport): { valid: boolean; groupCount: number; totalGroups: number } => {
    const totalGroups = 12
    const groupCount = Object.keys(monthReport.groups).length
    const minRequired = Math.ceil(totalGroups / 2)
    
    return {
      valid: groupCount >= minRequired,
      groupCount,
      totalGroups
    }
  }

  const scanFolder14 = async () => {
    if (!rhDirectoryHandle) {
      toast({
        title: 'Erro',
        description: 'Por favor, selecione a pasta RH primeiro.',
        variant: 'destructive'
      })
      return
    }

    try {
      const folder14Handle = await rhDirectoryHandle.getDirectoryHandle('14')
      const availableMonths: string[] = []

      for await (const entry of folder14Handle.values()) {
        if (entry.kind === 'file' && entry.name.startsWith('base_') && entry.name.endsWith('.pdf')) {
          const month = entry.name.replace('base_', '').replace('.pdf', '')
          availableMonths.push(month)
        }
      }

      availableMonths.sort()
      setAvailableMonthsForFinal(availableMonths)
      setHasAutoScanned(true)

      if (availableMonths.length === 0) {
        toast({
          title: 'Nenhum Base PDF',
          description: 'Não foram encontrados base PDFs na pasta 14. Execute primeiro o Base Join.',
          variant: 'destructive'
        })
      } else {
        toast({
          title: 'Scan Completo',
          description: `${availableMonths.length} base PDF(s) encontrado(s) na pasta 14.`
        })
      }
    } catch (error) {
      console.error('[v0] Error scanning folder 14:', error)
      toast({
        title: 'Erro',
        description: getErrorMessage(error, 'Pasta 14 não encontrada. Execute primeiro o Base Join.'),
        variant: 'destructive'
      })
    }
  }

  const handleTabChange = async (value: string) => {
    if (value === 'final' && rhDirectoryHandle && !hasAutoScanned) {
      await scanFolder14()
    }
  }

  const handleScanPersons = async () => {
    if (!rhDirectoryHandle) {
      toast({
        title: 'Erro',
        description: 'Por favor, selecione a pasta RH primeiro.',
        variant: 'destructive'
      })
      return
    }

    if (selectedMonthsForFinal.length === 0) {
      toast({
        title: 'Erro',
        description: 'Por favor, selecione pelo menos um mês.',
        variant: 'destructive'
      })
      return
    }

    setIsScanningPersons(true)

    try {
      const folder1Handle = await rhDirectoryHandle.getDirectoryHandle('1')
      const personsMap = new Map<string, { months: Set<string>; filenames: string[]; filesByMonth: Record<string, string> }>()

      for (const month of selectedMonthsForFinal) {
        try {
          const monthHandle = await folder1Handle.getDirectoryHandle(month)

          for await (const entry of monthHandle.values()) {
            if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.pdf')) {
              const baseName = entry.name.replace(/\.pdf$/i, '')
              const regexMatch = baseName.match(/^\d{2}[_-]\d{4}\s+(.+)/)
              const personName = (regexMatch ? regexMatch[1] : baseName).trim()

              if (!personsMap.has(personName)) {
                personsMap.set(personName, { months: new Set(), filenames: [], filesByMonth: {} })
              }
              personsMap.get(personName)!.months.add(month)
              personsMap.get(personName)!.filenames.push(entry.name)
              personsMap.get(personName)!.filesByMonth[month] = entry.name
            }
          }
        } catch (error) {
          console.log(`[v0] Month folder ${month} not found in folder 1`)
        }
      }

      const calculateSimilarity = (str1: string, str2: string): number => {
        const longer = str1.length > str2.length ? str1 : str2
        const shorter = str1.length > str2.length ? str2 : str1
        
        if (longer.length === 0) return 1.0
        
        let matches = 0
        for (let i = 0; i < shorter.length; i++) {
          if (longer.includes(shorter[i])) {
            matches++
          }
        }
        
        return matches / longer.length
      }

      const sortedNames = Array.from(personsMap.keys()).sort()
      
      const isSimplePersonName = (personName: string) => {
        // Allow any unicode letters and spaces; any other character marks as complex
        return /^[\p{L}\s]+$/u.test(personName.trim())
      }

      const persons: PersonFileData[] = sortedNames.map((name) => {
        const data = personsMap.get(name)!
        return {
          name,
          months: Array.from(data.months).sort(),
          isSimple: isSimplePersonName(name),
          fullFilenames: data.filenames,
          filesByMonth: data.filesByMonth
        }
      })

      setPersonsData(persons)
      setFinalScanStale(false)
      if (selectedMonthsForFinal.length > 0) {
        setActiveFinalMonth(selectedMonthsForFinal[0])
      }

      const folder15Handle = await rhDirectoryHandle.getDirectoryHandle('15', { create: true })
      const personsFileHandle = await folder15Handle.getFileHandle('persons.json', { create: true })
      const writable = await personsFileHandle.createWritable()
      await writable.write(JSON.stringify(persons, null, 2))
      await writable.close()

      toast({
        title: 'Scan Completo',
        description: `${persons.length} pessoa(s) encontrada(s). Lista salva em RH/15/persons.json`
      })

    } catch (error) {
      console.error('[v0] Error scanning persons:', error)
      toast({
        title: 'Erro',
        description: `Erro ao fazer scan: ${getErrorMessage(error, 'Falha desconhecida')}`,
        variant: 'destructive'
      })
    } finally {
      setIsScanningPersons(false)
    }
  }

  const toggleMonthForFinal = (month: string) => {
    setSelectedMonthsForFinal(prev => {
      let next: string[] = []
      if (prev.includes(month)) {
        // deselect
        next = []
        setActiveFinalMonth(null)
      } else {
        // single selection mode
        next = [month]
        setActiveFinalMonth(month)
      }
      // Changing months invalidates existing person scan
      setPersonsData([])
      setSelectedPersons([])
      setFinalScanStale(true)
      return next
    })
  }

  const togglePerson = (personName: string) => {
    setSelectedPersons(prev =>
      prev.includes(personName) ? prev.filter(p => p !== personName) : [...prev, personName]
    )
  }

  const selectAllPersons = () => {
    setSelectedPersons(personsData.map(p => p.name))
  }

  const deselectAllPersons = () => {
    setSelectedPersons([])
  }

  const handleJoinFinal = async () => {
    if (selectedPersons.length === 0) {
      toast({
        title: 'Erro',
        description: 'Selecione pelo menos uma pessoa.',
        variant: 'destructive'
      })
      return
    }

    if (selectedMonthsForFinal.length === 0) {
      toast({
        title: 'Erro',
        description: 'Selecione pelo menos um mês.',
        variant: 'destructive'
      })
      return
    }

    setIsJoiningFinal(true)

    try {
      let successCount = 0
      let failCount = 0

      const folder1Handle = await rhDirectoryHandle.getDirectoryHandle('1')
      const folder14Handle = await rhDirectoryHandle.getDirectoryHandle('14')
      const folder15Handle = await rhDirectoryHandle.getDirectoryHandle('15', { create: true })

      for (const person of selectedPersons) {
        const personData = personsData.find(p => p.name === person)
        if (!personData) continue

        const personFolderHandle = await folder15Handle.getDirectoryHandle(person, { create: true })

        for (const month of selectedMonthsForFinal) {
          if (!personData.months.includes(month)) {
            console.log(`[v0] Skipping ${person} - ${month}: no document found`)
            continue
          }

          try {
          console.log(`[v0] Processing ${person} - ${month}`)

          const baseFileHandle = await folder14Handle.getFileHandle(`base_${month}.pdf`)
          const baseFile = await baseFileHandle.getFile()

          const monthFolderHandle = await folder1Handle.getDirectoryHandle(month)
          const personFileName = personData.filesByMonth[month]
          if (!personFileName) {
            console.log(`[v0] Person file not found for ${person} in ${month}`)
            failCount++
            continue
          }

          const personFileHandle = await monthFolderHandle.getFileHandle(personFileName)
          const personFile = await personFileHandle.getFile()

          const response = await fetch('/api/rh/join/final', {
            method: 'POST',
            body: (() => {
              const formData = new FormData()
              formData.append('personName', person)
              formData.append('month', month)
              formData.append('baseFile', baseFile, baseFile.name)
              formData.append('personFile', personFile, personFile.name)
              return formData
            })()
          })

            if (!response.ok) {
              throw new Error(`API error for ${person} - ${month}`)
            }

            const blob = await response.blob()
            const sanitizedName = person.replace(/[^a-zA-Z0-9]/g, '_')
            const filename = `final_${month}_${sanitizedName}.pdf`

            const monthFolderInPersonHandle = await personFolderHandle.getDirectoryHandle(month, { create: true })
            const finalFileHandle = await monthFolderInPersonHandle.getFileHandle(filename, { create: true })
            const writable = await finalFileHandle.createWritable()
            await writable.write(blob)
            await writable.close()

            console.log(`[v0] Final PDF saved: RH/15/${person}/${month}/${filename}`)
            successCount++

          } catch (error) {
            console.error(`[v0] Error processing ${person} - ${month}:`, error)
            failCount++
          }
        }
      }

      toast({
        title: 'Final Join Completo!',
        description: `${successCount} PDF(s) final criado(s) em RH/15/. ${failCount > 0 ? `${failCount} falharam.` : ''}`,
      })

    } catch (error) {
      console.error('[v0] Error in Final Join:', error)
      toast({
        title: 'Erro',
        description: `Erro ao compilar: ${getErrorMessage(error, 'Falha desconhecida')}`,
        variant: 'destructive'
      })
    } finally {
      setIsJoiningFinal(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4 md:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">
            PDFCompiler
          </h1>
          <p className="text-lg text-slate-600 dark:text-slate-300">
            Sistema automático de compilação de documentos RH para projetos financiados
          </p>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="h-5 w-5" />
              Seleção de Pasta RH
            </CardTitle>
            <CardDescription>
              Selecione a pasta raiz RH que contém a estrutura: RH/{'{group}'}/{'{month}'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <Button variant="outline" onClick={handleSelectRHFolder}>
                <FolderOpen className="mr-2 h-4 w-4" />
                Selecionar Pasta RH
              </Button>
              {rhDirectoryHandle && (
                <Badge variant="secondary" className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  Pasta: {rhDirectoryHandle.name}
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Added onValueChange prop to Tabs for auto-scanning */}
        <Tabs defaultValue="base" className="w-full" onValueChange={handleTabChange}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="base">Base Join (Grupos 2-13)</TabsTrigger>
            <TabsTrigger value="final">Final Join (Pasta 1)</TabsTrigger>
          </TabsList>

          <TabsContent value="base" className="mt-6">
            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-1">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Scan className="h-5 w-5" />
                    Controlo de Operações
                  </CardTitle>
                  <CardDescription>
                    Selecione o ano e meses (grupos 2-13)
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="year">Ano</Label>
                    <Select value={year} onValueChange={setYear}>
                      <SelectTrigger id="year">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="2024">2024</SelectItem>
                        <SelectItem value="2025">2025</SelectItem>
                        <SelectItem value="2026">2026</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Meses ({selectedMonths.length} selecionados)</Label>
                    <div className="max-h-48 overflow-y-auto border rounded-lg p-2 space-y-2">
                      {months.map(month => (
                        <div key={month} className="flex items-center space-x-2">
                          <Checkbox
                            id={month}
                            checked={selectedMonths.includes(month)}
                            onCheckedChange={() => toggleMonth(month)}
                          />
                          <label
                            htmlFor={month}
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                          >
                            {month}
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2 pt-4 border-t">
                    <Button
                      onClick={handleScan}
                      disabled={!rhDirectoryHandle || selectedMonths.length === 0 || isScanning}
                      className="w-full"
                      variant="outline"
                    >
                      {isScanning ? (
                        <>Analisando...</>
                      ) : (
                        <>
                          <Scan className="mr-2 h-4 w-4" />
                          Scan Meses
                        </>
                      )}
                    </Button>

                    <Button
                      onClick={handleJoinAll}
                      disabled={!scanResult || isJoining}
                      className="w-full"
                    >
                      {isJoining ? (
                        <>Compilando...</>
                      ) : (
                        <>
                          <Download className="mr-2 h-4 w-4" />
                          Join All Meses
                        </>
                      )}
                    </Button>
                  </div>

                  {scanResult && (
                    <div className="mt-4 p-3 bg-slate-100 dark:bg-slate-800 rounded-lg space-1">
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">Último Scan</p>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        {new Date(scanResult.scanTimestamp).toLocaleString('pt-PT')}
                      </p>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        {scanResult.monthReports.length} mês(es) • {scanResult.totalFiles} ficheiros
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FolderOpen className="h-5 w-5" />
                    Resultados do Scan
                    {scanResult && ` - ${scanResult.totalFiles} ficheiros`}
                  </CardTitle>
                  <CardDescription>
                    Grupos 2-13 • PDFs e imagens organizados por mês (Grupo 1 omitido)
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      Pasta RH: {rhFolderLabel || 'não definida'}
                    </div>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {!scanResult ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <FolderOpen className="h-16 w-16 text-slate-400 mb-4" />
                      <p className="text-slate-500 dark:text-slate-400">
                        Nenhum scan realizado
                      </p>
                      <p className="text-sm text-slate-400 dark:text-slate-500 mt-2">
                        Selecione a pasta RH, escolha o ano e meses, depois clique em "Scan Meses"
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {scanResult.monthReports.map((monthReport) => (
                        <Card key={monthReport.month} className="border-2">
                          <CardHeader className="pb-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <CardTitle className="text-lg">Mês {monthReport.month}</CardTitle>
                                {monthReport.hasChanges && (
                                  <Badge variant="destructive" className="flex items-center gap-1">
                                    <AlertTriangle className="h-3 w-3" />
                                    Alterações Detectadas
                                  </Badge>
                                )}
                              </div>
                              <Button
                                size="sm"
                                onClick={() => handleJoinMonth(monthReport.month)}
                                disabled={isJoining || monthReport.totalFiles === 0}
                              >
                                <Download className="mr-2 h-4 w-4" />
                                Join Base
                              </Button>
                            </div>
                            <CardDescription>
                              {monthReport.totalFiles} ficheiros • {Object.keys(monthReport.groups).length} grupos
                              {monthReport.previousScanDate && (
                                <span className="ml-2 text-xs">
                                  (Último scan: {new Date(monthReport.previousScanDate).toLocaleString('pt-PT')})
                                </span>
                              )}
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            {monthReport.errors.length > 0 && (
                              <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                                <div className="flex items-start gap-2">
                                  <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                                  <div className="space-y-1">
                                    <p className="text-sm font-semibold text-red-800 dark:text-red-300">
                                      Erros de Estrutura
                                    </p>
                                    {monthReport.errors.map((error, idx) => (
                                      <p key={idx} className="text-xs text-red-700 dark:text-red-400">
                                        {error}
                                      </p>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            )}

                            <div className="space-y-3 max-h-64 overflow-y-auto">
                              {Object.keys(monthReport.groups)
                                .sort((a, b) => parseInt(a) - parseInt(b))
                                .map(group => (
                                  <div key={group} className="space-y-2">
                                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                                      Grupo {group} ({monthReport.groups[group].files.length} ficheiros)
                                    </div>
                                    <div className="pl-6 space-y-1">
                                      {monthReport.groups[group].files.map((file, idx) => (
                                        <div
                                          key={idx}
                                          className="flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-800 rounded text-xs"
                                        >
                                          {getFileIcon(file.type)}
                                          <span className="truncate">{file.name}</span>
                                          <span className="ml-auto text-slate-500 uppercase text-[10px]">
                                            {file.type}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="final" className="mt-6">
            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-1">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Controlo Final Join
                  </CardTitle>
                  <CardDescription>
                    Base (14) + Pessoa (1) → Final (15)
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      Pasta RH: {rhFolderLabel || 'não definida'}
                    </div>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Button
                    variant="outline"
                    onClick={scanFolder14}
                    disabled={!rhDirectoryHandle}
                    className="w-full"
                  >
                    <Scan className="mr-2 h-4 w-4" />
                    {hasAutoScanned ? 'Atualizar Meses Disponíveis' : 'Carregar Meses Disponíveis'}
                  </Button>

                  {availableMonthsForFinal.length === 0 && hasAutoScanned && (
                    <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                      <p className="text-sm text-yellow-800 dark:text-yellow-300">
                        Nenhum base PDF encontrado na pasta 14. Execute primeiro o Base Join.
                      </p>
                    </div>
                  )}

                  {availableMonthsForFinal.length > 0 && (
                    <>
                      <div className="space-y-2">
                        <Label>Selecione um mês com Base PDF</Label>
                        <div className="max-h-48 overflow-y-auto border rounded-lg p-2 space-y-2">
                          {availableMonthsForFinal.map(month => (
                            <div key={month} className="flex items-center space-x-2">
                              <Checkbox
                                id={`final-${month}`}
                                checked={selectedMonthsForFinal.includes(month)}
                                onCheckedChange={() => toggleMonthForFinal(month)}
                              />
                              <label
                                htmlFor={`final-${month}`}
                                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                              >
                                {month}
                              </label>
                            </div>
                          ))}
                        </div>
                        {selectedMonthsForFinal.length > 0 && (
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Mês ativo: {selectedMonthsForFinal[0]}
                          </p>
                        )}
                      </div>

                      <Button
                        onClick={handleScanPersons}
                        disabled={selectedMonthsForFinal.length === 0 || isScanningPersons}
                        className="w-full"
                        variant="outline"
                      >
                        {isScanningPersons ? (
                          <>Analisando Pessoas...</>
                        ) : (
                          <>
                            <Scan className="mr-2 h-4 w-4" />
                            Scan Pessoas (Pasta 1)
                          </>
                        )}
                      </Button>
                    </>
                  )}

                      {personsData.length > 0 && (
                        <>
                          {finalScanStale && (
                            <p className="text-xs text-amber-600 dark:text-amber-400">
                              Meses alterados — faça novamente o scan das pessoas.
                            </p>
                          )}
                          <div className="flex gap-2 pt-4 border-t">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={selectAllPersons}
                          className="flex-1"
                        >
                          Selecionar Todos
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={deselectAllPersons}
                          className="flex-1"
                        >
                          Desmarcar Todos
                        </Button>
                      </div>

                      <Button
                        onClick={handleJoinFinal}
                        disabled={selectedPersons.length === 0 || isJoiningFinal || finalScanStale}
                        className="w-full"
                      >
                        {isJoiningFinal ? (
                          <>Compilando Final...</>
                        ) : (
                          <>
                            <Download className="mr-2 h-4 w-4" />
                            Join Final ({selectedPersons.length} pessoas)
                          </>
                        )}
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Pessoas Encontradas
                    {personsData.length > 0 && ` - ${personsData.length} pessoa(s)`}
                  </CardTitle>
                  <CardDescription>
                    Nomes simples aparecem normalmente. Nomes com descritores aparecem cinzentos (clique para ativar).
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {!activeFinalMonth ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                      Selecione um mês com Base e faça o scan das pessoas para ver a lista.
                    </div>
                  ) : personsData.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <Users className="h-16 w-16 text-slate-400 mb-4" />
                      <p className="text-slate-500 dark:text-slate-400">
                        Nenhuma pessoa encontrada
                      </p>
                      {/* Updated instruction text */}
                      <p className="text-sm text-slate-400 dark:text-slate-500 mt-2">
                        Os meses disponíveis serão carregados automaticamente. Depois faça scan das pessoas.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {personsData
                        .filter(person => person.months.includes(activeFinalMonth))
                        .map((person) => (
                        <div
                          key={person.name}
                          className={`flex items-center justify-between p-3 border rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 ${
                            !person.isSimple ? 'opacity-50' : ''
                          }`}
                        >
                          <div className="flex items-center space-x-3">
                            <Checkbox
                              id={`person-${person.name}`}
                              checked={selectedPersons.includes(person.name)}
                              onCheckedChange={() => togglePerson(person.name)}
                            />
                            <label
                              htmlFor={`person-${person.name}`}
                              className="text-sm font-medium cursor-pointer"
                            >
                              {person.name}
                              {!person.isSimple && (
                                <Badge variant="outline" className="ml-2 text-xs">
                                  Nome Complexo
                                </Badge>
                              )}
                            </label>
                          </div>
                          <div className="flex gap-1 flex-wrap">
                            {person.months.map((month: string) => (
                              <Badge key={month} variant="secondary" className="text-xs">
                                {month}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <AlertDialog open={confirmDialog?.open || false} onOpenChange={(open) => !open && setConfirmDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              Dados Insuficientes
            </AlertDialogTitle>
            <AlertDialogDescription>
              O mês <strong>{confirmDialog?.month}</strong> tem apenas <strong>{confirmDialog?.groupCount}</strong> de 12 grupos com ficheiros.
              <br /><br />
              É necessário pelo menos <strong>6 grupos</strong> (metade) para garantir a integridade da compilação.
              <br /><br />
              Deseja continuar mesmo assim?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmDialog(null)}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDialog) {
                  handleJoinMonth(confirmDialog.month, true)
                  setConfirmDialog(null)
                }
              }}
            >
              Continuar Mesmo Assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function loadPreviousScanFromStorage(year: string, month: string) {
  try {
    const key = `rh_scan_${year}_${month}`
    const data = localStorage.getItem(key)
    return data ? JSON.parse(data) : null
  } catch {
    return null
  }
}

function saveScanStateToStorage(year: string, month: string, state: any) {
  try {
    const key = `rh_scan_${year}_${month}`
    localStorage.setItem(key, JSON.stringify(state))
  } catch (error) {
    console.error('[v0] Error saving to localStorage:', error)
  }
}

function detectChanges(previousGroups: any, currentGroups: any): boolean {
  const prevGroupKeys = Object.keys(previousGroups || {})
  const currGroupKeys = Object.keys(currentGroups || {})
  
  if (prevGroupKeys.length !== currGroupKeys.length) {
    return true
  }

  for (const groupKey of currGroupKeys) {
    const prevGroup = previousGroups?.[groupKey]
    const currGroup = currentGroups[groupKey]

    if (!prevGroup) {
      return true
    }

    if (prevGroup.files.length !== currGroup.files.length) {
      return true
    }

    const prevFileNames = prevGroup.files.map((f: any) => f.name).sort()
    const currFileNames = currGroup.files.map((f: any) => f.name).sort()

    for (let i = 0; i < prevFileNames.length; i++) {
      if (prevFileNames[i] !== currFileNames[i]) {
        return true
      }
    }
  }

  return false
}
