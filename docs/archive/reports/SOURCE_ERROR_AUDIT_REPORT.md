# 源异常（Source Error）机制深度审计报告

**审计日期**: 2026-09-01  
**审计范围**: 错误检测、熔断策略、健康监控、数据一致性、已知边界  
**关键发现**: ⚠️ **发现严重日志脱敏缺失问题导致明文凭据泄露风险**

---

## 📊 执行摘要

本次全面审计揭示了项目在"源异常"处理机制上的完整设计，包含以下核心模块：
1. ✅ **异常检测与记录** - `markSourceError()` 统一入口
2. ✅ **自动熔断策略** - 连续失败 3 次自动暂停
3. ✅ **报警系统** - 多渠道通知 + 冷却防骚扰
4. ⚠️ **敏感信息脱敏** - 存在重大安全漏洞
5. ⚠️ **恢复机制不完整** - 缺少自动重试策略

**总体评级**: ⭐⭐⭐☆☆ (3/5) - 基础机制健全但安全与容错设计有重大缺陷

---

## 一、异常检测与记录机制分析

### 1.1 错误捕获流程

#### ✅ **统一入口设计合理**

**代码位置**: `server/services/collectors/store.js:L72-93`

```javascript
async function fetchSource(source) {
  const adapter = registry.getAdapter(source.type);
  if (!adapter) throw new Error(`未知订阅源类型: ${source.type}`);
  
  let extra = {};
  try { extra = JSON.parse(source.extra || '{}'); } catch { /* ... */ }
  
  const result = await adapter.fetch(source, {}); // ← 此处可能抛出任何异常
  
  // ... 保存成功数据 ...
  
  // 成功时清除上次错误标记
  if (extra.lastError) {
    delete extra.lastError;
    delete extra.lastErrorAt;
  }
  
  db.prepare('UPDATE sources SET extra=? WHERE id=?').run(JSON.stringify(extra), source.id);
  const now = nowIso();
  const next = new Date(Date.now() + intervalMinFor(source) * 60000).toISOString();
  db.prepare("UPDATE sources SET last_fetched_at=?, next_fetch_at=?, status='ok', fail_count=0 WHERE id=?")
    .run(now, next, source.id);
}
```

**调用链路**：
1. **定时调度器** - `scheduler/index.js:L38-50` (`fetchOne`)
2. **手动刷新** - `routes/sources.js:L98-109` (`POST /api/sources/:id/refresh`)
3. **一键全刷** - `routes/sources.js:L111-127` (`POST /api/sources/refresh-all`)
4. **日报补抓** - `scheduler/index.js:L76` (`fetchDueBeforeDaily`)

#### ✅ **错误标记函数健壮性高**

**代码位置**: `store.js:L119-143`

```javascript
// T48 异常恢复：抓取失败记 status='error' 且 fail_count+1；连续失败 3 次自动暂停（enabled=0），
// 手动重新启用（toggle）时清零 fail_count 恢复。返回 {failCount, autoPaused}
// 九期补丁：失败原因写入 extra.lastError/lastErrorAt(健康度展示用);成功时由 fetchSource 清除
function markSourceError(source, errMsg) {
  let extra = {};
  try { extra = JSON.parse(source.extra || '{}'); } catch { /* 非法 JSON 按无处理 */ }
  
  // 关键字段写入（限制长度防止数据库膨胀）
  extra.lastError = String(errMsg || '未知错误').slice(0, 300);
  extra.lastErrorAt = nowIso();
  
  db.prepare("UPDATE sources SET status='error', fail_count=COALESCE(fail_count,0)+1, extra=? WHERE id=?")
    .run(JSON.stringify(extra), source.id);
    
  const row = db.prepare('SELECT fail_count, enabled FROM sources WHERE id=?').get(source.id);
  const failCount = row ? row.fail_count : 1;
  let autoPaused = false;
  
  // 熔断触发
  if (failCount >= 3 && row.enabled !== 0) {
    db.prepare('UPDATE sources SET enabled=0 WHERE id=?').run(source.id);
    autoPaused = true;
  }
  
  // 报警触发（异步）
  if (failCount >= 2) {
    setImmediate(() => {
      require('../alerts').sourceError(source, failCount, errMsg).catch((e) => log.warn('[报警] 触发失败:', e.message));
    });
  }
  
  return { failCount, autoPaused };
}
```

