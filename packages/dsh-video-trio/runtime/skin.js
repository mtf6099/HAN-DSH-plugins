/*
 * dsh-video-trio — 注入到 index.html 的浏览器运行时。
 *
 * 本文件是脚本文本，不是模块：宿主把 config + 这段文本作为一个 `{ kind: 'script' }`
 * 结构化注入行塞进 index.html。
 *
 * 它做的三件事：
 *   ① start 开机动画：全窗短片（可带声）+ 底部提示 + 可调跳过按钮；start/ 目录
 *      多个视频按顺序或随机挑一个播，startIndex 记录当前。
 *   ② work 聊天背景：短片循环（或逐条切换）铺满视口，界面表面半透明化。
 *   ③ 跳过按钮：可调大小（fontRatio）与位置（anchor/offset/vertical/verticalOffset）。
 *
 * 硬约束（DSH 注入环境要求，别改）：
 *   - 本文件求值时绝不能抛异常。
 *   - 不 import 任何模块。
 *   - 覆盖层 / 背景层都挂在 document.body 上，不放进 #root。
 *     背景层 z-index:-1，落在在流内容之下。
 */

;(function (global) {
  'use strict'

  var NS = '__DSH_VIDEO_TRIO__'

  if (global.__DSH_VIDEO_TRIO_STARTED__ === true) return
  var cfg = global[NS]
  if (cfg === null || typeof cfg !== 'object') return
  if (typeof global.document !== 'object' || global.document === null) return
  global.__DSH_VIDEO_TRIO_STARTED__ = true

  var doc = global.document
  var boot = isObject(cfg.start) ? cfg.start : {}
  var work = isObject(cfg.work) ? cfg.work : {}
  var skip = isObject(cfg.skipButton) ? cfg.skipButton : {}
  var playOrder = cfg.playOrder === 'random' ? 'random' : 'sequence'

  var win = global

  // work 背景播放位置：新开对话/刷新页面后从原处继续，而不是从头重播。
  // 只用 localStorage（同一 DSH 运行内 origin 不变；DSH 重启换端口后自然从新开始）。

  // 选下一个播放项：列表 + 模式，返回 { src, index }。
  function pick(list, mode, lastIndex) {
    if (!Array.isArray(list) || list.length === 0) return null
    var i
    if (mode === 'random') {
      i = Math.floor(Math.random() * list.length)
      // 多个素材时避免连续两轮抽中同一个。
      if (list.length > 1 && i === lastIndex) i = (i + 1) % list.length
    } else {
      i = typeof lastIndex === 'number' && lastIndex >= 0 ? (lastIndex + 1) % list.length : 0
    }
    return { src: list[i], index: i }
  }

  // ────────────────────── ① start 开机动画 ──────────────────────

  var bootIndex = -1
  var bootEl = null
  var bootVideo = null
  var bootEnded = false
  var bootWatchdog = 0

  function startBoot() {
    if (!boot.enabled) {
      startWork()
      return
    }
    if (!Array.isArray(boot.srcs) || boot.srcs.length === 0) {
      startWork()
      return
    }
    // 起始片由宿主在 DSH 启动时选好（顺序/随机游标在宿主侧、跨重启保存），
    // 页面只负责从这一条开始播；页面刷新也不会跳片。
    var hostPick = typeof boot.pick === 'number' && boot.pick >= 0 ? Math.floor(boot.pick) : -1
    var sel
    if (hostPick >= 0 && hostPick < boot.srcs.length) {
      sel = { src: boot.srcs[hostPick], index: hostPick }
    } else {
      sel = pick(boot.srcs, playOrder, -1)
    }
    if (!sel) {
      startWork()
      return
    }
    bootIndex = sel.index

    bootEl = doc.createElement('div')
    bootEl.className = 'dsvt-boot'

    bootVideo = doc.createElement('video')
    bootVideo.className = 'dsvt-boot-video'
    bootVideo.src = sel.src
    bootVideo.setAttribute('data-shown', '0')
    bootVideo.playsInline = true
    bootVideo.preload = 'auto'
    if (boot.sound === false) bootVideo.muted = true

    var veil = doc.createElement('div')
    veil.className = 'dsvt-boot-veil'

    var ui = doc.createElement('div')
    ui.className = 'dsvt-boot-ui'
    ui.textContent = boot.hint || '正在启动…'

    bootEl.appendChild(bootVideo)
    bootEl.appendChild(veil)
    bootEl.appendChild(ui)

    if (skip.show !== false) {
      var sb = buildSkipButton()
      if (sb) bootEl.appendChild(sb)
    }

    doc.body.appendChild(bootEl)
    doc.body.style.cursor = 'pointer'

    bootVideo.addEventListener('loadeddata', function () {
      if (bootWatchdog) {
        win.clearTimeout(bootWatchdog)
        bootWatchdog = 0
      }
      if (bootVideo) bootVideo.setAttribute('data-shown', '1')
    })
    // 素材读不出来（404/编码不支持）时不能让开机层永久盖住界面。
    bootVideo.addEventListener('error', function () { endBoot(true) })
    // 兜底：12 秒还没 decode 出首帧就当作失败，直接进界面。
    bootWatchdog = win.setTimeout(function () {
      bootWatchdog = 0
      if (bootVideo && bootVideo.readyState < 2) endBoot(true)
    }, 12000)
    // 播放（带声音被浏览器拦下时退回静音）
    var tryPlay = function () {
      var p = bootVideo.play && bootVideo.play()
      if (p && typeof p.then === 'function') p.catch(function () {
        bootVideo.muted = true
        var q = bootVideo.play
        if (q) q.call(bootVideo).catch(function () {})
      })
    }
    tryPlay()
    // 播完自动进入（带淡出转场）：播放时长完全由视频自己的 duration 决定。
    bootVideo.addEventListener('ended', function () { endBoot(false) })
    // 兜底：某些媒体源不触发 ended，用 timeupdate 在接近结尾时收尾。
    bootVideo.addEventListener('timeupdate', function () {
      if (!bootVideo) return
      var total = bootVideo.duration
      if (!isFinite(total) || total <= 0) return
      if (bootVideo.currentTime > 0 && bootVideo.currentTime >= total - 0.15) {
        endBoot(false)
      }
    })

    bootEl.addEventListener('click', function () { endBoot(true) })
    doc.addEventListener('keydown', onBootKey)
  }

  function onBootKey(e) {
    var k = e && e.key
    if (k === 'Escape' || k === ' ' || k === 'Enter') endBoot(true)
  }

  function endBoot(immediate) {
    if (!bootEl || bootEnded) return
    bootEnded = true
    if (bootWatchdog) {
      win.clearTimeout(bootWatchdog)
      bootWatchdog = 0
    }
    var fade = immediate ? 280 : Math.max(200, boot.fadeMs || 900)
    bootEl.style.setProperty('--dsvt-boot-fade', fade + 'ms')
    bootEl.setAttribute('data-state', 'leaving')
    if (bootVideo) { try { bootVideo.pause() } catch (e) {} }
    doc.body.style.cursor = ''
    doc.removeEventListener('keydown', onBootKey)
    win.setTimeout(removeBoot, fade)
  }

  function removeBoot() {
    if (bootEl && bootEl.parentNode) bootEl.parentNode.removeChild(bootEl)
    bootEl = null
    bootVideo = null
    // 背景层到这时才建，避免和开机抢带宽。
    startWork()
  }

  // 跳过按钮：位置/大小全由行内样式控制。
  function buildSkipButton() {
    var btn = doc.createElement('button')
    btn.type = 'button'
    btn.className = 'dsvt-skip'
    btn.textContent = skip.label || '点击跳过'

    var size = num(skip.fontRatio, 1, 0.6, 3)
    btn.style.fontSize = Math.round(13 * size) + 'px'
    btn.style.padding = Math.round(10 * size) + 'px ' + Math.round(16 * size) + 'px'

    var anchor = skip.anchor === 'left' ? 'left' : (skip.anchor === 'center' ? 'center' : 'right')
    var off = num(skip.offset, 3, 0, 40)
    var vert = skip.vertical === 'top' ? 'top' : 'bottom'
    var voff = num(skip.verticalOffset, 5, 0, 40)

    if (anchor === 'left') {
      btn.style.left = off + '%'
    } else if (anchor === 'center') {
      btn.style.left = '50%'
      btn.style.transform = 'translateX(-50%)'
    } else {
      btn.style.right = off + '%'
    }
    if (vert === 'top') {
      btn.style.top = voff + '%'
    } else {
      btn.style.bottom = voff + '%'
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation()
      endBoot(true)
    })
    return btn
  }

  // ────────────────────── ② work 聊天背景（重写版：简单、单一职责）──────────────────────
  // 一个 <video> 铺满视口，放在 body 最底层（z-index:-1，不挡交互）。
  // 素材按 sequence/random 轮换：一条播完换下一条。无存档续播、无看门狗、无色阶滤镜。

  var workLayer = null
  var workEl = null
  var workList = []
  var workCursor = -1

  function workPick() {
    if (!workList.length) return -1
    if (workList.length === 1) return 0
    if (playOrder === 'random') {
      var r = workCursor
      while (r === workCursor) r = Math.floor(Math.random() * workList.length)
      return r
    }
    return (workCursor + 1) % workList.length
  }

  function workPlay(index) {
    if (!workEl || index < 0) return
    workCursor = index
    workEl.src = workList[index]
    var p = workEl.play && workEl.play()
    if (p && typeof p.then === 'function') p.catch(function () {})
  }

  function startWork() {
    if (!work.enabled || workLayer) return
    if (!Array.isArray(work.srcs) || work.srcs.length === 0) return
    workList = work.srcs.slice()
    if (!doc.body) return

    workLayer = doc.createElement('div')
    workLayer.id = 'dsvt-backdrop'

    workEl = doc.createElement('video')
    workEl.className = 'dsvt-backdrop-video'
    workEl.muted = work.muted !== false
    workEl.autoplay = true
    workEl.loop = false
    workEl.playsInline = true
    if (typeof work.playbackRate === 'number' && work.playbackRate > 0) {
      workEl.playbackRate = num(work.playbackRate, 1, 0.25, 4)
    }
    workEl.addEventListener('ended', function () { workPlay(workPick()) })
    // 素材出错：跳到下一条，不卡死。
    workEl.addEventListener('error', function () { workPlay(workPick()) })

    workLayer.appendChild(workEl)
    doc.body.appendChild(workLayer)
    startRipple(workLayer)
    installSendWatch()
    doc.documentElement.setAttribute('data-dsvt', 'on')
    // 把 work.surface 换算后的半透明值写进 <html>，供 skin.css 的表面半透明化使用。
    doc.documentElement.style.setProperty('--dsvt-surface', String(num(work.surface, 0.2, 0, 1)))
    doc.documentElement.style.setProperty('--dsvt-surface-light', String(num(work.surfaceLight, num(work.surface, 0, 0, 1), 0, 1)))
    workPlay(workPick())
  }
  // ────────────────────── ③ 水波纹（鼠标划过）+ 发送时回到 work 起点 ──────────────────────
  // 水波纹：画在背景层里（视频之上、界面之下），鼠标移动时在指针处生成一圈向外扩散的环。
  // 参数由玻璃面板写入 global.__DSVT_FX__；面板未加载时回退到配置 cfg.fx。

  var rippleCanvas = null
  var rippleCtx = null
  var rings = []
  var rippleRaf = 0
  var lastSpawn = 0
  var lastSendAt = 0

  function fxLive() {
    var live = global.__DSVT_FX__
    if (live && typeof live === 'object') return live
    return (cfg.fx && typeof cfg.fx === 'object') ? cfg.fx : {}
  }
  function fxNum(v, fb) {
    return typeof v === 'number' && v === v ? v : fb
  }
  function fxCfgNum(key, fb) {
    return cfg.fx && typeof cfg.fx === 'object' ? fxNum(cfg.fx[key], fb) : fb
  }

  // 水波纹是否启用由开关决定。关闭时：不挂 mousemove 监听、不跑绘制循环、清空画布，零计算开销。
  var rippleOn = false

  function startRipple(layer) {
    rippleCanvas = doc.createElement('canvas')
    rippleCanvas.className = 'dsvt-ripple'
    layer.appendChild(rippleCanvas)
    rippleCtx = rippleCanvas.getContext('2d')
    sizeRipple()
    win.addEventListener('resize', sizeRipple)
    setRippleEnabled(fxLive().ripple === true)
  }

  function setRippleEnabled(on) {
    on = !!on
    if (on === rippleOn) return
    rippleOn = on
    if (on) {
      doc.addEventListener('mousemove', onRippleMove, { passive: true })
    } else {
      doc.removeEventListener('mousemove', onRippleMove, { passive: true })
      rings = []
      if (rippleRaf) { win.cancelAnimationFrame(rippleRaf); rippleRaf = 0 }
      if (rippleCtx) rippleCtx.clearRect(0, 0, win.innerWidth, win.innerHeight)
    }
  }
  global.__DSVT_SET_RIPPLE__ = setRippleEnabled

  function sizeRipple() {
    if (!rippleCanvas || !rippleCtx) return
    var dpr = Math.min(win.devicePixelRatio || 1, 2)
    rippleCanvas.width = Math.round(win.innerWidth * dpr)
    rippleCanvas.height = Math.round(win.innerHeight * dpr)
    rippleCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  function onRippleMove(e) {
    if (!rippleOn || !rippleCanvas) return
    var now = Date.now()
    if (now - lastSpawn < fxCfgNum('rippleInterval', 60)) return
    lastSpawn = now
    rings.push({ x: e.clientX, y: e.clientY, t: now })
    if (!rippleRaf) rippleRaf = win.requestAnimationFrame(drawRipple)
  }

  function drawRipple() {
    rippleRaf = 0
    if (!rippleCtx || !rippleOn) return
    var fx = fxLive()
    var w = win.innerWidth
    var h = win.innerHeight
    rippleCtx.clearRect(0, 0, w, h)
    var now = Date.now()
    var maxR = fxNum(fx.rippleRadius, 120)
    var speed = fxNum(fx.rippleSpeed, 240)
    var strength = fxNum(fx.rippleStrength, 0.25)
    var lw = fxNum(fx.rippleWidth, 3)
    var keep = []
    for (var i = 0; i < rings.length; i++) {
      var ring = rings[i]
      var r = ((now - ring.t) / 1000) * speed
      if (r >= maxR) continue
      keep.push(ring)
      var a = strength * Math.pow(1 - r / maxR, 1.6)
      if (a <= 0.002) continue
      // 亮环（水面高光）
      rippleCtx.beginPath()
      rippleCtx.arc(ring.x, ring.y, Math.max(r, 0.5), 0, Math.PI * 2)
      rippleCtx.strokeStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')'
      rippleCtx.lineWidth = lw
      rippleCtx.stroke()
      // 紧贴内侧的暗环（让亮环在浅色画面上也看得见）
      if (r > lw * 1.5) {
        rippleCtx.beginPath()
        rippleCtx.arc(ring.x, ring.y, r - lw * 1.2, 0, Math.PI * 2)
        rippleCtx.strokeStyle = 'rgba(0,0,0,' + (a * 0.5).toFixed(3) + ')'
        rippleCtx.lineWidth = lw * 0.8
        rippleCtx.stroke()
      }
    }
    rings = keep
    if (rings.length) rippleRaf = win.requestAnimationFrame(drawRipple)
  }

  // 发送回放：输入框回车或点击发送按钮 → work 视频淡出，回到当前片起点，再淡入续播。
  function resetWorkToStart() {
    if (!workEl || !workLayer) return
    if (fxLive().resetOnSend !== true) return
    var now = Date.now()
    if (now - lastSendAt < 800) return
    lastSendAt = now
    var ms = fxCfgNum('resetFadeMs', 600)
    workEl.style.transition = 'opacity ' + ms + 'ms ease'
    workEl.style.opacity = '0'
    win.setTimeout(function () {
      if (!workEl) return
      try { workEl.currentTime = 0 } catch (e) { /* 未就绪时忽略 */ }
      var p = workEl.play && workEl.play()
      if (p && typeof p.catch === 'function') p.catch(function () {})
      workEl.style.opacity = '1'
    }, ms)
  }

  function isSendButton(el) {
    var btn = el && el.closest ? el.closest('button, [role="button"]') : null
    if (!btn) return false
    if (btn.type === 'submit') return true
    var label = (btn.getAttribute('aria-label') || '') + ' ' + (btn.getAttribute('title') || '')
    return /发送|send/i.test(label)
  }

  function installSendWatch() {
    if (global.__DSVT_SEND_WATCH__ === true) return
    global.__DSVT_SEND_WATCH__ = true
    doc.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return
      var t = e.target
      if (t && (t.tagName === 'TEXTAREA' || t.isContentEditable)) resetWorkToStart()
    }, true)
    doc.addEventListener('click', function (e) {
      if (isSendButton(e.target)) resetWorkToStart()
    }, true)
  }

  // ────────────────────── 工具 ──────────────────────

  function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }
  function num(value, fb, lo, hi) {
    var n = typeof value === 'number' ? value : Number(value)
    if (n !== n) return fb
    if (n < lo) return lo
    if (n > hi) return hi
    return n
  }

  // 诊断用 API。
  global[NS] = {
    version: cfg.version || '0.1.0',
    config: cfg,
    state: {
      bootShown: function () { return !!bootEl },
      workStarted: function () { return workStarted },
    },
  }

  // 启动：能续播 work 就直接进背景；否则照常走开机动画。
  if (typeof doc.body === 'object' && doc.body !== null) {
    startBoot()
  } else if (doc.addEventListener) {
    doc.addEventListener('DOMContentLoaded', startBoot)
  }
})(typeof window !== 'undefined' ? window : this)

