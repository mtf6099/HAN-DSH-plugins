# dsh-video-trio — 启动 / 工作 / 退出 三段视频皮肤

DSH 桌面端插件：在你放好的三个视频文件夹里，分别给你 **开机全屏视频**、**工作聊天背景**、**退出全屏视频**。三处共享同一套播放设置（顺序/随机），开机有可调大小和位置的「跳过按钮」，退出视频播完（或点一下）自动关。

本插件为独立实现，不依赖也不包含其他插件的代码。

## 三个素材文件夹

插件包内 `videos/` 下三个目录，把 mp4/webm/ogv 放进去即可（用户自己以后替换）：

| 目录 | 作用 | 当前测试文件 |
| --- | --- | --- |
| `videos/start/` | 启动时全屏播放（带声音，可跳过） | `start1.mp4` |
| `videos/work/` | 工作时作为聊天背景铺满视口循环；新开对话/刷新页面会从原位置继续，不从头重播 | `work1.mp4` |
| `videos/exit/` | 退出 DSH 后全屏播放（播完/点击关闭） | `exit1.mp4` |

> `start1.mp4` / `work1.mp4` / `exit1.mp4` 是**测试用占位素材**（来源需替换确认，见下方说明），
> 用它们验证可用性，之后你把自己的视频放进去替换即可（同名覆盖就行）。
> 每个目录下放多个文件时，按「顺序(sequence)」逐个循环，或「随机(random)」挑一个。

## 安装（已完成接线，待重启生效）

已把插件接线进 desktop profile：
- `node_modules/dsh-video-trio/`：指向开发目录 `<你的DSH开发目录>\dsh-video-trio` 的目录联接（junction），改代码/换视频即时同步
- `package.json`：dependencies 用 `link:../../../dsh-video-trio` + `dsh.profile.bundles` 加 `dsh-video-trio`
- 插件包自带 `cordis.patch.yml`（`dsh.bundle.patch`）负责插入 loader 行，**profile 自己的 cordis.patch.yml 不要再插一次**（重复 insert 会挂两份插件）

> 历史坑：旧接线是 `link:./node_modules/dsh-video-trio`（自己指向自己），
> pnpm 每次 install 都会报 `Symlink path is the same as the target path`
> 并把插件目录删进 `.ignored` —— 表现就是「视频突然全没了」。
> 现在依赖指向包外的开发目录，pnpm 不会再删它。

开机注入行是启动时快照，**装完必须完全重启 DSH 才生效**。重启后：
- 启动：出现全屏视频 + 右下角「点击跳过」，播完自动进界面
- 工作：聊天背景视频铺满视口，界面表面半透明可看到
- 退出：关掉 DSH 窗口即触发全屏退出视频（下次开机启动时那轮退出也生效）

## 配置文件

不改配置也能用默认值。想改时新建一个 JSON（两个位置都能读，叠加合并，越靠后优先级越高）：

1. 插件包内 `video-trio.config.json`（随包分发）
2. 数据根 `$DSH_HOME/dsh-video-trio.json`（推荐，改这里免动包内文件）

```json
{
  "playOrder": "sequence",
  "skipButton": {
    "show": true,
    "anchor": "right",
    "offset": 3,
    "vertical": "bottom",
    "verticalOffset": 5,
    "fontRatio": 1,
    "label": "点击跳过"
  },
  "start": { "enabled": true, "sound": true, "fadeMs": 900, "hint": "正在启动…", "dirName": "start" },
  "work": {
    "enabled": true,
    "muted": true,
    "veil": 0.04,
    "surface": 0.18,
    "surfaceLight": 0.18,
    "sidebar": 0.38,
    "delayMs": 1200,
    "playbackRate": 1,
    "dirName": "work"
  },
  "glass": {
    "blur": 4,
    "alpha": 0.35,
    "edge": 0.51
  },
  "exit": { "enabled": true, "muted": false, "fadeMs": 700, "hint": "再见~", "dirName": "exit" }
}
```

### 字段说明

