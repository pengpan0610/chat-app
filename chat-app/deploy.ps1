# ============================================================
# ChatNova 一键部署脚本（Windows PowerShell）
# 用途：把本地 4 个 HTML 文件上传到腾讯云服务器
# 服务器：124.220.2.184（root，端口 22，免密/密钥）
# 目标路径：/var/www/html/chat-app/
# ============================================================

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$SERVER = "root@124.220.2.184"
$PORT = 22
$REMOTE_DIR = "/var/www/html/chat-app"
$LOCAL_DIR = $PSScriptRoot

Write-Host ""
Write-Host "ChatNova 部署脚本" -ForegroundColor Cyan
Write-Host "  本地目录: $LOCAL_DIR" -ForegroundColor Gray
Write-Host "  服务器:   $SERVER`:$PORT" -ForegroundColor Gray
Write-Host "  远端目录: $REMOTE_DIR" -ForegroundColor Gray
Write-Host ""

# ---------- 1. 检查必要工具 ----------
$useSCP = $true
try {
    $scp = (Get-Command scp -ErrorAction Stop).Source
    $ssh = (Get-Command ssh -ErrorAction Stop).Source
    Write-Host "[1/4] 使用系统自带 OpenSSH" -ForegroundColor Green
} catch {
    Write-Host "[1/4] 系统没有 scp/ssh，需要先用 WinSCP/pscp" -ForegroundColor Yellow
    $useSCP = $false
    $pscp = (Get-Command pscp -ErrorAction Stop).Source 2>$null
    $plink = (Get-Command plink -ErrorAction Stop).Source 2>$null
    if (-not $pscp -or -not $plink) {
        Write-Host "  未找到 pscp/plink，请先安装 PuTTY 或 WinSCP" -ForegroundColor Red
        Write-Host "  下载: https://winscp.net/eng/downloads.php" -ForegroundColor Yellow
        pause
        exit 1
    }
    Write-Host "  使用 PuTTY 工具链: pscp + plink" -ForegroundColor Green
}

# ---------- 2. 测试连接 ----------
Write-Host ""
Write-Host "[2/4] 测试 SSH 连接..." -ForegroundColor Cyan
try {
    if ($useSCP) {
        $test = ssh -p $PORT -o StrictHostKeyChecking=no -o ConnectTimeout=8 "$SERVER" "echo CONNECT_OK && uname -a"
    } else {
        $test = echo y | plink -ssh -P $PORT -batch "$SERVER" "echo CONNECT_OK && uname -a" 2>&1
    }
    Write-Host "  连接成功" -ForegroundColor Green
    Write-Host "  $test" -ForegroundColor Gray
} catch {
    Write-Host "  SSH 连接失败: $_" -ForegroundColor Red
    Write-Host "  提示：如果是密码登录，请先在本机配置免密登录：" -ForegroundColor Yellow
    Write-Host "    ssh-keygen -t rsa" -ForegroundColor Gray
    Write-Host "    type $env:USERPROFILE\.ssh\id_rsa.pub | ssh $SERVER 'mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys'" -ForegroundColor Gray
    pause
    exit 1
}

# ---------- 3. 创建远端目录 ----------
Write-Host ""
Write-Host "[3/4] 创建远端目录 $REMOTE_DIR ..." -ForegroundColor Cyan
try {
    if ($useSCP) {
        ssh -p $PORT "$SERVER" "mkdir -p $REMOTE_DIR && ls -ld $REMOTE_DIR"
    } else {
        echo y | plink -ssh -P $PORT -batch "$SERVER" "mkdir -p $REMOTE_DIR && ls -ld $REMOTE_DIR" 2>&1
    }
} catch {
    Write-Host "  创建目录失败: $_" -ForegroundColor Red
    pause
    exit 1
}

# ---------- 4. 上传 4 个 HTML 文件 ----------
Write-Host ""
Write-Host "[4/4] 上传 HTML 文件..." -ForegroundColor Cyan
$files = @("index.html", "admin.html", "reset.html", "test.html")
foreach ($f in $files) {
    $local = Join-Path $LOCAL_DIR $f
    if (-not (Test-Path $local)) {
        Write-Host "  跳过不存在的文件: $f" -ForegroundColor Yellow
        continue
    }
    Write-Host "  上传: $f" -ForegroundColor Gray
    try {
        if ($useSCP) {
            scp -P $PORT -o StrictHostKeyChecking=no "$local" "${SERVER}:${REMOTE_DIR}/$f"
        } else {
            & pscp -P $PORT -batch "$local" "${SERVER}:${REMOTE_DIR}/$f"
        }
        Write-Host "    OK" -ForegroundColor Green
    } catch {
        Write-Host "    失败: $_" -ForegroundColor Red
    }
}

# ---------- 5. 设置权限 + 验证 ----------
Write-Host ""
Write-Host "[5/5] 设置权限并验证..." -ForegroundColor Cyan
try {
    if ($useSCP) {
        ssh -p $PORT "$SERVER" "chmod -R 755 $REMOTE_DIR && ls -la $REMOTE_DIR/"
    } else {
        echo y | plink -ssh -P $PORT -batch "$SERVER" "chmod -R 755 $REMOTE_DIR && ls -la $REMOTE_DIR/" 2>&1
    }
} catch {
    Write-Host "  设置权限失败: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  部署完成！" -ForegroundColor Green
Write-Host "  访问地址: http://124.220.2.184/chat-app/" -ForegroundColor Yellow
Write-Host "  默认账号: admin / admin123" -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "如果浏览器打开是 403 Forbidden，可能需要在服务器上：" -ForegroundColor Gray
Write-Host "  - 检查 /etc/nginx/nginx.conf 中 root 目录是否正确" -ForegroundColor Gray
Write-Host "  - 检查 nginx 是否启动: systemctl status nginx" -ForegroundColor Gray
Write-Host "  - 开放 80 端口: firewall-cmd --add-port=80/tcp --permanent && firewall-cmd --reload" -ForegroundColor Gray
Write-Host ""
pause
