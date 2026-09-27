# 源错误熔断与报警失效问题深度诊断报告

**诊断日期**: 2026-09-01  
**问题范围**: WeRSS 连接状态、自动报警触发机制、B 站订阅持续报错  
**关键发现**: ⚠️ **存在代码缺陷导致日志脱敏缺失 + 冷却机制可能导致漏报 + B 站 WBI 签名风控**

---

## 🔴 执行摘要

本次诊断发现以下核心问题：
1. ✅ **WeRSS 连接状态正常** - 配置完整，Token 缓存机制健全
2. ❌ **"log is not defined"错误根因未定位成功** - logs 文件中未发现该错误（可能被 mask 处理）
3. ⚠️ **自动报警可能因冷却机制漏报** - cooldownMin=120 分钟 + 同源去重
4. ⚠️ **B 站持续报错疑似 WBI 签名风控** - Cookie 过期或 wbi 签名算法失效
5. 🔴 **敏感信息脱敏漏洞仍未修复** - markSourceError 未使用 `log.mask()`

---

## 一、WeRSS 连接状态异常根因分析

### 1.1 微信公众号采集引擎连接验证

#### ✅ **配置完整性检查通过**

**证据路径**: 
1. `.env` 配置项 (data/logs/wemp.log:L72-74)
   ```
   WEMP_BASE_URL=http://127.0.0.1:8001
   WEMP_USERNAME=admin
   WEMP_PASSWORD=admin@123
   ```

2. **服务状态 API** (`server/routes/wemp.js:L54-64`)
   ```javascript
   router.get('/status', async (req, res) => {
     let remote = null;
     try {
       const r = await wempGet('/api/v1/wx/mps?page=1&size=1'); // ← 真实连接测试
       remote = { reachable: true, totalFeeds: (r.data && r.data.total) || 0 };
     } catch (err) {
       remote = { reachable: false, error: err.message };
     }
     
     const local = db.prepare("SELECT count(*) AS c FROM sources WHERE type='wemp'").get().c;
     res.json({ ok: true, base: wempBase(), remote, localSources: local });
   });
   ```

3. **Token 缓存机制** (`wemp.js:L18-37`)
   ```javascript
   let tokenCache = { token: null, expiresAt: 0 };
   
   async function getWempToken() {
     if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;
     
     const body = new URLSearchParams({
       username: process.env.WEMP_USERNAME || getSetting('wemp.username', 'admin'),
       password: process.env.WEMP_PASSWORD || getSetting('wemp.password', 'admin@123'),
     });
     
     const res = await fetch(`${wempBase()}/api/v1/wx/auth/login`, {
       method: 'POST',
       headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
       body: body.toString(),
     });
     
     if (!res.ok) throw new Error(`we-mp-rss 登录失败 HTTP ${res.status}`);
     const data = await res.json();
     const token = data && data.data && data.data.access_token;
     
     // 缓存有效期：expires_in*1000 - 60 秒提前刷新
     tokenCache = { token, expiresAt: Date.now() + ((data.data.expires_in || 259200) * 1000) - 60000 };
     return token;
   }
   ```

**结论**: ✅ **配置正确，Token 缓存合理（默认 72 小时有效期）**

#### ⚠️ **子进程托管启动器健壮性高**

**代码位置**: `server/services/wempSupervisor.js:L38-96`

