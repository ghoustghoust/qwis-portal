# 全网情报系统 — 全局审计修复清单（2026-09-02）

> 工作流：全局审计 → 优先级排序 → 依次修复 → 验证 → 对抗性审查
> 修复范围：刷新源机制 / 采集器逻辑 / 调度器竞态 / 公众号引擎自愈
> 验证基线：`npm test` 71/71 通过、`npm run build` 前端构建通过、逐项 handler 级对抗测试
> 证据文件：`tools/.verify-p0.json`、`.verify-p02.json`、`.verify-p11.json`、`.reschedule-out.json`、`.probe-a.json`、`.probe-b.json`

---

## 一、修复前后对比总表

### 1.1 风险分布对比

| 风险等级 | 修复前（未修复项） | 修复后（剩余项） | 变化 |
|---|---|---|---|
| 🔴 高 | 4（P0-1 interval、P0-2 丢文、P0-3 SQL、P2-2 GBK） | **0** | ✅ 全部消除 |
| 🟡 中 | 3（P1-1 崩溃不自愈、P1-2 前端不刷新、P1-3 静默失败） | **0** | ✅ 全部消除 |
| 🟢 低 | 3（P2-1 竞态、P2-3 漂移、P2-4 补抓弱） | **0** | ✅ 全部消除 |
| **合计** | **10** | **0** | **10/10 已修复** |

### 1.2 问题清单与状态

| # | 问题描述 | 风险 | 影响面 | 状态 | 修改文件 |
|---|---------|------|-------|------|---------|
| P0-1 | PUT interval 不重算 next_fetch_at → 65 wemp 源按 8h 跑 | 🔴 | 65 wemp 源 | ✅ 已修复+验证 | sources.js |
| P0-2 | pubDate 过滤器永久丢弃迟到文章 | 🔴 | 87 无 etag 源 | ✅ 已修复+验证 | rss/index.js |
| P0-3 | refresh-all skipBreaker 路径 SQL 缺占位符必 500 | 🔴 | 应急恢复路径 | ✅ 已修复+验证 | sources.js |
| P2-2 | we-mp-rss GBK+emoji 正文抓取崩溃（feed 只剩摘要） | 🔴 | 全部 wemp 全文层 | ✅ 已修复+实证 | wempSupervisor.js |
| P1-1 | we-mp-rss 崩溃后不自动重启（65 源熔断历史根因） | 🟡 | 全部 wemp 链路 | ✅ 已修复+验证 | wempSupervisor.js |
| P1-2 | 前端无轮询 → 必须手动刷新网页才见新文 | 🟡 | 阅读器全用户 | ✅ 已修复+构建 | ArticleList.jsx |
| P1-3 | 全文补抓单条失败静默 catch 无日志 | 🟡 | 补抓可观测性 | ✅ 已修复 | rss/index.js |
| P2-1 | fetchDueBeforeDaily 与 tick 并发双抓同一源 | 🟢 | 日报时刻到期源 | ✅ 已修复（含 daily.js 副本） | scheduler/index.js + daily.js |
| P2-3 | 云端/本地采集语义双实现漂移风险 | 🟢 | 维护流程 | ✅ 已文档化 | ARCHITECTURE.md |
| P2-4 | 全文补抓每天 1 次×100 条，远低于产文速度 | 🟢 | 摘要文章积压 | ✅ 已提频至 6h×300 | scheduler/index.js |

### 1.3 本轮核实「已修复无需再动」项（来自历史报告）

| 项 | 声称来源 | 当前代码核实证据 | 结论 |
|---|---|---|---|
| rss/index.js 缺 log 导入 | FINAL_DIAGNOSIS L26/L43 | `rss/index.js:6` `const log = require('../../../util/log')` 已存在 | ✅ 早已修复 |
| 敏感信息未脱敏 | FINAL_DIAGNOSIS L17 | `store.js:126`、`sources.js:21`、`alerts.js` 均已 `log.mask()` | ✅ 早已修复 |
| scheduler markSourceError 参数遗漏 | FINAL_DIAGNOSIS L42 | `scheduler/index.js:47` 已传 `err.message` | ✅ 早已修复 |
| 飞书报警冷却未清理 | 紧急修复报告 L20 | `alerts.js:164/174` clearCooldowns+autoCleanup 已存在，scheduler L269 每 10min 自动调用 | ✅ 早已修复 |
| B 站 WBI 签名隔夜失效 | FINAL_DIAGNOSIS L19 | 报告称已修（30min 缓存+强制刷新重试），非本轮清单 | ℹ️ 已修复 |

