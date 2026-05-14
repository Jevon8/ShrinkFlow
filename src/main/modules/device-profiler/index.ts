import { cpus, totalmem, freemem, platform } from 'os'
import { execFile } from 'child_process'
import { getFfmpegPath } from '../ffmpeg-manager'

export interface DeviceProfile {
  platform: string
  cpuModel: string
  cpuCores: number
  totalMemoryBytes: number
  freeMemoryBytes: number
  ffmpegVersion: string | null
  availableHardwareEncoders: string[]
}

const HARDWARE_ENCODERS = [
  'h264_nvenc',
  'hevc_nvenc',
  'h264_qsv',
  'hevc_qsv',
  'h264_videotoolbox',
  'hevc_videotoolbox',
  'h264_amf',
  'hevc_amf'
]

function execFileAsync(command: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, windowsHide: true }, (error, stdout) => {
      if (error) {
        reject(error)
        return
      }
      resolve(stdout)
    })
  })
}

async function getFfmpegVersion(): Promise<string | null> {
  try {
    const output = await execFileAsync(getFfmpegPath(), ['-version'], 5000)
    const firstLine = output.split('\n')[0] || ''
    // Extract version string like "ffmpeg version 6.0"
    const match = firstLine.match(/version\s+(\S+)/)
    return match ? match[1] : firstLine.trim()
  } catch {
    return null
  }
}

async function detectHardwareEncoders(): Promise<string[]> {
  try {
    const output = await execFileAsync(getFfmpegPath(), ['-encoders'], 5000)
    const available: string[] = []
    for (const encoder of HARDWARE_ENCODERS) {
      if (output.includes(encoder)) {
        available.push(encoder)
      }
    }
    return available
  } catch {
    return []
  }
}

export async function getDeviceProfile(): Promise<DeviceProfile> {
  const cpuInfo = cpus()
  const cpuModel = cpuInfo.length > 0 ? cpuInfo[0].model : 'Unknown'

  const [ffmpegVersion, availableHardwareEncoders] = await Promise.all([
    getFfmpegVersion(),
    detectHardwareEncoders()
  ])

  return {
    platform: platform(),
    cpuModel,
    cpuCores: cpuInfo.length,
    totalMemoryBytes: totalmem(),
    freeMemoryBytes: freemem(),
    ffmpegVersion,
    availableHardwareEncoders
  }
}
