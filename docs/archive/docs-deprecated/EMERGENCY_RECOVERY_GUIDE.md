# 🚨 WeRSS 服务熔断紧急恢复手册（2026-09-01）

> **适用场景**：We-mp-rss 离线、Cookie 失效、B 站/Wemp 订阅持续报错、自动熔断后需快速恢复  
> **预计耗时**：10-30 分钟（根据错误数量）  
> **权限要求**：管理员账号 + PowerShell 执行权限

---

## 🔴 **第一部分：紧急状态诊断（5 分钟内完成）**

### **1.1 Python 进程存活检查**

```powershell
# 检查 we-mp-rss 主进程是否运行
Get-Process | Where-Object {$_.FileName -like "*python*" -and $_.CommandLine -like "*app.py*"}

# 或直接通过端口检测（默认 8787）
Test-NetConnection -ComputerName localhost -Port 8787 -WarningAction SilentlyContinue | Select-Object TcpTestSucceeded

# 预期输出：TcpTestSucceeded : True
```

**如果未运行** → 执行 `1.2` 节启动脚本

---

### **1.2 一键启动 we-mp-rss**

```powershell
cd D:\tools\we-mp-rss

# 方式 A:后台启动（推荐）
Start-Process python -ArgumentList "app\core\app.py" -WindowStyle Hidden
Write-Host "✅ WeRSS 已在后台启动，等待 10 秒..." -ForegroundColor Green
Start-Sleep -Seconds 10

# 方式 B:前台启动（调试模式）
python app\core\app.py

# 验证启动成功
if (Test-NetConnection -ComputerName localhost -Port 8787 -WarningAction SilentlyContinue).TcpTestSucceeded {
    Write-Host "✅ WeRSS 监听端口 8787 成功" -ForegroundColor Green
} else {
    Write-Host "❌ 启动失败！请查看日志：D:\tools\we-mp-rss\data\logs\wemp.log" -ForegroundColor Red
}
```

---

### **1.3 数据库错误统计快照**

```powershell
# 生成当前熔断源清单（PowerShell + SQLite）
$DB = "d:\全网情报系统\data\app.db"

sqlite3 $DB "SELECT id, name, type, fail_count, enabled, 
     json_extract(extra, '$.lastError') as lastError,
     json_extract(extra, '$.lastErrorAt') as lastErrorAt
     FROM sources 
     WHERE fail_count >= 3 AND enabled = 0
     ORDER BY fail_count DESC;" | Format-Table -AutoSize

# 导出为 CSV（便于后续批量处理）
sqlite3 -header -csv $DB "SELECT id, name, type, fail_count FROM sources WHERE fail_count >= 3 AND enabled = 0" > d:\temp\frozen_sources.csv
Write-Host "📊 已导出冻结源清单到 d:\temp\frozen_sources.csv"
```

---

## 🟡 **第二部分：分场景恢复方案**

### **场景 A: We-mp-rss Token 缓存过期（公众号/微信读书）**

#### **现象特征**
- 错误消息包含 `-2012`、`cookie.*(过期 | 失效)`、`401`
- `extra.lastError` 显示 "Token 无效" 或 "登录态失效"

#### **手动恢复步骤**

```powershell
# 1. 清理 Token 缓存（强制重新登录）
cd d:\全网情报系统

# 备份当前配置
Copy-Item .env .env.backup-$(Get-Date -Format "yyyyMMdd-HHmmss")

# 编辑.env 文件
notepad .env

# 修改以下内容（替换为新的登录凭据）：
# WEMP_USERNAME=你的微信公众号后台邮箱
# WEMP_PASSWORD=你的微信公众号后台密码（非微信登录密码）
# WEMP_BASE=https://你的自建 we-mp-rss 实例地址（如 http://localhost:8787）

# 保存后重启服务端
& pm2 restart 全网情报系统  # 如果使用 PM2
# 或手动停止 + 重新启动 node server/index.js
```

**或者通过前端界面更新**：
1. 打开管理后台：`http://localhost:3000/admin/`
2. 切换到「公众号」Tab
3. 点击「重新授权」按钮
4. 扫码登录微信公众号后台

---

### **场景 B: 微信读书 Cookie 失效**