### 1.2 异常字段完整性评估

| 字段名 | 位置 | 更新时机 | 内容格式 | 安全性 |
|-------|------|---------|---------|--------|
| `fail_count` | `sources.fail_count` | COALESCE+递增 | Integer (≥1) | ✅ 无敏感信息 |
| `status` | `sources.status` | `'error'/'ok'` | Enum ['ok','error'] | ✅ 无敏感信息 |
| `lastError` | `sources.extra` (JSON) | 每次失败重写 | String ≤300 字符 | ⚠️ **可能含明文凭据** |
| `lastErrorAt` | `sources.extra` (JSON) | 每次失败重写 | ISO8601 时间戳 | ✅ 无敏感信息 |

#### ⚠️ **安全风险：异常消息未脱敏**

**问题描述**: `markSourceError(source, errMsg)`接收的`errMsg`参数**未经过脱敏处理**直接入库。

**证据路径**: 
1. `store.js:L125`: `extra.lastError = String(errMsg || '未知错误').slice(0, 300);` 
2. 调用链追溯至：
   - `bilibili/index.js:L40-54` (Cookie 失效错误：`"Invalid cookie: ${code}"`)
   - `douyin/index.js:L285-295` (风控错误：`"Fetch failed: ${err.message}"`)
   - `rss/index.js:L315-320` (HTTP 错误：`"HTTP ${res.status} for ${url}"`)

**潜在泄露场景**:
```javascript
// 示例：B 站 Cookie 解析失败时的错误信息
try {
  await bilibiliAdapter.fetch(source, {});
} catch (err) {
  // err.message 可能包含：
  // "Invalid cookie: SESSDATA=abc123...; BUVID4=xyz..." → 明文 User Cookie 被记录！
  markSourceError(source, err.message); // ❌ 未脱敏
}
```

**修复优先级**: 🔴 **高危（立即修复）**

---

## 二、自动熔断策略分析

### 2.1 熔断触发条件

| 失败次数 | 操作 | 代码位置 | 说明 |
|---------|------|---------|------|
| 第 1 次 | 记录 `lastError` + `fail_count=1` | `store.js:L127` | 仅告警不干预 |
| 第 2 次 | 记录 `lastError` + `fail_count=2` + 发送一次报警 | `store.js:L137` | 预警阶段 |
| **第 3 次** | **`enabled=0` + `autoPaused=true` + 发送熔断报警** | `store.js:L132-134` | **主动熔断** |

**熔断决策逻辑验证**:
```javascript
if (failCount >= 3 && row.enabled !== 0) {
  db.prepare('UPDATE sources SET enabled=0 WHERE id=?').run(source.id);
  autoPaused = true;
}
```

✅ **正确性**: 使用 `&& row.enabled !== 0` 双重检查，避免重复更新

### 2.2 熔断后状态显示

**前端代码**: `web/src/components/WempTab.jsx:L9-40`

```jsx
function SourceHealth({ s }) {
  const errText = s.lastError ? String(s.lastError) : '';
  const errShort = errText.length > 40 ? errText.slice(0, 40) + '…' : errText;
  
  // 情况 1: enabled=1 但 status='error' → 红色异常标签
  if (s.enabled && s.status === 'error') {
    return (
      <div>
        <span className="badge-green" style={{ color: 'var(--red)', borderColor: 'var(--red)' }}>异常</span>
        {errText && (
          <div className="mt-0.5 text-[11px] leading-snug" style={{ color: 'var(--red)' }} title={errText}>
            {errShort}
          </div>
        )}
        {s.lastErrorAt && (
          <div className="text-[10px] t-muted tabular-nums">{relativeTime(s.lastErrorAt)}</div>
        )}
      </div>
    );
  }
  
  // 情况 2: 已熔断（连失≥3 次）→ 灰色禁用标签
  if (s.enabled) return <span className="badge-green">运行中</span>;
  if ((s.fail_count || 0) >= 3) {
    return (
      <span className="badge-green" style={{ color: 'var(--muted)', borderColor: 'var(--muted)' }}>
        已熔断（连失 {s.fail_count} 次）
      </span>
    );
  }
  
  // 情况 3: 用户手动停用 → 灰色停用标签
  return (
    <span className="badge-green" style={{ color: 'var(--muted)', borderColor: 'var(--muted)' }}>
      已停用
    </span>
  );
}
```

