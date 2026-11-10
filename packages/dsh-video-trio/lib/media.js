/**
 * 素材路由工具：按文件名从 videos/<slot>/ 目录下提供单个文件的字节流，
 * 支持 Range / ETag / 206 / HEAD / 304。
 */
import fs from 'node:fs'
import path from 'node:path'

const CONTENT_TYPES = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.png': 'image/png',
}

export function contentTypeFor(file) {
  const ext = path.extname(file).toLowerCase()
  return CONTENT_TYPES[ext] || 'application/octet-stream'
}

/** 解析 HTTP Range 头（支持单区间，bytes=start- 或 bytes=start-end）。
 * @param {string|undefined} header Range 头。
 * @param {number} size 文件大小。
 * @returns {null | { start:number, end:number } | 'unsatisfiable'}
 */
export function parseRange(header, size) {
  if (header === undefined || header === null || header === '') return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim())
  if (!m) return null
  const startText = m[1]
  const endText = m[2]
  let start
  let end
  if (startText === '' && endText === '') return 'unsatisfiable'
  if (startText === '') {
    // suffix range: last N bytes
    const suffix = parseInt(endText, 10)
    if (Number.isNaN(suffix) || suffix <= 0) return 'unsatisfiable'
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = parseInt(startText, 10)
    end = endText === '' ? size - 1 : parseInt(endText, 10)
    if (Number.isNaN(start) || Number.isNaN(end) || start > end) return 'unsatisfiable'
  }
  if (start >= size) return 'unsatisfiable'
  end = Math.min(end, size - 1)
  return { start, end }
}

/**
 * 把一个文件按 HTTP 语义发给浏览器。
 * @param {import('node:http').IncomingMessage} req 请求。
 * @param {import('node:http').ServerResponse} res 响应。
 * @param {string} filePath 绝对路径。
 */
export function serveAsset(req, res, filePath) {
  let stat
  try {
    stat = fs.statSync(filePath)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('asset not found')
    return
  }
  const size = stat.size
  const etag = `"${size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`
  const range = parseRange(req.headers.range, size)

  if (range === 'unsatisfiable') {
    res.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' })
    res.end()
    return
  }
  const headers = {
    'Content-Type': contentTypeFor(filePath),
    'Accept-Ranges': 'bytes',
    ETag: etag,
  }
  if (range !== null) {
    headers['Cache-Control'] = 'no-store'
    headers['Content-Length'] = range.end - range.start + 1
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`
    res.writeHead(206, headers)
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    fs.createReadStream(filePath, { start: range.start, end: range.end }).pipe(res)
    return
  }
  headers['Cache-Control'] = 'no-cache'
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers)
    res.end()
    return
  }
  headers['Content-Length'] = size
  res.writeHead(200, headers)
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  fs.createReadStream(filePath).pipe(res)
}

/** 从素材请求 URL 里解析出 slot 与文件名。
 * @param {import('node:http').IncomingMessage} req 请求。
 */
export function parseMediaRequest(req, base) {
  const url = new URL(String(req.url ?? '/'), 'http://127.0.0.1')
  const match = /\/dsh-video-trio\/media\/([^/?]+)/.exec(url.pathname)
  if (!match) return null
  const slot = decodeURIComponent(match[1])
  const name = url.searchParams.get('name')
  if (!name) return null
  return { slot, name: decodeURIComponent(name) }
}