---

## 二、逐项修复详情（diff + 验证）

### P0-1：PUT /:id/interval 更新后不重算 next_fetch_at 🔴

**文件**：`server/routes/sources.js` L7、L57-64
**根因**：next_fetch_at 全系统唯一写点在 `store.js:91-93`（fetchSource 内），PUT interval 只更新 extra.intervalMin + reschedule()，新间隔要等旧 deadline（按 8h 算）到期抓一次后才生效。SQL 实锤：65 个 wemp 源 UI 显示 30min，实际 next = last + 8h。

**修改前**：
```js
const { fetchSource, markSourceError } = require('../services/collectors/store');
// ...
  db.prepare('UPDATE sources SET extra=? WHERE id=?').run(JSON.stringify(extra), s.id);
  try { require('../services/scheduler').reschedule(); } catch { /* 调度未启动时忽略 */ }
  res.json({ ok: true, intervalMin: extra.intervalMin ?? null });
```

**修改后**：
```js
const { fetchSource, markSourceError, intervalMinFor } = require('../services/collectors/store');
// ...
  db.prepare('UPDATE sources SET extra=? WHERE id=?').run(JSON.stringify(extra), s.id);
  // P0-1 修复：新间隔立即生效——按最新 extra.intervalMin 重算 next_fetch_at
  const updated = db.prepare('SELECT * FROM sources WHERE id=?').get(s.id);
  const next = new Date(Date.now() + intervalMinFor(updated) * 60000).toISOString();
  db.prepare('UPDATE sources SET next_fetch_at=? WHERE id=?').run(next, s.id);
  try { require('../services/scheduler').reschedule(); } catch { /* 调度未启动时忽略 */ }
  res.json({ ok: true, intervalMin: extra.intervalMin ?? null, nextFetchAt: next });
```

**验证命令**（handler 级真实调用，源 id=31 设 45min 断言 next_fetch_at≈now+45min 后恢复 30min）：
```powershell
node tools/.verify-p0.cjs   # 已执行，跑完删除；结果存 tools/.verify-p0.json
```
**验证结果**（`tools/.verify-p0.json`）：`interval-recalc` pass=true，before_next=`01:54:46Z`（旧 8h 规则残留）→ after_next=`02:23:46Z`（=now+45min，driftMin=0.001），restore-30min pass=true。
**状态**：✅ 已修复

---

### P0-2：pubDate 增量过滤器永久丢弃迟到文章 🔴

**文件**：`server/services/collectors/rss/index.js` L325-353
**根因**：原逻辑 `pubDate > lastFetchAt` 把「发布早于上轮抓取、但迟到进 feed」的文章在 INSERT OR IGNORE 之前就 filter 掉 → 永久静默丢弃。wemp 源入库延迟实测 13min~40h，全部 87 个无 etag 源受影响。

**修改前**：
```js
const lastFetchAt = source.last_fetched_at ? new Date(source.last_fetched_at) : null;
if (!etag && lastFetchAt && (feed.items || []).length > 0) {
  const totalBefore = feed.items.length;
  feed.items = (feed.items || []).filter((item) => {
    const pubDate = item.isoDate || item.pubDate;
    if (!pubDate) return true;
    return new Date(pubDate) > lastFetchAt;   // ← 迟到文章在此被永久丢弃
  });
  // ...
}
```