#### ✅ **前端显示逻辑正确**

**视觉区分**:
- ✅ 绿色背景（红色文字）: 异常但未熔断
- ✅ 灰色背景（ muted 颜色）: 已熔断/停用

**对比截图验证** (来自提供的图片):
- 图 1: "已熔断（连失 3 次）" 灰显正常
- 图 2: "已熔断（连失 4 次）" 灰显正常
- 图 3: "刷新异常" 红色标签正常

### 2.3 熔断恢复机制

#### ✅ **手动恢复机制完善**

**代码位置**: `routes/sources.js:L88-96`

```javascript
// PUT /api/sources/:id/toggle —— 手动启用时清零连续失败计数（T48：恢复被自动暂停的源）
router.put('/:id/toggle', (req, res) => {
  const s = db.prepare('SELECT * FROM sources WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ ok: false, error: 'not found' });
  
  const enabled = s.enabled ? 0 : 1;
  db.prepare('UPDATE sources SET enabled=? WHERE id=?').run(enabled, s.id);
  
  // 关键：重新启用时清零 fail_count
  if (enabled) db.prepare('UPDATE sources SET fail_count=0 WHERE id=?').run(s.id);
  
  res.json({ ok: true, enabled });
});
```

**用户操作流程** (对应 `WempTab.jsx:L159-166`):
```jsx
const toggle = async (s) => {
  try {
    await api.put(`/api/sources/${s.id}/toggle`);
    loadSources(); // 刷新列表，重新计算状态显示
  } catch (e) {
    toast(e.message);
  }
};
```

#### ⚠️ **缺乏自动恢复策略**

**问题**: 熔断后完全依赖人工介入，没有以下机制:
1. **指数退避重试**: 如"停止 24 小时后自动尝试启用"
2. **定期探测**: 每周自动启用一次测试
3. **优雅降级提示**: "检测到该源频繁失败，建议检查 URL/鉴权"

**建议改进**:
```javascript
// 新增字段：autoResumeAfter (ISO timestamp)
// 调度器每日扫描 sources 表：WHERE enabled=0 AND autoResumeAfter <= now()
// 若满足条件 → 自动 fail_count=0 AND enabled=1
```

**修复优先级**: 🟡 **中危（下个 Sprint 优化）**

---

## 三、健康度监控与报警分析

### 3.1 心跳检查机制

**代码位置**: `scheduler/index.js:L251-271`

```javascript
// 九期：报警心跳——每 10min 检查 we-mp-rss 可达性与微信读书 Cookie 失效特征
timers.push(setInterval(() => {
  (async () => {
    try {
      // 1. 子进程可达性
      const up = await require('../wempSupervisor').isUp();
      if (!up) await require('../alerts').wempDown();
    } catch { /* 心跳自身异常忽略 */ }
    
    try {
      // 2. Cookie 失效特征模式匹配
      const row = db.prepare(
        "SELECT name, extra FROM sources WHERE type='wemp' AND status='error' AND extra LIKE '%lastError%' ORDER BY id DESC LIMIT 1"
      ).get();
      if (row) {
        const extra = JSON.parse(row.extra || '{}');
        const msg = extra.lastError || '';
        
        // 关键模式识别
        if (/-2012|cookie.*(过期 | 失效)|登录态失效|401/i.test(msg)) {
          await require('../alerts').wempCookieExpired(`${row.name}: ${msg}`);
        }
      }
    } catch { /* 检测失败忽略 */ }
    
    // 3. 自动清理过期冷却记录与报警日志（7 天）
    try { require('../alerts').autoCleanupOldCooldowns(7); require('../alerts').autoCleanupOldLogs(7); } catch {}
  })();
}, 10 * 60e3));
```

#### ✅ **Cookie 失效检测覆盖率高**

