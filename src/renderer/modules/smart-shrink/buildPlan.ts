import type { CompressionMode } from '../../../preload/index.d'
import type { ShrinkGoal, ShrinkGoalId, SmartShrinkPlan, SmartShrinkPlanSummary, VideoInput, VideoShrinkAdvice } from './types'
import { classifyVideo } from './rules'

export const SHRINK_GOALS: Record<ShrinkGoalId, ShrinkGoal> = {
  light_30: {
    id: 'light_30',
    labelKey: 'smartShrink.goal.light.name',
    descriptionKey: 'smartShrink.goal.light.desc',
    recommendedMode: 'quality_first',
    riskTolerance: 'low',
    skipLowValueVideos: true,
    requireConfirmationForHighRisk: true
  },
  balanced_50: {
    id: 'balanced_50',
    labelKey: 'smartShrink.goal.balanced.name',
    descriptionKey: 'smartShrink.goal.balanced.desc',
    recommendedMode: 'compatible_high_quality',
    riskTolerance: 'medium',
    skipLowValueVideos: false,
    requireConfirmationForHighRisk: true
  },
  deep_70: {
    id: 'deep_70',
    labelKey: 'smartShrink.goal.deep.name',
    descriptionKey: 'smartShrink.goal.deep.desc',
    recommendedMode: 'heavy_balanced',
    riskTolerance: 'high',
    skipLowValueVideos: false,
    requireConfirmationForHighRisk: true
  },
  folder_budget: {
    id: 'folder_budget',
    labelKey: 'smartShrink.goal.folderBudget.name',
    descriptionKey: 'smartShrink.goal.folderBudget.desc',
    recommendedMode: 'compatible_high_quality',
    riskTolerance: 'medium',
    skipLowValueVideos: false,
    requireConfirmationForHighRisk: false
  }
}

export function buildSmartShrinkPlan(
  videos: VideoInput[],
  goalId: ShrinkGoalId
): SmartShrinkPlan {
  const goal = SHRINK_GOALS[goalId]
  const advices: Record<string, VideoShrinkAdvice> = {}

  for (const video of videos) {
    advices[video.id] = classifyVideo(video, goal)
  }

  const summary = computePlanSummary(videos, advices, goal)

  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    goal,
    summary,
    advices
  }
}

export function computePlanSummary(
  videos: VideoInput[],
  advices: Record<string, VideoShrinkAdvice>,
  goal: ShrinkGoal
): SmartShrinkPlanSummary {
  let compressCount = 0
  let skipCount = 0
  let confirmCount = 0
  let lowRiskCount = 0
  let mediumRiskCount = 0
  let highRiskCount = 0
  let originalTotalBytes = 0
  let estimatedSavingBytesMin = 0
  let estimatedSavingBytesMax = 0
  let hasSavingEstimate = false

  for (const video of videos) {
    const advice = advices[video.id]
    if (!advice) continue

    originalTotalBytes += video.fileSize || 0

    switch (advice.action) {
      case 'compress':
        compressCount++
        break
      case 'skip':
        skipCount++
        break
      case 'confirm':
        confirmCount++
        break
    }

    switch (advice.qualityRisk) {
      case 'low':
        lowRiskCount++
        break
      case 'medium':
        mediumRiskCount++
        break
      case 'high':
        highRiskCount++
        break
    }

    if (advice.estimatedSaving.minBytes != null) {
      estimatedSavingBytesMin += advice.estimatedSaving.minBytes
      hasSavingEstimate = true
    }
    if (advice.estimatedSaving.maxBytes != null) {
      estimatedSavingBytesMax += advice.estimatedSaving.maxBytes
      hasSavingEstimate = true
    }
  }

  return {
    goalId: goal.id,
    totalVideos: videos.length,
    compressCount,
    skipCount,
    confirmCount,
    lowRiskCount,
    mediumRiskCount,
    highRiskCount,
    originalTotalBytes,
    estimatedOutputBytesMin: hasSavingEstimate ? originalTotalBytes - estimatedSavingBytesMax : undefined,
    estimatedOutputBytesMax: hasSavingEstimate ? originalTotalBytes - estimatedSavingBytesMin : undefined,
    estimatedSavingBytesMin: hasSavingEstimate ? estimatedSavingBytesMin : undefined,
    estimatedSavingBytesMax: hasSavingEstimate ? estimatedSavingBytesMax : undefined,
    recommendedMode: goal.recommendedMode as CompressionMode
  }
}
