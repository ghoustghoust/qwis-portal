# submit.ps1 —— F46 Windows 快捷提交工具（T37）
# 流程：读取剪贴板 → 正则识别平台 → WinForms 确认弹窗 → POST 到对应云端队列 → 结果提示
# 配置来源：与本脚本同目录的 submit-config.json（由 npm run setup:customer 生成），
#           结构 { "baseUrl": "https://api.qianmeng.news", "token": "<48位Token>" }
# 触发方式：桌面快捷方式 submit.lnk（Ctrl+Alt+Q）或直接运行本脚本。
[CmdletBinding()]
param()

Add-Type -AssemblyName System.Windows.Forms
$ErrorActionPreference = 'Stop'

function Show-Info([string]$Text, [string]$Title = '订阅提交') {
    [System.Windows.Forms.MessageBox]::Show($Text, $Title,
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
}

function Show-Err([string]$Text, [string]$Title = '订阅提交') {
    [System.Windows.Forms.MessageBox]::Show($Text, $Title,
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
}

# 1. 读取配置（同目录 submit-config.json）
$configPath = Join-Path $PSScriptRoot 'submit-config.json'
if (-not (Test-Path $configPath)) {
    Show-Err "未找到配置文件：`n$configPath`n`n请先在项目根目录运行 npm run setup:customer"
    exit 1
}
try {
    $config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
    Show-Err "配置文件解析失败：$($_.Exception.Message)"
    exit 1
}
$baseUrl = ([string]$config.baseUrl).TrimEnd('/')
$token = [string]$config.token
if (-not $baseUrl -or -not $token) {
    Show-Err "submit-config.json 缺少 baseUrl 或 token，请重新运行 npm run setup:customer"
    exit 1
}

# 2. 读取剪贴板
$clip = [System.Windows.Forms.Clipboard]::GetText()
if ([string]::IsNullOrWhiteSpace($clip)) {
    Show-Info '剪贴板为空，请先复制 B站 / 抖音 / 公众号链接再按快捷键。'
    exit 0
}

# 剪贴板可能是整段分享文案，提取其中的第一个链接
$m = [regex]::Match($clip, 'https?://[^\s"''<>]+')
$url = if ($m.Success) { $m.Value } else { $clip.Trim() }

# 3. 识别平台 → 对应云端队列端点
$type = $null
$endpoint = $null
$label = $null
switch -Regex ($url) {
    'bilibili\.com|b23\.tv'   { $type = 'bilibili'; $endpoint = 'bilibili-video-queue.php'; $label = 'B站'; break }
    'douyin\.com|iesdouyin'   { $type = 'douyin';   $endpoint = 'douyin-video-queue.php';   $label = '抖音'; break }
    'mp\.weixin\.qq\.com'     { $type = 'wechat';   $endpoint = 'wechat-rss-queue.php';     $label = '公众号'; break }
}
if (-not $type) {
    Show-Info "未识别到支持的平台链接：`n$url`n`n支持：B站（bilibili.com/b23.tv）、抖音（douyin.com）、公众号（mp.weixin.qq.com）"
    exit 0
}

# 4. 确认弹窗
$answer = [System.Windows.Forms.MessageBox]::Show(
    "识别到：$label`n类型：$type`n链接：$url`n`n确认加入订阅队列？",
    '提交订阅队列',
    [System.Windows.Forms.MessageBoxButtons]::YesNo,
    [System.Windows.Forms.MessageBoxIcon]::Question)
if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) { exit 0 }

# 5. POST 到云端队列（协议：POST {token,url,name,type} → {ok:true}）
$body = @{ token = $token; url = $url; name = ''; type = $type } | ConvertTo-Json
$bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)
try {
    $resp = Invoke-RestMethod -Uri "$baseUrl/$endpoint" -Method Post `
        -ContentType 'application/json; charset=utf-8' -Body $bodyBytes -TimeoutSec 20
    if ($resp.ok) {
        Show-Info "已加入订阅队列（$label）`n本机将在下个轮询周期自动拉取并解析。"
    } else {
        Show-Err "提交失败：$($resp.error)"
    }
} catch {
    Show-Err "提交失败：$($_.Exception.Message)"
    exit 1
}
