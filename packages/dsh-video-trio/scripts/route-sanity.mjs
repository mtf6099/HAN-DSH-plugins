/**
 * dsh-video-trio 路由自检：在本地起一个 http 服务模拟 handleRoute 的逻辑，
 * 验证 media/config 路由能正确返回文件（含 Range/206）。
 * 运行：node scripts/route-sanity.mjs
 */
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(__dirname, '..')

const { loadConfig } = await import(pathToFileURL(path.join(pkgRoot, 'lib', 'config.js')).href)
const { serveAsset } = await import(pathToFileURL(path.join(pkgRoot, 'lib', 'media.js')).href)

const { paths } = loadConfig({ packageRoot: pkgRoot, homeDir: undefined })
const ctx = { current: () => loadConfig({ packageRoot: pkgRoot, homeDir: undefined }) }

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  if (url.pathname === '/dsh-video-trio/config.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }
  if (url.pathname === '/dsh-video-trio/media') {
    const slot = url.searchParams.get('slot')
    const name = url.searchParams.get('name')
    const allowed = paths[`${slot}Files`] || []
    const target = allowed.find((f) => path.basename(f) === name)
    if (!target) {
      res.writeHead(404)
      res.end('nf')
      return
    }
    serveAsset(req, res, target)
    return
  }
  res.writeHead(404)
  res.end('nf')
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const base = `http://127.0.0.1:${port}`

let pass = 0
let fail = 0
function check(name, cond) {
  if (cond) { pass++; console.log(`PASS ${name}`) } else { fail++; console.log(`FAIL ${name}`) }
}

// 1) config
let cfgRes = await fetch(`${base}/dsh-video-trio/config.json`)
check('config returns JSON', cfgRes.ok && (await cfgRes.json()).ok === true)

// 2) media start file, full fetch
const startName = paths.startFiles[0] && path.basename(paths.startFiles[0])
if (startName) {
  const r = await fetch(`${base}/dsh-video-trio/media?slot=start&name=${startName}`)
  const buf = await r.arrayBuffer()
  check('media start full 200 with range ACK', r.status === 200 && buf.byteLength > 1000)
  check('start content-type video/mp4', (r.headers.get('content-type') || '').includes('video/mp4'))
}

// 3) Range request -> 206
if (startName) {
  const r = await fetch(`${base}/dsh-video-trio/media?slot=start&name=${startName}`, { headers: { Range: 'bytes=0-99' } })
  const buf = await r.arrayBuffer()
  check('range returns 206', r.status === 206 && buf.byteLength === 100 && (r.headers.get('content-range') || '').startsWith('bytes 0-99/'))
}

// 4) bad name -> 404
const r = await fetch(`${base}/dsh-video-trio/media?slot=start&name=doesnotexist.mp4`)
check('bad name 404', r.status === 404)

// 5) bad slot -> 404 (allowed list empty)
const r5 = await fetch(`${base}/dsh-video-trio/media?slot=evil&name=x.mp4`)
check('bad slot 404', r5.status === 404)

server.close()

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)