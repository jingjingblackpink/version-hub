<#
  publish.ps1 —— 一键把后台导出的数据文件发布到 GitHub
  --------------------------------------------------------
  用法：双击仓库根目录的「发布数据.bat」，或在 PowerShell 里执行：
      powershell -ExecutionPolicy Bypass -File tools\publish.ps1

  它会自动：
    1. 在「下载」文件夹里找到最新的 versions.json / versions.js
    2. 复制到 data\ 目录（覆盖前显示变更摘要）
    3. git add / commit / push
    4. 提示 GitHub Pages 重新构建的等待时间

  也可以加参数：
      -SkipDownload   跳过从下载目录复制，直接提交 data\ 里现有的文件
      -Message "xxx"  自定义提交说明
#>

param(
  [switch]$SkipDownload,
  [string]$Message = ""
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$RepoRoot = Split-Path -Parent $PSScriptRoot
$DataDir  = Join-Path $RepoRoot 'data'
$JsonPath = Join-Path $DataDir 'versions.json'
$JsPath   = Join-Path $DataDir 'versions.js'
$PagesUrl = 'https://jingjingblackpink.github.io/version-hub/'

function Write-Step($t) { Write-Host ""; Write-Host "==> $t" -ForegroundColor Cyan }
function Write-Ok($t)   { Write-Host "    [OK] $t" -ForegroundColor Green }
function Write-Warn2($t){ Write-Host "    [!!] $t" -ForegroundColor Yellow }
function Write-Err($t)  { Write-Host "    [XX] $t" -ForegroundColor Red }

Set-Location $RepoRoot

Write-Host ""
Write-Host "  软件版本信息微站 · 数据发布工具" -ForegroundColor Magenta
Write-Host "  仓库: $RepoRoot" -ForegroundColor DarkGray

# ---------- 0. 前置检查 ----------
Write-Step "检查环境"
foreach ($cmd in @('git')) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Err "找不到 $cmd，请先安装 Git"; exit 1
  }
}
if (-not (Test-Path (Join-Path $RepoRoot '.git'))) {
  Write-Err "当前目录不是 git 仓库"; exit 1
}
$remote = (git remote get-url origin 2>$null)
if (-not $remote) { Write-Err "没有配置 origin 远程"; exit 1 }
Write-Ok "git 就绪，远程 = $remote"

# ---------- 1. 从下载目录取最新导出文件 ----------
if (-not $SkipDownload) {
  Write-Step "在「下载」文件夹查找导出文件"
  $dl = [Environment]::GetFolderPath('UserProfile') + '\Downloads'
  if (-not (Test-Path $dl)) { $dl = "$env:USERPROFILE\Downloads" }

  $jsonSrc = Get-ChildItem -Path $dl -Filter 'versions*.json' -File -ErrorAction SilentlyContinue |
             Sort-Object LastWriteTime -Descending | Select-Object -First 1
  $jsSrc   = Get-ChildItem -Path $dl -Filter 'versions*.js' -File -ErrorAction SilentlyContinue |
             Sort-Object LastWriteTime -Descending | Select-Object -First 1

  if (-not $jsonSrc) {
    Write-Warn2 "下载目录没找到 versions*.json"
    Write-Host "    请先在后台点「导出 -> 导出发布文件（JSON + JS）」，再重新运行本脚本。" -ForegroundColor Yellow
    Write-Host "    或者用 -SkipDownload 参数直接提交 data\ 里已有的文件。" -ForegroundColor Yellow
    exit 1
  }
  Write-Ok "找到 JSON: $($jsonSrc.Name)  ($($jsonSrc.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')))"
  if ($jsSrc) { Write-Ok "找到 JS  : $($jsSrc.Name)  ($($jsSrc.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')))" }
  else { Write-Warn2 "没找到 versions*.js —— 本地双击预览会读不到新数据（线上不受影响）" }

  # 变更摘要
  Write-Step "对比变更"
  $before = $null
  if (Test-Path $JsonPath) {
    try { $before = (Get-Content $JsonPath -Raw -Encoding UTF8 | ConvertFrom-Json) } catch {}
  }
  try { $after = (Get-Content $jsonSrc.FullName -Raw -Encoding UTF8 | ConvertFrom-Json) }
  catch { Write-Err "导出的 JSON 无法解析，文件可能损坏：$($_.Exception.Message)"; exit 1 }

  function Count-Releases($db) {
    if (-not $db -or -not $db.projects) { return 0 }
    $n = 0; foreach ($p in $db.projects) { if ($p.releases) { $n += @($p.releases).Count } }; return $n
  }
  $bp = if ($before) { @($before.projects).Count } else { 0 }
  $br = Count-Releases $before
  $ap = @($after.projects).Count
  $ar = Count-Releases $after
  Write-Host "    发布前: $bp 个项目 / $br 个版本"
  Write-Host "    发布后: $ap 个项目 / $ar 个版本" -ForegroundColor Green
  if ($ar -lt $br) {
    Write-Warn2 "版本数变少了（$br -> $ar），请确认这是你想要的"
    $ans = Read-Host "    仍要继续吗？(y/N)"
    if ($ans -ne 'y' -and $ans -ne 'Y') { Write-Host "    已取消。"; exit 0 }
  }

  Copy-Item $jsonSrc.FullName $JsonPath -Force
  Write-Ok "已复制 -> data\versions.json"
  if ($jsSrc) {
    Copy-Item $jsSrc.FullName $JsPath -Force
    Write-Ok "已复制 -> data\versions.js"
  }
} else {
  Write-Step "跳过下载目录（-SkipDownload）"
  if (-not (Test-Path $JsonPath)) { Write-Err "data\versions.json 不存在"; exit 1 }
  Write-Ok "将直接提交 data\ 目录现有内容"
}

# ---------- 2. 提交并推送 ----------
Write-Step "提交到 git"
git add data/ 2>&1 | Out-Null
$status = git status --porcelain 2>&1
if (-not $status) {
  Write-Warn2 "数据没有变化，无需提交"
  Write-Host ""; Write-Host "  线上数据已是最新：$PagesUrl" -ForegroundColor Green; Write-Host ""
  exit 0
}
$status | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }

if (-not $Message) {
  $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
  $Message = "chore(data): 更新版本数据 @ $stamp"
}
git commit -q -m $Message 2>&1 | Out-Null
Write-Ok "已提交：$Message"

Write-Step "推送到 GitHub"
$pushOut = git push origin HEAD 2>&1
$pushOut | ForEach-Object { Write-Host "    $($_ -replace 'github_pat_[A-Za-z0-9_]+','***')" -ForegroundColor DarkGray }
if ($LASTEXITCODE -ne 0) {
  Write-Err "推送失败。常见原因：token 权限不足、网络问题、远程有新提交"
  Write-Host "    可先执行 git pull --rebase origin main 再重试" -ForegroundColor Yellow
  exit 1
}
Write-Ok "推送成功"

# ---------- 3. 完成 ----------
$head = git rev-parse --short HEAD 2>&1
Write-Host ""
Write-Host "  ✓ 发布完成" -ForegroundColor Green
Write-Host "    提交号 : $head"
Write-Host "    项目数 : $ap   版本数 : $ar"
Write-Host "    站点   : $PagesUrl"
Write-Host "    说明   : GitHub Pages 需 1~2 分钟重新构建，之后客户端刷新即可看到新数据"
Write-Host "             浏览器若有缓存，请按 Ctrl+F5 强制刷新"
Write-Host ""
Read-Host "按回车键关闭窗口"