**修改后**（改为「已入库 URL 去重 + 14 天陈旧截断」双闸门）：
```js
if (!etag && (feed.items || []).length > 0) {
  const totalBefore = feed.items.length;
  // 1) 已入库 URL 直接跳过（避免重复进 needFulltext 白白重抓全文）
  const urls = (feed.items || []).map((it) => it.link || it.guid).filter(Boolean).slice(0, 200);
  const known = new Set();
  if (urls.length) {
    try {
      const { db } = require('../../../db');
      const rows = db.prepare(`SELECT url FROM articles WHERE url IN (${urls.map(() => '?').join(',')})`).all(...urls);
      for (const r of rows) known.add(r.url);
    } catch { /* 查询失败则不去重，交给 INSERT OR IGNORE 兜底 */ }
  }
  // 2) 只丢弃明显陈旧的条目（14 天前），其余一律保留
  const cutoff = Date.now() - 14 * 86400e3;
  feed.items = (feed.items || []).filter((item) => {
    const u = item.link || item.guid;
    if (u && known.has(u)) return false;
    const pubDate = item.isoDate || item.pubDate;
    if (!pubDate) return true;
    return new Date(pubDate).getTime() > cutoff;
  });
  const filteredCount = totalBefore - feed.items.length;
  if (filteredCount > 0) {
    log.info(`[RSS 增量] ${source.name}: 跳过已入库/超 14 天陈旧条目 ${filteredCount} 条`);
  }
}
```

**验证命令**（本地 HTTP 喂 fixture，last_fetched_at=now，断言迟到 3h 文章被保留、20 天陈旧文章被丢弃）：
```powershell
node tools/.verify-p02.cjs   # 已执行，跑完删除；结果存 tools/.verify-p02.json
```
**验证结果**：`late-article-kept` pass=true、`old-article-dropped(14d-cutoff)` pass=true；日志 `[RSS 增量] P0-2验证源: 跳过已入库/超 14 天陈旧条目 1 条`。
**对抗审查**：① url 键一致性——`mapItem` L136 入库 `url: item.link`，过滤器比对 `item.link || item.guid` 为超集，不漏；② articles.url 有唯一索引（INSERT OR IGNORE by url 依赖），IN 查询走索引不拖慢；③ 云端 `_collect.js:274-289 fetchRss` 核实**无同样过滤逻辑**，无需双改。
**⚠️ 行为变化**：新订阅源首次导入时，超 14 天的历史文章不再全量入库（防归档洪泛，与既有 needFulltext slice(0,10) 设计意图一致）。
**状态**：✅ 已修复

---

### P0-3：refresh-all skipBreaker 路径 SQL 缺占位符 🔴

**文件**：`server/routes/sources.js` L145
**根因**：`"UPDATE sources SET extra=? WHERE id="` 缺 `?` → prepare 抛 SQL 语法错，`?skipBreaker=1`（熔断恢复应急路径）必 500。

**修改前 → 修改后**：
```js
- db.prepare("UPDATE sources SET extra=? WHERE id=").run(JSON.stringify(extra), s.id);
+ db.prepare('UPDATE sources SET extra=? WHERE id=?').run(JSON.stringify(extra), s.id); // P0-3 修复
```

**验证结果**（`tools/.verify-p0.json`）：`sql-prepare-fixed` pass=true；对照 `sql-prepare-old(should-throw)` pass=true（旧 SQL 抛 `incomplete input`，证明原为真 bug）。
**状态**：✅ 已修复

---

### P2-2：we-mp-rss GBK+emoji 正文抓取崩溃 🔴

**文件**：`server/services/wempSupervisor.js` L64-69
**根因**（实证定位，非外部 Python 代码问题）：Windows 中文 locale 下，we-mp-rss 子进程 stdout 重定向到 `data/logs/wemp.log`（文件 fd）时默认用 **GBK 编码**；抓取的微信正文含 emoji（🧠 U+1F9E0）经 `print()` 输出 → `UnicodeEncodeError: 'gbk' codec can't encode` → 正文抓取连续失败 status=5/has_content=0 → feed 只剩摘要。