#### **判断依据**
```sql
-- 查询微信读书相关错误
SELECT name, extra FROM sources 
WHERE type='wemp' AND extra LIKE '%lastError%' 
AND (extra LIKE '%-2012%' OR extra LIKE '%过期%' OR extra LIKE '%401%');
```

#### **Cookie 重置流程**

```powershell
# 1. 查找所有微信读书源的 ID
sqlite3 "d:\全网情报系统\data\app.db" "SELECT id, name FROM sources WHERE type='wemp';"

# 2. 停用问题源（避免继续报错）
foreach ($id in 131, 132, 133) {  # 替换为实际 ID
    sqlite3 "d:\全网情报系统\data\app.db" "UPDATE sources SET enabled=0 WHERE id=$id;"
}

# 3. 清空错误计数 + 额外字段
sqlite3 "d:\全网情报系统\data\app.db" "
    UPDATE sources 
    SET fail_count=0, 
        extra='{}', 
        status='ok' 
    WHERE type='wemp' AND enabled=0;
"

Write-Host "✅ 微信读书源已重置，现在可以重新添加 Cookie"
```

**手动获取新 Cookie**：
1. 浏览器打开 `https://weread.qq.com/`
2. 登录后按 F12 打开开发者工具
3. Application → Cookies → weread.qq.com
4. 复制 `read.qq.com` 下的 `token` 字段值
5. 前端路径：`http://localhost:3000/admin/sources` → 添加源 → 粘贴 Cookie

---

### **场景 C: B 站订阅持续报错（WBI 签名/Cookie 部分失效）**

#### **诊断流程**

```powershell
# 1. 检查 B 站源列表
$bilis = sqlite3 "d:\全网情报系统\data\app.db" "SELECT id, name, extra FROM sources WHERE type='bilibili';"
Write-Host "`n=== B 站源详情 ===" 
$bilis | Out-String

# 2. 测试 B 站 API 连通性
$response = Invoke-WebRequest -Uri "https://api.bilibili.com/x/web-interface/nav" -UserAgent "Mozilla/5.0" -TimeoutSec 5 -ErrorAction Stop
$Json = $response.Content | ConvertFrom-Json

if ($Json.code -eq 0) {
    Write-Host "✅ B 站 API 正常，当前用户：$($Json.data.uname)" -ForegroundColor Green
} else {
    Write-Host "❌ B 站 API 返回错误 Code: $($Json.code), Message: $($Json.message)" -ForegroundColor Red
    
    if ($Json.code -eq -101) {
        Write-Host "⚠️  原因：Cookie 中 SESSDATA 缺失或过期" -ForegroundColor Yellow
        Write-Host "🔧 解决方案：见下方‘B 站 Cookie 更新步骤’"
    }
}
```

#### **B 站 Cookie 更新步骤**

```powershell
# 1. 找到当前 B 站源使用的 extra 配置
$sourceExtra = sqlite3 "d:\全网情报系统\data\app.db" "SELECT extra FROM sources WHERE type='bilibili' LIMIT 1;"
Write-Host "`n当前 extra 配置：$sourceExtra"

# 2. 解析并修改 Cookie 字段
$extra = $sourceExtra | ConvertFrom-Json
$oldCookie = $extra.cookie

# 3. 手动获取新 Cookie（浏览器操作）
Write-Host "`n请按以下步骤获取新 Cookie：" -ForegroundColor Cyan
Write-Host "1. 打开 https://www.bilibili.com/"
Write-Host "2. 登录后按 F12 → Network → 任意请求 → Copy → Copy Request Headers"
Write-Host "3. 找到 Cookie 头部，复制整个值（包含 SESSDATA, bili_jct 等）"
Write-Host "4. 粘贴到下方提示中..."

$newCookie = Read-Host "请输入完整的 Cookie 字符串"

# 4. 更新数据库
$oldExtra = $sourceExtra | ConvertFrom-Json
$oldExtra.cookie = $newCookie
$newExtra = $oldExtra | ConvertTo-Json -Compress

sqlite3 "d:\全网情报系统\data\app.db" "UPDATE sources SET extra='$newExtra' WHERE type='bilibili';"

