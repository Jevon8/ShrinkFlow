import { readFile, writeFile, mkdir } from 'fs/promises'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import type { CompressionMode } from '../compression-planner'

export type ResolutionBucket = '480p' | '720p' | '1080p' | '1440p' | '4k' | 'unknown'

export interface CompressionBenchmark {
  id: string
  mode: CompressionMode
  resolutionBucket: ResolutionBucket
  outputCodec: string
  encoderType: 'cpu' | 'gpu' | 'unknown'
  videoDurationSeconds: number
  actualCompressionSeconds: number
  speedMultiplier: number
  createdAt: number
}

const MAX_RECORDS = 100

let cachedPath: string | null = null

function getStorePath(userDataPath: string): string {
  if (!cachedPath) {
    cachedPath = join(userDataPath, 'benchmarks.json')
  }
  return cachedPath
}

async function readAll(userDataPath: string): Promise<CompressionBenchmark[]> {
  try {
    const raw = await readFile(getStorePath(userDataPath), 'utf-8')
    return JSON.parse(raw) as CompressionBenchmark[]
  } catch {
    return []
  }
}

async function writeAll(userDataPath: string, records: CompressionBenchmark[]): Promise<void> {
  const storePath = getStorePath(userDataPath)
  await mkdir(dirname(storePath), { recursive: true })
  await writeFile(storePath, JSON.stringify(records, null, 2), 'utf-8')
}

export function getResolutionBucket(height: number): ResolutionBucket {
  if (height <= 0) return 'unknown'
  if (height <= 480) return '480p'
  if (height <= 720) return '720p'
  if (height <= 1080) return '1080p'
  if (height <= 1440) return '1440p'
  return '4k'
}

export async function addBenchmark(
  userDataPath: string,
  input: {
    mode: CompressionMode
    resolutionBucket: ResolutionBucket
    outputCodec: string
    encoderType: 'cpu' | 'gpu' | 'unknown'
    videoDurationSeconds: number
    actualCompressionSeconds: number
  }
): Promise<CompressionBenchmark> {
  const records = await readAll(userDataPath)

  const speedMultiplier = input.actualCompressionSeconds > 0
    ? input.videoDurationSeconds / input.actualCompressionSeconds
    : 0

  const record: CompressionBenchmark = {
    ...input,
    speedMultiplier,
    id: randomUUID(),
    createdAt: Date.now()
  }

  records.push(record)

  // Keep only the most recent MAX_RECORDS
  if (records.length > MAX_RECORDS) {
    records.sort((a, b) => b.createdAt - a.createdAt)
    records.length = MAX_RECORDS
  }

  await writeAll(userDataPath, records)

  console.log(`[benchmark] saved: duration=${input.videoDurationSeconds}s actual=${input.actualCompressionSeconds}s speed=${speedMultiplier.toFixed(1)}x mode=${input.mode} resolution=${input.resolutionBucket}`)

  return record
}

export async function queryBenchmarks(
  userDataPath: string,
  filters: {
    mode?: CompressionMode
    resolutionBucket?: ResolutionBucket
    outputCodec?: string
  }
): Promise<CompressionBenchmark[]> {
  const records = await readAll(userDataPath)

  return records.filter((r) => {
    if (filters.mode && r.mode !== filters.mode) return false
    if (filters.resolutionBucket && r.resolutionBucket !== filters.resolutionBucket) return false
    if (filters.outputCodec && r.outputCodec !== filters.outputCodec) return false
    return true
  })
}

export async function getAllBenchmarks(userDataPath: string): Promise<CompressionBenchmark[]> {
  return readAll(userDataPath)
}

export async function deleteBenchmark(userDataPath: string, id: string): Promise<void> {
  const records = await readAll(userDataPath)
  const filtered = records.filter((r) => r.id !== id)
  await writeAll(userDataPath, filtered)
}