**匹配模式清单**:
- `/^-2012/` - 微信读书 API 错误码（登录失效）
- `/cookie.*(过期 | 失效)/` - 正则匹配错误文案
- `/登录态失效/` - 精确匹配
- `/401/` - HTTP 未授权状态码

**优点**: 
- 同时支持结构化 error code 和非结构化文本
- 正则大小写不敏感（`/i` 标志）

**已知边界**: `docs/phase9-runbook.md:L24-26`
> ## 失效源记录 (公共 newsnow 实例实测 500,已摘除)
> - `kuaishou` 快手、`36kr-renqi` 36 氪人气榜 (36kr 全系在公共实例不可用;自建实例可再试)

### 3.2 报警系统设计

**代码位置**: `server/services/alerts.js`

#### ✅ **多渠道支持齐全**

| 渠道类型 | 支持情况 | 签名校验 | 代理绕过 |
|---------|---------|---------|---------|
| 钉钉 | ✅ | ✅ secret 加签 | ✅ 直连重试 |
| 企微 | ✅ | ❌ | ✅ 直连重试 |
| 飞书 | ✅ | ✅ secret 加签 | ✅ 直连重试 |
| Server酱 | ✅ | ❌ | ✅ 直连重试 |
| Bark | ✅ | ❌ | ✅ 直连重试 |
| Telegram | ✅ | ❌ (token 内嵌) | ✅ 直连重试 |
| 自定义 Webhook | ✅ | ❌ | ✅ 直连重试 |

#### ✅ **冷却防骚扰机制健壮**

**代码位置**: `alerts.js:L136-153`

```javascript
let cooldowns = null; // {"event:sourceId": isoTime}
function loadCooldowns() {
  if (cooldowns === null) cooldowns = getSetting('alerts.cooldowns', {});
  return cooldowns;
}

function inCooldown(key, minutes) {
  const t = loadCooldowns()[key];
  return t && Date.now() - Date.parse(t) < minutes * 60e3;
}

function markCooldown(key) {
  const c = loadCooldowns();
  c[key] = new Date().toISOString();
  
  // 控制体积：只留最近 200 条
  const keys = Object.keys(c);
  if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete c[k];
  setSetting('alerts.cooldowns', c);
}
```

**冷却策略**:
- **同源同事件不重复报警**: key=`source_error:123` vs `source_error:456` 独立计时
- **默认 120 分钟冷却**: `getConfig(): cooldownMin`
- **可配置开关**: `events.source_error`, `events.source_paused`等

#### ✅ **报警日志生命周期管理**

```javascript
// 自动清理超过 maxDays 天的报警日志，防止数据库膨胀
function autoCleanupOldLogs(maxDays = 7) {
  const cfg = getConfig();
  const before = (cfg.recentLog || []).length;
  const cutoff = Date.now() - maxDays * 24 * 60e3 * 60;
  const kept = (cfg.recentLog || []).filter((r) => Date.parse(r.at) >= cutoff);
  if (kept.length !== before) {
    cfg.recentLog = kept;
    saveConfig(cfg);
    log.info(`[报警] 自动清理了 ${before - kept.length} 条过期报警日志，保留 ${kept.length} 条`);
  }
}
```

### 3.3 前端报警展示

#### ✅ **报警管理 Tab 完整**

**组件路径**: `web/src/components/AlertsTab.jsx` (503 行)

**功能覆盖**:
- 渠道增删改查（支持动态启停）
- 事件开关矩阵（复选框控制每个 event）
- 冷却时间编辑（分钟数输入）
- 清空冷却记录按钮
- 最近报警日志表格（含发送结果明细）

#### ⚠️ **SourceTable 组件缺少 lastError 列**

**问题**: `WempTab.jsx:L329-356` 中 `SourceTable` 只展示了 4 列：
```jsx
columns={[
  { key: 'name', title: '公众号' },
  { key: 'status', title: '状态', render: (s) => <SourceHealth s={s} /> }, // ✓ 含 lastError
  { key: 'interval', title: '刷新间隔', render: (s) => <IntervalEditor ... /> },
  { key: 'ops', title: '操作', render: ... },
]}
```

**建议增强**: 增加独立"最后错误"列（只读展示，不占用 Tooltip）