Write-Host "`n✅ B 站 Cookie 已更新" -ForegroundColor Green
Write-Host "⚠️  建议同时重置 fail_count："
sqlite3 "d:\全网情报系统\data\app.db" "UPDATE sources SET fail_count=0 WHERE type='bilibili';"
```

---

## 🟢 **第三部分：批量熔断恢复（一键脚本）**

### **3.1 一键解冻所有熔断源**

```powershell
# ============================================
# 脚本：unfreeze-all-sources.ps1
# 用途：批量重置 fail_count >= 3 的源
# 风险：⚠️ 高风险！确保先确认问题根源再执行
# ============================================

$DB = "d:\全网情报系统\data\app.db"

# 1. 预览将要重置的源
Write-Host "=== 即将解冻的源（fail_count >= 3）===" -ForegroundColor Yellow
$frozen = sqlite3 $DB "SELECT id, name, type, fail_count FROM sources WHERE fail_count >= 3 AND enabled = 0;"
$frozen | Format-Table -AutoSize

$count = ($frozen | Measure-Object).Count
if ($count -eq 0) {
    Write-Host "✅ 无需要解冻的源" -ForegroundColor Green
    exit 0
}

Write-Host "`n共发现 $count 个冻结源" -ForegroundColor Yellow
$confirm = Read-Host "确定要批量解冻这些源？(y/N)"

if ($confirm -ne 'y') {
    Write-Host "❌ 已取消操作" -ForegroundColor Gray
    exit 0
}

# 2. 执行批量重置
Write-Host "`n开始批量重置..." -ForegroundColor Cyan

# 方法 A:仅重置计数（保留 enabled=0）
$sql1 = "UPDATE sources SET fail_count=0 WHERE fail_count >= 3;"
sqlite3 $DB $sql1

# 方法 B:完全恢复（enabled=1 + fail_count=0 + status='ok'）
$sql2 = "UPDATE sources SET enabled=1, fail_count=0, status='ok' WHERE fail_count >= 3;"
sqlite3 $DB $sql2

Write-Host "✅ 批量重置完成！" -ForegroundColor Green
Write-Host "📊 建议刷新查看效果：http://localhost:3000/admin/sources"
```

**执行方式**：
```powershell
# 保存为 unfreeze-all-sources.ps1 到 d:\全网情报系统\tools\
cd d:\全网情报系统\tools
.\unfreeze-all-sources.ps1
```

---

### **3.2 增量恢复（推荐，更安全）**

```powershell
# ============================================
# 脚本：incremental-unfreeze.ps1
# 用途：按类型分组恢复，优先恢复高优先级源
# ============================================

$DB = "d:\全网情报系统\data\app.db"

Write-Host "=== 按类型分组恢复策略 ===" -ForegroundColor Cyan

# 1. RSS 源（低风险，直接恢复）
Write-Host "`n[1/3] RSS 源..." -ForegroundColor Gray
$rss = sqlite3 $DB "SELECT COUNT(*) FROM sources WHERE type='rss' AND fail_count >= 3;"
Write-Host "   发现 $rss 个 RSS 冻结源 → 自动恢复" -ForegroundColor Gray
sqlite3 $DB "UPDATE sources SET enabled=1, fail_count=0, status='ok' WHERE type='rss' AND fail_count >= 3;"

# 2. B 站源（需人工确认）
Write-Host "`n[2/3] B 站源... 等待人工确认" -ForegroundColor Yellow
$bili = sqlite3 $DB "SELECT id, name, fail_count FROM sources WHERE type='bilibili' AND fail_count >= 3;"
Write-Host "$bili" | Format-Table -AutoSize
$confirm = Read-Host "确认 B 站 Cookie 已更新？(y/N)"
if ($confirm -eq 'y') {
    sqlite3 $DB "UPDATE sources SET enabled=1, fail_count=0, status='ok' WHERE type='bilibili' AND fail_count >= 3;"
    Write-Host "✅ B 站源已恢复" -ForegroundColor Green
}

# 3. WeChat 源（需先检查 WeRSS 健康）
Write-Host "`n[3/3] 公众号源... 依赖 WeRSS 引擎" -ForegroundColor Yellow
if ((Test-NetConnection -ComputerName localhost -Port 8787).TcpTestSucceeded) {
    Write-Host "✅ WeRSS 在线 → 自动恢复" -ForegroundColor Green
    sqlite3 $DB "UPDATE sources SET enabled=1, fail_count=0, status='ok' WHERE type='wemp' AND fail_count >= 3;"
} else {
    Write-Host "❌ WeRSS 离线 → 跳过（请先启动服务）" -ForegroundColor Red
}

