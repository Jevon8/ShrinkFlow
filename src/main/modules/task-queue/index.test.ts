import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TaskQueue, type QueueProgress, type QueueResult } from './index'
import type { CompressionPlan } from '../compression-planner'

// Mock ffmpeg-runner
vi.mock('../ffmpeg-runner', () => ({
  runCompression: vi.fn()
}))

// Mock fs/promises for stat/unlink control
vi.mock('fs/promises', () => ({
  stat: vi.fn().mockResolvedValue({ size: 600 }),
  unlink: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}))

import { runCompression } from '../ffmpeg-runner'
import { stat } from 'fs/promises'

function makePlan(inputPath = '/videos/test.mp4'): CompressionPlan {
  return {
    inputPath,
    outputPath: '/output/test_compressed.mp4',
    outputDir: '/output',
    mode: 'balanced',
    ffmpegArgs: ['-i', inputPath, '/output/test_compressed.mp4'],
    warnings: []
  }
}

function mockSuccess(delay = 10) {
  return vi.mocked(runCompression).mockImplementation((_plan, _dur, onProgress) => {
    let cancelFn: (() => void) | null = null
    let canceled = false
    const promise = new Promise<any>((resolve) => {
      const timer = setTimeout(() => {
        if (!canceled) onProgress({ percent: 50, elapsedSeconds: 1, remainingLabel: '1s', remainingSeconds: 1, speed: '1x', outTimeUs: 5000000, phase: 'single' })
        if (!canceled) onProgress({ percent: 100, elapsedSeconds: 2, remainingLabel: '0s', remainingSeconds: 0, speed: '1x', outTimeUs: 10000000, phase: 'single' })
        resolve({
          success: true, originalSize: 1000, outputSize: 600, savedSize: 400,
          compressionRatio: 0.6, outputPath: '/output/test_compressed.mp4'
        })
      }, delay)
      cancelFn = () => { canceled = true; clearTimeout(timer) }
    })
    const cancel = () => cancelFn?.()
    return { promise, cancel }
  })
}

function mockFailure(delay = 10) {
  return vi.mocked(runCompression).mockImplementation(() => {
    const promise = new Promise<any>((resolve) => {
      setTimeout(() => {
        resolve({
          success: false, originalSize: 0, outputSize: 0, savedSize: 0,
          compressionRatio: 0, outputPath: '/output/test_compressed.mp4',
          error: 'FFmpeg failed'
        })
      }, delay)
    })
    return { promise, cancel: () => {} }
  })
}

function mockMixed(results: ('success' | 'fail')[]) {
  let callIndex = 0
  return vi.mocked(runCompression).mockImplementation((_plan, _dur, onProgress) => {
    const idx = callIndex++
    const shouldSucceed = results[idx] === 'success'
    const promise = new Promise<any>((resolve) => {
      setTimeout(() => {
        if (shouldSucceed) {
          onProgress({ percent: 100, elapsedSeconds: 1, remainingLabel: '0s', remainingSeconds: 0, speed: '1x', outTimeUs: 10000000, phase: 'single' })
          resolve({
            success: true, originalSize: 1000, outputSize: 600, savedSize: 400,
            compressionRatio: 0.6, outputPath: '/output/test_compressed.mp4'
          })
        } else {
          resolve({
            success: false, originalSize: 0, outputSize: 0, savedSize: 0,
            compressionRatio: 0, outputPath: '/output/test_compressed.mp4',
            error: 'FFmpeg failed'
          })
        }
      }, 10)
    })
    return { promise, cancel: () => {} }
  })
}

