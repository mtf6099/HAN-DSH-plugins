/**
 * 各视频槽的「顺序/随机」选择与跨启动游标。
 *
 * 为什么状态不放在页面 localStorage：DSH 桌面端每次启动的 web 端口会变，
 * origin 一变 localStorage 就清空，顺序播放会永远从第 1 个重来。
 * 所以游标统一落在 `$DSH_HOME/dsh-video-trio.state.json`：
 *   { "playOrder": "sequence", "startIndex": 0, "exitIndex": 1, "updatedAt": "..." }
 *
 * start 在宿主 apply 时决定一次并写进注入配置（页面刷新也不会跳片）；
 * exit 在拉起伴随播放器时决定（真正要播的时候才推进游标）。
 */
import fs from 'node:fs'
import path from 'node:path'

/** 状态文件名（放在 DSH_HOME 下，跨重启保留）。 */
export const STATE_FILE_NAME = 'dsh-video-trio.state.json'

/** @param {string} file 状态文件绝对路径。 */
function readState(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** @param {string} file 状态文件绝对路径。 @param {Record<string, unknown>} state 新状态。 */
function writeState(file, state) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8')
  } catch {
    /* 状态写不进不影响本轮播放 */
  }
}

/**
 * @param {string|undefined} homeDir DSH_HOME。
 * @param {string} packageRoot 包根（没有 DSH_HOME 时的兜底）。
 * @returns {string} 状态文件路径。
 */
export function resolveExitStateFile(homeDir, packageRoot) {
  return homeDir ? path.join(homeDir, STATE_FILE_NAME) : path.join(packageRoot, '.dsh-video-trio.state.json')
}

/**
 * 选出某个槽本轮要播第几个，并把下一轮游标写回状态文件。
 * @param {number} count 该槽素材数量。
 * @param {'sequence'|'random'} playOrder 播放顺序。
 * @param {string} stateFile 状态文件。
 * @param {'start'|'exit'} slot 槽名（决定状态字段）。
 * @returns {number} 选中的下标；没有素材时返回 -1。
 */
export function chooseSlotIndex(count, playOrder, stateFile, slot) {
  if (!Number.isInteger(count) || count <= 0) return -1
  const state = readState(stateFile)
  const key = `${slot}Index`
  const last = Number.isInteger(state[key]) ? state[key] : -1
  let index
  if (playOrder === 'random') {
    index = Math.floor(Math.random() * count)
    // 多个素材时避免连续两轮抽中同一个。
    if (count > 1 && index === ((last % count) + count) % count) index = (index + 1) % count
  } else {
    index = last >= 0 ? (last + 1) % count : 0
  }
  writeState(stateFile, { ...state, [key]: index, playOrder })
  return index
}

/**
 * 把选中的文件排到列表最前；播放器仍按列表顺序回退，文件被删也不黑屏。
 * @template T
 * @param {T[]} list 原始列表。
 * @param {number} index 起始下标。
 * @returns {T[]} 旋转后的列表。
 */
export function rotateTo(list, index) {
  if (!Array.isArray(list) || list.length === 0) return []
  const n = list.length
  const i = Number.isInteger(index) && index >= 0 ? index % n : 0
  return list.slice(i).concat(list.slice(0, i))
}