Write-Host "`n=== 恢复完成 ===" -ForegroundColor Green
```

---

## 🟣 **第四部分：前端可视化增强（实时状态指示器）**

### **4.1 新增 WeRSS 健康状态面板**

```jsx
// web/src/components/WeHealth.jsx
import { useEffect, useState } from 'react';

export function WeHealth() {
  const [status, setStatus] = useState('unknown'); // unknown | online | offline
  const [errorStats, setErrorStats] = useState({ total: 0, paused: 0 });
  const [lastCheck, setLastCheck] = useState(null);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        // 1. 检测 WeRSS 端口
        const portCheck = await fetch('/api/health/wemp-port');
        const wempOk = portCheck.ok;

        // 2. 统计错误源
        const sourcesRes = await fetch('/api/sources?status=error');
        const sources = await sourcesRes.json();
        
        setStatus(wempOk ? 'online' : 'offline');
        setErrorStats({
          total: sources.filter(s => s.status === 'error').length,
          paused: sources.filter(s => s.fail_count >= 3 && !s.enabled).length
        });
        setLastCheck(new Date());
      } catch (err) {
        setStatus('offline');
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 30000); // 30 秒刷新
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-gray-50 p-4 rounded-lg border-l-4 border-blue-500">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-sm">WeRSS 引擎状态</h3>
          <p className="text-xs text-gray-600">最后检查：{lastCheck?.toLocaleTimeString()}</p>
        </div>
        
        <div className="flex items-center gap-2">
          {status === 'online' && (
            <>
              <span className="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs font-bold">
                ✅ 在线
              </span>
              {errorStats.paused > 0 && (
                <span className="px-2 py-1 bg-red-100 text-red-800 rounded-full text-xs">
                  ⚠️ {errorStats.paused} 个熔断源
                </span>
              )}
            </>
          )}
          
          {status === 'offline' && (
            <span className="px-2 py-1 bg-red-600 text-white rounded-full text-xs font-bold animate-pulse">
              ❌ 离线
            </span>
          )}
        </div>
      </div>

      {/* 点击查看错误详情 */}
      {errorStats.total > 0 && (
        <button 
          onClick={() => window.location.href = '/admin/sources#errors'}
          className="mt-2 text-xs text-blue-600 hover:underline"
        >
          查看所有错误详情 →
        </button>
      )}
    </div>
  );
}
```

**集成到管理后台**：
```jsx
// web/src/components/SourcesTable.jsx 顶部添加
import { WeHealth } from './WeHealth';

// ... 在 render 中添加
<div className="grid grid-cols-3 gap-4 mb-6">
  <WeHealth />
  <TokenCacheDisplay /> {/* 下一节实现 */}
  <CookieExpiryCountdown /> {/* 下一节实现 */}
