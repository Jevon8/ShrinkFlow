import { create } from 'zustand'
import type { VideoShrinkAdvice } from '../modules/smart-shrink/types'

export interface VideoFile {
  id: string
  fileName: string
  filePath: string
  fileSize: number
  extension: string
  status: 'scanned' | 'analyzing' | 'ready' | 'pending' | 'compressing' | 'completed' | 'failed' | 'canceled' | 'skipped'
  errorMessage?: string
  duration?: number
  width?: number
  height?: number
  format?: string
  videoCodec?: string
  audioCodec?: string
  bitrate?: number
  frameRate?: number
  compressionProgress?: {
    percent: number
    elapsedSeconds: number
    remainingLabel: string
    remainingSeconds: number
    speed: string
    phase?: 'single' | 'two_pass_analyze' | 'two_pass_encode'
  }
  compressionResult?: {
    originalSize: number
    outputSize: number
    savedSize: number
    compressionRatio: number
    outputPath: string
    outputLargerThanInput?: boolean
    noSaving?: boolean
  }
  selectedForCompression?: boolean
  shrinkAdvice?: VideoShrinkAdvice
  selectionUserOverride?: boolean
}

interface SkippedEntry {
  path: string
  reason: string
}

type QueueStatus = 'idle' | 'running' | 'completed' | 'partial_failed' | 'failed' | 'canceled'

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'canceled', 'skipped'])

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status)
}

interface FinalResult {
  id: string
  filePath?: string
  status: 'completed' | 'failed' | 'canceled' | 'skipped'
  result?: {
    originalSize: number
    outputSize: number
    savedSize: number
    compressionRatio: number
    outputPath: string
    outputLargerThanInput?: boolean
    noSaving?: boolean
  }
  error?: string
}

interface VideoState {
  videos: VideoFile[]
  skipped: SkippedEntry[]
  queueStatus: QueueStatus
  sessionId: number
  addVideos: (videos: VideoFile[]) => void
  addSkipped: (skipped: SkippedEntry[]) => void
  removeVideo: (id: string) => void
  clearAll: () => void
  setVideoStatus: (id: string, status: VideoFile['status']) => void
  updateVideoMetadata: (id: string, metadata: Partial<VideoFile>) => void
  setVideoError: (id: string, error: string) => void
  updateCompressionProgress: (id: string, progress: NonNullable<VideoFile['compressionProgress']>) => void
  setCompressionResult: (id: string, result: NonNullable<VideoFile['compressionResult']>) => void
  setCanceled: (id: string) => void
  setSkipped: (id: string) => void
  setQueueStatus: (status: QueueStatus) => void
  reconcileFinalResults: (results: FinalResult[]) => void
  setSelectedForCompression: (id: string, selected: boolean) => void
  applyShrinkPlan: (advices: Record<string, VideoShrinkAdvice>) => void
  resetSelectionOverrides: (advices: Record<string, VideoShrinkAdvice>) => void
}