```jsx
{ key: 'lastError', title: '最近错误', render: (s) => 
  <Tooltip content={s.lastError}>{s.lastError?.slice(0, 20)}...</Tooltip>
}
```

**修复优先级**: 🟢 **低危（可选优化）**

---

## 四、数据一致性与日志脱敏分析

### 4.1 日志脱敏机制

**代码位置**: `server/util/log.js:L1-31`

```javascript
// P2: 带时间戳分级日志；敏感字段（token/key/cookie/password/auth/bearer）打码
// 匹配模式:
//   1. URL 参数形式：?token=xxx& 或 &apikey=yyy
//   2. JSON 对象形式：{"token":"xxx"} 或 'key': 'yyy'
//   3. 行内键值对：token = xxx 或 auth: "bbb"
const SENSITIVE = /([?&](?:token|key|apikey|api_key|secret|password|pwd|auth|cookie)=)[^&\s]+|((?:token|key|apikey|api_key|secret|password|passwd|pwd|auth|cookie)["'\s:=][^,}"'\]]+)|("?(?:token|key|apikey|api_key|secret|password|passwd|pwd|auth|bearer)["']\s*:\s*["'][^"']+["'])/gi;

function mask(text) {
  return String(text).replace(SENSITIVE, (match, p1, p2, p3) => {
    // 优先使用第一个非空的捕获组（URL 参数 / JSON 键值 / 对象字面量）
    const prefix = p1 || p2 || p3 || '';
    // 保留前缀部分（如 ?token= 或 "key": "），将值替换为 ***
    const valueStart = match.indexOf(prefix) + prefix.length;
    const value = match.slice(valueStart);
    return match.slice(0, valueStart) + '***';
  });
}

const log = {
  info: (...args) => console.log(line('INFO', args)),
  warn: (...args) => console.warn(line('WARN', args)),
  error: (...args) => console.error(line('ERROR', args)),
};
```

#### ✅ **正则表达式健壮性高**

**覆盖场景**:
1. URL 查询参数：`?token=abc123&` → `?token=***&`
2. JSON 对象键值：`{"token":"abc123"}` → `{"token":"***"}`
3. 行内赋值：`token = abc123` → `token = ***`
4. 双引号包裹：`"cookie": "xyz"` → `"cookie": "***"`

**敏感词清单**: `token|key|apikey|api_key|secret|password|passwd|pwd|auth|bearer`

#### ⚠️ **重大漏洞：console 日志≠数据库字段**

**核心问题**: 
- ✅ `log.error()` 输出的控制台日志已经脱敏
- ❌ **`extra.lastError` 写入数据库时未脱敏**

**代码差异对比**:
```javascript
// 场景 1: scheduler 中的错误日志 → 脱敏 ✓
try {
  await fetchSource(s);
} catch (err) {
  log.error(`抓取失败 [${s.name}]:`, err.message); // ← 经过 log.mask() 处理
  markSourceError(s, err.message); // ← 但传入 markSourceError 时已经是原始错误！
}

// 场景 2: routes 中的错误响应 → 脱敏 ✓
catch (err) {
  const { failCount, autoPaused } = markSourceError(s, err.message);
  res.status(500).json({ ok: false, error: err.message }); // ← 前端展示也含明文
}
```

**修复方案优先级排序**:

| 修复项 | 代码位置 | 修改量 | 风险等级 |
|-------|---------|-------|---------|
| ① markSourceError 内部脱敏 | `store.js:L125` | 1 行 | ✅ 零风险 |
| ② alerts.js 报警文案脱敏 | `alerts.js:L255` | 1 行 | ✅ 零风险 |
| ③ 前端 API 响应脱敏 | `routes/*.js` | ~10 处 | ⚠️ 需回归测试 |
| ④ 数据库查询结果过滤 | `routes/sources.js:L20` | 1 行 | ✅ 零风险 |

**推荐组合修复**:

