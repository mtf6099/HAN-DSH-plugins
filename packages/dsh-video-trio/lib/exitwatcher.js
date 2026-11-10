/**
 * 退出视频的「伴随进程」实现。
 *
 * 思路：DSH 是 Electron 桌面应用，点关闭后渲染进程/宿主进程很快被销毁，
 * 前端注入拦不到"退出"这个瞬间。所以退出段的播放交给一个**独立于 DSH 的进程**来做：
 *
 *   1. 插件启动（apply）后延迟拉起 `scripts/exit-player.ps1`（`child_process.spawn`），
 *      设置 `detached: true` —— 它脱离 DSH 的进程组，DSH 退掉后它自己继续活着。
 *   2. 播放配置（DSH 主进程 PID + exit 视频列表）写成 UTF-8 JSON 文件，
 *      用 `-ConfigFile <path>` 传给播放器（避免命令行 argv 改写反斜杠）。
 *   3. player 常驻并**静默轮询 DSH PID 是否还活着**（`Get-Process` 探测）。
 *   4. 一旦发现 DSH 没了（= 用户退出了 DSH），player 立即弹出一个无边框、置顶、
 *      全屏的窗口播放 exit 视频；播完或点击再退出。
 *
 * 为什么不用"DSH 关闭事件"：宿主进程被销毁前无法可靠地执行阻塞动作，
 * 而"PID 消失"是最简单、最可靠的退出信号，且不依赖 DSH 内部任何钩子。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** 播放器脚本在包内的绝对路径。 */
export const PLAYER_SCRIPT = path.join(__dirname, '..', 'scripts', 'exit-player.ps1')

/** 记录当前拉起的 player 进程，便于停止。 */
let currentPlayer = null

/**
 * 退出播放器的配置文件路径。
 *
 * 为什么不把 JSON 直接塞进命令行：Windows 下 Node 的 argv 转义会改写
 * JSON 里的反斜杠（`V:\...\exit1.mp4` 的 `\\`），PowerShell 收到后
 * ConvertFrom-Json 失败、files 变空、播放器直接 exit 0 —— 表现就是
 * 「退出时什么都不播」。落成 UTF-8 文件最稳，文件名里也能带空格/中文。
 * @param {number} parentPid DSH 主进程 PID（用于隔离多个实例）。
 */
export function exitConfigFile(parentPid) {
  return path.join(os.tmpdir(), `dsh-video-trio-exit-${parentPid}.json`)
}

/**
 * 拉起退出播放器。
 * @param {{ parentPid:number, files:string[], muted:boolean, fadeMs:number, hint:string, configFile?:string }} opts
 * @returns {{ pid:number } | null}
 */
export function startExitPlayer(opts) {
  const plain = {
    parent: opts.parentPid,
    fadeMs: opts.fadeMs,
    hint: opts.hint,
    muted: opts.muted,
    files: opts.files,
  }
  try {
    // 去重：启动新的前，先停掉旧的（否则会话内热重启会残留重复 watcher）。
    // 注意：这不冲突于"退出时不能杀"——这里是在 DSH 还活着、要重新拉起时才执行。
    stopExitPlayer()
    const configFile = opts.configFile || exitConfigFile(opts.parentPid)
    fs.writeFileSync(configFile, `${JSON.stringify(plain, null, 2)}\n`, 'utf8')
    // 用系统自带的 PowerShell 跑我们的脚本。PowerShell 是 Windows 上最可靠的、
    // 可用一个脚本拉起 WPF 全屏播放窗口的手段（相对 ffplay 等外部依赖）。
    // detached + 独立 stdio，DSH 退出后它继续运行。
    const child = spawn(
      process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PLAYER_SCRIPT, '-ConfigFile', configFile],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      },
    )
    child.unref()
    currentPlayer = { child, pid: child.pid }
    return currentPlayer
  } catch (error) {
    try {
      // eslint-disable-next-line no-console
      console.error('[video-trio] 启动退出播放器失败:', error?.message || error)
    } catch {
      /* ignore */
    }
    return null
  }
}

/** 停止当前播放器（插件卸载 / DSH 正常退出前的兜底）。 */
export function stopExitPlayer() {
  if (!currentPlayer) return
  try {
    currentPlayer.child?.kill?.()
  } catch {
    /* ignore */
  }
  currentPlayer = null
}