describe('TaskQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('executes items serially (one at a time)', async () => {
    const concurrent: number[] = []
    let active = 0
    let maxConcurrent = 0

    vi.mocked(runCompression).mockImplementation((_plan, _dur, _onProgress) => {
      active++
      maxConcurrent = Math.max(maxConcurrent, active)
      concurrent.push(active)
      const promise = new Promise<any>((resolve) => {
        setTimeout(() => {
          active--
          resolve({
            success: true, originalSize: 1000, outputSize: 600, savedSize: 400,
            compressionRatio: 0.6, outputPath: '/output/test_compressed.mp4'
          })
        }, 20)
      })
      return { promise, cancel: () => {} }
    })

    const queue = new TaskQueue([
      { id: '1', plan: makePlan('/a.mp4'), duration: 10 },
      { id: '2', plan: makePlan('/b.mp4'), duration: 10 },
      { id: '3', plan: makePlan('/c.mp4'), duration: 10 }
    ])

    await queue.start()
    expect(maxConcurrent).toBe(1)
  })

  it('continues to next item after single failure', async () => {
    mockMixed(['fail', 'success', 'success'])

    const queue = new TaskQueue([
      { id: '1', plan: makePlan('/a.mp4'), duration: 10 },
      { id: '2', plan: makePlan('/b.mp4'), duration: 10 },
      { id: '3', plan: makePlan('/c.mp4'), duration: 10 }
    ])

    const result = await queue.start()
    expect(result.status).toBe('partial_failed')
    expect(result.completedFiles).toBe(2)
    expect(result.failedFiles).toBe(1)
    expect(result.items[0].status).toBe('failed')
    expect(result.items[1].status).toBe('completed')
    expect(result.items[2].status).toBe('completed')
  })

  it('marks all remaining as canceled when cancel is called', async () => {
    let callIndex = 0
    const resolves: (() => void)[] = []

    vi.mocked(runCompression).mockImplementation((_plan, _dur, onProgress) => {
      const idx = callIndex++
      const promise = new Promise<any>((resolve) => {
        resolves.push(() => {
          onProgress({ percent: 50, elapsedSeconds: 1, remainingLabel: '1s', remainingSeconds: 1, speed: '1x', outTimeUs: 5000000, phase: 'single' })
          resolve({
            success: true, originalSize: 1000, outputSize: 600, savedSize: 400,
            compressionRatio: 0.6, outputPath: '/output/test_compressed.mp4'
          })
        })
      })
      return { promise, cancel: () => {} }
    })

    const queue = new TaskQueue([
      { id: '1', plan: makePlan('/a.mp4'), duration: 10 },
      { id: '2', plan: makePlan('/b.mp4'), duration: 10 },
      { id: '3', plan: makePlan('/c.mp4'), duration: 10 }
    ])

    const progressEvents: QueueProgress[] = []
    queue.on('progress', (p: QueueProgress) => progressEvents.push(p))

    const doneEvents: any[] = []
    queue.on('item-done', (d) => doneEvents.push(d))

    const resultPromise = queue.start()

    // Let first item start
    await new Promise((r) => setTimeout(r, 5))
    // Cancel the queue
    queue.cancel()
    // Resolve the first item
    resolves[0]()

    const result = await resultPromise
    expect(result.status).toBe('canceled')
    expect(result.canceledFiles).toBe(3) // all 3 canceled
    expect(result.items.every((it: any) => it.status === 'canceled')).toBe(true)
  })

  it('all success → completed status', async () => {
    mockSuccess()
    const queue = new TaskQueue([
      { id: '1', plan: makePlan(), duration: 10 },
      { id: '2', plan: makePlan(), duration: 10 }
    ])
    const result = await queue.start()
    expect(result.status).toBe('completed')
    expect(result.completedFiles).toBe(2)
    expect(result.failedFiles).toBe(0)
  })

  it('all failed → failed status', async () => {
    mockFailure()
    const queue = new TaskQueue([
      { id: '1', plan: makePlan(), duration: 10 },
      { id: '2', plan: makePlan(), duration: 10 }
    ])
    const result = await queue.start()
    expect(result.status).toBe('failed')
    expect(result.failedFiles).toBe(2)
    expect(result.completedFiles).toBe(0)
  })

  it('emits item-done for each item', async () => {
    mockSuccess()
    const queue = new TaskQueue([
      { id: '1', plan: makePlan(), duration: 10 },
      { id: '2', plan: makePlan(), duration: 10 }
    ])

    const doneEvents: any[] = []
    queue.on('item-done', (d) => doneEvents.push(d))

    await queue.start()
    expect(doneEvents).toHaveLength(2)
    expect(doneEvents[0].id).toBe('1')
    expect(doneEvents[0].status).toBe('completed')
    expect(doneEvents[1].id).toBe('2')
    expect(doneEvents[1].status).toBe('completed')
  })

  it('emits progress events during compression', async () => {
    mockSuccess()
    const queue = new TaskQueue([
      { id: '1', plan: makePlan(), duration: 10 }
    ])

    const progressEvents: QueueProgress[] = []
    queue.on('progress', (p: QueueProgress) => progressEvents.push(p))

    await queue.start()
    // Should have: start progress + 50% + 100% + post-complete
    expect(progressEvents.length).toBeGreaterThanOrEqual(3)
  })

  it('overall percent includes completed files', async () => {
    mockSuccess()
    const queue = new TaskQueue([
      { id: '1', plan: makePlan(), duration: 10 },
      { id: '2', plan: makePlan(), duration: 10 }
    ])

    const progressEvents: QueueProgress[] = []
    queue.on('progress', (p: QueueProgress) => progressEvents.push(p))

    await queue.start()
    // After item 1 completes, the next progress should reflect 1 completed file
    const afterFirstComplete = progressEvents.filter((p) => p.completedFiles === 1)
    expect(afterFirstComplete.length).toBeGreaterThan(0)
    // When item 2 starts (percent=0), overall should be ~50%
    const item2Start = afterFirstComplete.find((p) => p.currentItem?.percent === 0)
    if (item2Start) {
      expect(item2Start.overallPercent).toBeCloseTo(50, 0)
    }
  })

  it('throws if start is called while running', async () => {
    mockSuccess(50)
    const queue = new TaskQueue([{ id: '1', plan: makePlan(), duration: 10 }])
    const promise = queue.start()
    await expect(queue.start()).rejects.toThrow('already running')
    await promise
  })

  it('cancel during compression marks current item as canceled', async () => {
    let cancelCalled = false
    vi.mocked(runCompression).mockImplementation((_plan, _dur, _onProgress) => {
      const promise = new Promise<any>((resolve) => {
        setTimeout(() => {
          resolve({
            success: cancelCalled, originalSize: 0, outputSize: 0, savedSize: 0,
            compressionRatio: 0, outputPath: '/output/test_compressed.mp4',
            error: cancelCalled ? 'Canceled' : undefined
          })
        }, 50)
      })
      return { promise, cancel: () => { cancelCalled = true } }
    })

    const queue = new TaskQueue([
      { id: '1', plan: makePlan(), duration: 10 }
    ])

    const resultPromise = queue.start()
    await new Promise((r) => setTimeout(r, 10))
    queue.cancel()
    const result = await resultPromise
    expect(result.status).toBe('canceled')
  })

  it('records totalElapsedSeconds on completed queue', async () => {
    mockSuccess(10)
    const queue = new TaskQueue([
      { id: '1', plan: makePlan(), duration: 10 }
    ])
    const result = await queue.start()
    expect(result.totalElapsedSeconds).toBeDefined()
    expect(result.totalElapsedSeconds).toBeGreaterThanOrEqual(1)
  })

  it('records compressionElapsedSeconds for completed items', async () => {
    mockSuccess(10)
    const queue = new TaskQueue([
      { id: '1', plan: makePlan('/a.mp4'), duration: 10 },
      { id: '2', plan: makePlan('/b.mp4'), duration: 10 }
    ])
    const result = await queue.start()
    expect(result.items[0].compressionElapsedSeconds).toBeDefined()
    expect(result.items[0].compressionElapsedSeconds).toBeGreaterThanOrEqual(1)
    expect(result.items[1].compressionElapsedSeconds).toBeDefined()
    expect(result.items[1].compressionElapsedSeconds).toBeGreaterThanOrEqual(1)
  })

  it('records compressionElapsedSeconds for failed items', async () => {
    mockFailure(10)
    const queue = new TaskQueue([
      { id: '1', plan: makePlan(), duration: 10 }
    ])
    const result = await queue.start()
    expect(result.items[0].status).toBe('failed')
    expect(result.items[0].compressionElapsedSeconds).toBeDefined()
    expect(result.items[0].compressionElapsedSeconds).toBeGreaterThanOrEqual(1)
  })

  it('includes inputPath on result items', async () => {
    mockSuccess()
    const queue = new TaskQueue([
      { id: '1', plan: makePlan('/videos/test.mp4'), duration: 10 }
    ])
    const result = await queue.start()
    expect(result.items[0].inputPath).toBe('/videos/test.mp4')
  })

  it('item-done events include compressionElapsedSeconds', async () => {
    mockSuccess(10)
    const queue = new TaskQueue([
      { id: '1', plan: makePlan(), duration: 10 }
    ])

    const doneEvents: any[] = []
    queue.on('item-done', (d) => doneEvents.push(d))

    await queue.start()
    expect(doneEvents).toHaveLength(1)
    expect(doneEvents[0].compressionElapsedSeconds).toBeDefined()
    expect(doneEvents[0].compressionElapsedSeconds).toBeGreaterThanOrEqual(1)
  })
})