**修改后**（在 spawn childEnv 注入 UTF-8 强制开关，源头消除整类崩溃，无需改外部代码）：
```js
  // P2-2 修复：强制 Python 子进程 stdout/默认文件编码为 UTF-8
  childEnv.PYTHONUTF8 = '1';
  childEnv.PYTHONIOENCODING = 'utf-8';
```

**验证命令**（用 we-mp-rss 真实 venv Python 对比 GBK vs UTF-8 输出 emoji）：
```powershell
$py='D:\tools\we-mp-rss\.venv\Scripts\python.exe'
$env:PYTHONIOENCODING='gbk'; $env:PROBE_OUT='.probe-a.json'; & $py tools\.emoji-probe.py
$env:PYTHONUTF8='1'; $env:PYTHONIOENCODING='utf-8'; $env:PROBE_OUT='.probe-b.json'; & $py tools\.emoji-probe.py
```
**验证结果**（错误签名与 wemp.log 逐字节吻合）：
| 场景 | stdout 编码 | print emoji |
|---|---|---|
| A `.probe-a.json` 默认 GBK | `gbk` | ❌ `UnicodeEncodeError: 'gbk' codec can't encode character '\U0001f9e0' in position 12` |
| B `.probe-b.json` PYTHONUTF8=1 | `utf-8` | ✅ `real_print_ok: true` |

对照 wemp.log 原始错误 `'gbk' codec can't encode character '\U0001f9e0' in position 7: illegal multibyte sequence` → 根因确认。
**状态**：✅ 已修复（生效需重启主服务，见第三节人工介入）

---

### P1-1：we-mp-rss 崩溃后不自动重启 🟡

**文件**：`server/services/wempSupervisor.js` L17-23、L34、L49、L88-114、L129-135
**根因**：`child.on('exit')` 仅记日志、置 child=null，不重启。子进程意外退出后 65 源持续熔断（紧急修复报告 L13 的历史根因）。

**修改后**（指数退避 5s→10s→…→5min 封顶；存活超 10min 重置退避；外部实例不重复拉起；退出中不自愈）：
```js
let managed = false; let shuttingDown = false;
let restartAttempts = 0; let lastSpawnAt = 0; let restartTimer = null;
// ...
  child.on('exit', (code) => {
    log.warn(`we-mp-rss 进程退出 code=${code}（日志:data/logs/wemp.log）`);
    child = null;
    if (!managed || shuttingDown || process.env.WEMP_MANAGED === '0') return;
    if (Date.now() - lastSpawnAt > 10 * 60e3) restartAttempts = 0;
    restartAttempts += 1;
    const delayMs = Math.min(5000 * Math.pow(2, restartAttempts - 1), 5 * 60e3);
    log.warn(`[托管自愈] ${Math.round(delayMs / 1000)}s 后第 ${restartAttempts} 次尝试重启 we-mp-rss…`);
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(async () => {
      restartTimer = null;
      if (shuttingDown) return;
      try {
        if (await isUp()) { log.info('[托管自愈] 端口 8001 已恢复（外部拉起），跳过重启'); managed = false; return; }
        await start();
      } catch (err) { log.error('[托管自愈] 重启失败:', err.message); }
    }, delayMs);
  });
```

**验证命令**（注入假 child_process 模拟反复崩溃，断言退避时序）：
```powershell
node tools/.verify-p11.cjs   # 已执行，跑完删除；结果存 tools/.verify-p11.json
```
**验证结果**：`restart-after-5s` pass=true（crash#1 后 5.3s 重启）、`backoff-doubled-10s` pass=true（crash#2 后 6s 未重启、11s 内重启）；日志 `[托管自愈] 5s 后第 1 次…` / `10s 后第 2 次…`。
**对抗审查**：① killChild 清 restartTimer，SIGINT/SIGTERM 先置 shuttingDown → 退出过程不触发僵尸重启；② 外部实例（isUp=true）时 managed=false，崩溃不重复拉起，靠 scheduler 心跳 wempDown 报警兜底；③ 退避封顶 5min，最坏 = 每 5min 一次重启（非紧密循环），符合"自动恢复"设计意图。
**状态**：✅ 已修复

---