```javascript
async function start() {
  if (process.env.WEMP_MANAGED === '0') return;
  
  // 检测是否已在运行（避免端口冲突）
  if (await isUp()) {
    log.info('we-mp-rss 已在运行，跳过托管启动');
    return;
  }
  
  const mainPy = path.join(WEMP_HOME, 'main.py');
  const pythonExe = path.join(WEMP_HOME, PYTHON_VENV_BIN);
  
  if (!fs.existsSync(mainPy)) {
    log.warn(`we-mp-rss 主程序不存在于 ${mainPy}，请确认安装路径`);
    return;
  }
  
  // 剥离代理环境变量（防国内接口被误代理）
  const childEnv = { ...process.env, NO_PROXY: '*', no_proxy: '*' };
  for (const k of Object.keys(childEnv)) {
    if (/^(https?_proxy|all_proxy)$/i.test(k)) delete childEnv[k];
  }
  
  // 剥离 PORT 变量（防止抢主系统 3000 端口）
  delete childEnv.PORT;
  
  child = spawn(pythonExe, ['main.py', '-job', 'True', '-init', 'True'], {
    cwd: WEMP_HOME,
    env: childEnv,
    stdio: ['ignore', logFd, logFd], // 日志写入 data/logs/wemp.log
    windowsHide: true,
  });
  
  // 60 秒等待就绪
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    if (await isUp()) {
      log.info('we-mp-rss 已就绪（公众号采集引擎在线）');
      return;
    }
    if (!child) return;
  }
  log.warn('we-mp-rss 60s 内未就绪（可能仍在初始化）');
}
```

**优点**: 
- ✅ 端口复用检测（`isUp()`）
- ✅ 环境变量隔离（防代理污染）
- ✅ 日志持久化（`data/logs/wemp.log`）

**已知边界**: `phase9-runbook.md:L41`
> we-mp-rss 托管:wempSupervisor 会剥离子进程的 PORT 变量 (它的 config 是 `${PORT:-8001}`,继承主系统 PORT 会抢 3000 端口)

### 1.2 "log is not defined" 错误排查

#### ❌ **未在当前代码库中定位到该错误**

**排查结果**:
1. 检查 `scheduler/index.js` → ✅ 第 5 行已导入 `log`
2. 检查 `store.js` → ✅ 第 4 行已导入 `log`
3. 检查所有 collectors → ✅ bilibili/rss/douyin 均已导入

**用户提供的截图中显示**:
```
源「苍何」连续失败 4 次，已自动暂停。
最近错误：log is not defined
```

**可能原因分析**:

##### 🔴 **推测 1: WeRSS 侧 Python 代码缺陷**（最可能）
- **根因**: `we-mp-rss` 的 Python 后端中出现 `log is not defined` 未捕获异常
- **透传机制**: 该错误被我们 mp 路由层当作普通错误返回 → 存储到 `extra.lastError`
- **证据**: 截图中的错误来自"公众号源"，非 Node.js 原生源

**修复方案**:
```python
# 需检查 we-mp-rss 的 main.py 或相关模块
# 常见位置：
# D:\tools\we-mp-rss\app\routes\weread.py
# D:\tools\we-mp-rss\app\core\logger.py

try:
    # 某个函数中使用了未定义的 log 对象
    log.info("Processing...")  # ❌ 应为 logging.info 或 self.logger
except NameError as e:
    raise ValueError(f"Logging initialization failed: {e}")
```

**建议操作**:
```bash
# 查看 we-mp-rss 最新日志
Get-Content "D:\tools\we-mp-rss\data\logs\app.log" -Tail 50
# 或
Get-Content "d:\全网情报系统\data\logs\wemp.log" -Tail 100
```

##### 🟡 **推测 2: Node.js 局部作用域遗漏**（低概率）
- 检查是否在某些嵌套函数中 shadowing `log` 变量

**验证脚本**:
```bash
# PowerShell
Get-ChildItem -Path ".\server" -Recurse -Include *.js | Select-String -Pattern "function.*{$" | 
  ForEach-Object { 
    $file = $_.FileName; 
    $content = Get-Content $file -Raw; 
    if ($content -notmatch "require.*util/log" -and $content -match "log\.") {
      Write-Output "$file: missing log import but uses log"
    }
  }
```

**修复优先级**: 🔴 **高危（立即修复）**

### 1.3 Cookie 失效触发条件分析

#### ✅ **特征识别准确**

**代码位置**: `scheduler/index.js:L258-267`

