import type { CompressionMode } from '../../../preload/index.d'

export type ShrinkGoalId = 'light_30' | 'balanced_50' | 'deep_70' | 'folder_budget'

export interface ShrinkGoal {
  id: ShrinkGoalId
  labelKey: string
  descriptionKey: string
  recommendedMode: CompressionMode
  riskTolerance: 'low' | 'medium' | 'high'
  skipLowValueVideos: boolean
  requireConfirmationForHighRisk: boolean
}

export type AdviceAction = 'compress' | 'skip' | 'confirm'

export type QualityRisk = 'low' | 'medium' | 'high' | 'unknown'

export type AdviceReasonCode =
  | 'high_bitrate'
  | 'very_high_bitrate'
  | 'already_compressed'
  | 'small_file'
  | 'short_video'
  | 'high_resolution'
  | 'unsupported_metadata'
  | 'damaged_or_invalid'
  | 'aggressive_goal'
  | 'low_estimated_saving'
  | 'non_h264_codec'
  | 'large_file'
  | 'efficient_codec'
  | 'editing_codec'
  | 'low_return'
  | 'probe_recommended'
  | 'minor_quality_loss'

export interface EstimatedSaving {
  minPercent: number
  maxPercent: number
  minBytes?: number
  maxBytes?: number
  confidence: 'low' | 'medium' | 'high' | 'unknown'
}

export interface VideoShrinkAdvice {
  videoId: string
  action: AdviceAction
  recommendedMode: CompressionMode
  qualityRisk: QualityRisk
  estimatedSaving: EstimatedSaving
  reasonCodes: AdviceReasonCode[]
  selectedByDefault: boolean
  userOverride?: boolean
}

export interface SmartShrinkPlanSummary {
  goalId: ShrinkGoalId
  totalVideos: number
  compressCount: number
  skipCount: number
  confirmCount: number
  lowRiskCount: number
  mediumRiskCount: number
  highRiskCount: number
  originalTotalBytes: number
  estimatedOutputBytesMin?: number
  estimatedOutputBytesMax?: number
  estimatedSavingBytesMin?: number
  estimatedSavingBytesMax?: number
  recommendedMode: CompressionMode
}

export interface SmartShrinkPlan {
  id: string
  createdAt: string
  goal: ShrinkGoal
  summary: SmartShrinkPlanSummary
  advices: Record<string, VideoShrinkAdvice>
}

export interface VideoInput {
  id: string
  fileSize: number
  duration?: number
  width?: number
  height?: number
  videoCodec?: string
  bitrate?: number
  frameRate?: number
}