### P1-2：前端无轮询 → 必须手动刷新网页 🟡

**文件**：`web/src/components/ArticleList.jsx` L98-110
**根因**：重新拉取的 useEffect（L88-96）依赖仅 filter/q/sort/dedup/reloadKey，无 setInterval/EventSource → 只在挂载和筛选变化时加载一次，后端已入库新文前端不可见。

**修改后**（60s 轮询静默刷新第一页，三重防打断守卫）：
```jsx
  // P1-2：60s 轮询静默刷新第一页（修复"必须手动刷新网页才能看到新文"）
  // 仅在页面可见、未选中文章、列表接近顶部时替换刷新，避免打断阅读/深分页状态
  useEffect(() => {
    const t = setInterval(() => {
      if (document.hidden) return;
      if (selectedId) return;
      const el = boxRef.current;
      if (el && el.scrollTop > 200) return;
      fetchPage(null, true);
    }, 60000);
    return () => clearInterval(t);
  }, [fetchPage, selectedId]);
```

**验证命令**：
```powershell
npm run build   # vite build --config web/vite.config.js
```
**验证结果**：`✓ built in 2.13s`，产物 main-*.js/admin-*.js 正常输出，无编译错误。
**对抗审查**：① fetchPage 内 `loadingRef` 守卫防轮询请求叠加；② document.hidden 时跳过（后台标签不空跑）；③ selectedId 存在时跳过（不打断阅读）；④ scrollTop>200 时跳过（不覆盖深分页/滚动位置）。
**备注**：SSE 推送为二期增强（后端 `server/routes/events.js` 已有基础设施），本轮先上轮询。
**状态**：✅ 已修复

---

### P1-3：全文补抓单条失败静默 catch 🟡

**文件**：`server/services/collectors/rss/index.js` L385
**修改前 → 修改后**：
```js
- } catch { /* 单条失败保留摘要 */ }
+ } catch (err) { log.warn(`[全文补抓] ${source.name} 单条失败(保留摘要): ${a.url} - ${err.message}`); }
```
**验证结果**：`node --check` 通过，`npm test` 71/71 通过。
**状态**：✅ 已修复

---

### P2-1：日报补抓与 tick 并发双抓同一源 🟢

**文件**：`server/services/scheduler/index.js` L68-92（主）+ `server/routes/daily.js` L20-31（辅助副本）
**根因**：`fetchDueBeforeDaily()` 不受 ticking 守卫保护；且 `daily.js /regenerate` 路由**重复实现**了一套无守卫的补抓循环（实现漂移）。08:00 日报补抓与 60s tick 命中同一到期源会并发双抓（浪费带宽 + 触发对端风控，不写坏数据）。

**主文件修改后**（等待在飞 tick + 全程持有守卫）：
```js
async function fetchDueBeforeDaily() {
  const waitStart = Date.now();
  while (ticking && Date.now() - waitStart < 5 * 60e3) {
    log.info('日报补抓：调度 tick 进行中，等待其结束…');
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (ticking) { log.warn('日报补抓：等待 tick 超时（5min），跳过本次补抓直接生成'); return; }
  ticking = true; // 持有守卫，期间 tick() 会直接 return
  try {
    const due = db.prepare('SELECT * FROM sources WHERE enabled=1 AND (next_fetch_at IS NULL OR next_fetch_at <= ?)').all(new Date().toISOString());
    if (!due.length) return;
    log.info(`日报生成前补抓 ${due.length} 个到期源…`);
    for (const s of due) {
      try { await fetchSource(s); } catch (err) { markSourceError(s, err.message); log.warn(`补抓失败 [${s.name}]: ${err.message}`); }
    }
  } finally {
    ticking = false;
  }
}
// 导出供 daily 路由复用
module.exports = { start, stop, reschedule, runOpmlSync, tick, resumeInterrupted, healthCheck, fetchDueBeforeDaily };
```