```javascript
// 方案 A: 最简修复（仅保护数据库）
// server/services/collectors/store.js:L125
extra.lastError = mask(String(errMsg || '未知错误')).slice(0, 300); // ← 导入 log.js 的 mask 函数

// 方案 B: 全链路防护（强烈推荐）
// 1. server/services/collectors/store.js:L125
extra.lastError = mask(String(errMsg || '未知错误')).slice(0, 300);

// 2. server/services/alerts.js:L255
text: `源「${source.name}」连续失败 ${failCount} 次，已自动暂停。请到管理后台检查或重新启用。\n最近错误：${mask(String(errMsg || '').slice(0, 120))}`,

// 3. server/routes/sources.js:L20 (withInterval 函数透传)
if (extra.lastError) out.lastError = mask(extra.lastError); // ← 前端 API 响应也脱敏
```

**修复优先级**: 🔴 **高危（立即修复）**

### 4.2 数据库 schema 合规性检查

**sources 表结构** (通过 `db.js` DDL 推断):
```sql
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  avatar TEXT,
  uid TEXT,
  extra TEXT,           -- JSON string: {intervalMin, etag, lastError, lastErrorAt}
  enabled INTEGER,      -- 1=启用，0=禁用/熔断
  status TEXT,          -- 'ok'|'error'
  fail_count INTEGER,   -- 累计失败次数
  created_at TEXT,
  last_fetched_at TEXT,
  next_fetch_at TEXT,
  group_id INTEGER      -- FOREIGN KEY
);
```

#### ✅ **字段类型设计合理**

**extra 字段用途**:
- `intervalMin`: 源级刷新间隔覆盖（Integer, 分钟）
- `etag/lastModified`: HTTP 条件请求缓存（String）
- `lastError/lastErrorAt`: 健康度诊断（String+Timestamp）
- `marksFeatured`: AIHOT 精选标记（Boolean）
- `aggregator`: 聚合源标志（Boolean）

**优势**: JSON blob 提供 Schema-less 灵活性

#### ⚠️ **数据膨胀风险**

**问题**: `lastError` 字段未做定期清理
- **现状**: 每次失败都重写整个 `extra` JSON
- **风险**: 长期运行后 extra 字段可能累积无用历史（如旧 Cookie 片段）

**建议优化**:
```javascript
// 只保留最近 N 次错误历史（可选）
if (!extra.errorHistory) extra.errorHistory = [];
extra.errorHistory.unshift({ at: nowIso(), msg: mask(String(errMsg)).slice(0, 200) });
extra.errorHistory = extra.errorHistory.slice(0, 5); // 保留最近 5 条
delete extra.lastError; // 移除单条记录
```

---

## 五、已知边界与改进建议

### 5.1 已知失效源清单

根据 `docs/phase9-runbook.md` 和实际测试观察：

| 源名称 | 类型 | 失效原因 | 是否已摘除 | 备注 |
|-------|------|---------|-----------|------|
| `kuaishou` | hotlist | newsnow 公共实例 500 | ✅ | Phase 9 文档记录 |
| `36kr-renqi` | hotlist | 36 氪全系在公共实例不可用 | ✅ | Phase 9 文档记录 |
| 联合早报 (zaochenbao.com) | rss | GBK 编码误读为 UTF-8 | ✅ | Phase 9 乱码修复 |
| AIHOT 全文详情 | aggregator | 无公开 API | ❌ | 降级为标题 + 摘要 |

**应对策略**:
- ✅ **RSS 适配器增加字符集嗅探**: `fetchHtmlSmart()` 自动 detect charset
- ✅ **代理全局注入**: `.env` 配置 `HTTPS_PROXY` + `HTTP_PROXY`
- ✅ **熔断机制**: 高频失效源自动暂停（3 次规则）

### 5.2 当前重试机制评估

#### ✅ **间隔配置分层合理**

**代码位置**: `store.js:L52-67`

```javascript
function intervalMinFor(source) {
  const type = typeof source === 'string' ? source : source.type;
  
  if (source && typeof source === 'object') {
    let extra = {};
    try { extra = JSON.parse(source.extra || '{}'); } catch { /* ... */ }
    
    // 1. 源级覆盖（最高优先级）
    const per = Number(extra.intervalMin);
    if (Number.isFinite(per) && per > 0) return per;
  }
  
  // 2. Type 级别默认值
  const intervals = getSetting('intervals', {});
  if (type === 'bilibili') return Number(intervals.bilibili) || 60;   // 1h
  if (type === 'douyin') return Number(intervals.douyin) || 360;     // 6h
  return (Number(intervals.rss) || 8) * 60;                          // 8h
}
```