</div>
```

---

### **4.2 Cookie 有效期倒计时组件**

```jsx
// web/src/components/CookieExpiry.jsx
export function CookieExpiryCountdown() {
  const [cookies, setCookies] = useState([]);

  useEffect(() => {
    const loadCookies = async () => {
      const res = await fetch('/api/sessions'); // 假设有此接口
      const sessions = await res.json();
      
      // 计算剩余时间
      const countdowns = sessions.map(s => ({
        source: s.source_name,
        type: s.session_type, // SESSDATA / token
        expires: new Date(s.expires_at || 0),
        progress: calculateProgress(s.expires_at) // 0-100
      }));
      
      setCookies(countdowns);
    };
    
    loadCookies();
    const timer = setInterval(loadCookies, 60000);
    return () => clearInterval(timer);
  }, []);

  function calculateProgress(expiresAt) {
    const now = Date.now();
    const total = expiresAt - now;
    return Math.max(0, Math.min(100, (total / (7 * 24 * 60 * 60e3)) * 100)); // 7 天预警线
  }

  return (
    <div className="bg-white p-4 rounded-lg shadow-sm">
      <h3 className="font-bold text-sm mb-3">Cookie 有效期监控</h3>
      {cookies.length === 0 ? (
        <p className="text-xs text-gray-500">暂无可用数据</p>
      ) : (
        <div className="space-y-2">
          {cookies.map((c, idx) => (
            <div key={idx}>
              <div className="flex justify-between text-xs mb-1">
                <span>{c.source}</span>
                <span className={c.progress < 20 ? 'text-red-600 font-bold' : 'text-gray-600'}>
                  {Math.round(c.progress)}%
                </span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div 
                  className={`h-full ${c.progress < 20 ? 'bg-red-500' : c.progress < 50 ? 'bg-yellow-500' : 'bg-green-500'}`}
                  style={{ width: `${c.progress}%`, transition: 'width 1s linear' }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

---

## 📋 **第五部分：自动化监控脚本（可选部署）**

### **5.1 每 5 分钟健康检查**

```powershell
# tools\daily-health-check.ps1
while ($true) {
    Start-Sleep -Seconds 300  # 5 分钟
    
    $DB = "d:\全网情报系统\data\app.db"
    $logFile = "d:\全网情报系统\data\logs\health-check-$(Get-Date -Format yyyy-MM-dd).log"
    
    # 1. WeRSS 端口检测
    $wempOnline = (Test-NetConnection -ComputerName localhost -Port 8787 -WarningAction SilentlyContinue).TcpTestSucceeded
    Add-Content $logFile "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') WeRSS: $($wempOnline ? '✅' : '❌')"
    
    # 2. 熔断源统计
    $frozenCount = sqlite3 $DB "SELECT COUNT(*) FROM sources WHERE fail_count >= 3 AND enabled = 0;"
    Add-Content $logFile "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') 熔断源：$frozenCount"
    
    # 3. 错误源 Top 5
    $topErrors = sqlite3 $DB "SELECT name, json_extract(extra, '$.lastError') as err FROM sources WHERE status='error' LIMIT 5;"
    Add-Content $logFile "`nTop 错误源:`n$topErrors"
    
    # 4. 如果熔断源 > 10 且持续 30 分钟 → 发送 Bark 报警
    if ($frozenCount -gt 10) {
        Send-BarkAlert "⚠️ 大量源熔断：$frozenCount 个源需关注"
    }
}
```

---

## 🎯 **第六部分：使用流程总结**

### **标准操作流程（SOP）**

```
1. 诊断阶段（5 分钟）
   └─ 执行 1.1 + 1.3 → 确认 WeRSS 状态 + 冻结源清单

2. 根因分析（10 分钟）
   └─ 根据错误特征选择对应场景：
      ├─ 含 -2012/401 → 场景 A/B (WeRSS/微信读书)
      └─ 含 WBI/signature → 场景 C (B 站)

3. 执行恢复（5-15 分钟）
   └─ 使用对应场景的手动步骤或批量脚本

4. 验证效果（5 分钟）
   └─ 前端管理后台 → SourceTable → 检查状态标签颜色变化
      （绿色 = 运行中，红色 = 异常，灰色 = 已熔断）

5. 监控观察（1-2 小时）
   └─ 使用第五部分的自动化脚本持续监测
```

---

## 🔧 **附录：常用 SQLite 命令速查表**

| 任务 | SQL 命令 |
|-----|---------|
| 查询所有冻结源 | `SELECT * FROM sources WHERE fail_count >= 3 AND enabled = 0` |
| 单个源解冻 | `UPDATE sources SET enabled=1, fail_count=0, status='ok' WHERE id=XXX` |
| 清空某类型源的错误 | `UPDATE sources SET fail_count=0, extra='{}' WHERE type='bilibili'` |
| 查看最新错误消息 | `SELECT name, json_extract(extra, '$.lastError') FROM sources ORDER BY id DESC LIMIT 10` |
| 重置所有源为初始状态 | ⚠️ **慎用**: `UPDATE sources SET fail_count=0, status='ok', extra='{}'` |

---

## 🆘 **紧急联系与回滚**

- **回滚点**：每次执行重要操作前已自动生成 `.env.backup-*` 文件
- **数据库快照**：建议在执行批量操作前手动备份 `cp data/app.db data/app.db.pre-recovery-$(date)`
- **技术支持**：如遇无法解决的问题，提供完整日志到 `data/logs/app.log`

**祝你操作顺利！** ✨