| 字段 | 取值 | 说明 |
| --- | --- | --- |
| `playOrder` | `sequence`/`random` | 三处共享的播放顺序；多个视频时逐个播放或随机挑 |
| `skipButton.show` | bool | 启动/退出的「跳过按钮」是否显示 |
| `skipButton.anchor` | `left`/`center`/`right` | 按钮水平位置 |
| `skipButton.offset` | 0–40 (%) | 按钮距水平边的距离 |
| `skipButton.vertical` | `top`/`bottom` | 按钮垂直位置 |
| `skipButton.verticalOffset` | 0–40 (%) | 按钮距上/下边的距离 |
| `skipButton.fontRatio` | 0.6–3 | 按钮大小倍数（字体/内边距等比） |
| `skipButton.label` | string | 按钮文字 |
| `start.sound` | bool | 开机视频是否带声音 |
| `start.fadeMs` | 200–6000 | 开机视频点击跳过后的淡出毫秒 |
| `start.hint` | string | 开机画面底部提示 |
| `work.muted` | bool | 背景是否静音 |
| `work.veil` | 0–0.92 | 暗主题背景蒙版透明度 |
| `work.surface` | 0–1 | 框外背景不透明度（暗主题）：背景视频之上的近黑底色。0=全透、视频满亮，越大越暗。GUI 面板「框外背景不透明度」 |
| `work.surfaceLight` | 0–1 | 亮主题界面表面不透明度。默认跟随 `work.surface`（即 0），不再额外加亮度 |
| `work.sidebar` | 0–1 | 左侧对话栏遮挡不透明度。0=全透，独立于框外背景。GUI 面板「对话栏遮挡」 |
| `work.delayMs` | 0–60000 | 界面就绪后延迟加载背景（ms） |
| `work.playbackRate` | 0.25–4 | 背景播放速度 |
| `glass.blur` | 0–30 | 玻璃模糊强度（px） |
| `glass.alpha` | 0–1 | 玻璃底色不透明度（越小越透、越能看到背景视频；默认 0.35） |
| `glass.edge` | 0–1 | 玻璃边缘高光不透明度 |
| `exit.muted` | bool | 退出视频是否静音 |
| `exit.fadeMs` | 200–6000 | 退出视频播放完成的淡出 |
| `exit.hint` | string | 退出画面提示 |
| 各 `dirName` | string | 对应素材子目录名（默认 `start`/`work`/`exit`），可自定义但必须留在 `videos/` 内 |

改完 JSON **重启 DSH 生效**（注入行是启动快照）；或刷新页面（桌面壳一般无刷新路径，最稳是重启）。

## 玻璃调参面板（GUI）

桌面 DSH 右下角有一个 **◎** 圆点，点开是「玻璃效果」面板，共 5 个滑条：

| 滑条 | 对应配置 | 默认 | 作用 |
| --- | --- | --- | --- |
| 模糊强度 (px) | `glass.blur` | 4 | 对话气泡/输入框/AI 回复的毛玻璃模糊 |
| 玻璃不透明度 | `glass.alpha` | 0.35 | 上述玻璃底色的不透明度，越小越能看到背景视频 |
| 边缘高光 | `glass.edge` | 0.51 | 玻璃边缘高光 |
| 框外背景不透明度 | `work.surface` | 0.18 | 框外背景（暗主题）的压暗程度，0=视频满亮 |
| 对话栏遮挡 | `work.sidebar` | 0.38 | 左侧对话栏的遮挡，0=全透 |

- 拖动后立即生效，并保存到浏览器本地存储（键 `dsvt.glass`），重启 DSH 后保持。
- 「恢复默认」会把 5 个滑条都复位到上表默认值。
- **注意**：保存的值优先于 JSON 配置与代码里的新默认值。改了默认后，如果面板数值不对，点「恢复默认」即可；或在开发者控制台执行 `localStorage.removeItem('dsvt.glass')` 后重启。

## 水波纹与发送回放（GUI 可调）

玻璃面板里新增「水波纹 / 发送回放」区域：

| 控件 | 默认 | 作用 |
| --- | --- | --- |
| 鼠标水波纹（开关） | 关 | 鼠标在界面上移动时，在指针处生成向外扩散的水波环（画在背景视频之上、界面之下，不挡点击）。**关闭时不挂载鼠标监听、不做任何计算，节省性能** |
| 水波强度 | 0.25 | 水波环的亮度，越大越明显 |
| 水波半径 (px) | 120 | 单个水波扩散到的最大半径 |
| 扩散速度 (px/s) | 240 | 水波向外扩散的速度 |
| 水波线宽 (px) | 3 | 水波环的粗细 |
| 生成间隔 (ms) | 60 | 鼠标移动时最短多久生成一圈，越小越密 |
| 发送时回到 work 起点（开关） | 关 | 开启后，每次在输入框回车或点击发送，work 背景视频淡出、回到当前片的起点，再淡入重新播放 |
| 回放淡出 (ms) | 600 | 上面那个回放动作的淡出/淡入时长 |

- 这两组参数分开保存（键 `dsvt.fx`），拖动后即时生效，「恢复默认」会一并复位。
- 配置文件里对应的是 `fx` 段（`ripple`、`rippleStrength`、`rippleRadius`、`rippleSpeed`、`rippleWidth`、`rippleInterval`、`resetOnSend`、`resetFadeMs`），面板的保存值优先于配置。
- 系统开启「减少动态效果」时，水波纹不绘制、背景视频也不播放。

