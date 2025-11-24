import { NextRequest, NextResponse } from 'next/server'

interface ScanRequest {
  year: string
  months: string[]
}

interface MonthReport {
  month: string
  groups: {
    [key: string]: {
      path: string
      files: Array<{ name: string; type: 'pdf' | 'image' }>
    }
  }
  errors: string[]
  totalFiles: number
  hasChanges?: boolean
  previousScanDate?: string
}

export async function POST(request: NextRequest) {
  try {
    const body: ScanRequest = await request.json()
    const { year, months } = body

    if (!year || !months || months.length === 0) {
      return NextResponse.json(
        { error: 'Year and at least one month are required' },
        { status: 400 }
      )
    }

    const scanTimestamp = new Date().toISOString()
    const monthReports: MonthReport[] = []
    let totalFiles = 0

    for (const month of months) {
      const groups: { [key: string]: { path: string; files: Array<{ name: string; type: 'pdf' | 'image' }> } } = {}
      const errors: string[] = []
      let monthTotalFiles = 0

      for (let i = 2; i <= 13; i++) {
        const monthPath = `RH/${year}/RH/${i}/${month}`
        
        // Simulate checking if group folder exists
        if (i <= 10) {
          const files: Array<{ name: string; type: 'pdf' | 'image' }> = []
          
          // Simulate finding files in the group
          const fileCount = Math.floor(Math.random() * 4) + 1
          
          for (let j = 0; j < fileCount; j++) {
            // Random file type - mostly PDFs, some images
            const isPdf = Math.random() > 0.3
            const extension = isPdf ? 'pdf' : (Math.random() > 0.5 ? 'jpg' : 'png')
            
            files.push({
              name: `${month}_documento_${i}_${j + 1}.${extension}`,
              type: isPdf ? 'pdf' : 'image'
            })
          }
          
          groups[i.toString()] = {
            path: monthPath,
            files
          }
          monthTotalFiles += files.length
        } else {
          // Simulate missing groups
          errors.push(`Grupo ${i} não encontrado: ${monthPath}`)
        }
      }

      const previousScan = await loadPreviousScan(year, month)
      
      let hasChanges = false
      let previousScanDate: string | undefined

      if (previousScan) {
        previousScanDate = previousScan.scanDate
        // Check if files have changed
        hasChanges = detectChanges(previousScan.groups, groups)
      } else {
        // No previous scan = first time = has changes
        hasChanges = true
      }

      await saveScanState(year, month, {
        scanDate: scanTimestamp,
        groups,
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

    return NextResponse.json({
      year,
      monthReports,
      totalFiles,
      scanTimestamp
    })
  } catch (error) {
    console.error('Error in scan:', error)
    return NextResponse.json(
      { error: 'Failed to scan folders' },
      { status: 500 }
    )
  }
}

async function loadPreviousScan(year: string, month: string) {
  try {
    // In production: read from file system RH/14/state/{year}/{month}.json
    // For demo: simulate with localStorage or return null
    return null
  } catch {
    return null
  }
}

async function saveScanState(year: string, month: string, state: any) {
  try {
    // In production: write to file system RH/14/state/{year}/{month}.json
    // For demo: simulate with localStorage or console.log
    console.log(`Saving scan state for ${month}:`, state)
  } catch (error) {
    console.error('Error saving scan state:', error)
  }
}

function detectChanges(
  previousGroups: any,
  currentGroups: any
): boolean {
  // Check if number of groups changed
  const prevGroupKeys = Object.keys(previousGroups || {})
  const currGroupKeys = Object.keys(currentGroups || {})
  
  if (prevGroupKeys.length !== currGroupKeys.length) {
    return true
  }

  // Check each group for changes
  for (const groupKey of currGroupKeys) {
    const prevGroup = previousGroups?.[groupKey]
    const currGroup = currentGroups[groupKey]

    if (!prevGroup) {
      return true
    }

    // Check if file count changed
    if (prevGroup.files.length !== currGroup.files.length) {
      return true
    }

    // Check if file names changed
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