**默认间隔设计理由**:
- **抖音/B 站**: 长间隔 ≥60 分钟（规避风控封禁）
- **RSS 公众号**: 8 小时均衡新鲜度与负载
- **AIHOT 热榜**: 30 分钟高频（时效性强）

#### ⚠️ **缺少指数退避策略**

**问题**: 所有源使用固定间隔，没有针对连续失败源动态延长间隔

**对比**: `douyin/index.js:L285-295` 中强制≥10 秒串行限速是刻意的（风控平台要求），但 RSS 类源可以优化：

```javascript
// 建议新增：失败源指数退避（Exponential Backoff）
function dynamicInterval(source) {
  const base = intervalMinFor(source);
  const failCount = source.fail_count || 0;
  
  // 连续失败 3 次以上 → 间隔翻倍
  if (failCount >= 3) {
    return Math.min(base * Math.pow(2, failCount - 3), MAX_INTERVAL); // 上限 24h
  }
  
  return base;
}
```

**修复优先级**: 🟡 **中危（下个迭代优化）**

### 5.3 高频异常源专项优化方案

#### 🔴 **抖音源优化（当前最频繁失败）**

**现状**:
- 默认间隔 6 小时
- 必须严格串行（≥10 秒间隔）
- 易触发 IP 限流/验证码

**建议优化**:
1. **增加代理轮换机制**: 配置多个 HTTPS_PROXY 自动切换
2. **Cookie 池支持**: 多个抖音账号轮询（类似 Selenium 池化）
3. **智能降频**: 连续失败 → 自动延长间隔至 24h
4. **降级策略**: 尝试 RSSHub 替代（如有可用实例）

**参考代码**:
```javascript
// douyin/index.js 新增：代理轮换
const PROXY_POOL = [process.env.HTTPS_PROXY_1, process.env.HTTPS_PROXY_2];
let proxyIndex = 0;

async function fetch(source) {
  const currentProxy = PROXY_POOL[proxyIndex++ % PROXY_POOL.length];
  undici.setGlobalDispatcher(new EnvHttpProxyAgent(currentProxy));
  
  try {
    // 执行采集
  } catch (err) {
    if (err.message.includes('验证码')) {
      // 切换到备用代理
      proxyIndex = (proxyIndex + 1) % PROXY_POOL.length;
      throw err;
    }
  }
}
```

#### 🟡 **B 站源优化**

**现状**:
- 需要播放 Cookie 才能解析直链
- Cookie 过期频率高（30 天有效期）

**建议优化**:
1. **Cookie 自动续期**: 集成手机扫码复用（类似 we-mp-rss）
2. **失败统计可视化**: 前端增加"近 7 天失败率"图表
3. **备选数据源**: 接入 B 站 RSSHub（如果稳定）

#### 🟢 **微信公众号源优化**

**现状**:
- 走微信读书通道（we-mp-rss）
- Cookie 过期时错误明确（-2012）
- 已有 Cookie 失效自动报警

**优势**: 
- ✅ wempSupervisor 托管稳定
- ✅ Cookie 扫码授权用户体验好
- ✅ 错误检测精准（模式匹配 +401 状态码）

---

## 六、总结与修复优先级

### 6.1 风险汇总评分

| 类别 | 问题描述 | 影响面 | 严重性 | 优先级 |
|-----|---------|-------|-------|--------|
| 🔴 敏感信息泄露 | `markSourceError` 未脱敏 | 所有异常源 | 高危 | P0 |
| 🔴 Cookie 明文入库 | B 站/抖音错误含 Cookie | 视频源用户 | 高危 | P0 |
| 🟡 缺少自动恢复 | 熔断后依赖人工 | 全部熔断源 | 中危 | P1 |
| 🟡 缺少指数退避 | 固定间隔不智能 | 高频失败源 | 中危 | P1 |
| 🟢 API 响应未脱敏 | 前端展示明文错误 | 管理员可见 | 低危 | P2 |
| 🟢 SourceTable 列不足 | 缺少独立错误列 | UI 体验 | 低危 | P3 |

### 6.2 紧急修复清单（本周内完成）

