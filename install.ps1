<#
  大肥鱼 · Aurabot 模块 一键安装
  ------------------------------------------------------------------
  用法（在仓库根目录）：
    powershell -ExecutionPolicy Bypass -File install.ps1
    powershell -ExecutionPolicy Bypass -File install.ps1 -ModulesDir "D:\Aurobot\data\modules"
    powershell -ExecutionPolicy Bypass -File install.ps1 -DryRun     # 只检查，不动文件
  做的事：
    1. 找到 Aurabot 的 data/modules 目录（找不到就让你用 -ModulesDir 指）
    2. 把 modules/* 拷进去（已存在的默认跳过，加 -Force 才覆盖）
    3. 检查依赖：TTS 引擎 / 模型 / 音色 / ffmpeg / 梗词库 / node，缺什么直接告诉你
#>
param(
  [string]$ModulesDir = "",
  [switch]$Force,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$repo = $PSScriptRoot
$src = Join-Path $repo "modules"
if (-not (Test-Path -LiteralPath $src)) { throw "找不到 modules 目录：$src" }

function Test-Path2($p) {
  if (-not $p) { return $false }
  try { return Test-Path -LiteralPath $p } catch { return $false }
}

function Find-AurabotData {
  $cands = @()
  if ($env:DAFEIYU_DATA_DIR) { $cands += $env:DAFEIYU_DATA_DIR }
  if ($env:AURABOT_DATA) { $cands += $env:AURABOT_DATA }
  if ($env:USERPROFILE) { $cands += (Join-Path $env:USERPROFILE ".dsh\plugins-data\aurabot") }
  if ($env:DSH_HOME) { $cands += (Join-Path $env:DSH_HOME "plugins-data\aurabot") }
  $cands += "C:\Aurobot\data", "D:\Aurobot\data", "E:\Aurobot\data"
  foreach ($c in $cands) { if (Test-Path2 (Join-Path $c "modules")) { return $c } }
  return ""
}

function New-Check($name, $path, $hint) {
  $ok = Test-Path2 $path
  [pscustomobject]@{
    项目 = $name
    结果 = $(if ($ok) { "OK" } else { "缺" })
    路径 = $(if ($path) { $path } else { "(没找到)" })
    提示 = $(if ($ok) { "" } else { $hint })
  }
}

Write-Host "== 大肥鱼 Aurabot 模块 安装 ==" -ForegroundColor Cyan

# ---------- 1. 找目标目录 ----------
if (-not $ModulesDir) {
  $data = Find-AurabotData
  if ($data) {
    $ModulesDir = Join-Path $data "modules"
    Write-Host "[1/3] Aurabot data 目录：$data"
  } else {
    Write-Host "[1/3] 没找到 Aurabot 的 data 目录" -ForegroundColor Red
    Write-Host '      请用参数指定，例如：'
    Write-Host '      powershell -File install.ps1 -ModulesDir "D:\Aurobot\data\modules"'
    exit 2
  }
} else {
  if (-not (Test-Path2 $ModulesDir)) {
    Write-Host "[1/3] 目录不存在：$ModulesDir" -ForegroundColor Red
    exit 2
  }
  Write-Host "[1/3] 目标目录：$ModulesDir"
}

# ---------- 2. 拷模块 ----------
$list = Get-ChildItem -LiteralPath $src -Directory | Sort-Object Name
$copied = 0; $skipped = 0
Write-Host "[2/3] 模块 $($list.Count) 个"
foreach ($m in $list) {
  $dst = Join-Path $ModulesDir $m.Name
  if ((Test-Path2 $dst) -and (-not $Force)) {
    Write-Host ("      - {0,-22} 已存在，跳过（加 -Force 覆盖）" -f $m.Name) -ForegroundColor DarkYellow
    $skipped++
    continue
  }
  if ($DryRun) {
    Write-Host ("      - {0,-22} 会拷进去" -f $m.Name)
    $copied++
    continue
  }
  if (Test-Path2 $dst) { Remove-Item -LiteralPath $dst -Recurse -Force }
  Copy-Item -LiteralPath $m.FullName -Destination $dst -Recurse -Force
  Write-Host ("      - {0,-22} 已拷入" -f $m.Name) -ForegroundColor Green
  $copied++
}
Write-Host ("      共 {0} 个写入 / {1} 个跳过" -f $copied, $skipped)

# ---------- 3. 检查依赖 ----------
$dataDir = Split-Path -Parent $ModulesDir
$dsh = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE ".dsh" }

$breezeHomes = @()
if ($env:DAFEIYU_BREEZE_HOME) { $breezeHomes += $env:DAFEIYU_BREEZE_HOME }
if ($dataDir) { $breezeHomes += (Join-Path $dataDir "breeze-tts2"); $breezeHomes += (Join-Path $dataDir "breeze-tts-2") }
$breezeHomes += (Join-Path $dsh "plugins-data\aurabot\breeze-tts2")
$breezeHomes += "C:\breeze-tts2"

$breezeHome = ""
$breezeCli = ""
foreach ($h in $breezeHomes) {
  $binDir = Join-Path $h "bin"
  if (-not (Test-Path2 $binDir)) { continue }
  $cand = Get-ChildItem -LiteralPath $binDir -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName "breeze-cli.exe" } |
    Where-Object { Test-Path2 $_ } | Select-Object -First 1
  if ($cand) { $breezeHome = $h; $breezeCli = $cand; break }
  if (Test-Path2 (Join-Path $binDir "breeze-cli.exe")) { $breezeHome = $h; $breezeCli = (Join-Path $binDir "breeze-cli.exe"); break }
}

$ffmpeg = ""
if (Test-Path2 (Join-Path $dsh "douyin-studio\bin\ffmpeg.exe")) { $ffmpeg = Join-Path $dsh "douyin-studio\bin\ffmpeg.exe" }
else {
  $cmd = Get-Command ffmpeg -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($cmd) { $ffmpeg = $cmd.Source }
}

$nodeExe = ""
$nodeCands = @()
$nodeCands += "E:\SnowLuma\node.exe"
$ncmd = Get-Command node -ErrorAction SilentlyContinue | Select-Object -First 1
if ($ncmd) { $nodeCands += $ncmd.Source }
foreach ($n in $nodeCands) { if (Test-Path2 $n) { $nodeExe = $n; break } }

$checks = @(
  (New-Check "Breeze TTS 引擎" $breezeCli "装 Breeze TTS 2（breeze-cli.exe），或设 DAFEIYU_BREEZE_HOME")
  (New-Check "TTS 模型(q8)" $(if ($breezeHome) { Join-Path $breezeHome "models\breeze-tts-2-q8_0.gguf" }) "下载 q8_0 权重放进 models/")
  (New-Check "音色目录" $(if ($breezeHome) { Join-Path $breezeHome "voices" }) "放一个 .breeze 音色文件（自己克隆或找作者要）")
  (New-Check "ffmpeg" $ffmpeg "装 ffmpeg 并加进 PATH，或放到 douyin-studio\bin\")
  (New-Check "梗词库 memes.db" (Join-Path $dsh "profiles\desktop\node_modules\dsh-memewiki\data\memes.db") "装 DSH 梗百科插件 dsh-memewiki（qq-memewiki 只读它的词库）")
  (New-Check "node.exe(解 zstd)" $nodeExe "装 Node.js（dsh-memory-bridge 用它解会话文件）")
  (New-Check "视频工厂目录" (Join-Path $dsh "douyin-studio\memory") "装 dsh-douyin-studio（只有抖音素材同步需要）")
)

Write-Host "[3/3] 依赖检查"
foreach ($c in $checks) {
  if ($c.结果 -eq "OK") { Write-Host ("      OK  {0,-18} {1}" -f $c.项目, $c.路径) -ForegroundColor Green }
  else { Write-Host ("      缺  {0,-18} {1}" -f $c.项目, $c.路径) -ForegroundColor Yellow }
  if ($c.提示) { Write-Host ("          → " + $c.提示) -ForegroundColor DarkGray }
}

$missing = @($checks | Where-Object { $_.结果 -ne "OK" })
Write-Host ""
if ($DryRun) { Write-Host "（-DryRun：只检查，没有改动任何文件）" -ForegroundColor DarkGray }
if ($missing.Count -eq 0) {
  Write-Host "全部就绪。重启 Aurabot（或在面板重载模块），看日志里有没有各模块的启动行。" -ForegroundColor Green
} else {
  Write-Host ("还缺 {0} 项，先把上面标「缺」的装上，再重启 Aurabot。缺也不影响其它模块，对应功能会自己跳过。" -f $missing.Count) -ForegroundColor Yellow
}
Write-Host "路径要手工指定时：设环境变量 DAFEIYU_DATA_DIR / DAFEIYU_BREEZE_HOME，或改 modules-data\voice\backend.json。"
