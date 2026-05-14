import { execFile } from 'child_process'
import { access } from 'fs/promises'
import { getFfprobePath, checkFFprobeAvailable as checkFFprobe } from '../ffmpeg-manager'

export interface VideoMetadata {
  duration: number
  width: number
  height: number
  format: string
  videoCodec: string
  audioCodec: string
  bitrate: number
  frameRate: number
}

export interface AnalyzeResult {
  success: boolean
  metadata?: VideoMetadata
  error?: string
}

export { checkFFprobeAvailable } from '../ffmpeg-manager'

function runFfprobe(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ffprobe = getFfprobePath()
    console.log('[FFprobe] Analyzing video:', filePath)

    execFile(
      ffprobe,
      [
        '-v', 'error',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        '-show_error',
        filePath
      ],
      { timeout: 30000, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          console.log('[FFprobe] Failed:', stderr || error.message)
          // ffprobe may still write useful JSON to stdout on error
          if (stdout && stdout.trim().length > 2) {
            resolve(stdout)
            return
          }
          reject(new Error(stderr?.trim() || error.message || 'ffprobe execution failed'))
          return
        }
        resolve(stdout)
      }
    )
  })
}

function parseFfprobeOutput(output: string): VideoMetadata {
  const trimmed = output.trim()
  if (!trimmed) {
    throw new Error('ffprobe returned empty output')
  }

  let data: Record<string, unknown>
  try {
    data = JSON.parse(trimmed)
  } catch {
    console.log('[FFprobe] JSON parse failed, raw output:', trimmed.slice(0, 300))
    throw new Error(`ffprobe returned invalid JSON`)
  }

  // Check if ffprobe returned an error object
  if (data['error']) {
    const errObj = data['error'] as Record<string, unknown>
    throw new Error((errObj['string'] as string) || 'ffprobe reported an error')
  }

  const format = (data['format'] as Record<string, unknown>) || {}
  const streams = (data['streams'] as Record<string, unknown>[]) || []

  // Check file size — empty or zero-byte files are not valid
  const fileSize = parseInt(format['size'] as string, 10) || 0
  if (fileSize <= 0) {
    throw new Error('File is empty or unreadable')
  }

  // Filter out attached_pic streams (cover images, thumbnails)
  const videoStreams = streams.filter(
    (s) => s['codec_type'] === 'video' && (s['disposition'] as Record<string, unknown>)?.['attached_pic'] !== 1
  )
  const audioStream = streams.find((s) => s['codec_type'] === 'audio')

  if (videoStreams.length === 0) {
    throw new Error('No valid video stream found in file')
  }

  const videoStream = videoStreams[0]

  // Duration: prefer format.duration, fallback to videoStream.duration
  const duration =
    Number(format['duration']) ||
    Number(videoStream['duration']) ||
    0

  if (!duration || duration <= 0) {
    throw new Error('Missing or invalid duration')
  }

  const width = (videoStream['width'] as number) || 0
  const height = (videoStream['height'] as number) || 0

  if (!width || width <= 0 || !height || height <= 0) {
    throw new Error('Missing or invalid video resolution')
  }

  const videoCodec = (videoStream['codec_name'] as string) || ''
  if (!videoCodec) {
    throw new Error('Missing video codec information')
  }

  // Bitrate: prefer format.bit_rate, fallback to videoStream.bit_rate
  const bitrate =
    parseInt(format['bit_rate'] as string, 10) ||
    parseInt(videoStream['bit_rate'] as string, 10) ||
    0

  const audioCodec = (audioStream?.['codec_name'] as string) || 'none'
  const formatName = (format['format_name'] as string) || 'unknown'

  // Frame rate: try avg_frame_rate first, then r_frame_rate
  let frameRate: number | undefined
  const rateStr = (videoStream['avg_frame_rate'] || videoStream['r_frame_rate']) as string
  if (rateStr && rateStr !== '0/0') {
    const parts = rateStr.split('/')
    if (parts.length === 2 && parseInt(parts[1]) !== 0) {
      frameRate = Math.round((parseInt(parts[0]) / parseInt(parts[1])) * 100) / 100
    }
  }

  const metadata: VideoMetadata = { duration, width, height, format: formatName, videoCodec, audioCodec, bitrate, frameRate: frameRate || 0 }
  console.log(`[FFprobe] Video analyzed: duration=${duration}, ${width}x${height}, ${videoCodec}, bitrate=${bitrate}`)
  return metadata
}

export async function analyzeVideo(filePath: string): Promise<AnalyzeResult> {
  try {
    // Check file exists
    try {
      await access(filePath)
    } catch {
      return { success: false, error: `File not found: ${filePath}` }
    }

    const output = await runFfprobe(filePath)
    const metadata = parseFfprobeOutput(output)
    return { success: true, metadata }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown analysis error'
    console.log('[FFprobe] Analysis error:', errorMsg)
    return { success: false, error: errorMsg }
  }
}

export async function analyzeVideos(
  videoList: { id: string; filePath: string }[],
  onProgress: (id: string, result: AnalyzeResult) => void
): Promise<void> {
  console.log(`[FFprobe] Starting batch analysis of ${videoList.length} videos`)
  for (const video of videoList) {
    const result = await analyzeVideo(video.filePath)
    onProgress(video.id, result)
  }
  console.log('[FFprobe] Batch analysis complete')
}
