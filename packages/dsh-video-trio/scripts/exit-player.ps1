<#
.SYNOPSIS
  dsh-video-trio 退出视频播放器（纯 WPF / MediaElement）。

.DESCRIPTION
  由插件的伴随进程机制拉起（detached + 独立 stdio），所以不随 DSH 退出。
  它先静默轮询 DSH 主进程 PID；一旦 DSH 退出（PID 消失）就弹出一个无边框、
  置顶、全屏的窗口播放 exit/ 文件夹里的视频，播完或任意键/鼠标点击再退出。

  只依赖系统自带 .NET / WPF（MediaElement 走 Windows Media Foundation），
  不依赖任何第三方播放器。mp4 H.264 普遍支持。

  参数：
    -Config <json>      直接传 JSON（兼容旧调用；路径反斜杠易被 Windows argv 改写）
    -ConfigFile <path>  从 UTF-8 JSON 文件读取（推荐；宿主实际使用这条）
#>
param(
  [string]$Config,
  [string]$ConfigFile
)

$ErrorActionPreference = 'SilentlyContinue'
try {
  if ($ConfigFile) {
    $cfg = Get-Content -LiteralPath $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
  } elseif ($Config) {
    $cfg = $Config | ConvertFrom-Json
  } else {
    exit 1
  }
} catch { exit 1 }
if ($null -eq $cfg) { exit 1 }
# 配置只读一次，删掉避免 %TEMP% 里越积越多。
if ($ConfigFile) { Remove-Item -LiteralPath $ConfigFile -Force -ErrorAction SilentlyContinue }

$script:parentPid = [int]$cfg.parent
$script:files = @($cfg.files)
if ($null -ne $cfg.fadeMs) { $script:fadeMs = [int]$cfg.fadeMs } else { $script:fadeMs = 700 }
$script:muted = $false
if ($null -ne $cfg.muted) { $script:muted = [bool]$cfg.muted }
if ($null -ne $cfg.hint) { $script:hint = [string]$cfg.hint } else { $script:hint = '再见~' }

if ($script:files.Count -eq 0) { exit 0 }

# ─────────────────── 监视 DSH 主进程 PID ───────────────────
function Test-ProcessAlive([int]$procId_) {
  if ($procId_ -le 0) { return $false }
  try {
    $null = Get-Process -Id $procId_ -ErrorAction Stop
    return $true
  } catch { return $false }
}

while (Test-ProcessAlive $script:parentPid) {
  Start-Sleep -Milliseconds 800
}

# DSH 已退出 —— 挑一个存在的视频，全屏播。
Add-Type -AssemblyName PresentationFramework

$videoPath = $script:files | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $videoPath) { exit 0 }
$uri = (Get-Item -LiteralPath $videoPath).FullName

$window = New-Object System.Windows.Window
$window.Title = 'dsh-video-trio exit'
$window.WindowStyle = [System.Windows.WindowStyle]::None
$window.WindowState = [System.Windows.WindowState]::Maximized
$window.Topmost = $true
$window.Background = [System.Windows.Media.Brushes]::Black
$window.ResizeMode = 'NoResize'
$window.ShowInTaskbar = $false

$player = New-Object System.Windows.Controls.MediaElement
$player.Source = (New-Object System.Uri($uri, [System.UriKind]::Absolute))
$player.LoadedBehavior = [System.Windows.Controls.MediaState]::Manual
$player.Stretch = [System.Windows.Media.Stretch]::UniformToFill
$player.IsHitTestVisible = $false
if ($script:muted) { $player.Volume = 0 } else { $player.Volume = 1 }

$txt = New-Object System.Windows.Controls.TextBlock
$txt.Text = $script:hint
$txt.Foreground = [System.Windows.Media.Brushes]::White
$txt.FontSize = 17
$txt.HorizontalAlignment = 'Center'
$txt.VerticalAlignment = 'Bottom'
$txt.Margin = '0,0,0,44'
$shadow = New-Object System.Windows.Media.DropShadowEffect
$shadow.ShadowDepth = 1
$shadow.BlurRadius = 8
$shadow.Color = [System.Windows.Media.Colors]::Black
$txt.Effect = $shadow

$grid = New-Object System.Windows.Controls.Grid
$grid.Children.Add($player) | Out-Null
$grid.Children.Add($txt) | Out-Null
$window.Content = $grid

$script:win = $window
$window.Add_KeyDown({ $script:win.Close() })
$window.Add_MouseLeftButtonDown({ $script:win.Close() })
$player.Add_MediaEnded({ $script:win.Close() })
# 素材损坏/编码不支持时 MediaEnded 永远不会来，必须靠 MediaFailed 收场，
# 否则会留下一块置顶全屏黑窗挡住整个桌面。
$player.Add_MediaFailed({ $script:win.Close() })

# 兜底保险：哪怕媒体既不结束也不报错（驱动/解码器卡死），10 分钟后也关窗。
$script:guard = New-Object System.Windows.Threading.DispatcherTimer
$script:guard.Interval = [TimeSpan]::FromMinutes(10)
$script:guard.Add_Tick({
  $script:guard.Stop()
  if ($script:win) { $script:win.Close() }
})
$script:guard.Start()

try { $player.Play() } catch { $window.Close() }

$window.ShowDialog()
if ($script:guard) { $script:guard.Stop() }