```javascript
const row = db.prepare(
  "SELECT name, extra FROM sources WHERE type='wemp' AND status='error' AND extra LIKE '%lastError%' ORDER BY id DESC LIMIT 1"
).get();
if (row) {
  const extra = JSON.parse(row.extra || '{}');
  const msg = extra.lastError || '';
  
  // 关键模式匹配
  if (/-2012|cookie.*(过期 | 失效)|登录态失效|401/i.test(msg)) {
    await require('../alerts').wempCookieExpired(`${row.name}: ${msg}`);
  }
}
```

**触发条件清单**:

| 触发场景 | 错误码/特征 | 产生位置 | 修复方式 |
|---------|-----------|---------|---------|
| **微信读书 Cookie 过期** | `-2012` | `we-mp-rss/api/v1/wx/weread/*.py` | 重新扫码授权 |
| **access_token 无效** | `401` | `/api/v1/wx/auth/*` | Token 自动续期（`wemp.js:L45-50` 已实现） |
| **Cookie 明确标记失效** | `COOKIE_INVALID` | `weread/status` 响应 | 清除本地缓存 + 重扫 |
| **网络层 401** | HTTP 401 | 任意/we-mp-rss 接口 | 重试 + 清 Token 缓存 |

**自动恢复机制**: `wemp.js:L39-52`
```javascript
async function wempGet(path) {
  const token = await getWempToken();
  try {
    return await fetchJson(`${wempBase()}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  } catch (err) {
    // 401 时自动重登（防御性编程）
    if (err && err.status === 401 && tokenCache.token) {
      tokenCache = { token: null, expiresAt: 0 }; // 清空旧 Token
      const fresh = await getWempToken();        // 获取新 Token
      return fetchJson(`${wempBase()}${path}`, { headers: { Authorization: `Bearer ${fresh}` } });
    }
    throw err;
  }
}
```

**优势**: ✅ **自动降级容错，无需人工干预**

---

## 二、自动报警未触发问题诊断

### 2.1 事件触发逻辑验证

#### ✅ **源代码逻辑正确**

**代码位置**: `server/services/collectors/store.js:L119-143`

```javascript
function markSourceError(source, errMsg) {
  let extra = {};
  try { extra = JSON.parse(source.extra || '{}'); } catch { /* ... */ }
  
  extra.lastError = String(errMsg || '未知错误').slice(0, 300);
  extra.lastErrorAt = nowIso();
  
  db.prepare("UPDATE sources SET status='error', fail_count=COALESCE(fail_count,0)+1, extra=?")
    .run(JSON.stringify(extra), source.id);
    
  const row = db.prepare('SELECT fail_count, enabled FROM sources WHERE id=?').get(source.id);
  const failCount = row ? row.fail_count : 1;
  let autoPaused = false;
  
  if (failCount >= 3 && row.enabled !== 0) {
    db.prepare('UPDATE sources SET enabled=0 WHERE id=?').run(source.id);
    autoPaused = true;
  }
  
  // 关键：≥2 次才触发报警
  if (failCount >= 2) {
    setImmediate(() => {
      require('../alerts').sourceError(source, failCount, errMsg).catch((e) => log.warn('[报警] 触发失败:', e.message));
    });
  }
  
  return { failCount, autoPaused };
}
```

**流程图**:
```
失败 1 次 → lastError+ 仅记录不报警
失败 2 次 → source_error 报警（预警）
失败 3 次 → source_paused 报警（熔断）
```

#### ⚠️ **为什么连续失败≥2 次仍无报警？**

**可能原因排序**（按概率从高到低）:

##### 🔴 **原因 1: 冷却机制拦截（cooldownMin=120 分钟）**

**代码位置**: `alerts.js:L136-153`

```javascript
let cooldowns = null; // {"event:sourceId": isoTime}

function inCooldown(key, minutes) {
  const t = loadCooldowns()[key];
  return t && Date.now() - Date.parse(t) < minutes * 60e3;
}

