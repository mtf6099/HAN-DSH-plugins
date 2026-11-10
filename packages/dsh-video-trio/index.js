/**
 * dsh-video-trio —— 宿主半边。
 *
 * 三件事：
 *   ① 给 `webserver/index-inject` 贡献两行（style + script），页面加载时把
 *      start 开机覆盖层和 work 聊天背景挂上去。
 *   ② 用带 Range 的路由把三区素材提供给浏览器（/dsh-video-trio/media?slot=&name=）。
 *   ③ 拉起/停掉"退出视频"伴随播放器进程（exit-player.ps1）：它监视 DSH 主进程，
 *      DSH 退出后全屏播 exit/ 视频。
 *
 * 设计取舍（每条都是为了"插件出问题时不能连累 DSH 起来"）：
 *   - 不 import 任何 DSH 包。
 *   - 注入行同步注册；路由走 ctx.inject(['webServer'])，晚到就晚接，不阻塞 apply。
 *   - 素材只读包内 videos/<slot>/，路径做逃逸防护。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadConfig } from './lib/config.js'
import { buildInjectionRows, BOOTSTRAP_GLOBAL } from './lib/injections.js'
import { serveAsset } from './lib/media.js'
import { startExitPlayer } from './lib/exitwatcher.js'
import { chooseSlotIndex, resolveExitStateFile, rotateTo } from './lib/exitplaylist.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const name = 'video-trio'
export const inject = []
export const VERSION = '0.1.0'

const CONFIG_ROUTE = '/dsh-video-trio/config.json'
const MEDIA_ROUTE = '/dsh-video-trio/media'
const QUIT_ROUTE = '/dsh-video-trio/quit'

function describe(error) {
  return error instanceof Error ? error.message : String(error)
}

function makeRuntimeReader(packageRoot) {
  const cache = new Map()
  return (file) => {
    const target = path.join(packageRoot, 'runtime', file)
    const stat = fs.statSync(target)
    const hit = cache.get(file)
    if (hit !== undefined && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.text
    const text = fs.readFileSync(target, 'utf8')
    cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, text })
    return text
  }
}

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  const packageRoot = __dirname
  const homeDir = (() => {
    try {
      return process.env.DSH_HOME || undefined
    } catch {
      return undefined
    }
  })()
  const readRuntime = makeRuntimeReader(packageRoot)
  // 本次 DSH 运行的随机标识：页面刷新/新开对话时不变，DSH 重启后一定变。
  // 页面侧靠它区分「同一轮运行里重新加载页面」和「真正重启 DSH」。
  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

  const warn = (message) => {
    try {
      ctx.logger?.warn?.(`[${name}] ${message}`)
    } catch {
      /* 日志都不该成为失败原因 */
    }
  }
  const info = (message) => {
    try {
      ctx.logger?.info?.(`[${name}] ${message}`)
    } catch {
      /* 同上 */
    }
  }

  /** 每次都重新解析配置：注入行在收集时解析、配置路由在请求时解析。
   * @returns {ReturnType<typeof loadConfig>} */
  const current = () => loadConfig({ packageRoot, homeDir })

  // 跨启动的顺序游标（页面 localStorage 不靠谱：桌面端每次启动端口会变，origin 跟着变）。
  const stateFile = resolveExitStateFile(homeDir, packageRoot)

  // start 在宿主启动时决定一次：之后页面刷新也不会跳片，DSH 重启才轮到下一条。
  let startPick = -1
  try {
    const { client } = current()
    if (client.start.enabled && client.start.srcs.length > 0) {
      startPick = chooseSlotIndex(client.start.srcs.length, client.playOrder, stateFile, 'start')
    }
  } catch (error) {
    warn(`启动视频顺序选择失败，将从第一条开始：${describe(error)}`)
  }

  // ── ① 注入行：同步注册，不让索引渲染失败 ──
  ctx.on('webserver/index-inject', (table) => {
    if (!Array.isArray(table)) return
    try {
      const { client, warnings } = current()
      for (const warning of warnings) warn(warning)
      // 把宿主选好的起始下标带进页面；start.srcs 本身保持原顺序（便于配置/诊断）。
      const clientConfig = { ...client, runId, start: { ...client.start, pick: startPick } }
      const rows = buildInjectionRows({
        clientConfig,
        cssText: readRuntime('skin.css'),
        jsText: readRuntime('skin.js'),
      })
      table.push(...rows)
    } catch (error) {
      warn(`注入行生成失败，页面将回落到原生外观：${describe(error)}`)
    }
  })

  // ── ② 路由：webServer 可选能力，晚到就晚接 ──
  ctx.inject(['webServer'], (child) => {
    const disposers = []
    // 素材：?slot=start|work|exit&name=<文件名>
    disposers.push(
      child.webServer.register({
        kind: 'exact',
        path: MEDIA_ROUTE,
        handler: (req, res) => {
          const url = new URL(String(req.url ?? '/'), 'http://127.0.0.1')
          const slot = url.searchParams.get('slot')
          const name = url.searchParams.get('name')
          if (!slot || !name) {
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end('slot or name missing')
            return
          }
          let target
          try {
            const { paths } = current()
            const allowed = paths[`${slot}Files`] || []
            target = allowed.find((f) => path.basename(f) === name)
          } catch (error) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end(describe(error))
            return
          }
          if (!target || !fs.existsSync(target)) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end('not found')
            return
          }
          serveAsset(req, res, target)
        },
      }),
    )
    // 配置：GET → JSON
    disposers.push(
      child.webServer.register({
        kind: 'exact',
        path: CONFIG_ROUTE,
        handler: (req, res) => {
          let payload
          try {
            const { client, warnings } = current()
            payload = JSON.stringify({ ...client, warnings })
          } catch (error) {
            payload = JSON.stringify({ error: describe(error) })
          }
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          })
          res.end(payload)
        },
      }),
    )

    // 退出入口：页面里点「退出并播放」→ 播完（或失败兜底）→ POST 这里 → 宿主进程自己退，
    // Electron 外壳（父子进程靠在 IPC 上握手的，不是 kill）会跟着收尾、触发退出视频。
    // 为什么不在页面里直接 window.close()：页面注入看不到 DSH 外壳的关闭入口，硬关会跳过外壳收尾。
    disposers.push(
      child.webServer.register({
        kind: 'exact',
        path: QUIT_ROUTE,
        handler: (req, res) => {
          if (req.method !== 'POST') {
            res.writeHead(405, { Allow: 'POST', 'Content-Type': 'text/plain; charset=utf-8' })
            res.end('POST only')
            return
          }
          let force = false
          try {
            const { client } = current()
            force = client.exit.forceQuit === true
          } catch {
            force = false
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end(JSON.stringify({ ok: true, force }))
          info(`[video-trio] 退出视频播完，宿主进程开始退出（${force ? '强制' : '正常'}）`)
          // 先把响应写完让页面安心，再退出；给日志与 IPC 一点时间。
          const timer = setTimeout(() => {
            try {
              if (force) process.kill(process.pid, 'SIGTERM')
              else process.exit(0)
            } catch {
              process.exit(0)
            }
          }, 120)
          try {
            timer.unref?.()
          } catch {
            /* ignore */
          }
        },
      }),
    )

    child.effect(() => {
      // ── ③ 退出伴随播放器：DSH 起来后延迟拉起，监视 DSH 退出 ──
      // 注意：绝不能在"应用关闭"的 cleanup 里 kill 这个 player！
      // player 靠轮询 parentPid 是否消失来"自终止"——DSH 退出那一刻正是它要工作的
      // 时候（播放退出视频）。若在 shutdown cleanup 里 stopExitPlayer()，就把它提前
      // 杀掉了，退出视频永远不会出现（这正是右键任务栏退出没动画的根因）。
      try {
        const { client, paths } = current()
        if (!client.exit.enabled || !paths.exitFiles || paths.exitFiles.length === 0) {
          info('[video-trio] 退出视频未启用或 exit 目录为空，跳过伴随进程')
          return
        }
        const delay = Number(process.env.DSH_VIDEO_TRIO_EXIT_DELAY_MS) || 4000
        const timer = setTimeout(() => {
          try {
            // 顺序/随机在真正拉起播放器时决定：游标写进 DSH_HOME 的状态文件，
            // 到了退出那一刻播放器按「选中文件优先」的列表落盘执行。
            const exitPick = chooseSlotIndex(paths.exitFiles.length, client.playOrder, stateFile, 'exit')
            const files = rotateTo(paths.exitFiles, exitPick)
            if (files.length === 0) {
              info('[video-trio] exit 目录此刻为空，跳过伴随进程')
              return
            }
            startExitPlayer({
              parentPid: process.pid,
              files,
              muted: client.exit.muted === true,
              fadeMs: client.exit.fadeMs,
              hint: client.exit.hint,
            })
            info(`[video-trio] 退出伴随播放器已拉起（exit 视频 ${files.length} 个，${client.playOrder} 顺序）`)
          } catch (error) {
            warn(`退出伴随播放器启动失败：${describe(error)}`)
          }
        }, delay)
        // cleanup 只清定时器，绝不杀 player（见上方注释）。player 去重由 startExitPlayer 内部做。
        return () => {
          clearTimeout(timer)
        }
      } catch (error) {
        warn(`退出伴随进程调度失败：${describe(error)}`)
        return () => {}
      }
    })

    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          /* 已经注销 */
        }
      }
    }
  })

  try {
    const { client, sources, warnings } = current()
    for (const warning of warnings) warn(warning)
    info(
      `已就绪：start ${client.start.srcs.length} 个 · work ${client.work.srcs.length} 个 · exit ${client.exit.srcs.length} 个（配置来源：${sources.length === 0 ? '默认值' : sources.join(' → ')}）`,
    )
  } catch (error) {
    warn(`配置读取失败，将使用默认值：${describe(error)}`)
  }
}