**辅助文件修改后**（daily.js 消除重复实现，复用主文件）：
```js
router.post('/regenerate', async (req, res) => {
  try {
    // P2-1 修复：复用 scheduler.fetchDueBeforeDaily（已含 ticking 守卫），消除与 tick() 并发双抓竞态
    await require('../services/scheduler').fetchDueBeforeDaily();
    const report = await daily.generate(req.body && req.body.windowHours);
    res.json({ ok: true, report });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});
```

**验证命令**：
```powershell
node --check server/routes/daily.js; node --check server/services/scheduler/index.js
node -e "require('./server/routes/daily'); require('./server/services/scheduler'); console.log('LOAD_OK')"
npm test
```
**验证结果**：语法通过、`LOAD_OK no circular dependency crash`（懒加载 require 无循环依赖）、71/71 测试通过。
**状态**：✅ 已修复（主文件 + 辅助副本双改）

---

### P2-3：云端/本地采集语义双实现漂移 🟢

**文件**：`ARCHITECTURE.md` L68（已知坑追加第 9 条）
**修改后**：
```
9. 云端/本地采集语义双实现漂移：Vercel 端 portal/api/_collect.js、_daily.js 是主系统
   server/services/collectors/*、ai/daily.js 的移植副本(非同步)，写 Turso 云库。
   修改任何采集语义(过滤/清洗/熔断/去重/增量)必须同步检查云端副本，否则漂移。
   （例：2026-09-02 P0-2 修了 rss/index.js 的 pubDate 过滤器；已核实云端 _collect.js fetchRss
   当时无同样过滤逻辑，故无需双改）
```
**状态**：✅ 已文档化

---

### P2-4：全文补抓提频 🟢

**文件**：`server/services/scheduler/index.js` L86-100、L169-183
**修改前 → 修改后**：
```js
- // LIMIT 100 / cron '0 2 * * *'（每天凌晨 2 点 100 条）
+ // LIMIT 300 / cron '0 2,8,14,20 * * *'（每 6h 一次，保留原凌晨 2 点低峰槽，300 条）
```
**验证结果**：`node --check` 通过、71/71 测试通过；日志 `[全文补抓] 定时任务已注册：每 6 小时一次（02/08/14/20 点）`。
**状态**：✅ 已修复

---

## 三、需要人工介入的步骤

> ⚠️ 本轮修改的是**主系统 Node 代码**，需重启主服务才能全部生效；P2-2 的 UTF-8 注入需 we-mp-rss 子进程被重新拉起才生效。

### 3.1 重启主服务（使 P0/P1/P2 代码修改 + P2-2 环境注入全部生效）

```powershell
cd d:\全网情报系统
.\restart-server.bat
```
- 重启会触发 wempSupervisor 重新 spawn we-mp-rss 子进程 → 带上新的 `PYTHONUTF8=1`（P2-2 生效）
- 若 we-mp-rss 是**外部独立启动**（非托管），需手动重启它才能让 UTF-8 环境生效：
```powershell
cd D:\tools\we-mp-rss; .\restart-wemp.bat
```

### 3.2 数据重排已执行（P0-1 配套）✅

存量 115 个 enabled 源的 next_fetch_at 已按最新 intervalMinFor 规则全量重排（0~10min 随机错峰防抓取风暴）：
- 结果（`tools/.reschedule-out.json`）：115 源重排，stale8hAfter=0（无残留 8h 陈旧 deadline）
- 抽样：量子位 id=30 next=`02:18:43Z`（+30min ✅）、id=72 量子位博客 next=`09:47:45Z`（+8h，因该源无 intervalMin 覆盖，跟随全局 rss=8h，符合预期）
- **无需人工再执行**；若今后想手动重排，可复用同款逻辑（UPDATE sources SET next_fetch_at 按 intervalMinFor 计算）

### 3.3 验证 P2-2 修复实际生效（重启后）

```powershell
# 重启主服务后，观察 wemp.log 是否还有 gbk codec 报错
Get-Content data\logs\wemp.log -Tail 50 | Select-String "gbk|codec|emoji"
# 预期：无新的 'gbk' codec can't encode 报错
```

### 3.4 微信读书/B 站 Cookie 重置（历史遗留，非本轮修复项）

