# ============================================================
# anime-tracker 本地爬虫一键脚本（国内 IP，数据准确）
# 用途：每天由 Windows 任务计划在 12:00 触发（错过则开机补跑）
# 流程：跑 4 个爬虫 -> commit -> pull(rebase) -> push（覆盖 GHA 兜底数据）
# ============================================================

$ErrorActionPreference = "Continue"

# --- 统一编码为 UTF-8（解决中文日志乱码 + 子进程输出乱码）---
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [Console]::InputEncoding  = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
    $env:PYTHONIOENCODING = "utf-8"
    chcp 65001 | Out-Null
} catch {}

# --- 配置 ---
$ProjectDir = "C:\Users\dylanynsu\WorkBuddy\2026-06-04-12-43-06\anime-tracker-demo"
$NodeExe    = "C:\Users\dylanynsu\.workbuddy\binaries\node\versions\22.22.2\node.exe"
$LogDir     = Join-Path $ProjectDir "logs"
$Stamp      = Get-Date -Format "yyyy-MM-dd_HHmmss"

# 先进项目目录
Set-Location $ProjectDir

# node 兜底
if (-not (Test-Path $NodeExe)) { $NodeExe = "node" }

# 建日志目录（必须在写日志前）
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}
$LogFile = Join-Path $LogDir "local-run_$Stamp.log"

function Log($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg
    Write-Output $line
    # 用 .NET 无 BOM UTF-8 追加写，避免 PS5.1 的 BOM + GBK 乱码
    try { [System.IO.File]::AppendAllText($LogFile, $line + "`r`n", (New-Object System.Text.UTF8Encoding($false))) } catch {}
}

Log "===== anime-tracker 本地爬虫开始 ====="
Log "node = $NodeExe"

# --- 1. 串行跑 4 个爬虫（先抓数据）---
$scrapers = @("bili", "tencent", "youku", "iqiyi")
foreach ($s in $scrapers) {
    Log "---- 跑 $s ----"
    & $NodeExe "scrapers\$s.js" 2>&1 | ForEach-Object { Log "  $_" }
    if ($LASTEXITCODE -eq 0) { Log "  [$s] OK" } else { Log "  [$s] 退出码=$LASTEXITCODE" }
}

# --- 2. 先 commit 本地数据（避免 pull rebase 时 unstaged 报错）---
Log "git add & commit..."
git add data/ 2>&1 | Out-Null
$dateStr = Get-Date -Format "yyyy-MM-dd HH:mm"
$commitOut = git commit -m "data update (local accurate): $dateStr" 2>&1
$commitOut | ForEach-Object { Log "  $_" }

# --- 3. pull --rebase 合并远端（GHA 可能也 push 了）---
Log "git pull --rebase..."
git pull --rebase origin main --strategy-option=ours 2>&1 | ForEach-Object { Log "  $_" }

# --- 4. push（重试 3 次）---
Log "git push..."
$pushed = $false
for ($i = 1; $i -le 3; $i++) {
    git push 2>&1 | ForEach-Object { Log "  $_" }
    if ($LASTEXITCODE -eq 0) { $pushed = $true; break }
    Log "  push 失败，重试 $i..."
    git pull --rebase origin main --strategy-option=ours 2>&1 | ForEach-Object { Log "  $_" }
    Start-Sleep -Seconds 2
}

if ($pushed) { Log "===== 完成：数据已推送 GitHub =====" }
else { Log "===== 警告：push 失败，数据已在本地 commit，下次会重试 =====" }

# --- 5. 清理 30 天前的日志 ---
if (Test-Path $LogDir) {
    Get-ChildItem $LogDir -Filter "local-run_*.log" -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
        Remove-Item -Force -ErrorAction SilentlyContinue
}
