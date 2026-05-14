const { existsSync } = require('fs')
const { join } = require('path')

const root = join(__dirname, '..')
const ffmpegDir = join(root, 'resources', 'ffmpeg', 'win32', 'x64')

const requiredFiles = ['ffmpeg.exe', 'ffprobe.exe', 'LICENSE.txt']

let missing = []
for (const file of requiredFiles) {
  if (!existsSync(join(ffmpegDir, file))) {
    missing.push(file)
  }
}

if (missing.length > 0) {
  console.error('\nERROR: FFmpeg binaries not found.')
  console.error('Please place the following files in resources/ffmpeg/win32/x64/:')
  for (const file of missing) {
    console.error(`  - ${file}`)
  }
  console.error('\nSee resources/ffmpeg/win32/x64/README.txt for instructions.\n')
  process.exit(1)
}

console.log('FFmpeg binaries check passed.')
