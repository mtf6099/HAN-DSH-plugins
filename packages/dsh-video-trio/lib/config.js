/**
 * dsh-video-trio 配置：默认值 → JSON 覆盖 → 校验/夹取 → 素材解析。
 *
 * 三个功能区，各自是独立的播放槽：
 *   - start ：启动时全屏覆盖层（对应 `start/` 文件夹里的视频）
 *   - work  ：工作时循环背景（对应 `work/` 文件夹里的视频）
 *   - exit  ：退出时全屏（对应 `exit/` 文件夹里的视频，由伴随进程播放）
 *
 * 播放模式 `playOrder`：
 *   - sequence ：按文件名排序顺序播放
 *   - random   ：随机播放（不保证不重复，简单洗牌）
 *
 * 跳过按钮 `skipButton`：启动（start）与退出（exit）覆盖层上的跳过按钮，
 *   可调大小（fontRatio）与位置（x/width，支持 left/center/right 与自定义百分比）。
 *
 * 刻意不 import 任何 DSH 包（连 schemastery 都不 import）：宿主半边零依赖，
 * 不存在"依赖解析不到 ⇒ 模块求值即抛 ⇒ 插件 FAILED"这条路径。
 */
import fs from 'node:fs'
import path from 'node:path'

/** 3 个功能区、以及各自默认的文件夹名。 */
export const SLOTS = Object.freeze(['start', 'work', 'exit'])
/** 播放模式。 */
export const PLAY_ORDERS = Object.freeze(['sequence', 'random'])
/** 跳过按钮的水平锚点。 */
export const SKIP_ANCHORS = Object.freeze(['left', 'center', 'right'])

/** 参数夹值。
 * @param {unknown} value 原始值。
 * @param {number} fallback 兜底。
 * @param {number} min 下界。
 * @param {number} max 上界。
 * @returns {number}
 */
export function clampNumber(value, fallback, min, max) {
  const n = typeof value === 'number' ? value : Number(value)
  if (n !== n) return fallback
  if (n < min) return min
  if (n > max) return max
  return n
}

/** 从配置里读一个字符串项。
 * @param {Record<string, unknown>} obj 配置片段。
 * @param {string} key 键。
 * @param {string} fallback 兜底。
 * @returns {string}
 */
export function readString(obj, key, fallback) {
  const v = obj[key]
  return typeof v === 'string' && v !== '' ? v : fallback
}

/**
 * 默认配置。状态"装上就先无害"：每个功能各有一个 do-nothing 的兜底。
 */
export const DEFAULT_CONFIG = Object.freeze({
  /** 播放顺序。sequence=按文件名排序，random=随机。 */
  /** 玻璃层参数（AI/用户气泡 + 输入框的磨砂效果，由 skin.js 面板写入本段）。 */
  glass: Object.freeze({
    blur: 4,
    alpha: 0.35,
    edge: 0.51,
  }),
  /** 水波纹与发送回放（由 skin.js 面板写入本段；ripple 类为鼠标水波，resetOnSend 为发送时回到 work 视频起点）。 */
  fx: Object.freeze({
    ripple: false,
    rippleStrength: 0.25,
    rippleRadius: 120,
    rippleSpeed: 240,
    rippleWidth: 3,
    rippleInterval: 60,
    resetOnSend: false,
    resetFadeMs: 600,
  }),
  playOrder: 'sequence',
  /** 是否启用整个 trio（总闸）。 */
  enabled: true,

  /** 跳过按钮（启动/退出覆盖层共用）。 */
  skipButton: Object.freeze({
    /** 是否显示跳过按钮。 */
    show: true,
    /** 水平锚点：left / center / right。 */
    anchor: 'right',
    /** 距左/右边缘的百分比偏移（0~40）。 */
    offset: 3,
    /** 垂直方向：bottom（底部）或 top（顶部）。 */
    vertical: 'bottom',
    /** 距顶/底边缘的百分比偏移（0~40）。 */
    verticalOffset: 5,
    /** 字号缩放比（相对默认 13px）。 */
    fontRatio: 1,
    /** 按钮文案。 */
    label: '点击跳过',
  }),

  start: Object.freeze({
    enabled: true,
    /** 是否尝试带声音播放（桌面版可出声）。 */
    sound: true,
    /** 淡出时长 ms。 */
    fadeMs: 900,
    /** 覆盖层底部的提示文字。 */
    hint: '正在启动…',
    /** 素材目录（相对包根的文件夹名）。 */
    dirName: 'start',
  }),

  work: Object.freeze({
    enabled: true,
    /** 是否静音（背景默认无声）。 */
    muted: true,
    /** 视频蒙版不透明度（暗主题）。 */
    veil: 0.04,
    /** 界面表面不透明度（暗主题）：框外背景透视频的暗度，0=全透（视频满亮），越大越黑。 */
    surface: 0.18,
    /** 左侧对话栏遮挡不透明度（0=全透）。 */
    sidebar: 0.38,
    /** 界面就绪后延迟加载背景视频 ms。 */
    delayMs: 1200,
    /** 播放速度。 */
    playbackRate: 1,
    /** 素材目录。 */
    dirName: 'work',
  }),

  exit: Object.freeze({
    enabled: true,
    /** 是否静音。 */
    muted: false,
    /** 点「退出并播放」后，用 DSH 的普通退出路径（会经过退出确认）还是强制退出。 */
    forceQuit: false,
    /** 淡出时长 ms。 */
    fadeMs: 700,
    /** 指示文字。 */
    hint: '再见~',
    /** 素材目录。 */
    dirName: 'exit',
  }),
})