// ───── 玻璃调参面板（折叠版：默认只显示一个小圆点，点开才出滑条）─────
// 参数初值来自插件配置 __DSH_VIDEO_TRIO__.glass；拖动后存 localStorage 键 dsvt.glass，刷新后保持。
;(function (global) {
  'use strict'
  if (global.__DSVT_GLASS_STARTED__ === true) return
  if (typeof global.document !== 'object' || global.document === null) return
  global.__DSVT_GLASS_STARTED__ = true

  var doc = global.document
  var KEY = 'dsvt.glass'
  // 玻璃参数（键 → 默认值 / 滑条范围）。surface/sidebar 属 work 段，其余属 glass 段。
  var DEFAULTS = { blur: 4, alpha: 0.35, edge: 0.51, surface: 0.18, sidebar: 0.38 }
  var RANGES = {
    blur: { min: 0, max: 30, step: 1, label: '模糊强度 (px)' },
    alpha: { min: 0, max: 1, step: 0.01, label: '玻璃不透明度' },
    edge: { min: 0, max: 1, step: 0.01, label: '边缘高光' },
    surface: { min: 0, max: 1, step: 0.01, label: '框外背景不透明度' },
    sidebar: { min: 0, max: 1, step: 0.01, label: '对话栏遮挡' },
  }
  // 水波纹 / 发送回放参数（存在 KEY_FX 里，与玻璃参数分开）。
  var KEY_FX = 'dsvt.fx'
  var FX_DEFAULTS = {
    ripple: false, rippleStrength: 0.25, rippleRadius: 120, rippleSpeed: 240,
    rippleWidth: 3, rippleInterval: 60, resetOnSend: false, resetFadeMs: 600,
  }
  var FX_RANGES = {
    rippleStrength: { min: 0, max: 1, step: 0.01, label: '水波强度' },
    rippleRadius: { min: 20, max: 400, step: 1, label: '水波半径 (px)' },
    rippleSpeed: { min: 20, max: 1000, step: 1, label: '扩散速度 (px/s)' },
    rippleWidth: { min: 1, max: 12, step: 1, label: '水波线宽 (px)' },
    rippleInterval: { min: 16, max: 500, step: 1, label: '生成间隔 (ms)' },
    resetFadeMs: { min: 100, max: 3000, step: 50, label: '回放淡出 (ms)' },
  }
  var FX_TOGGLES = {
    ripple: '鼠标水波纹',
    resetOnSend: '发送时回到 work 起点',
  }

  function readSaved(key) {
    try {
      var raw = global.localStorage && global.localStorage.getItem(key)
      return raw ? JSON.parse(raw) : null
    } catch (e) { return null }
  }

  function loadState() {
    var out = {}
    var cfg = global.__DSH_VIDEO_TRIO__ && global.__DSH_VIDEO_TRIO__.glass
    var work = global.__DSH_VIDEO_TRIO__ && global.__DSH_VIDEO_TRIO__.work
    var saved = readSaved(KEY)
    for (var k in DEFAULTS) {
      var src = (k === 'surface' || k === 'sidebar') ? work : cfg
      var v = saved && typeof saved[k] === 'number' ? saved[k]
        : src && typeof src[k] === 'number' ? src[k] : DEFAULTS[k]
      out[k] = v
    }
    return out
  }

  function loadFx() {
    var cfgFx = (global.__DSH_VIDEO_TRIO__ && global.__DSH_VIDEO_TRIO__.fx) || {}
    var saved = readSaved(KEY_FX) || {}
    var out = {}
    for (var k in FX_DEFAULTS) {
      var fallback = typeof cfgFx[k] === typeof FX_DEFAULTS[k] ? cfgFx[k] : FX_DEFAULTS[k]
      out[k] = typeof saved[k] === typeof FX_DEFAULTS[k] ? saved[k] : fallback
    }
    return out
  }

  function saveState(state) {
    try { if (global.localStorage) global.localStorage.setItem(KEY, JSON.stringify(state)) } catch (e) { /* 忽略 */ }
  }
  function saveFx(fx) {
    try { if (global.localStorage) global.localStorage.setItem(KEY_FX, JSON.stringify(fx)) } catch (e) { /* 忽略 */ }
  }

  function applyState(state) {
    var root = doc.documentElement
    root.style.setProperty('--dsvt-glass-blur', state.blur + 'px')
    root.style.setProperty('--dsvt-glass-alpha', String(state.alpha))
    root.style.setProperty('--dsvt-glass-edge', String(state.edge))
    // surface 直接控制暗主题 body 表面（--dsw-alias-bg-base 的 alpha），即框外背景透视频的暗度。
    root.style.setProperty('--dsvt-surface', String(state.surface))
    // sidebar 单独控制左侧对话栏的遮挡透明度，与框外背景互不影响。
    root.style.setProperty('--dsvt-sidebar', String(state.sidebar))
  }

  function buildPanel(state, fx) {
    var toggle = doc.createElement('button')
    toggle.id = 'dsvt-glass-toggle'
    toggle.type = 'button'
    toggle.title = '玻璃效果参数'
    toggle.textContent = '◎'

    var panel = doc.createElement('div')
    panel.id = 'dsvt-glass-panel'
    panel.hidden = true

    var title = doc.createElement('div')
    title.textContent = '玻璃效果'
    title.style.fontWeight = '600'
    panel.appendChild(title)

    // 滑条按键名绑定，「恢复默认」用键名取值，不依赖 DOM 顺序。
    var sliders = {}
    function addSlider(store, rangeMap, key) {
      var r = rangeMap[key]
      var wrap = doc.createElement('label')
      var row = doc.createElement('div')
      row.className = 'dsvt-glass-row'
      var name = doc.createElement('span')
      name.textContent = r.label
      var val = doc.createElement('span')
      val.textContent = String(store[key])
      row.appendChild(name)
      row.appendChild(val)
      var input = doc.createElement('input')
      input.type = 'range'
      input.min = String(r.min)
      input.max = String(r.max)
      input.step = String(r.step)
      input.value = String(store[key])
      input.addEventListener('input', function () {
        store[key] = Number(input.value)
        val.textContent = String(store[key])
        onChange()
      })
      wrap.appendChild(row)
      wrap.appendChild(input)
      panel.appendChild(wrap)
      sliders[key] = { input: input, val: val }
    }

    var toggles = {}
    function addToggle(key, label) {
      var wrap = doc.createElement('label')
      wrap.className = 'dsvt-glass-row'
      var name = doc.createElement('span')
      name.textContent = label
      var box = doc.createElement('input')
      box.type = 'checkbox'
      box.checked = !!fx[key]
      box.addEventListener('change', function () {
        fx[key] = box.checked
        onChange()
        // 水波开关即时生效：关闭时立刻摘掉鼠标监听，不做任何计算。
        if (key === 'ripple' && typeof global.__DSVT_SET_RIPPLE__ === 'function') {
          global.__DSVT_SET_RIPPLE__(box.checked)
        }
      })
      wrap.appendChild(name)
      wrap.appendChild(box)
      panel.appendChild(wrap)
      toggles[key] = box
    }

    function onChange() {
      applyState(state)
      saveState(state)
      saveFx(fx)
      global.__DSVT_FX__ = fx
    }

    Object.keys(RANGES).forEach(function (key) { addSlider(state, RANGES, key) })

    var sep = doc.createElement('div')
    sep.textContent = '水波纹 / 发送回放'
    sep.style.marginTop = '10px'
    sep.style.fontWeight = '600'
    panel.appendChild(sep)

    Object.keys(FX_TOGGLES).forEach(function (key) { addToggle(key, FX_TOGGLES[key]) })
    Object.keys(FX_RANGES).forEach(function (key) { addSlider(fx, FX_RANGES, key) })

    var reset = doc.createElement('button')
    reset.type = 'button'
    reset.textContent = '恢复默认'
    reset.style.marginTop = '10px'
    reset.addEventListener('click', function () {
      Object.keys(DEFAULTS).forEach(function (k) { state[k] = DEFAULTS[k] })
      Object.keys(FX_DEFAULTS).forEach(function (k) { fx[k] = FX_DEFAULTS[k] })
      Object.keys(sliders).forEach(function (k) {
        var store = Object.prototype.hasOwnProperty.call(DEFAULTS, k) ? state : fx
        sliders[k].input.value = String(store[k])
        sliders[k].val.textContent = String(store[k])
      })
      Object.keys(toggles).forEach(function (k) { toggles[k].checked = !!fx[k] })
      onChange()
      if (typeof global.__DSVT_SET_RIPPLE__ === 'function') global.__DSVT_SET_RIPPLE__(!!fx.ripple)
    })
    panel.appendChild(reset)

    toggle.addEventListener('click', function () { panel.hidden = !panel.hidden })

    doc.body.appendChild(toggle)
    doc.body.appendChild(panel)
  }

  try {
    var state = loadState()
    var fx = loadFx()
    global.__DSVT_FX__ = fx
    applyState(state)
    if (doc.body) buildPanel(state, fx)
    else doc.addEventListener('DOMContentLoaded', function () { buildPanel(state, fx) })
  } catch (e) {
    /* 面板失败不影响 DSH */
  }
})(typeof window !== 'undefined' ? window : this)