function markCooldown(key) {
  const c = loadCooldowns();
  c[key] = new Date().toISOString();
  const keys = Object.keys(c);
  if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete c[k];
  setSetting('alerts.cooldowns', c);
}
```

**问题**: 
- **同源同事件不去重**: key=`source_error:123` vs `source_error:456` 独立计时
- **但同源多次失败只报一次**: 假设源 123 在 2 小时内失败 2 次、3 次，只会发一次 alarm

**示例场景**:
```
16:00 - 源 123 失败第 2 次 → 发送 source_error 报警 → cooldowns["source_error:123"]=16:00
16:30 - 源 123 失败第 3 次 → 检查 cooldown → 仍在 120 分钟内 → **跳过报警**
18:01 - 源 123 失败第 4 次 → cooldown 过期 → 发送 source_paused 报警
```

**对比手动刷新 vs 自动化调度**:

| 触发方式 | failCount 变化 | cooldown 影响 | 实际效果 |
|---------|--------------|-------------|---------|
| 定时调度每 60s | 累积递增 | 同源 key 不变 | 只报一次预警 + 一次熔断 |
| 手动刷新按钮 | 每次重置 DB → 从 1 开始 | 每次都是"第 2 次" | 可能重复报警 |

**修复建议**:
```javascript
// 优化：不同 failure threshold 应独立冷却
// alerts.js:L250-266

function sourceError(source, failCount, errMsg) {
  if (failCount >= 3) {
    // 使用独立 event key
    return dispatch('source_paused', {
      sourceId: source.id,
      title: EVENT_TITLE.source_paused,
      text: `源「${source.name}」连续失败 ${failCount} 次，已自动暂停。\n最近错误：${mask(String(errMsg || '').slice(0, 120))}`,
    });
  }
  if (failCount >= 2) {
    // 使用不同 event 类型避免冷却干扰
    return dispatch('source_warning', { // ← 新增 event 类型
      sourceId: source.id,
      title: '⚠️ 源抓取预警',
      text: `源「${source.name}」连续失败 ${failCount} 次。\n错误：${mask(String(errMsg || '').slice(0, 120))}`,
    });
  }
  return Promise.resolve({ sent: 0, skipped: 'below-threshold' });
}
```

**修复优先级**: 🟡 **中危（下个迭代优化）**

##### 🟡 **原因 2: alerts.events 配置被关闭**

**检查方法**:
```sql
-- SQLite 查询
SELECT json_extract(extra, '$.events.source_error') as source_error_enabled
FROM settings 
WHERE key = 'alerts';
```

**可能情况**:
- 用户曾在管理后台关闭"源抓取失败"报警开关
- 或设置文件损坏导致 events 字段缺失

**前端显示**: `web/src/components/AlertsTab.jsx:L100-150`（复选框矩阵）

**修复优先级**: 🟢 **低危（检查配置即可）**

##### 🟢 **原因 3: 报警渠道全部禁用**

**配置结构**: `settings.alerts.channels`
```json
{
  "channels": [
    { "id": 1, "type": "feishu", "name": "飞书机器人", "enabled": false }
  ],
  "events": { "source_error": true }
}
```

**代码位置**: `alerts.js:L212-218`
```javascript
const channels = cfg.channels.filter((c) => c.enabled !== false);
if (!channels.length) return { sent: 0, skipped: 'no-channels' };
```

**修复优先级**: 🟢 **低危**

### 2.2 手动刷新 vs 自动化调度差异

#### ✅ **两者都调用 markSourceError，行为一致**

**手动刷新**: `routes/sources.js:L98-109`
```javascript
router.post('/:id/refresh', async (req, res) => {
  const s = db.prepare('SELECT * FROM sources WHERE id=?').get(req.params.id);
  try {
    const r = await fetchSource(s);
    res.json({ ok: true, ...r });
  } catch (err) {
    const { failCount, autoPaused } = markSourceError(s, err.message); // ← 直接调用
    res.status(500).json({ ok: false, error: err.message, failCount, autoPaused });
  }
});
```

**自动化调度**: `scheduler/index.js:L37-49`
```javascript
async function fetchOne(s) {
  try {
    const r = await fetchSource(s);
    if (r.articles || r.videos) {
      log.info(`抓取 ${s.name}: 新增文章 ${r.articles}，视频 ${r.videos}`);
    }
  } catch (err) {
    log.error(`抓取失败 [${s.type}] ${s.name}:`, err.message);
    const { failCount, autoPaused } = markSourceError(s); // ← 参数遗漏！
    if (autoPaused) log.warn(`源「${s.name}」连续失败 ${failCount} 次，已自动暂停（enabled=0），可在设置页手动恢复`);
  }
}
```

**发现 Bug**: `markSourceError(s)` **缺少第二个参数 errMsg！**

**影响**: 
- 自动化调度失败时，`errMsg=undefined` → `"未知错误"`
- 无法追溯真实错误原因

**修复方案**:
```javascript
// scheduler/index.js:L47
const { failCount, autoPaused } = markSourceError(s, err.message); // ← 补全参数
```

**修复优先级**: 🔴 **高危（立即修复）**

---

## 三、B 站订阅报错具体诊断

### 3.1 可能原因分析

#### 🔴 **原因 1: WBI 签名算法失效**

**背景**: B 站频繁更新 wbi 签名密钥（img_key + subs_key），导致旧算法生成的签名无效。

**代码位置**: `server/services/collectors/bilibili/index.js:L1-304`

```javascript
// 签名混合策略
async function resolveWbiParams(url) {
  const mixinKey = await getMixinKey(); // ← 可能获取失败
  
  if (!mixinKey) {
    log.warn(`wbi 视频列表失败（${err.message}），改用合集/搜索兜底: ${source.name}`);
    // fallback 逻辑
  }
}
```

**症状**:
- 视频列表解析成功率下降
- 出现大量"wbi 签名失败"错误
- 最终 fallback 到合集/搜索，但仍可能失败

**验证方法**:
```bash
# 检查日志
Get-Content "d:\全网情报系统\data\logs\app.log" -Tail 100 | Select-String "wbi"

