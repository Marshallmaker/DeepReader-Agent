<#
.SYNOPSIS
DeepReader Agent 一键启动（修复版 v2）
.DESCRIPTION
依次启动 Redis、Celery Worker、FastAPI 后端、React 前端。
所有服务运行在独立的最小化 PowerShell 窗口中。
#>
param(
    [switch]$Stop,
    [int]$BackendPort = 8005
)

$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path

function color($msg, $c = "White") { Write-Host $msg -ForegroundColor $c }

# ── HTTP 请求辅助函数（安全处理无响应场景）──────────────────
function Test-Endpoint($url, $method = "GET", $body = $null, $timeoutSec = 5) {
    try {
        $req = [System.Net.WebRequest]::Create($url)
        $req.Timeout = $timeoutSec * 1000
        $req.Method = $method
        if ($body -and $method -eq "POST") {
            $req.ContentType = "application/json"
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
            $req.ContentLength = $bytes.Length
            $stream = $req.GetRequestStream()
            $stream.Write($bytes, 0, $bytes.Length)
            $stream.Close()
        }
        $resp = $req.GetResponse()
        $code = [int]$resp.StatusCode
        $resp.Close()
        return @{ Success = $true; StatusCode = $code }
    } catch [System.Net.WebException] {
        $resp = $_.Exception.Response
        if ($resp) {
            $code = [int]$resp.StatusCode
            $resp.Close()
            return @{ Success = $false; StatusCode = $code }
        }
        return @{ Success = $false; StatusCode = 0 }
    } catch {
        return @{ Success = $false; StatusCode = 0 }
    }
}

# ── 清理 ─────────────────────────────────────────────────────
function Stop-All {
    color "`n正在停止所有服务..." Yellow

    # 精确清理：按端口 → 按进程名
    @{
        Ports = @(5173, $BackendPort)
        Names = @("redis-server", "celery", "uvicorn", "node")
    }

    # 端口占用清理
    @(5173, $BackendPort) | ForEach-Object {
        $port = $_
        $lines = netstat -ano 2>$null | Select-String ":$port\s" | Select-String "LISTENING"
        foreach ($line in $lines) {
            $parts = $line -split '\s+'
            $procId = $parts[-1]
            if ($procId -match '^\d+$') {
                Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
                color "  端口 ${port} (PID $procId) 已释放" Green
            }
        }
    }

    # 精准清理相关进程
    @("redis-server", "celery", "uvicorn") | ForEach-Object {
        $name = $_
        Get-Process $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    }

    # 清理前端 Node 进程（仅限 vite）
    Get-Process node -ErrorAction SilentlyContinue | ForEach-Object {
        $cmd = (Get-WmiObject Win32_Process -Filter "ProcessId = $($_.Id)").CommandLine
        if ($cmd -match "vite") { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
    }

    color "  已清理" Green
}
if ($Stop) { Stop-All; return }

# ── 启动 ─────────────────────────────────────────────────────
color "`n" * 0
color ("=" * 55) Cyan
color "  DeepReader Agent — 一键启动" Cyan
color ("=" * 55) Cyan

# ═══════════════════════════════════════════════════════════════
# 1. 前置检查
# ═══════════════════════════════════════════════════════════════
color "`n[1/5] 前置检查" Yellow

# 1a. MySQL
$mysqlOk = $false
if (Get-Process mysqld -ErrorAction SilentlyContinue) {
    # 验证数据库连接
    $test = mysql -u root -p123456 -e "USE deepreader_db; SELECT 1" 2>&1
    if ($LASTEXITCODE -eq 0) {
        color "  ✓ MySQL 已运行，数据库连接正常" Green
        $mysqlOk = $true
    } else {
        color "  ⚠ MySQL 进程运行中，但数据库连接失败" DarkYellow
        color "  提示: 检查 deepreader_db 是否存在" DarkYellow
    }
} else {
    color "  ✗ MySQL 未运行，请先启动 MySQL 服务" Red
    color "  提示: net start MySQL80" DarkYellow
    return
}

# 1b. Redis 预检
$redisInPath = $null
try { $redisInPath = Get-Command redis-server -ErrorAction Stop } catch {}
if (-not $redisInPath) {
    color "  ✗ redis-server 未在 PATH 中找到" Red
    color "  提示: 安装 Redis for Windows 或确认 PATH 配置" DarkYellow
    return
}
color "  ✓ 环境检查通过" Green

# ═══════════════════════════════════════════════════════════════
# 2. Redis
# ═══════════════════════════════════════════════════════════════
color "`n[2/5] Redis" Yellow
$redisRunning = netstat -ano 2>$null | Select-String ":6379 " | Select-String "LISTENING"
if (-not $redisRunning) {
    color "  启动中..." DarkYellow
    Start-Process redis-server -ArgumentList "--port 6379" -WindowStyle Hidden
    Start-Sleep 3
}
$r = netstat -ano 2>$null | Select-String ":6379 " | Select-String "LISTENING"
if ($r) {
    $redisRunning = $r  # 更新状态用于最终汇总
    color "  ✓ Redis: localhost:6379" Green
} else {
    color "  ✗ Redis 启动失败" Red
    color "  提示: 检查端口 6379 是否被占用" DarkYellow
    return
}

# ═══════════════════════════════════════════════════════════════
# 3. Celery Worker
# ═══════════════════════════════════════════════════════════════
color "`n[3/5] Celery Worker" Yellow

# 部署 sitecustomize.py（Redis RESP2 兼容补丁）
$sitecustomizeSrc = "$repo\backend\sitecustomize.py"
$sitecustomizeDst = "$repo\backend\venv\Lib\site-packages\sitecustomize.py"
if (Test-Path $sitecustomizeSrc) {
    Copy-Item $sitecustomizeSrc $sitecustomizeDst -Force
    color "  ✓ Redis RESP2 补丁已部署" DarkGreen
} else {
    color "  ⚠ sitecustomize.py 缺失，Celery 可能无法连接 Redis" DarkYellow
}

# 如果已有 celery worker 在运行，先停掉
$oldCelery = Get-Process celery -ErrorAction SilentlyContinue
if ($oldCelery) {
    $oldCelery | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep 1
}

$celeryDir = "$repo\backend"
Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "cd '$celeryDir'; .\venv\Scripts\activate; celery -A app.tasks.celery_app worker --loglevel=info --pool=threads" -WindowStyle Minimized

# 等待 Celery 就绪（最多 20 秒）
$celeryReady = $false
for ($i = 1; $i -le 10; $i++) {
    Start-Sleep 2
    $proc = Get-Process celery -ErrorAction SilentlyContinue
    if (-not $proc) { continue }
    # 检查 Celery 日志中是否有 "ready" 标记
    $latestLog = Get-ChildItem "$repo\backend\logs\celery*.log" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $latestLog) { continue }
    $logContent = Get-Content $latestLog.FullName -Tail 5 -ErrorAction SilentlyContinue | Out-String
    if ($logContent -match "ready") {
        $celeryReady = $true
        break
    }
}
if ($celeryReady) {
    color "  ✓ Celery 已就绪 (pool=threads)" Green
} else {
    color "  ⚠ Celery 进程已启动，但就绪状态未能确认" DarkYellow
    color "  提示: 查看 Celery 窗口输出确认" DarkYellow
}

