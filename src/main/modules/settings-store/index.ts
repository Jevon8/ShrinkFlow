import { readFile, writeFile, mkdir } from 'fs/promises'
import { dirname, join } from 'path'

export type CompressionMode = 'balanced' | 'quality_first' | 'smallest_size' | 'target_size_fast' | 'target_size_accurate' | 'compatible_high_quality' | 'heavy_balanced'

export const SETTINGS_SCHEMA_VERSION = 2

export interface AppSettings {
  defaultOutputDir: string
  defaultCompressionMode: CompressionMode
  theme: 'dark' | 'light'
  autoOpenOutputFolder: boolean
  migrationVersion?: number
}

const defaults: AppSettings = {
  defaultOutputDir: '',
  defaultCompressionMode: 'compatible_high_quality',
  theme: 'dark',
  autoOpenOutputFolder: false
}

let cachedPath: string | null = null

function getStorePath(userDataPath: string): string {
  if (!cachedPath) {
    cachedPath = join(userDataPath, 'settings.json')
  }
  return cachedPath
}

export async function getSettings(userDataPath: string): Promise<AppSettings> {
  try {
    const raw = await readFile(getStorePath(userDataPath), 'utf-8')
    const parsed = JSON.parse(raw)
    const merged = { ...defaults, ...parsed }

    // One-time migration for old settings
    if (!parsed.migrationVersion || parsed.migrationVersion < SETTINGS_SCHEMA_VERSION) {
      if (!parsed.defaultCompressionMode || parsed.defaultCompressionMode === 'balanced') {
        merged.defaultCompressionMode = 'compatible_high_quality'
      }
      merged.migrationVersion = SETTINGS_SCHEMA_VERSION
      const storePath = getStorePath(userDataPath)
      await mkdir(dirname(storePath), { recursive: true })
      await writeFile(storePath, JSON.stringify(merged, null, 2), 'utf-8')
    }

    return merged
  } catch {
    return { ...defaults }
  }
}

export async function saveSettings(userDataPath: string, partial: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings(userDataPath)
  const next = { ...current, ...partial }
  const storePath = getStorePath(userDataPath)
  await mkdir(dirname(storePath), { recursive: true })
  await writeFile(storePath, JSON.stringify(next, null, 2), 'utf-8')
  return next
}