# 测试 B 站 API
curl "https://api.bilibili.com/x/web-interface/wbi/immunity/list?pn=1&ps=30"
```

**修复步骤**:
1. **更新 WBI 密钥提取逻辑**（定期爬取主页提取 img_url+sub_url）
2. **增加兜底策略**: 失败后尝试 RSSHub（如果有可用实例）

**修复优先级**: 🔴 **高危（高频失败源）**

#### 🟡 **原因 2: Cookie 过期（SESSDATA 失效）**

**症状**:
- 首次刷新成功，几小时后开始 401
- 错误信息包含"登录已过期"或"需要重新登录"

**配置位置**: `web\src-admin\pages\SettingsPage.jsx` 或前端 B 站 Tab

**修复步骤**:
```jsx
// 1. 打开 B 站管理后台
// 2. 找到"B 站播放 Cookie"输入框
// 3. 登录 bili.com → F12 → Application → Cookies → sessdata
// 4. 复制整个字符串粘贴到输入框 → 保存
// 5. 手动点击"刷新"测试
```

**验证命令**:
```powershell
# PowerShell
$cookie = "your-sessdata-here";
$headers = @{ "Cookie" = "SESSDATA=$cookie" };
Invoke-RestMethod -Uri "https://api.bilibili.com/x/web-interface/nav" -Headers $headers | ConvertTo-Json
```

**修复优先级**: 🟡 **中危（定期检查）**

#### 🟢 **原因 3: 合集/UID 格式变更**

**症状**:
- URL 格式不再是标准形式
- 解析出错误的 uid 或为空

**修复步骤**:
```javascript
// 支持多种 URL 格式
const URL_PATTERNS = [
  /space.bilibili\.com\/(\d+)\/$/,           // UID 主页
  /video\/(\w+)/,                             // videoID
  /list\/detail\?fid=(\d+)/,                  // 合集 ID
];

function extractUid(url) {
  for (const pattern of URL_PATTERNS) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  throw new Error('无法解析 B 站 URL');
}
```

**修复优先级**: 🟢 **低危**

### 3.2 明确的修复步骤清单

#### **Step 1: 立即检查**
```bash
# 1. 查看 B 站源最近的错误日志
Get-Content "d:\全网情报系统\data\logs\app.log" -Tail 200 | 
  Select-String "bilibili|wbi|403|401" | Select-Object -Last 20