# ═══════════════════════════════════════════════════════════════
# 4. FastAPI 后端
# ═══════════════════════════════════════════════════════════════
color "`n[4/5] FastAPI 后端" Yellow

# 清理僵尸端口
$old = netstat -ano 2>$null | Select-String ":$BackendPort " | Select-String "LISTENING"
if ($old) {
    ($old -split '\s+')[-1] | ForEach-Object {
        if ($_ -match '^\d+$') { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
    }
    Start-Sleep 1
}

Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "cd '$celeryDir'; .\venv\Scripts\activate; uvicorn app.main:app --host 0.0.0.0 --port $BackendPort --reload" -WindowStyle Minimized

# 等待后端就绪（最多 15 秒）
$backendOk = $false
for ($i = 1; $i -le 15; $i++) {
    Start-Sleep 1
    $result = Test-Endpoint "http://localhost:$BackendPort/health"
    if ($result.StatusCode -eq 200) {
        $backendOk = $true
        break
    }
}
if ($backendOk) {
    color "  ✓ 后端: http://localhost:$BackendPort" Green
} else {
    color "  ✗ 后端未就绪，请检查窗口输出" Red
}

# ═══════════════════════════════════════════════════════════════
# 5. React 前端
# ═══════════════════════════════════════════════════════════════
color "`n[5/5] React 前端" Yellow

# 清理前端端口
$old = netstat -ano 2>$null | Select-String ":5173 " | Select-String "LISTENING"
if ($old) {
    ($old -split '\s+')[-1] | ForEach-Object {
        if ($_ -match '^\d+$') { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
    }
    Start-Sleep 1
}

Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "cd '$repo\frontend'; npm run dev" -WindowStyle Minimized

# 等待前端就绪（最多 24 秒，4 次重试，每次间隔 3 秒）
$frontendOk = $false
for ($attempt = 1; $attempt -le 4; $attempt++) {
    Start-Sleep 3
    $result = Test-Endpoint "http://localhost:5173"
    if ($result.StatusCode -eq 200) {
        $frontendOk = $true
        break
    }
    if ($attempt -lt 4) {
        color "  前端尚未就绪，重试 ($attempt/4)..." DarkGray
    }
}
if ($frontendOk) {
    color "  ✓ 前端: http://localhost:5173" Green
} else {
    color "  ✗ 前端未就绪，请检查窗口输出" Red
    color "  提示: 首次冷启动可能需要更长时间" DarkYellow
}

# ═══════════════════════════════════════════════════════════════
# 汇总
# ═══════════════════════════════════════════════════════════════
color "`n" * 0
color ("=" * 55) Cyan

$allOk = $redisRunning -and $celeryReady -and $backendOk -and $frontendOk
if ($allOk) {
    color "  全部启动完成！" Green
} elseif ($redisRunning -and $backendOk -and $frontendOk) {
    color "  核心服务已就绪（Celery 状态待确认）" Yellow
} else {
    color "  部分服务未就绪，请检查上方输出" Red
}

color ("=" * 55) Cyan
color "  入口:      http://localhost:5173" White
color "  API:       http://localhost:$BackendPort" DarkGray
color "  API 文档:  http://localhost:$BackendPort/docs" DarkGray
color "  管理员:    admin@deepreader.com / Admin@123456" DarkGray
color "`n  各服务运行在独立的 PowerShell 最小化窗口中" DarkYellow
color "  关闭窗口即可停止对应服务`n" DarkYellow