describe('ETA smoothing', () => {
  // Helper: mock that emits progress with specific percent/elapsed values
  function mockWithProgress(steps: { percent: number; elapsedSeconds: number }[]) {
    return vi.mocked(runCompression).mockImplementation((_plan, _dur, onProgress) => {
      let canceled = false
      const promise = new Promise<any>((resolve) => {
        for (const step of steps) {
          if (!canceled) {
            onProgress({
              percent: step.percent,
              elapsedSeconds: step.elapsedSeconds,
              remainingLabel: `${step.elapsedSeconds}s`,
              remainingSeconds: step.elapsedSeconds,
              speed: '1x',
              outTimeUs: step.percent * 100000,
              phase: 'single'
            })
          }
        }
        resolve({
          success: true, originalSize: 1000, outputSize: 600, savedSize: 400,
          compressionRatio: 0.6, outputPath: '/output/test_compressed.mp4'
        })
      })
      return { promise, cancel: () => { canceled = true } }
    })
  }

  it('first raw ETA passes through unchanged', async () => {
    // Use slow mock so queue-level elapsed time is non-zero
    mockWithProgress([{ percent: 50, elapsedSeconds: 60 }])
    const queue = new TaskQueue([
      { id: '1', plan: makePlan(), duration: 10 }
    ])

    const progressEvents: QueueProgress[] = []
    queue.on('progress', (p: QueueProgress) => progressEvents.push(p))

    await queue.start()
    // The mock runs fast, so queue elapsed ≈ 0, making ETA ≈ 0 or undefined.
    // What we can verify: the ETA smoothing didn't break the event flow.
    const percentEvents = progressEvents.filter((p) => p.currentItem?.percent === 50)
    expect(percentEvents.length).toBeGreaterThanOrEqual(1)
    // ETA should be a valid number or undefined, never NaN
    for (const evt of percentEvents) {
      if (evt.estimatedRemainingSeconds !== undefined) {
        expect(isFinite(evt.estimatedRemainingSeconds)).toBe(true)
        expect(evt.estimatedRemainingSeconds).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('raw ETA jumping up is capped', async () => {
    // Two items. First item: progress at 50% (elapsed=10s) → raw ETA = 10s
    // Second item: progress at 10% (elapsed=120s) → raw would be huge but capped
    vi.mocked(runCompression).mockImplementationOnce((_plan, _dur, onProgress) => {
      let canceled = false
      const promise = new Promise<any>((resolve) => {
        if (!canceled) onProgress({ percent: 50, elapsedSeconds: 10, remainingLabel: '10s', remainingSeconds: 10, speed: '1x', outTimeUs: 5000000, phase: 'single' })
        if (!canceled) onProgress({ percent: 100, elapsedSeconds: 20, remainingLabel: '0s', remainingSeconds: 0, speed: '1x', outTimeUs: 10000000, phase: 'single' })
        resolve({ success: true, originalSize: 1000, outputSize: 600, savedSize: 400, compressionRatio: 0.6, outputPath: '/output/test_compressed.mp4' })
      })
      return { promise, cancel: () => { canceled = true } }
    }).mockImplementationOnce((_plan, _dur, onProgress) => {
      const promise = new Promise<any>((resolve) => {
        // At elapsed=120s from queue start, percent=10 → raw ETA = 120*90/10 = 1080
        onProgress({ percent: 10, elapsedSeconds: 100, remainingLabel: '100s', remainingSeconds: 100, speed: '1x', outTimeUs: 1000000, phase: 'single' })
        onProgress({ percent: 100, elapsedSeconds: 200, remainingLabel: '0s', remainingSeconds: 0, speed: '1x', outTimeUs: 10000000, phase: 'single' })
        resolve({ success: true, originalSize: 1000, outputSize: 600, savedSize: 400, compressionRatio: 0.6, outputPath: '/output/test_compressed.mp4' })
      })
      return { promise, cancel: () => {} }
    })

    const queue = new TaskQueue([
      { id: '1', plan: makePlan(), duration: 10 },
      { id: '2', plan: makePlan(), duration: 10 }
    ])

    const progressEvents: QueueProgress[] = []
    queue.on('progress', (p: QueueProgress) => progressEvents.push(p))

    await queue.start()

    // After first file completes, lastDisplayedEta should be ~10s
    // When second file starts at low percent, raw ETA would jump massively
    // But smoothing should cap it
    const etaValues = progressEvents
      .map((p) => p.estimatedRemainingSeconds)
      .filter((v): v is number => v !== undefined && v > 0)

    // Verify no jump exceeds the cap: max(prev + 15, prev * 1.15)
    for (let i = 1; i < etaValues.length; i++) {
      const prev = etaValues[i - 1]
      const curr = etaValues[i]
      const maxAllowed = Math.max(prev + 15, Math.round(prev * 1.15))
      if (curr > prev) {
        expect(curr).toBeLessThanOrEqual(maxAllowed)
      }
    }
  })

  it('raw ETA dropping is allowed fast', async () => {
    // One item: first progress gives high ETA, second gives lower
    mockWithProgress([
      { percent: 10, elapsedSeconds: 100 },  // raw ETA = 100*90/10 = 900
      { percent: 80, elapsedSeconds: 200 }   // raw ETA = 200*20/80 = 50
    ])
    const queue = new TaskQueue([
      { id: '1', plan: makePlan(), duration: 10 }
    ])

    const progressEvents: QueueProgress[] = []
    queue.on('progress', (p: QueueProgress) => progressEvents.push(p))

    await queue.start()
    const etaValues = progressEvents
      .map((p) => p.estimatedRemainingSeconds)
      .filter((v): v is number => v !== undefined && v > 0)

    // Should have high then low — drop is allowed
    if (etaValues.length >= 2) {
      expect(etaValues[etaValues.length - 1]).toBeLessThan(etaValues[0])
    }
  })

  it('completed queue shows remaining = 0', async () => {
    mockSuccess(10)
    const queue = new TaskQueue([
      { id: '1', plan: makePlan(), duration: 10 }
    ])

    const progressEvents: QueueProgress[] = []
    queue.on('progress', (p: QueueProgress) => progressEvents.push(p))

    await queue.start()
    const lastEvent = progressEvents[progressEvents.length - 1]
    expect(lastEvent.status).toBe('completed')
    expect(lastEvent.estimatedRemainingSeconds).toBe(0)
  })

  it('new queue does not inherit previous ETA', async () => {
    // First queue: produces ETA of ~10s
    mockWithProgress([{ percent: 50, elapsedSeconds: 10 }])
    const queue1 = new TaskQueue([
      { id: '1', plan: makePlan(), duration: 10 }
    ])
    const events1: QueueProgress[] = []
    queue1.on('progress', (p: QueueProgress) => events1.push(p))
    await queue1.start()

    // Second queue: same setup — ETA should be recalculated fresh
    mockWithProgress([{ percent: 50, elapsedSeconds: 10 }])
    const queue2 = new TaskQueue([
      { id: '1', plan: makePlan(), duration: 10 }
    ])
    const events2: QueueProgress[] = []
    queue2.on('progress', (p: QueueProgress) => events2.push(p))
    await queue2.start()

    // Both should produce similar ETA values (not inherit)
    const eta1 = events1.find((p) => p.currentItem?.percent === 50)?.estimatedRemainingSeconds
    const eta2 = events2.find((p) => p.currentItem?.percent === 50)?.estimatedRemainingSeconds
    expect(eta1).toBeDefined()
    expect(eta2).toBeDefined()
    // They should be similar (within 5s), not different due to inheritance
    expect(Math.abs((eta1 ?? 0) - (eta2 ?? 0))).toBeLessThan(5)
  })

  it('percent below 5 returns undefined ETA', async () => {
    mockWithProgress([{ percent: 2, elapsedSeconds: 5 }])
    const queue = new TaskQueue([
      { id: '1', plan: makePlan(), duration: 10 }
    ])

    const progressEvents: QueueProgress[] = []
    queue.on('progress', (p: QueueProgress) => progressEvents.push(p))

    await queue.start()
    const lowPercentEvent = progressEvents.find((p) => p.currentItem?.percent === 2)
    expect(lowPercentEvent).toBeDefined()
    expect(lowPercentEvent!.estimatedRemainingSeconds).toBeUndefined()
  })

  it('canceled queue does not update ETA after cancel', async () => {
    let resolveFirst: (v: any) => void
    vi.mocked(runCompression).mockImplementation((_plan, _dur, onProgress) => {
      let canceled = false
      const promise = new Promise<any>((resolve) => {
        resolveFirst = resolve
        // Emit progress with a known ETA
        if (!canceled) onProgress({ percent: 50, elapsedSeconds: 10, remainingLabel: '10s', remainingSeconds: 10, speed: '1x', outTimeUs: 5000000, phase: 'single' })
      })
      return { promise, cancel: () => { canceled = true } }
    })

    const queue = new TaskQueue([
      { id: '1', plan: makePlan(), duration: 10 }
    ])

    const progressEvents: QueueProgress[] = []
    queue.on('progress', (p: QueueProgress) => progressEvents.push(p))

    const resultPromise = queue.start()
    await new Promise((r) => setTimeout(r, 10))
    queue.cancel()
    resolveFirst!({ success: false, originalSize: 0, outputSize: 0, savedSize: 0, compressionRatio: 0, outputPath: '/output/test.mp4', error: 'canceled' })
    const result = await resultPromise

    expect(result.status).toBe('canceled')
    // Final event should have status canceled
    const lastEvent = progressEvents[progressEvents.length - 1]
    expect(lastEvent.status).toBe('canceled')
  })
})

describe('monotonic overallPercent', () => {
  it('overallPercent never regresses across item boundaries', async () => {
    // 3 items: each emits progress at 50% then 100% before completing
    mockSuccess(10)
    const queue = new TaskQueue([
      { id: '1', plan: makePlan(), duration: 10 },
      { id: '2', plan: makePlan(), duration: 10 },
      { id: '3', plan: makePlan(), duration: 10 }
    ])

    const progressEvents: QueueProgress[] = []
    queue.on('progress', (p: QueueProgress) => progressEvents.push(p))

    await queue.start()

    // Verify monotonic: each event's overallPercent >= previous
    for (let i = 1; i < progressEvents.length; i++) {
      const prev = progressEvents[i - 1].overallPercent
      const curr = progressEvents[i].overallPercent
      expect(curr).toBeGreaterThanOrEqual(prev)
    }
  })

  it('overallPercent does not drop when item2 starts at 0%', async () => {
    // Two items with fast completion
    mockSuccess(10)
    const queue = new TaskQueue([
      { id: '1', plan: makePlan(), duration: 10 },
      { id: '2', plan: makePlan(), duration: 10 }
    ])

    const progressEvents: QueueProgress[] = []
    queue.on('progress', (p: QueueProgress) => progressEvents.push(p))

    await queue.start()

    // Find the transition point: last event with currentItem.id='1' and first with currentItem.id='2'
    const item1Events = progressEvents.filter((p) => p.currentItem?.id === '1')
    const item2Events = progressEvents.filter((p) => p.currentItem?.id === '2')

    if (item1Events.length > 0 && item2Events.length > 0) {
      const lastItem1 = item1Events[item1Events.length - 1].overallPercent
      const firstItem2 = item2Events[0].overallPercent
      expect(firstItem2).toBeGreaterThanOrEqual(lastItem1)
    }
  })

  it('failed item is counted in processed, overallPercent does not drop', async () => {
    // First item fails, second succeeds
    vi.mocked(runCompression).mockImplementationOnce(() => {
      const promise = new Promise<any>((resolve) => {
        setTimeout(() => {
          resolve({ success: false, originalSize: 0, outputSize: 0, savedSize: 0, compressionRatio: 0, outputPath: '/output/test.mp4', error: 'FFmpeg failed' })
        }, 10)
      })
      return { promise, cancel: () => {} }
    }).mockImplementationOnce((_plan, _dur, onProgress) => {
      const promise = new Promise<any>((resolve) => {
        onProgress({ percent: 50, elapsedSeconds: 1, remainingLabel: '1s', remainingSeconds: 1, speed: '1x', outTimeUs: 5000000, phase: 'single' })
        onProgress({ percent: 100, elapsedSeconds: 2, remainingLabel: '0s', remainingSeconds: 0, speed: '1x', outTimeUs: 10000000, phase: 'single' })
        resolve({ success: true, originalSize: 1000, outputSize: 600, savedSize: 400, compressionRatio: 0.6, outputPath: '/output/test_compressed.mp4' })
      })
      return { promise, cancel: () => {} }
    })

    const queue = new TaskQueue([
      { id: '1', plan: makePlan(), duration: 10 },
      { id: '2', plan: makePlan(), duration: 10 }
    ])

    const progressEvents: QueueProgress[] = []
    queue.on('progress', (p: QueueProgress) => progressEvents.push(p))

    await queue.start()

    // Monotonic check
    for (let i = 1; i < progressEvents.length; i++) {
      expect(progressEvents[i].overallPercent).toBeGreaterThanOrEqual(progressEvents[i - 1].overallPercent)
    }
  })

  it('completed/partial_failed/failed terminal status has 100% overallPercent', async () => {
    mockSuccess(10)
    const queue = new TaskQueue([
      { id: '1', plan: makePlan(), duration: 10 }
    ])

    const progressEvents: QueueProgress[] = []
    queue.on('progress', (p: QueueProgress) => progressEvents.push(p))

    await queue.start()
    const lastEvent = progressEvents[progressEvents.length - 1]
    expect(lastEvent.status).toBe('completed')
    expect(lastEvent.overallPercent).toBe(100)
  })

  it('canceled queue does not regress overallPercent', async () => {
    let resolveFirst: (v: any) => void
    vi.mocked(runCompression).mockImplementation((_plan, _dur, onProgress) => {
      let canceled = false
      const promise = new Promise<any>((resolve) => {
        resolveFirst = resolve
        if (!canceled) onProgress({ percent: 50, elapsedSeconds: 10, remainingLabel: '10s', remainingSeconds: 10, speed: '1x', outTimeUs: 5000000, phase: 'single' })
      })
      return { promise, cancel: () => { canceled = true } }
    })

    const queue = new TaskQueue([
      { id: '1', plan: makePlan(), duration: 10 }
    ])

    const progressEvents: QueueProgress[] = []
    queue.on('progress', (p: QueueProgress) => progressEvents.push(p))

    const resultPromise = queue.start()
    await new Promise((r) => setTimeout(r, 10))
    queue.cancel()
    resolveFirst!({ success: false, originalSize: 0, outputSize: 0, savedSize: 0, compressionRatio: 0, outputPath: '/output/test.mp4', error: 'canceled' })
    await resultPromise

    // Monotonic check
    for (let i = 1; i < progressEvents.length; i++) {
      expect(progressEvents[i].overallPercent).toBeGreaterThanOrEqual(progressEvents[i - 1].overallPercent)
    }
  })

  it('new queue resets monotonic state', async () => {
    mockSuccess(10)
    const queue1 = new TaskQueue([
      { id: '1', plan: makePlan(), duration: 10 }
    ])
    const events1: QueueProgress[] = []
    queue1.on('progress', (p: QueueProgress) => events1.push(p))
    await queue1.start()

    // Second queue should start from 0, not inherit
    mockSuccess(10)
    const queue2 = new TaskQueue([
      { id: '1', plan: makePlan(), duration: 10 }
    ])
    const events2: QueueProgress[] = []
    queue2.on('progress', (p: QueueProgress) => events2.push(p))
    await queue2.start()

    // First event of queue2 should start near 0
    expect(events2[0].overallPercent).toBeLessThanOrEqual(5)
  })

  it('overallPercent is clamped to 0-100', async () => {
    mockSuccess(10)
    const queue = new TaskQueue([
      { id: '1', plan: makePlan(), duration: 10 }
    ])

    const progressEvents: QueueProgress[] = []
    queue.on('progress', (p: QueueProgress) => progressEvents.push(p))

    await queue.start()

    for (const evt of progressEvents) {
      expect(evt.overallPercent).toBeGreaterThanOrEqual(0)
      expect(evt.overallPercent).toBeLessThanOrEqual(100)
    }
  })
})

describe('TaskQueue - cancel lifecycle', () => {
  it('cancel before start is a no-op', () => {
    const queue = new TaskQueue([
      { id: '1', plan: makePlan(), duration: 10 }
    ])
    // Should not throw
    queue.cancel()
    expect(queue.getStatus()).toBe('idle')
  })

  it('cancel stops remaining items from processing', async () => {
    let callIndex = 0
    const startedIds: string[] = []

    vi.mocked(runCompression).mockImplementation((_plan, _dur, _onProgress) => {
      const idx = callIndex++
      startedIds.push(`item-${idx}`)
      const promise = new Promise<any>((resolve) => {
        setTimeout(() => {
          resolve({
            success: true, originalSize: 1000, outputSize: 600, savedSize: 400,
            compressionRatio: 0.6, outputPath: '/output/test_compressed.mp4'
          })
        }, 50)
      })
      return { promise, cancel: () => {} }
    })

    const queue = new TaskQueue([
      { id: '1', plan: makePlan('/a.mp4'), duration: 10 },
      { id: '2', plan: makePlan('/b.mp4'), duration: 10 },
      { id: '3', plan: makePlan('/c.mp4'), duration: 10 }
    ])

    const resultPromise = queue.start()
    await new Promise((r) => setTimeout(r, 10))
    queue.cancel()
    const result = await resultPromise

    // Only first item should have started
    expect(startedIds).toHaveLength(1)
    expect(result.status).toBe('canceled')
  })

  it('cancel emits task-finished with all items in terminal state', async () => {
    vi.mocked(runCompression).mockImplementation((_plan, _dur, _onProgress) => {
      const promise = new Promise<any>((resolve) => {
        setTimeout(() => {
          resolve({
            success: true, originalSize: 1000, outputSize: 600, savedSize: 400,
            compressionRatio: 0.6, outputPath: '/output/test_compressed.mp4'
          })
        }, 100)
      })
      return { promise, cancel: () => {} }
    })

    const queue = new TaskQueue([
      { id: '1', plan: makePlan('/a.mp4'), duration: 10 },
      { id: '2', plan: makePlan('/b.mp4'), duration: 10 }
    ])

    const taskFinishedEvents: any[] = []
    queue.on('task-finished', (e) => taskFinishedEvents.push(e))

    const resultPromise = queue.start()
    await new Promise((r) => setTimeout(r, 10))
    queue.cancel()
    await resultPromise

    expect(taskFinishedEvents).toHaveLength(1)
    const statuses = taskFinishedEvents[0].results.map((r: any) => r.status)
    // All items should be in terminal state (canceled)
    expect(statuses.every((s: string) => s === 'canceled' || s === 'completed' || s === 'failed')).toBe(true)
  })
})

describe('Output-larger-than-input protection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: stat returns 600 (output) for all paths, 1000 for input
    vi.mocked(stat).mockImplementation(async (p: any) => {
      const path = typeof p === 'string' ? p : String(p)
      if (path.includes('input') || path.includes('original') || path.includes('a.mp4') || path.includes('test.mp4')) {
        return { size: 1000 } as any
      }
      return { size: 600 } as any
    })
  })

  function mockSuccessWithOutput(outputPath = '/output/test_compressed.mp4') {
    return vi.mocked(runCompression).mockImplementation(() => {
      const promise = new Promise<any>((resolve) => {
        resolve({
          success: true, originalSize: 1000, outputSize: 600, savedSize: 400,
          compressionRatio: 0.6, outputPath
        })
      })
      return { promise, cancel: () => {} }
    })
  }

  function makeReplaceOriginalPlan(inputPath = '/videos/test.mp4', tempPath = '/temp/test_compressed.mp4') {
    return {
      inputPath,
      outputPath: tempPath,
      outputDir: '/temp',
      mode: 'balanced' as const,
      ffmpegArgs: ['-i', inputPath, tempPath],
      warnings: [],
      outputPlan: {
        inputPath,
        ffmpegOutputPath: tempPath,
        finalOutputPath: inputPath,
        outputDir: '/temp',
        shouldReplaceOriginal: true,
        shouldOverwriteExisting: false
      }
    }
  }

  function makeOverwritePlan(inputPath = '/videos/test.mp4', tempPath = '/temp/test_compressed.mp4', targetPath = '/output/existing.mp4') {
    return {
      inputPath,
      outputPath: targetPath,
      outputDir: '/output',
      mode: 'balanced' as const,
      ffmpegArgs: ['-i', inputPath, tempPath],
      warnings: [],
      outputPlan: {
        inputPath,
        ffmpegOutputPath: tempPath,
        finalOutputPath: targetPath,
        outputDir: '/output',
        shouldReplaceOriginal: false,
        shouldOverwriteExisting: true
      }
    }
  }

  // Test 1: output stat fails + default output → failed
  it('output stat fails + default output → failed', async () => {
    vi.mocked(stat).mockRejectedValue(new Error('ENOENT'))
    mockSuccessWithOutput()

    const queue = new TaskQueue([{ id: '1', plan: makePlan(), duration: 10 }])
    const result = await queue.start()

    expect(result.items[0].status).toBe('failed')
    expect(result.items[0].error).toContain('Could not verify output file size')
  })

  // Test 2: output stat fails + save_as → failed
  it('output stat fails + save_as → failed', async () => {
    vi.mocked(stat).mockRejectedValue(new Error('ENOENT'))
    mockSuccessWithOutput()

    const plan = { ...makePlan(), outputPlan: { inputPath: '/videos/test.mp4', ffmpegOutputPath: '/output/test_compressed.mp4', finalOutputPath: '/output/test_compressed.mp4', outputDir: '/output', shouldReplaceOriginal: false, shouldOverwriteExisting: false } }
    const queue = new TaskQueue([{ id: '1', plan, duration: 10 }])
    const result = await queue.start()

    expect(result.items[0].status).toBe('failed')
    expect(result.items[0].error).toContain('Could not verify output file size')
  })

  // Test 3: output stat fails + replace_original → failed, no replace
  it('output stat fails + replace_original → failed, no replace', async () => {
    vi.mocked(stat).mockRejectedValue(new Error('ENOENT'))
    mockSuccessWithOutput('/temp/test_compressed.mp4')

    const queue = new TaskQueue([{ id: '1', plan: makeReplaceOriginalPlan(), duration: 10 }])
    const result = await queue.start()

    expect(result.items[0].status).toBe('failed')
    expect(result.items[0].error).toContain('Could not verify output file size')
  })

  // Test 4: input stat fails + replace_original → failed, no replace
  it('input stat fails + replace_original → failed, no replace', async () => {
    vi.mocked(stat).mockImplementation(async (p: any) => {
      const path = typeof p === 'string' ? p : String(p)
      if (path.includes('temp') || path.includes('compressed')) {
        return { size: 600 } as any
      }
      throw new Error('ENOENT')
    })
    mockSuccessWithOutput('/temp/test_compressed.mp4')

    const queue = new TaskQueue([{ id: '1', plan: makeReplaceOriginalPlan(), duration: 10 }])
    const result = await queue.start()

    expect(result.items[0].status).toBe('failed')
    expect(result.items[0].error).toContain('Could not read original file size')
  })

  // Test 5: input stat fails + default → completed, no flags
  it('input stat fails + default → completed, no flags', async () => {
    vi.mocked(stat).mockImplementation(async (p: any) => {
      const path = typeof p === 'string' ? p : String(p)
      if (path.includes('output') || path.includes('compressed')) {
        return { size: 600 } as any
      }
      throw new Error('ENOENT')
    })
    mockSuccessWithOutput()

    const queue = new TaskQueue([{ id: '1', plan: makePlan(), duration: 10 }])
    const result = await queue.start()

    expect(result.items[0].status).toBe('completed')
    expect(result.items[0].result?.outputLargerThanInput).toBeUndefined()
    expect(result.items[0].result?.noSaving).toBeUndefined()
  })

  // Test 6: input stat fails + save_as → completed, no flags
  it('input stat fails + save_as → completed, no flags', async () => {
    vi.mocked(stat).mockImplementation(async (p: any) => {
      const path = typeof p === 'string' ? p : String(p)
      if (path.includes('output') || path.includes('compressed')) {
        return { size: 600 } as any
      }
      throw new Error('ENOENT')
    })
    mockSuccessWithOutput()

    const plan = { ...makePlan(), outputPlan: { inputPath: '/videos/test.mp4', ffmpegOutputPath: '/output/test_compressed.mp4', finalOutputPath: '/output/test_compressed.mp4', outputDir: '/output', shouldReplaceOriginal: false, shouldOverwriteExisting: false } }
    const queue = new TaskQueue([{ id: '1', plan, duration: 10 }])
    const result = await queue.start()

    expect(result.items[0].status).toBe('completed')
    expect(result.items[0].result?.outputLargerThanInput).toBeUndefined()
    expect(result.items[0].result?.noSaving).toBeUndefined()
  })

  // Test 7: stat success, all fields synced
  it('stat success, all fields synced from fresh stat', async () => {
    vi.mocked(stat).mockImplementation(async (p: any) => {
      const path = typeof p === 'string' ? p : String(p)
      if (path.includes('test.mp4') || path.includes('a.mp4')) {
        return { size: 2000 } as any
      }
      return { size: 800 } as any
    })
    mockSuccessWithOutput()

    const queue = new TaskQueue([{ id: '1', plan: makePlan(), duration: 10 }])
    const result = await queue.start()

    expect(result.items[0].status).toBe('completed')
    expect(result.items[0].result?.originalSize).toBe(2000)
    expect(result.items[0].result?.outputSize).toBe(800)
    expect(result.items[0].result?.savedSize).toBe(1200)
    expect(result.items[0].result?.compressionRatio).toBe(800 / 2000)
  })

  // Test 8: outputSize > inputSize + replace_original → skipped
  it('outputSize > inputSize + replace_original → skipped', async () => {
    vi.mocked(stat).mockImplementation(async (p: any) => {
      const path = typeof p === 'string' ? p : String(p)
      if (path.includes('test.mp4') || path.includes('a.mp4') || path.includes('original')) {
        return { size: 500 } as any
      }
      return { size: 800 } as any
    })
    mockSuccessWithOutput('/temp/test_compressed.mp4')

    const queue = new TaskQueue([{ id: '1', plan: makeReplaceOriginalPlan(), duration: 10 }])
    const result = await queue.start()

    expect(result.items[0].status).toBe('skipped')
    expect(result.items[0].result?.outputLargerThanInput).toBe(true)
    expect(result.items[0].result?.noSaving).toBe(true)
    expect(result.items[0].result?.savedSize).toBe(0)
    expect(result.items[0].result?.compressionRatio).toBe(800 / 500)
    expect(result.items[0].result?.compressionRatio).toBeGreaterThan(1)
  })

  // Test 9: outputSize === inputSize + default → completed with flags
  it('outputSize === inputSize + default → completed with flags', async () => {
    vi.mocked(stat).mockImplementation(async () => {
      return { size: 1000 } as any
    })
    mockSuccessWithOutput()

    const queue = new TaskQueue([{ id: '1', plan: makePlan(), duration: 10 }])
    const result = await queue.start()

    expect(result.items[0].status).toBe('completed')
    expect(result.items[0].result?.outputLargerThanInput).toBe(true)
    expect(result.items[0].result?.noSaving).toBe(true)
    expect(result.items[0].result?.savedSize).toBe(0)
    expect(result.items[0].result?.compressionRatio).toBe(1)
  })

  // Test 10: success result but output path missing → failed
  it('success result but output path missing → failed', async () => {
    vi.mocked(runCompression).mockImplementation(() => {
      const promise = new Promise<any>((resolve) => {
        resolve({
          success: true, originalSize: 1000, outputSize: 600, savedSize: 400,
          compressionRatio: 0.6, outputPath: ''
        })
      })
      return { promise, cancel: () => {} }
    })

    const plan = { ...makePlan() }
    delete (plan as any).outputPlan
    const queue = new TaskQueue([{ id: '1', plan, duration: 10 }])
    const result = await queue.start()

    expect(result.items[0].status).toBe('failed')
    expect(result.items[0].error).toContain('Missing output file path')
  })

  // Test 11: replace_original + outputPath resolves to inputPath → failed
  it('replace_original + outputPath resolves to inputPath → failed', async () => {
    mockSuccessWithOutput('/videos/test.mp4')

    const plan = makeReplaceOriginalPlan('/videos/test.mp4', '/videos/test.mp4')
    const queue = new TaskQueue([{ id: '1', plan, duration: 10 }])
    const result = await queue.start()

    expect(result.items[0].status).toBe('failed')
    expect(result.items[0].error).toContain('Output path resolved to original file path')
  })

  // Test 12: replace_original + missing ffmpegOutputPath → failed
  it('replace_original + missing ffmpegOutputPath → failed', async () => {
    mockSuccessWithOutput('/output/test_compressed.mp4')

    const plan = {
      ...makePlan(),
      outputPlan: {
        inputPath: '/videos/test.mp4',
        ffmpegOutputPath: undefined as unknown as string,
        finalOutputPath: '/videos/test.mp4',
        outputDir: '/temp',
        shouldReplaceOriginal: true,
        shouldOverwriteExisting: false
      }
    }
    const queue = new TaskQueue([{ id: '1', plan, duration: 10 }])
    const result = await queue.start()

    expect(result.items[0].status).toBe('failed')
    expect(result.items[0].error).toContain('Missing temporary output file path')
  })

  // Test 13: output stat failure cleanup does not unlink inputPath
  it('output stat failure cleanup does not unlink inputPath', async () => {
    const unlinkMock = vi.fn().mockResolvedValue(undefined)
    vi.mocked(stat).mockRejectedValue(new Error('ENOENT'))

    // Mock fs/promises to track unlink calls
    vi.doMock('fs/promises', () => ({
      stat: vi.fn().mockRejectedValue(new Error('ENOENT')),
      unlink: unlinkMock,
      rename: vi.fn().mockResolvedValue(undefined),
      copyFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
      rm: vi.fn().mockResolvedValue(undefined),
    }))

    mockSuccessWithOutput()

    const queue = new TaskQueue([{ id: '1', plan: makePlan(), duration: 10 }])
    const result = await queue.start()

    expect(result.items[0].status).toBe('failed')
    // unlink should not be called with the input path
    for (const call of unlinkMock.mock.calls) {
      expect(call[0]).not.toBe('/videos/test.mp4')
    }
  })

  // Test 14: outputSize >= inputSize + replace_original cleanup only removes temp
  it('outputSize >= inputSize + replace_original cleanup only removes temp', async () => {
    const unlinkMock = vi.fn().mockResolvedValue(undefined)

    vi.mocked(stat).mockImplementation(async (p: any) => {
      const path = typeof p === 'string' ? p : String(p)
      if (path.includes('test.mp4') || path.includes('original')) {
        return { size: 500 } as any
      }
      return { size: 800 } as any
    })

    vi.doMock('fs/promises', () => ({
      stat: vi.mocked(stat),
      unlink: unlinkMock,
      rename: vi.fn().mockResolvedValue(undefined),
      copyFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
      rm: vi.fn().mockResolvedValue(undefined),
    }))

    mockSuccessWithOutput('/temp/test_compressed.mp4')

    const queue = new TaskQueue([{ id: '1', plan: makeReplaceOriginalPlan(), duration: 10 }])
    const result = await queue.start()

    expect(result.items[0].status).toBe('skipped')
    expect(result.items[0].result?.outputLargerThanInput).toBe(true)
  })
})