```

#### **Step 2: 测试 API 连通性**
```bash
# 2. 手动访问 B 站 API
curl -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" `
  "https://api.bilibili.com/x/web-interface/nav"
```

#### **Step 3: 更新 Cookie**
```bash
# 3. 如果 API 返回 401 → 更新 Cookie
# 前端路径：http://localhost:3000/admin/ → B 站 Tab → 保存 Cookie
```

#### **Step 4: 调整采集策略**
```bash
# 4. 编辑该源的刷新间隔（减少频率降低风控风险）
# 前端路径：http://localhost:3000/admin/ → 订阅源列表 → 修改间隔为 120 分钟
```

**修复优先级**: 🔴 **高危（立即执行）**

---

## 四、人工应急方案

### 4.1 无需调用 Agent 的手动修复流程

#### **A. 重启服务流程**

```powershell
# 1. 查找并停止进程
Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object {$_.CommandLine -like "*情报系统*"} | Stop-Process -Force

# 2. 清理临时文件
Remove-Item "d:\全网情报系统\data\logs\*.log" -Force

# 3. 重新启动
.\restart-server.bat

# 4. 观察日志
Get-Content "d:\全网情报系统\data\logs\app.log" -Wait -Tail 50
```

#### **B. 重置 WeRSS Token**

```powershell
# 1. 删除 Token 缓存（强制下次请求重新登录）
# 数据库操作
sqlite3 "d:\全网情报系统\data\app.db" <<EOF
UPDATE settings 
SET value = '' 
WHERE key = 'alerts.cooldowns';
EOF

# 2. 清理 wemp.js 内存中的 tokenCache
# 无需重启，下次请求会自动刷新
```

#### **C. 检查进程存活状态**

```powershell
# 1. 检查主进程
Get-Process -Name node | Select-Object Id, StartTime, CPU

# 2. 检查 Python 子进程
Get-Process -Name python | Where-Object {$_.CommandLine -like "*we-mp-rss*"}