/**
 * 解析一份素材目录：把包内相对路径映射成一个带 hash 的播放路由，
 * 列出目录下所有可播放文件（mp4/webm/ogv）。
 * @param {string} packageRoot 包根。
 * @param {Record<string, unknown>} section 功能区配置。
 * @param {Record<string, unknown>} defaults 该功能区默认值。
 * @returns {{ dir:string, folder:string, files:string[], route:string, warnings:string[] }}
 */
export function resolveMediaDir(packageRoot, section, defaults) {
  const warnings = []
  const folder = readString(section, 'dirName', defaults.dirName)
  // 目录逃逸防护：只允许包内 videos/<folder>，不许 ../ 跳出包。
  const rel = path.normalize(path.join('videos', folder))
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { dir: '', folder, files: [], route: '', warnings: ['dirName not inside videos/'] }
  }
  const dir = path.join(packageRoot, rel)
  let files = []
  try {
    const entries = fs.readdirSync(dir)
    files = entries
      .filter((n) => /\.(mp4|webm|ogv)$/i.test(n))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
      .map((n) => path.join(dir, n))
  } catch {
    warnings.push(`videos/${folder} not found or empty`)
  }
  return { dir, folder, files, route: `/dsh-video-trio/media?slot=${encodeURIComponent(folder)}`, warnings }
}

/**
 * 端到端配置读取。注入行收集时与 /config 请求时都会调用（很便宜）。
 * @param {{ packageRoot:string, homeDir?:string }} options 位置。
 */
