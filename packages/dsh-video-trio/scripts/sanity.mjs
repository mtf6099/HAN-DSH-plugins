/**
 * dsh-video-trio 自检脚本：读真实配置并打印三区素材/路由，验证配置层工作正常。
 * 运行：node scripts/sanity.mjs [packageRoot]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(__dirname, '..')

const { loadConfig } = await import(pathToFileURL(path.join(pkgRoot, 'lib', 'config.js')).href)

const result = loadConfig({ packageRoot: pkgRoot, homeDir: undefined })

console.log('=== dsh-video-trio sanity ===')
console.log('playOrder:', result.client.playOrder)
for (const slot of ['start', 'work', 'exit']) {
  const s = result.client[slot]
  console.log(`--- ${slot} ---`)
  console.log('  enabled:', s.enabled, '| hint:', s.hint)
  console.log(`  srcs (${s.srcs.length}):`)
  for (const src of s.srcs) console.log('    ', src)
}
console.log('--- skipButton ---')
console.log(' ', JSON.stringify(result.client.skipButton))
console.log('--- warnings ---')
for (const w of result.warnings) console.log('  !', w)
console.log('--- paths ---')
for (const k of ['startFiles', 'workFiles', 'exitFiles']) {
  console.log(`  ${k}:`, (result.paths[k] || []).map((f) => path.basename(f)))
}
console.log('ALL OK')