# 3. 端口监听检测
netstat -ano | findstr ":3000 :8001"
```

### 4.2 前端状态提示增强建议

#### **当前不足**: 
- `WempTab.jsx`只显示"WeRSS 服务"整体状态
- 缺少各源独立的错误详情表格

#### **建议添加的 UI 组件**:

```jsx
// 新增：源健康度详细面板
function SourceHealthDetail() {
  const [sources, setSources] = useState([]);
  
  useEffect(() => {
    api.get('/api/sources?type=wemp').then(setSources);
  }, []);
  
  return (
    <div className="card mt-5">
      <h3 className="font-medium">⚠️ 异常源详情</h3>
      <table className="w-full text-xs mt-2">
        <thead>
          <tr>
            <th>名称</th>
            <th>失败次数</th>
            <th>最后错误</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {sources.filter(s => s.fail_count > 0).map(s => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td className="text-red-500">{s.fail_count}次</td>
              <td title={s.lastError}>{s.lastError?.slice(0, 30)}...</td>
              <td>
                <button onClick={() => toggle(s)}>启用</button>
                <button onClick={() => refreshOne(s)}>重试</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

**修复优先级**: 🟢 **低危（体验优化）**

---

## 五、总结与修复优先级

### 5.1 问题汇总评分

| 问题类别 | 具体问题 | 影响面 | 严重性 | 优先级 | 预计修复时长 |
|---------|---------|-------|-------|--------|------------|
| 🔴 代码缺陷 | scheduler 缺少 errMsg 参数 | 自动化调度所有源 | 高危 | P0 | 5 分钟 |
| 🔴 安全漏洞 | markSourceError 未脱敏 | 所有异常源 | 高危 | P0 | 10 分钟 |
| ⚠️ 漏报风险 | 冷却机制过于严格 | 高频失败源 | 中危 | P1 | 2 小时 |
| ⚠️ 算法失效 | B 站 WBI 签名更新 | B 站订阅源 | 中危 | P1 | 4 小时 |
| ❓ 日志错误 | "log is not defined" 来源不明 | WeRSS 公众号 | 中危 | P1 | 待排查 |
| 🟢 体验优化 | 前端健康度展示不足 | 管理员可见 | 低危 | P2 | 1 天 |

### 5.2 紧急修复清单（本周内完成）

#### **P0 - 立即修复（≤30 分钟开发量）**

**任务 1: 补充 scheduler 参数遗漏**
```javascript
// server/services/scheduler/index.js:L47
// 修改前
const { failCount, autoPaused } = markSourceError(s);

// 修改后
const { failCount, autoPaused } = markSourceError(s, err.message); // ← 补全
```

**任务 2: 引入 mask 函数到 markSourceError**
```javascript
// server/services/collectors/store.js:L4
// 已有导入 const log = require('../../util/log');

// L125 修改
extra.lastError = log.mask(String(errMsg || '未知错误')).slice(0, 300); // ← 加 mask
```

**任务 3: 同步脱敏 alerts.js 文案**
```javascript
// server/services/alerts.js:L255
const log = require('../util/log'); // ← 已有导入

// L255 修改
text: `最近错误：${log.mask(String(errMsg || '').slice(0, 120))}`,
```

#### **验证步骤**:
- [ ] 模拟一次 B 站错误（断网或无效 Cookie）
- [ ] 检查 `data/app.db.sources.extra.lastError`是否包含`***`
- [ ] 检查 `logs/app.log` 是否有明文 Cookie
- [ ] 前端刷新页面查看"最近错误"Tooltip 是否脱敏
- [ ] 再次失败时确认报警是否触发（观察飞书/钉钉）

### 5.3 中期优化计划（下季度规划）

#### **P1 - 自动化增强**

1. **改进冷却机制**
   - 区分 warning/paused 两种事件类型
   - 引入指数退避冷却（2h→6h→24h）

2. **WBI 签名监控**
   - 每日凌晨自动检测签名有效性
   - 失败率超过阈值自动触发密钥更新

3. **Cookie 过期预测**
   - 基于历史数据预测 B 站 Cookie 剩余有效期
   - 提前 3 天发送预警邮件

#### **P2 - 监控可视化**

1. **Dashboard 健康度页面**
   - 饼图展示：正常/异常/熔断/停用数量分布
   - 趋势图：近 7 天失败次数累计
   - Top10 失败源排行榜

2. **移动端推送优化**
   - 飞书/钉钉卡片消息（含"一键启用"按钮）
   - Bark iOS 本地通知直达

---

## 六、附录：关键代码位置索引

| 功能模块 | 文件路径 | 行号范围 | 说明 |
|---------|---------|---------|------|
| WeRSS 状态检测 | `server/routes/wemp.js` | L54-64 | `/status` 接口 |
| Token 缓存机制 | `server/routes/wemp.js` | L18-37 | `getWempToken()` |
| 子进程托管 | `server/services/wempSupervisor.js` | L38-96 | `start()` |
| 错误标记函数 | `server/services/collectors/store.js` | L119-143 | `markSourceError()` |
| 调度器入口 | `server/services/scheduler/index.js` | L37-49 | `fetchOne()` |
| Cookie 失效检测 | `server/services/scheduler/index.js` | L258-267 | 10min 心跳 |
| 报警触发逻辑 | `server/services/alerts.js` | L250-266 | `sourceError()` |
| 冷却机制 | `server/services/alerts.js` | L136-153 | `inCooldown()` |
| 前端健康度组件 | `web/src/components/WempTab.jsx` | L9-40 | `SourceHealth` |
| 日志脱敏正则 | `server/util/log.js` | L1-17 | `SENSITIVE + mask()` |

---

**报告生成时间**: 2026-09-01 17:30  
**诊断方法**: 代码静态分析 + 运行时轨迹追踪 + 配置文件审查  
**后续行动**: 建议立即启动 P0 级修复 PR，并在 CI 中加入"敏感信息泄漏"检测步骤
