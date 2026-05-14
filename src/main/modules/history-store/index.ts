import { readFile, writeFile, mkdir } from 'fs/promises'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'

export interface HistoryTaskItem {
  videoId: string
  fileName: string
  inputPath: string
  outputPath?: string
  status: 'completed' | 'failed' | 'skipped' | 'canceled'
  originalSize?: number
  outputSize?: number
  savedSize?: number
  savedPercent?: number
  compressionElapsedSeconds?: number
  errorMessage?: string
  targetSizeMB?: number
  actualSizeMB?: number
  sizeErrorPercent?: number
  accuracyMode?: 'fast' | 'accurate'
  outputLargerThanInput?: boolean
  noSaving?: boolean
  mode?: string
}

export interface ShrinkPlanSummary {
  goalId: string
  recommendedMode: string
  originalTotalBytes: number
  estimatedSavingBytesMin?: number
  estimatedSavingBytesMax?: number
  compressCount: number
  skipCount: number
  confirmCount: number
  highRiskCount: number
  applied: boolean
}

export interface HistoryRecord {
  id: string
  createdAt: number
  totalFiles: number
  successCount: number
  failedCount: number
  originalTotalSize: number
  outputTotalSize: number
  savedSize: number
  savedPercent: number
  mode: string
  outputDir: string
  status: string
  skippedCount?: number
  totalElapsedSeconds?: number
  results?: HistoryTaskItem[]
  shrinkPlanSummary?: ShrinkPlanSummary
}

type HistoryInput = Omit<HistoryRecord, 'id' | 'createdAt'>

let cachedPath: string | null = null

function getStorePath(userDataPath: string): string {
  if (!cachedPath) {
    cachedPath = join(userDataPath, 'history.json')
  }
  return cachedPath
}

async function readAll(userDataPath: string): Promise<HistoryRecord[]> {
  try {
    const raw = await readFile(getStorePath(userDataPath), 'utf-8')
    return JSON.parse(raw) as HistoryRecord[]
  } catch {
    return []
  }
}

async function writeAll(userDataPath: string, records: HistoryRecord[]): Promise<void> {
  const storePath = getStorePath(userDataPath)
  await mkdir(dirname(storePath), { recursive: true })
  await writeFile(storePath, JSON.stringify(records, null, 2), 'utf-8')
}

export async function getHistory(userDataPath: string): Promise<HistoryRecord[]> {
  const records = await readAll(userDataPath)
  return records.sort((a, b) => b.createdAt - a.createdAt)
}

export async function addHistory(userDataPath: string, input: HistoryInput): Promise<HistoryRecord> {
  const records = await readAll(userDataPath)
  const record: HistoryRecord = {
    ...input,
    id: randomUUID(),
    createdAt: Date.now()
  }
  records.push(record)
  await writeAll(userDataPath, records)
  return record
}

export async function deleteHistory(userDataPath: string, id: string): Promise<void> {
  const records = await readAll(userDataPath)
  const filtered = records.filter((r) => r.id !== id)
  await writeAll(userDataPath, filtered)
}

export async function exportHistoryJSON(userDataPath: string, filePath: string): Promise<void> {
  const records = await readAll(userDataPath)
  await writeFile(filePath, JSON.stringify(records, null, 2), 'utf-8')
}

export async function exportHistoryCSV(userDataPath: string, filePath: string): Promise<void> {
  const records = await readAll(userDataPath)

  const headers = [
    'ID', 'Created At', 'Mode', 'Status', 'Total Files', 'Success', 'Failed', 'Skipped',
    'Original Size (bytes)', 'Output Size (bytes)', 'Saved Size (bytes)', 'Saved %',
    'Total Elapsed (s)', 'Output Dir',
    'Shrink Goal', 'Est. Saving Min (bytes)', 'Est. Saving Max (bytes)',
    'Compress Count', 'Skip Count', 'Confirm Count', 'High Risk Count'
  ]

  const escapeCSV = (val: string | number | undefined | null): string => {
    const str = val === undefined || val === null ? '' : String(val)
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  const rows = records.map((r) => [
    r.id, new Date(r.createdAt).toISOString(), r.mode, r.status,
    r.totalFiles, r.successCount, r.failedCount, r.skippedCount ?? 0,
    r.originalTotalSize, r.outputTotalSize, r.savedSize, r.savedPercent?.toFixed(2) ?? '',
    r.totalElapsedSeconds ?? '', r.outputDir,
    r.shrinkPlanSummary?.goalId ?? '',
    r.shrinkPlanSummary?.estimatedSavingBytesMin ?? '',
    r.shrinkPlanSummary?.estimatedSavingBytesMax ?? '',
    r.shrinkPlanSummary?.compressCount ?? '',
    r.shrinkPlanSummary?.skipCount ?? '',
    r.shrinkPlanSummary?.confirmCount ?? '',
    r.shrinkPlanSummary?.highRiskCount ?? ''
  ].map(escapeCSV).join(','))

  const csv = [headers.join(','), ...rows].join('\n')
  await writeFile(filePath, csv, 'utf-8')
}