export const useVideoStore = create<VideoState>((set, get) => ({
  videos: [],
  skipped: [],
  queueStatus: 'idle',
  sessionId: 0,
  addVideos: (newVideos) =>
    set((state) => {
      const existingPaths = new Set(state.videos.map((v) => v.filePath))
      const unique = newVideos.filter((v) => !existingPaths.has(v.filePath))
      const duplicates: SkippedEntry[] = newVideos
        .filter((v) => existingPaths.has(v.filePath))
        .map((v) => ({ path: v.filePath, reason: 'duplicate' }))
      return {
        videos: [...state.videos, ...unique],
        skipped: [...state.skipped, ...duplicates]
      }
    }),
  addSkipped: (newSkipped) =>
    set((state) => ({ skipped: [...state.skipped, ...newSkipped] })),
  removeVideo: (id) =>
    set((state) => ({ videos: state.videos.filter((v) => v.id !== id) })),
  clearAll: () => set((state) => ({ videos: [], skipped: [], queueStatus: 'idle', sessionId: state.sessionId + 1 })),
  setVideoStatus: (id, status) =>
    set((state) => ({
      videos: state.videos.map((v) => (v.id === id ? { ...v, status } : v))
    })),
  updateVideoMetadata: (id, metadata) =>
    set((state) => ({
      videos: state.videos.map((v) => (v.id === id ? { ...v, ...metadata } : v))
    })),
  setVideoError: (id, error) =>
    set((state) => ({
      videos: state.videos.map((v) =>
        v.id === id ? { ...v, status: 'failed', errorMessage: error, compressionProgress: undefined } : v
      )
    })),
  updateCompressionProgress: (id, progress) =>
    set((state) => {
      // Queue-level guard: never update per-video progress if queue is in terminal state
      if (isTerminalStatus(state.queueStatus)) {
        return state
      }
      return {
        videos: state.videos.map((v) => {
          if (v.id !== id) return v
          // Per-video terminal state guard
          if (isTerminalStatus(v.status)) {
            return v
          }
          return { ...v, status: 'compressing', compressionProgress: progress }
        })
      }
    }),
  setCompressionResult: (id, result) =>
    set((state) => ({
      videos: state.videos.map((v) =>
        v.id === id ? { ...v, status: 'completed', compressionResult: result, compressionProgress: undefined } : v
      )
    })),
  setCanceled: (id) =>
    set((state) => ({
      videos: state.videos.map((v) =>
        v.id === id ? { ...v, status: 'canceled', compressionProgress: undefined } : v
      )
    })),
  setSkipped: (id) =>
    set((state) => ({
      videos: state.videos.map((v) =>
        v.id === id ? { ...v, status: 'skipped', compressionProgress: undefined } : v
      )
    })),
  setQueueStatus: (status) =>
    set((state) => {
      // Never regress from terminal to non-terminal
      if (isTerminalStatus(state.queueStatus) && !isTerminalStatus(status)) {
        return state
      }
      return { queueStatus: status }
    }),
  reconcileFinalResults: (results) =>
    set((state) => {
      const newVideos = state.videos.map((v) => {
        // Find matching result by id first, then by filePath
        const result = results.find((r) => r.id === v.id) ||
          results.find((r) => r.filePath === v.filePath)
        if (!result) return v

        // Only update if video is NOT already in a matching terminal state
        if (v.status === result.status) return v

        // Force to terminal state
        if (result.status === 'completed' && result.result) {
          return {
            ...v,
            status: 'completed' as const,
            compressionResult: result.result,
            compressionProgress: undefined
          }
        }
        if (result.status === 'failed') {
          return {
            ...v,
            status: 'failed' as const,
            errorMessage: result.error || 'Compression failed',
            compressionProgress: undefined
          }
        }
        if (result.status === 'canceled') {
          return {
            ...v,
            status: 'canceled' as const,
            compressionProgress: undefined
          }
        }
        if (result.status === 'skipped') {
          return {
            ...v,
            status: 'skipped' as const,
            compressionProgress: undefined
          }
        }
        return v
      })

      return { videos: newVideos }
    }),
  setSelectedForCompression: (id, selected) =>
    set((state) => ({
      videos: state.videos.map((v) =>
        v.id === id ? { ...v, selectedForCompression: selected, selectionUserOverride: true } : v
      )
    })),
  applyShrinkPlan: (advices) =>
    set((state) => ({
      videos: state.videos.map((v) => {
        const advice = advices[v.id]
        if (!advice) return v
        // Don't override user's manual choice
        if (v.selectionUserOverride) return { ...v, shrinkAdvice: advice }
        return {
          ...v,
          selectedForCompression: advice.selectedByDefault,
          shrinkAdvice: advice
        }
      })
    })),
  resetSelectionOverrides: (advices) =>
    set((state) => ({
      videos: state.videos.map((v) => {
        const advice = advices[v.id]
        if (!advice) return v
        return {
          ...v,
          selectedForCompression: advice.selectedByDefault,
          shrinkAdvice: advice,
          selectionUserOverride: false
        }
      })
    }))
}))
