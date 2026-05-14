const { rmSync } = require('fs')
const { join } = require('path')

const root = join(__dirname, '..')
const dirs = ['dist', 'release', 'out']

for (const dir of dirs) {
  const target = join(root, dir)
  try {
    rmSync(target, { recursive: true, force: true })
    console.log(`[clean] removed ${dir}/`)
  } catch {
    // directory doesn't exist — ignore
  }
}
