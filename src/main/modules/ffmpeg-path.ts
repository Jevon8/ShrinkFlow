// Backward-compatible re-export. New code should import from './ffmpeg-manager' directly.
export {
  getFfmpegPath,
  getFfprobePath,
  checkFFmpegAvailable,
  checkFFprobeAvailable
} from './ffmpeg-manager'

export type { BinaryCheckResult } from './ffmpeg-manager'