export function loadConfig(options) {
  const warnings = []
  const raw = /** @type {Record<string, unknown>} */ ({})
  const sources = []
  for (const file of [path.join(options.packageRoot, 'video-trio.config.json'), options.homeDir ? path.join(options.homeDir, 'dsh-video-trio.json') : '']) {
    if (!file) continue
    try {
      const text = fs.readFileSync(file, 'utf8')
      const parsed = JSON.parse(text)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        Object.assign(raw, parsed)
        sources.push(file)
      }
    } catch {
      /* 读不到就当没有 */
    }
  }

  const enabled = raw.enabled !== false
  const playOrder = PLAY_ORDERS.includes(raw.playOrder) ? raw.playOrder : DEFAULT_CONFIG.playOrder
  const skipRaw = raw.skipButton !== null && typeof raw.skipButton === 'object' ? raw.skipButton : {}
  const skipButton = {
    show: skipRaw.show !== false,
    anchor: SKIP_ANCHORS.includes(skipRaw.anchor) ? skipRaw.anchor : DEFAULT_CONFIG.skipButton.anchor,
    offset: clampNumber(skipRaw.offset, DEFAULT_CONFIG.skipButton.offset, 0, 40),
    vertical: skipRaw.vertical === 'top' ? 'top' : 'bottom',
    verticalOffset: clampNumber(skipRaw.verticalOffset, DEFAULT_CONFIG.skipButton.verticalOffset, 0, 40),
    fontRatio: clampNumber(skipRaw.fontRatio, DEFAULT_CONFIG.skipButton.fontRatio, 0.6, 3),
    label: readString(skipRaw, 'label', DEFAULT_CONFIG.skipButton.label),
  }

  const startRaw = raw.start !== null && typeof raw.start === 'object' ? raw.start : {}
  const start = {
    enabled: enabled && startRaw.enabled !== false,
    sound: startRaw.sound !== false,
    fadeMs: clampNumber(startRaw.fadeMs, DEFAULT_CONFIG.start.fadeMs, 200, 6000),
    hint: readString(startRaw, 'hint', DEFAULT_CONFIG.start.hint),
    dirName: readString(startRaw, 'dirName', DEFAULT_CONFIG.start.dirName),
  }
  const startMedia = resolveMediaDir(options.packageRoot, startRaw, DEFAULT_CONFIG.start)

  const workRaw = raw.work !== null && typeof raw.work === 'object' ? raw.work : {}
  const work = {
    enabled: enabled && workRaw.enabled !== false,
    muted: workRaw.muted !== false,
    veil: clampNumber(workRaw.veil, DEFAULT_CONFIG.work.veil, 0, 0.92),
    surface: clampNumber(workRaw.surface, DEFAULT_CONFIG.work.surface, 0, 1),
    surfaceLight: clampNumber(workRaw.surfaceLight, clampNumber(workRaw.surface, DEFAULT_CONFIG.work.surface, 0, 1), 0, 1),
    sidebar: clampNumber(workRaw.sidebar, DEFAULT_CONFIG.work.sidebar, 0, 1),
    veilLight: clampNumber(workRaw.veilLight, clampNumber(workRaw.veil, DEFAULT_CONFIG.work.veil, 0, 0.92) * 0.7, 0, 0.92),
    delayMs: clampNumber(workRaw.delayMs, DEFAULT_CONFIG.work.delayMs, 0, 60000),
    playbackRate: clampNumber(workRaw.playbackRate, DEFAULT_CONFIG.work.playbackRate, 0.25, 4),
    dirName: readString(workRaw, 'dirName', DEFAULT_CONFIG.work.dirName),
  }
  const workMedia = resolveMediaDir(options.packageRoot, workRaw, DEFAULT_CONFIG.work)
  const glassRaw = raw.glass !== null && typeof raw.glass === 'object' ? raw.glass : {}
  const glass = {
    blur: clampNumber(glassRaw.blur, DEFAULT_CONFIG.glass.blur, 0, 30),
    alpha: clampNumber(glassRaw.alpha, DEFAULT_CONFIG.glass.alpha, 0, 1),
    edge: clampNumber(glassRaw.edge, DEFAULT_CONFIG.glass.edge, 0, 1),
  }
  const fxRaw = raw.fx !== null && typeof raw.fx === 'object' ? raw.fx : {}
  const fx = {
    ripple: typeof fxRaw.ripple === 'boolean' ? fxRaw.ripple : DEFAULT_CONFIG.fx.ripple,
    rippleStrength: clampNumber(fxRaw.rippleStrength, DEFAULT_CONFIG.fx.rippleStrength, 0, 1),
    rippleRadius: clampNumber(fxRaw.rippleRadius, DEFAULT_CONFIG.fx.rippleRadius, 20, 400),
    rippleSpeed: clampNumber(fxRaw.rippleSpeed, DEFAULT_CONFIG.fx.rippleSpeed, 20, 1000),
    rippleWidth: clampNumber(fxRaw.rippleWidth, DEFAULT_CONFIG.fx.rippleWidth, 1, 12),
    rippleInterval: clampNumber(fxRaw.rippleInterval, DEFAULT_CONFIG.fx.rippleInterval, 16, 500),
    resetOnSend: typeof fxRaw.resetOnSend === 'boolean' ? fxRaw.resetOnSend : DEFAULT_CONFIG.fx.resetOnSend,
    resetFadeMs: clampNumber(fxRaw.resetFadeMs, DEFAULT_CONFIG.fx.resetFadeMs, 100, 3000),
  }
  const exitRaw = raw.exit !== null && typeof raw.exit === 'object' ? raw.exit : {}
  const exit = {
    enabled: enabled && exitRaw.enabled !== false,
    muted: exitRaw.enabled === false ? true : exitRaw.muted === true,
    fadeMs: clampNumber(exitRaw.fadeMs, DEFAULT_CONFIG.exit.fadeMs, 200, 6000),
    hint: readString(exitRaw, 'hint', DEFAULT_CONFIG.exit.hint),
    dirName: readString(exitRaw, 'dirName', DEFAULT_CONFIG.exit.dirName),
    /** 点「退出并播放」后：false=走 DSH 正常退出（有确认弹窗），true=直接退出。 */
    forceQuit: exitRaw.forceQuit === true,
  }
  const exitMedia = resolveMediaDir(options.packageRoot, exitRaw, DEFAULT_CONFIG.exit)

  const client = {
    version: '0.1.0',
    playOrder,
    skipButton,
    start: {
      ...start,
      route: startMedia.route,
      srcs: startMedia.files.map((f) => `${startMedia.route}&name=${encodeURIComponent(path.basename(f))}`),
      custom: !!startRaw.dirName && startRaw.dirName !== DEFAULT_CONFIG.start.dirName,
    },
    work: {
      ...work,
      route: workMedia.route,
      srcs: workMedia.files.map((f) => `${workMedia.route}&name=${encodeURIComponent(path.basename(f))}`),
      custom: !!workRaw.dirName && workRaw.dirName !== DEFAULT_CONFIG.work.dirName,
    },
    exit: {
      ...exit,
      route: exitMedia.route,
      srcs: exitMedia.files.map((f) => `${exitMedia.route}&name=${encodeURIComponent(path.basename(f))}`),
      custom: !!exitRaw.dirName && exitRaw.dirName !== DEFAULT_CONFIG.exit.dirName,
    },
    glass,
    fx,
    config: '/dsh-video-trio/config.json',
  }

  return {
    client,
    paths: {
      startDir: startMedia.dir,
      workDir: workMedia.dir,
      exitDir: exitMedia.dir,
      startFiles: startMedia.files,
      workFiles: workMedia.files,
      exitFiles: exitMedia.files,
    },
    warnings: [...warnings, ...startMedia.warnings, ...workMedia.warnings, ...exitMedia.warnings],
    sources,
  }
}