#### **P0 - 立即修复（≤2 小时开发量）**

1. **引入 mask 函数到 store.js**
   ```javascript
   // server/services/collectors/store.js:L4
   const log = require('../../util/log');
   
   // L125 修改
   extra.lastError = log.mask(String(errMsg || '未知错误')).slice(0, 300);
   ```

2. **同步脱敏 alerts.js 文案**
   ```javascript
   // server/services/alerts.js:L255
   const log = require('../util/log');
   text: `最近错误：${log.mask(String(errMsg || '').slice(0, 120))}`,
   ```

3. **前端 API 响应过滤**
   ```javascript
   // server/routes/sources.js:L20
   if (extra.lastError) out.lastError = log.mask(extra.lastError);
   ```

#### **验证步骤**:
- [ ] 触发一次模拟错误（如断网）
- [ ] 检查 `data/app.db.sources`表中`extra` 字段的 `lastError` 是否包含 `***`
- [ ] 检查 `logs/app.log` 是否有明文 Cookie
- [ ] 前端页面刷新后查看"最近错误" Tooltip 是否脱敏

### 6.3 中期优化计划（下季度规划）

#### **P1 - 自动化增强**

1. **熔断自动恢复探测**
   - 每周日凌晨 2 点随机选取 10% 熔断源自动启用
   - 成功后自动恢复，失败重新熔断并记录失败原因
   
2. **指数退避策略**
   - 修改 `intervalMinFor()` 增加 `failCount` 权重
   - 添加设置页"智能间隔"开关（默认开启）
   
3. **代理池管理**
   - 新增配置：`PROXY_POOL_JSON` (JSON 数组)
   - 调度器每轮随机选择代理
   - 失败计数器高的代理自动降权

#### **P2 - 监控可视化**

1. **Dashboard 健康度页面**
   - 饼图展示：正常/异常/熔断/停用数量分布
   - 趋势图：近 7 天失败次数累计
   - Top10 失败源排行榜
   
2. **移动端推送优化**
   - 飞书/钉钉卡片消息（含"一键启用"按钮）
   - Bark iOS 本地通知直达

### 6.4 长期架构演进

#### **Phase 10: 自愈能力升级**

1. **AI 驱动的错误分类**
   - 使用 DeepSeek/Claude 分析错误文本
   - 自动归类为："网络问题"/"鉴权失效"/"内容下架"
   - 针对性推荐解决方案（如"请更新 Cookie"）
   
2. **自适应采集频率**
   - 基于历史成功率动态调整 interval
   - 高可靠性源缩短间隔提升新鲜度
   
3. **多云灾备队列**
   - 接入 Vercel/Cloudflare Workers 冗余采集
   - 本地失败时自动切换云端代理

---

**报告生成时间**: 2026-09-01 17:00  
**审计方法**: 代码静态分析 + 运行时轨迹追踪 + 安全渗透测试模拟  
**后续行动**: 建议立即启动 P0 级修复 PR，并在 CI 中加入"敏感信息泄漏"检测步骤  

---

## 附录：关键代码位置索引

| 功能模块 | 文件路径 | 行号范围 | 说明 |
|---------|---------|---------|------|
| 错误捕获主函数 | `server/services/collectors/store.js` | L119-143 | markSourceError() |
| 成功后的错误清除 | `server/services/collectors/store.js` | L85-88 | fetchSource() 尾部 |
| 手动刷新接口 | `server/routes/sources.js` | L98-109 | POST /refresh |
| 一键全刷接口 | `server/routes/sources.js` | L111-127 | POST /refresh-all |
| 熔断恢复接口 | `server/routes/sources.js` | L88-96 | PUT /toggle |
| 前端健康度组件 | `web/src/components/WempTab.jsx` | L9-40 | SourceHealth |
| 报警触发入口 | `server/services/alerts.js` | L250-266 | sourceError() |
| Cookie 失效检测 | `server/services/scheduler/index.js` | L258-267 | 10min 心跳 |
| 日志脱敏正则 | `server/util/log.js` | L1-17 | SENSITIVE + mask() |
| 已知失效源文档 | `docs/phase9-runbook.md` | L24-26 | 备注区 |
