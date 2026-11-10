/**
 * 结构化索引注入行（`webserver/index-inject` 的贡献）。
 *
 * 注入契约（由 DSH 桌面壳页面侧解释器逐行应用）：
 *   ① 两个渲染器按数组顺序应用行（style 必须先于 script）；
 *   ② `kind:'script-src'` 在桌面壳上是 await loadScript(src)，失败即 reject，
 *      会把 __DSH_BOOT_READY__ 打掉 ⇒ 应用起不来。这里只用 `kind:'script'`；
 *   ③ style 永远进 head，script/html 按 placement 进。
 *
 * 这里只贡献两行，在同一 push 里保证相邻、顺序确定。
 */

/** 运行期脚本文本（手动读，避免 import 运行时模块）。 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.join(__dirname, '..')

/** 页面侧读取部署期配置用的全局名。 */
export const BOOTSTRAP_GLOBAL = '__DSH_VIDEO_TRIO__'

/** 把任意值序列化成内联 JSON（夹住 `</script`）。 */
function toInlineJson(value) {
  return JSON.stringify(value).replace(/<\//g, '<\\/')
}

/**
 * @param {{ clientConfig: Record<string, unknown>, cssText:string, jsText:string }} input
 * @returns {Array<Record<string, unknown>>}
 */
export function buildInjectionRows(input) {
  const bootstrap = `globalThis.${BOOTSTRAP_GLOBAL}=${toInlineJson(input.clientConfig)};`
  return [
    { kind: 'style', text: input.cssText },
    { kind: 'script', placement: 'body', text: `${bootstrap}\n${input.jsText}` },
  ]
}

/** 读 runtime 下某个文本文件（宿主收集注入行时用）。 */
export function readRuntimeText(name) {
  return fs.readFileSync(path.join(pkgRoot, 'runtime', name), 'utf8')
}