> **注意（未实机验证）**：发送回放靠「输入框回车」或「带 send/发送 文字或 submit 类型的按钮」来识别发送动作。DSH 界面的发送按钮具体 DOM 结构未经实机核对，若点击发送按钮没有触发回放，请告知，我再按实际 DOM 调整选择器。

## 已知问题

- **退出视频（exit）播放出错**：当前版本的退出视频在部分情况下无法正常播放，已确认存在，暂不修复。
  - 退出视频由独立的伴随进程 `scripts/exit-player.ps1` 负责，与前端注入无关；问题可能出在该脚本的播放或素材路径环节。
  - 暂时的规避方式：把 `exit` 相关配置设为 `"enabled": false` 即可关闭退出视频，不影响启动与工作背景。
  - 后续修复时再排查。

## 退出视频的实现原理

启动全屏和聊天背景靠注入前端的 `<style>`+`<script>` 就能实现（页面加载时挂上去）。
但**退出视频没法靠前端**：窗口一关渲染进程就销毁了，前端的「beforeunload」拦不住整个应用退出。
所以退出用了**伴随进程**方案：

- DSH 启动时，插件通过 `child_process.spawn` 拉起的 detached PowerShell 脚本 `scripts/exit-player.ps1`，把 DSH 主进程 PID 和 exit 视频列表传给它。
- 脚本后台静默轮询 `Get-Process` 确认 DSH 主进程是否还活着（每 800ms）。
- DSH 彻底退出后，脚本弹一个 WPF `MediaElement` 全屏无边框置顶窗口播放退出视频，播完或任意键/鼠标点击即退出整个脚本进程。

这样窗口最小化、登录/关机前都能看见退出视频。

> **关键实现约束**：退出播放器靠「轮询到 DSH PID 消失」来自动终止，所以**绝不能在 DSH 退出的清理流程里 kill 它**（否则退出视频永远不会出现）。只有启动新 watcher 去重时才会停掉旧的。

## 已知修复

- **启动读完自动进入**：start 视频播完（`ended`）自动淡出转场进入应用，不必再点跳过；有 `timeupdate` 兜底防个别浏览器不触发 ended。
- **work 背景铺满**：`object-fit: cover !important` + 强制 `width/height: 100%`，防止主题样式覆盖导致视频留黑边。
- **右键任务栏退出无动画**：修复了「应用退出清理时把退出播放器提前 kill 掉」的 bug，退出视频现在能在任何退出方式下弹出。

## 自检

开发目录 `<你的DSH开发目录>\dsh-video-trio\` 下有两个自检脚本（`node` 运行）：

```
node scripts/sanity.mjs        # 配置层：三区素材/路由/跳过按钮解析
node scripts/route-sanity.mjs  # 路由自检：/config + /media 的 200/206/404（含 Range）
```

均输出 `ALL OK` / N passed 即通过。退出播放器脚本语法用 PowerShell 解析器校验过（PS1 SYNTAX OK）。
真机退出效果需重启 DSH 才能见到（前端注入是启动快照）。

## 开发目录 vs 已装副本

- 开发目录（源）：`<你的DSH开发目录>\dsh-video-trio\`
- 已装副本（desktop 加载的是它）：`$DSH_HOME\profiles\desktop\node_modules\dsh-video-trio\`

改代码/素材后要同步到已装副本再重启才生效：
```
Copy-Item "<你的DSH开发目录>\dsh-video-trio\*" "$DSH_HOME\profiles\desktop\node_modules\dsh-video-trio\" -Recurse -Force
```

## 公开仓库发布说明

本目录 **不在** 任何 git 仓库中（首次发布前需 `git init` 在本目录根执行）。`.gitignore` 已排除：
- `videos/*/*.mp4`：测试占位视频，不随仓库发布，用户自行放入即可；
- `*.bak*`：开发备份文件；
- `.dsh-meow/`：本地记忆库与会话缓存；
- `.tmp-smoke/`：临时冒烟目录。

注意：记忆备份仓库（`<你的记忆备份仓库路径>`）只备份记忆与插件清单，**不包含插件源码**，本插件请单独提交到自己的公开仓库。

## 卸载 / 回退

备份在 `package.json.bak-video-trio-*` 与 `cordis.patch.yml.bak-video-trio-*`（同目录）。卸载=从这三处还原即可：
1. 删 desktop `node_modules/dsh-video-trio/`
2. `package.json`：去掉 `dsh-video-trio` 的 dependencies 与 bundles 两项
3. `cordis.patch.yml`：删掉追加的 insert 段
4. 重启 DSH