若仍有源因 Cookie 失效熔断（紧急修复报告 Step3/4）：
```powershell
node tools\ops-toolkit.js check          # 健康总览
node tools\ops-toolkit.js unfreeze --yes # 批量解冻
node tools\ops-toolkit.js reset-wemp     # 清零 wemp 失败计数
node tools\ops-toolkit.js diagnose-bili  # B 站 WBI+Cookie 诊断
```
管理后台 → 公众号 Tab → 微信读书授权 → 扫码登录（Cookie 约 30 天有效期）。

### 3.5 量子位《李飞飞》一文复核（附录 B 遗留待办）

上游 we-mp-rss 每小时 :23 轮次，复核该 mp 是否进 feed（区分窗口时延 vs 通道漏抓）：
```powershell
curl.exe -s "http://127.0.0.1:8001/feed/MP_WXS_3236757533.atom?limit=5" | Select-String "<title>|<updated>"
```
若下一轮后仍无 → we-mp-rss 管理台手动触发该 mp 采集。

---

## 四、后续优化建议（Phase 2+）

| 优先级 | 建议 | 理由 | 预计工作量 |
|---|---|---|---|
| P1 | **SSE 实时推送**替代 60s 轮询 | 后端 `server/routes/events.js` 已有基础设施；fetchSource 入库后 emit `articles:new`，前端 EventSource 静默重拉，比轮询更省资源更实时 | 2-3h |
| P1 | **源级 update_time 停滞报警** | 本轮 P2-2 类"静默漏抓"（feed 更新但某 mp 通道 0 新文）当前无告警；给 scheduler 加"活跃源 N 小时无新文 → alerts.collectStalled"可在 2h 内变飞书告警 | 1-2h |
| P2 | **we-mp-rss cron 提频至 */30** | 上游每小时 :23 轮次是量子位延迟主瓶颈之一；配合已修复的 P0-1，本地 intervalMin 可降至 15，端到端延迟从 ≤90min 压到 ≤45min | 30min（改外部 cron） |
| P2 | **collectors 抽共享包** | 根治云端/本地双实现漂移（P2-3 目前是文档约束，非机制约束）；把过滤/清洗/熔断逻辑抽成 npm workspace 共享包，云端本地同源 | 1-2 天 |
| P2 | **报警冷却独立 key** | FINAL_DIAGNOSIS P2 遗留：区分 source_warning/source_paused/collect_stalled 独立冷却，避免 2h 内只报一次 | 1h |
| P3 | **全文补抓失败标记重试** | needFulltext 失败条目应标记 extra.fulltextRetry，供 recovery 优先补，而非每轮重新扫全表 | 1h |
| P3 | **前端 Error Boundary** | ARCHITECTURE_AUDIT 遗留：main.jsx 无 Error Boundary，JS 错误致整页白屏 | 30min |

---

## 五、修改文件清单（atomic 视角）

| 文件 | 涉及问题 | 改动行数 |
|---|---|---|
| `server/routes/sources.js` | P0-1, P0-3 | +8 / -3 |
| `server/services/collectors/rss/index.js` | P0-2, P1-3 | +22 / -10 |
| `server/services/wempSupervisor.js` | P1-1, P2-2 | +36 / -4 |
| `server/services/scheduler/index.js` | P2-1, P2-4 | +16 / -8 |
| `server/routes/daily.js` | P2-1（辅助副本） | +3 / -11 |
| `web/src/components/ArticleList.jsx` | P1-2 | +13 / -0 |
| `ARCHITECTURE.md` | P2-3（文档） | +1 / -0 |

**验证总闸**：`npm test` → 71/71 pass、0 fail；`npm run build` → ✓ built；`node --check` 全部后端改动文件通过；循环依赖加载测试 LOAD_OK。

---

**报告生成时间**：2026-09-02
**修复原则遵循**：P0 全部先于 P1/P2 完成并逐项对抗审查；根因跨文件者（P2-1）先修主文件 scheduler 再修辅助副本 daily.js；每改一处即验证。
