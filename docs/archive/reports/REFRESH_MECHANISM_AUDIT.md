# 全网情报系统「刷新源机制」深度审计与诊断报告

> 审计时间：2026-09-02 ｜ 取证方式：源码逐行审查 + 主库/we-mp-rss 库 SQL 实查 + 上游 feed 实时 curl + 日志时间线
> SQL 证据文件：`tools/audit-refresh-out.json`（主库 app.db）、`tools/.audit-wemp-out.json`（we-mp-rss db.db）
> 风险等级：🔴 高 ｜ 🟡 中 ｜ 🟢 低

---

## 一、机制全景梳理

### 1.1 调度逻辑：due-driven 模型（工作正常）

**证据**：`server/services/scheduler/index.js:53-66`

完整流程：

```
setInterval(tick, 60_000)          // 每 60s 一次
  └─ tick():
       if (ticking) return          // 防重入守卫
       ticking = true
       rows = SELECT * FROM sources
              WHERE enabled=1 AND (next_fetch_at IS NULL OR next_fetch_at <= now)
       for (row of rows) await fetchSource(row)   // 串行逐源抓取
       ticking = false
```

其它定时任务（同文件）：

| 任务 | 位置 | 说明 |
|---|---|---|
| 日报 cron | `scheduler/index.js:143-163` | 按 `settings.daily.time`（默认 08:00），**先 `fetchDueBeforeDaily()` 补抓到期源再 `daily.generate()`** |
| 全文补抓 recovery | `scheduler/index.js:166-178` | `0 2 * * *`，每天一次，**限 100 条**、2s 间隔 |
| 启动补跑 | `scheduler/index.js:216-227` | needsGeneration() 补昨日日报 |
| 队列轮询 | `scheduler/index.js:229-234` | 每 `settings.queue.intervalMin`（10min）跑 poller |
| 数据清理 | `scheduler/index.js:243-250` | 24h/7天 保留策略 |

**结论**：调度器本身没有漏扫。`next_fetch_at` 全系统唯一写点是 `store.js:91-93`（fetchSource 成功/失败后统一重算），Grep 验证无第二处 UPDATE。

### 1.2 间隔计算：intervalMinFor 分层规则（存在一处失效 bug）

**证据**：`server/services/collectors/store.js:54-67`

```
优先级：extra.intervalMin (>0)
     → type=bilibili: settings.intervals.bilibili || 60
     → type=douyin:   settings.intervals.douyin   || 360
     → 其余(rss/wemp/hotlist/x/youtube): (settings.intervals.rss || 8) * 60 = 480min
```

⚠️ 注意：适配器注册的 `defaultIntervalMin`（如 wemp 的 120，`server/services/collectors/wemp/index.js`）**从未被 intervalMinFor 读取**，是死代码。

**实际生效情况（SQL 实查，`tools/audit-refresh-out.json`）**：

- `settings.intervals = {"opml":12,"rss":8,"bilibili":60,"douyin":360,"queue":10}`（rss 单位是**小时**，×60=480min）
- 量子位 id=30：`extra={"intervalMin":30}`，last=09-02T00:42:46Z，next=+30min ✅ 生效（因为被手动刷新过，触发了 next_fetch_at 重算）
- **wemp 源 id=31/32/33/74-80：extra.intervalMin=30，但 next = last(09-01T17:54Z) + 8h** ❌ 未生效

### 1.3 当前活跃源统计（SQL 实查）

```sql
SELECT type, COUNT(*) FROM sources WHERE enabled=1 AND type!='hotlist' GROUP BY type;
```

| type | enabled=1 | 备注 |
|---|---|---|
| wemp | **65** | 全部指向本地 we-mp-rss `http://127.0.0.1:8001/feed/{id}.atom?limit=20` |
| rss | **22** | 含 FT中文网 等外部源 |
| hotlist | 28（未计入） | 热榜聚合 |
| bilibili / douyin / youtube | 各 1 个但 **enabled=0** | 全部处于熔断停用状态 |
| x | 0 | 无活跃源 |

**活跃非热榜源合计：87 个（65 wemp + 22 rss）。**

### 1.4 云端队列轮询：无冲突（✅ 排除）

**证据**：`server/services/queue/poller.js` 全文

- 每 10min：pull（PHP flock 队列 `cloud/*.php`）→ 写入本地 **`pending_items`** 表 → clear 云端
- bilibili/douyin 队列 `autoResolve:true` → `resolvePending()` 把条目转成 **`sources`** 表记录（进入正常调度抓取）
- wechat 队列 `autoResolve:false` → 保持 pending 供管理页手动处理
- **poller 全程不直接写 articles/videos 表** → 与调度器无写路径冲突、无重复入库

---

## 二、矛盾检测（左右脑互搏）

### 2.1 日报生成 vs 实时刷新 —— 🟢 低（存在轻微双抓竞态）

**证据**：`scheduler/index.js:69-78`（fetchDueBeforeDaily）、`:143-163`（scheduleDaily）

- 日报触发时**先补抓到期源再聚合**，设计正确，无数据竞争（articles 入库是 `INSERT OR IGNORE by url`，重复抓取不产生重复行）
- ⚠️ 轻微问题：`fetchDueBeforeDaily()` 不受 `ticking` 守卫保护。若 08:00 日报补抓与 60s tick 同时命中同一到期源，会**并发双抓同一源**（浪费带宽 + 可能触发对端风控），但不会写坏数据。

### 2.2 Vercel Serverless 端 —— 🟡 中（双实现漂移风险）

**证据**：`portal/api/_collect.js:1-16`、`portal/api/_daily.js:1-16`

- 云端有**独立完整的采集引擎**（十一期 M2）：语义移植自主系统（charset 嗅探、#js_content 抽取、cleanContent、isJunkContent、INSERT OR IGNORE、熔断 3 次），写 **Turso** 云库；受 Vercel 60s 约束：BATCH_MAX=12、SOURCE_GAP_MS=1000、TIME_BUDGET_MS=50000
- 云端日报引擎（十一期 M3，`_daily.js`）：移植 `server/services/ai/daily.js` 关键词模式，读写 Turso daily_reports
- **数据流向**：本地 Express → SQLite(app.db)；云端 Vercel → Turso。两套是"移植副本"而非同步，**修 bug 必须双改**，否则漂移。例如本次发现的 pubDate 过滤器 bug（见 3.2）如果 `_collect.js` 同样存在，云端也会丢文。

### 2.3 队列入队 vs 直接抓取 —— ✅ 无矛盾

- HTTP Shortcuts（Android/Windows）→ `cloud/*.php` 队列（token.json 鉴权 + flock）→ poller 拉取 → `pending_items` → resolve 转 `sources` → **之后走与手动添加源完全相同的调度抓取路径**入库 articles/videos
- 与直接抓取的区别仅在于"源的注册入口"，入库路径唯一，无分叉。

---

## 三、功能失效根因：量子位今早新文章 6h 未检测到

### 3.0 排查项逐一核验（用户指定 5 项）

| 排查项 | 结论 | 证据 |
|---|---|---|
| ① 日志时间线：是否被调度 | ✅ 被正常调度，30min 一次 | 主库 id=30：last=09-02T00:42:46Z，next=01:12:46Z（+30min 精确生效），status='ok' |
| ② 间隔配置 | ✅ intervalMin=30 已生效 | `SELECT name,extra FROM sources WHERE name LIKE '%量子位%'` → id=30, extra=`{"intervalMin":30}` |
| ③ 熔断状态 | ✅ **未熔断** | fail_count=0, enabled=1（不存在 fail_count>=3 AND enabled=0） |
| ④ 前端缓存 | ⚠️ 是"必须刷新网页"的根因，但不是本问题根因 | 见 4.1 |
| ⑤ ETag/304 短路 | ✅ 排除 | 全部 87 个 rss/wemp 源 extra 均无 etag（`no_etag_enabled` 查询），useConditional=false，每次全量解析 feed |

### 3.1 主根因 —— 🔴 高：上游 we-mp-rss 采集通道未抓到量子位新文章（本地系统无责）

**完整证据链**：

1. **实时 curl 上游 feed**（`http://127.0.0.1:8001/feed/MP_WXS_3236757533.atom?limit=20`，09-02 09:04 +0800）：
   - feed updated = Wed, 02 Sep 2026 09:04:32 +0800（feed 本身是新鲜的）
   - 但 entries 仅 6 条，**最新一条仍是 `Tue, 01 Sep 2026 17:23:02 +0800`《"没有Token的CS学生，应立即退学"》**
   - → **今早的新文章根本不在 feed 里，本地调度器抓不到不存在的内容**
2. **we-mp-rss 库实查**（`tools/.audit-wemp-out.json`）：
   - `feeds` 表量子位 sync_time=1788308582 ≈ **09-02 08:23:02 北京时间**（今早采集任务确实跑过、确实同步了该 mp）
   - 但 `articles` 表量子位最新行仍是 09-01 17:23 的文章 → 08:23 那轮采集**微信读书通道没有返回量子位的新文章**
   - 对照 `today_new`：同一轮 08:23-08:24 任务成功抓到十余个其它 mp 的新文章（邦早报、每经早参等）→ 采集任务整体正常，**唯独量子位（及部分 mp）通道失效**
3. **日志佐证**（`data/logs/wemp.log` tail）：we-mp-rss 对量子位近 5 篇文章正文抓取全部崩溃（见 4.2），status=5、has_content=0、fix_fail_count=3

**定性**：断点在 we-mp-rss（`D:/tools/we-mp-rss`）的微信读书 weread 采集通道——量子位今早的文章未进入其 articles 表。可能原因：weread 通道对该 mp 的订阅/翻页失效、该 mp 今早文章发布时间晚于 08:23 采集点（下一轮 10:07 cron 才会抓到，`7 */2 * * *` 每 2h 一轮）、或 weread 侧风控。**这不是主系统调度器/熔断/ETag 的问题。**

**验证命令**（等到 10:07 采集轮之后执行，确认是否自愈）：

```powershell
curl.exe -s "http://127.0.0.1:8001/feed/MP_WXS_3236757533.atom?limit=5" | Select-String "<title>|<updated>"
```

若 10:07 轮后 feed 仍无今早文章 → 需登 we-mp-rss 管理台检查量子位的 weread 订阅状态并手动触发一次该 mp 的采集。

### 3.2 次生根因 A —— 🔴 高：pubDate 增量过滤器会永久丢弃"迟到"文章

**证据**：`server/services/collectors/rss/index.js:326-341`

```js
if (!etag && lastFetchAt && (feed.items || []).length > 0) {
  feed.items = feed.items.filter((item) => {
    const pubDate = item.isoDate || item.pubDate;
    if (!pubDate) return true;
    return new Date(pubDate) > lastFetchAt;   // pubDate 早于上次抓取时间 → 直接丢弃
  });
}
```

- 全部 87 个活跃源都无 etag → **该过滤器对所有源生效**
- wemp feed 的文章是 we-mp-rss 每 2h 批量采集的，**文章 pubDate 可能早于本地 last_fetched_at**（主库实测 created_at 与 published_at 延迟 13min~40h 不等）：一旦某篇文章在"pubDate 之后、被 feed 收录之前"的窗口里恰好错过一轮本地抓取，它将被**永久静默丢弃**（INSERT OR IGNORE 之前就被 filter 掉了）
- 量子位这次没踩中（因为文章压根没进 feed），但这是悬在全部 wemp 源头上的丢文炸弹

### 3.3 次生根因 B —— 🔴 高：PUT /api/sources/:id/interval 不重算 next_fetch_at

**证据**：`server/routes/sources.js:44-60`

- 该接口更新 `extra.intervalMin` 后只调 `scheduler.reschedule()`（重设 cron），**不 UPDATE next_fetch_at**
- 而 next_fetch_at 唯一写点在 fetchSource（`store.js:91-93`）→ 新间隔要等**旧 deadline（按 8h 算的）到期抓取一次后才生效**
- SQL 实锤：wemp 源 id=31-33/74-80 的 UI 间隔显示 30min（截图1），但 next = 09-01T17:54Z + **8h** → 对应截图2"上次 6h · 下次 刚刚"的假象。只有被手动刷新过的 id=29/30 变成了 +30min

### 3.4 附加 bug —— 🟢 低：sources.js:140 SQL 语法错误

**证据**：`server/routes/sources.js:140`

```js
db.prepare("UPDATE sources SET extra=? WHERE id=").run(JSON.stringify(extra), s.id);
//                                              ^^^^^^^^ 缺 ? 占位符
```

refresh-all 带 `skipBreaker=1` 且某源抓取失败需重置熔断时，prepare 直接抛 SQL 语法错 → 该次 refresh-all 500。

---

## 四、信息失效根因：外部源"必须刷新网页 + 只有摘要"

### 4.1 "必须刷新网页" —— 🟡 中：前端无任何轮询/推送（设计缺口）

**证据**：
- `web/src/pages/ReaderPage.jsx:1-109`（全文核验）：无 setInterval / EventSource / WebSocket；`listKey` 仅在"全部已读"操作时递增（L51-58）
- `web/src/components/ArticleList.jsx:88-96`：重新拉取列表的 useEffect 依赖 = `[filter.tab, filter.sourceId, filter.groupId, filter.from, filter.to, q, sort, dedup, reloadKey]` → **只在挂载和筛选变化时加载一次**

后端其实已入库（截图4 中"联合早报 8 分钟前"证明数据是新的），纯粹是前端不主动刷新。**不是 SQL 查询条件问题，也不是渲染缓存问题。**

### 4.2 "只有摘要" —— 🔴 高：三层全文链路各自失效

**层 1（wemp 上游，主因）**：we-mp-rss 正文抓取 GBK 编码崩溃

**证据**：`data/logs/wemp.log` tail：

```
article 2831008240-... content fetch failed (3/3):
'gbk' codec can't encode character '\U0001f9e0' in position 7: illegal multibyte sequence
UPDATE articles SET status=?, fix_fail_count=? ... (5, 3, None, ...)
```

- we-mp-rss（Python）某处以 **GBK 编码**处理含 emoji（🧠 U+1F9E0）的微信正文 → 崩溃 → `status=5, has_content=0`
- SQL 实锤：量子位近 5 篇文章在 we-mp-rss 库中全部 `status=5 / has_content=0 / fix_fail_count=3`（`tools/.audit-wemp-out.json`）
- → feed 无 `content:encoded` → 本地入库时摘要垫底（`rss/index.js:141`：`content_html: contentHtml || '<p>${summary}</p>'`）

**层 2（本地全文补抓，兜底但常失败）**：

**证据**：`server/services/collectors/rss/index.js:356-373`

- needFulltext 限**最新 10 条**、单条失败 `catch { /* 静默保留摘要 */ }`（L373）无任何日志
- 主库实锤：量子位文章 id=98997 clen=**39**、id=60095 clen=**25**、id=60096 clen=**52**（纯摘要）；对照 id=116695 clen=103296（补抓成功时是正常的）→ mp.weixin.qq.com 原文页抓取成功率不稳定（风控/超时）

**层 3（外部 rss 源）**：

- SQL 实锤：FT中文网 最近 5/5 篇 short（avg content_html 长度 **61.4 字符**）→ feed 本身只给摘要 + 本地补抓 FT 付费墙页面失败静默
- recovery cron（`scheduler/index.js:166-178`）每天凌晨 2 点仅补 **100 条**、2s 间隔 → 补抓速度远低于 87 源的产文速度

---

## 五、修复方案（按优先级）

### P0-1 修复 interval 不生效（🔴 3.3）

**代码**（`server/routes/sources.js` PUT /:id/interval，更新 extra 后追加重算）：

```js
// 更新 extra.intervalMin 后：
const next = new Date(Date.now() + intervalMinFor(updatedSource) * 60000).toISOString();
db.prepare('UPDATE sources SET next_fetch_at=? WHERE id=?').run(next, id);
```

**数据清理**（立即让全部源按新间隔重排，tick 对 `next_fetch_at IS NULL` 视为到期）：

```sql
UPDATE sources SET next_fetch_at = NULL WHERE enabled = 1;
```

### P0-2 修复 pubDate 过滤器永久丢文（🔴 3.2）

**代码**（`server/services/collectors/rss/index.js:326-341`）：入库已有 `INSERT OR IGNORE by url` 去重兜底，pubDate 过滤应改为**宽松窗口**而非严格 `> lastFetchAt`：

```js
// 改为：只过滤明显陈旧的条目（如 14 天前），去重交给 INSERT OR IGNORE
const CUTOFF = new Date(Date.now() - 14 * 86400e3);
feed.items = feed.items.filter((item) => {
  const pubDate = item.isoDate || item.pubDate;
  if (!pubDate) return true;
  return new Date(pubDate) > CUTOFF;
});
```

⚠️ 同步检查云端移植副本 `portal/api/_collect.js` 是否存在同样过滤逻辑，双改。

### P0-3 修复 we-mp-rss GBK 编码崩溃（🔴 4.2 层1）

**定位命令**（在 we-mp-rss 源码中找 gbk 编码点）：

```powershell
Get-ChildItem D:\tools\we-mp-rss -Recurse -Include *.py |
  Select-String -Pattern "gbk|encode\(" | Select-Object Path, LineNumber, Line
```

**修复**：将命中处的 `encode('gbk')` / `errors` 策略改为 `utf-8`（微信读书 API 请求体没有理由用 GBK；若为下游兼容，至少加 `errors='replace'` 防崩溃）。修复后重置失败文章触发重抓：

```sql
-- we-mp-rss 库（D:/tools/we-mp-rss/data/db.db）
UPDATE articles SET status = 0, fix_fail_count = 0
WHERE status = 5 AND has_content = 0 AND fix_fail_count >= 3;
```

### P1-1 前端实时性（🟡 4.1）

最小改动（30s 轮询，`ArticleList.jsx`）：

```jsx
// 在 L88-96 的 useEffect 之后追加：
useEffect(() => {
  const t = setInterval(() => fetchPage(null, true), 30000);
  return () => clearInterval(t);
}, [fetchPage]);
```

推荐方案（SSE）：后端已有 `server/routes/events.js` 基础设施，新增 `GET /api/events/stream`（text/event-stream），在 fetchSource 成功入库后 emit `articles:new`；前端 ArticleList 挂 EventSource 收到事件后静默重拉第一页。轮询方案可先行上线，SSE 作为二期。

### P1-2 全文补抓强化（🟡 4.2 层2/3）

- `rss/index.js:373` 静默 catch 加日志：`logWarn('fulltext fail', source.name, a.url, err.message)`，让失败可观测
- recovery cron 从每天 1 次 100 条 → 每 6h 一次（`0 */6 * * *`）、上限提至 300 条
- 单源 needFulltext 上限 10 条维持（防风控），但失败条目应标记 `extra.fulltextRetry` 供 recovery 优先补

### P2-1 sources.js:140 SQL 占位符（🟢 3.4）

```js
db.prepare("UPDATE sources SET extra=? WHERE id=?").run(JSON.stringify(extra), s.id);
```

### P2-2 日报补抓竞态（🟢 2.1）

`fetchDueBeforeDaily()` 与 `tick()` 共用 `ticking` 守卫（或日报补抓前先 await 当前 tick 结束）。

### P2-3 云端/本地双实现漂移（🟡 2.2）

在 `ARCHITECTURE.md` 的"已知坑"追加一条：**修改采集语义（过滤、清洗、熔断）必须同步 `portal/api/_collect.js` 与 `portal/api/_daily.js`**；中期考虑把 collectors 抽成共享包。

---

## 六、结论速览

| # | 检测项 | 结论 | 风险 |
|---|---|---|---|
| 1 | 调度器 due-driven 模型 | 正常工作，无漏扫 | ✅ |
| 2 | intervalMinFor 分层 | 规则正确，但 PUT interval 不重算 next_fetch_at → 65 个 wemp 源实际按 8h 跑 | 🔴 |
| 3 | 活跃源统计 | wemp=65, rss=22；bilibili/douyin/youtube 各 1 但已熔断停用；x=0 | ℹ️ |
| 4 | poller vs 调度器 | 无冲突（只写 pending_items/sources） | ✅ |
| 5 | 日报 vs 实时 | 先补抓后聚合，设计正确；轻微并发双抓竞态 | 🟢 |
| 6 | Vercel 云端采集 | 独立移植副本写 Turso，语义对齐但有漂移风险 | 🟡 |
| 7 | **量子位 6h 未检测** | **主因在上游 we-mp-rss：今早 08:23 采集轮未抓到量子位新文章（feed 里没有）；本地调度/熔断/ETag 全部排除** | 🔴 |
| 8 | pubDate 增量过滤器 | 对全部 87 个无 etag 源生效，会永久丢弃迟到文章 | 🔴 |
| 9 | "必须刷新网页" | 前端无轮询/SSE，仅挂载时加载一次 | 🟡 |
| 10 | "只有摘要" | we-mp-rss GBK+emoji 崩溃（主）+ 本地补抓静默失败 + recovery 太弱 | 🔴 |
| 11 | sources.js:140 | SQL 缺占位符，skipBreaker 路径必炸 | 🟢 |

---

## 附录 A：量子位源逐项取证（2026-09-02 09:16 +0800 快照）

**总结论：抓取链路已跑通但 feed 滞后**（非"从未成功"、非"前端展示 bug"）。

| # | 检测项 | 结论 | 风险 | 证据 |
|---|---|---|---|---|
| 1 | 调度执行记录 | ✅ 每 30min 准时触发、全部 200 | ✅ | `data/logs/wemp.log` L224779/224861/228990/229521/229562 `GET /feed/MP_WXS_3236757533.atom?limit=20 200 OK`（历史共 41 次，LastWrite 09:16:36）；主库 last_fetched_at 08:42:46→09:13:46 +08 精确 30min 步进；每轮返回新文=0（feed 无新条目）；主系统 fetchSource 日志不落盘（`server/util/log.js:26-28` 仅 console，data/logs 只有 wemp.log，PM2 的 qwis-out.log 本地不存在） |
| 2 | 数据库入库证据 | 🟡 跑通过但延迟+摘要混杂 | 🟡 | 最新 published_at=2026-09-01T09:23:02Z；6 条中 3 条全文（clen=103296/58836/75899）、3 条纯摘要（39/25/52）；入库延迟 13min/39min/3.1h/**8h**/20.4h/40.4h（8h 那条即 interval 不重算 bug 的直接受害者）；`created_today n=0`，今早全库入库仅 hotlist，wemp/rss 为零（`tools/.qbitai-forensics.json`） |
| 3 | 上游 feed 新鲜度 | 🔴 断点所在 | 🔴 | curl 09:16:36：最新 entry pubDate 仍为 Tue, 01 Sep 2026 17:23:02 +0800；**最近 5 条 `<content:encoded />` 为空**、仅 8/28 旧文带全文（feed 级"只有摘要"实锤）；wemp.log L225131-225161：08:23:02 采集轮 sync_time 更新但 update_time=1788254582 不变 → 微信读书通道对量子位返回 0 新文 |
| 4 | 今早实际发布量 | 🟡 确有新文，处于 2h 周期窗口内 | 🟡 | qbitai.com 首页（09:16 抓取）：《李飞飞发布：全球首个多模态世界模型》"6分钟前"≈09:10 +08；该文晚于上游上一轮采集（08:23），we-mp-rss cron `7 */2 * * *` 下轮 10:07 → 09:16 不在 feed 属预期滞后；10:07 后需复核区分"周期滞后"vs"通道漏抓" |
| 5 | 熔断/停用状态 | ✅ 正常 | ✅ | SQL：enabled=1, fail_count=0, status='ok', last=2026-09-02T01:13:46Z, next=01:43:46Z |
| 6 | ETag/304 短路 | ✅ 排除 | ✅ | extra=`{"intervalMin":30}` 无 etag/lastModified → `rss/index.js:309` useConditional=false，每轮全量解析 |
| 7 | 前端展示验证 | ✅ 无渲染 bug（设计缺口另计） | 🟡 | `GET /api/articles?source_id=30&sort=new` → ok:true, items=6, nextCursor=null, span.max=2026-09-01T09:23:02Z；与截图列表 6 条完全一致 → 前端展示了后端全部数据，"看不到新文"因后端本无新数据；无轮询问题见 4.1 |

**10:07 复核命令**（区分周期滞后 vs 通道漏抓）：

```powershell
curl.exe -s "http://127.0.0.1:8001/feed/MP_WXS_3236757533.atom?limit=5" | Select-String '<title>|<updated>'
```

若 10:07 轮后 feed 仍无《李飞飞》一文 → 微信读书通道对量子位漏抓，需 we-mp-rss 管理台手动触发该 mp 采集。

---

## 附录 B：2h 窗口 vs 30min 调度 时间线复核（09:28 +0800 快照，修正附录 A 两处结论）

**修正 1：上游采集周期实为每小时 :23，非 2h。** 证据：we-mp-rss 库批次分组 `wemp_rounds` = 01:23/07:23/08:23/09:23（`tools/.qbitai-timeline.json`）；wemp.log L229877-229881 sync_time 1788308582(08:23:02) → 1788312182(09:23:02)。文档/记忆中的 `7 */2 * * *` 已过期。

**修正 2："4 篇只入库 1 篇"是源归属错觉，非丢文。** 按标题全库核查（`tools/.title-check.json`）：

| 文章 | 官网 RSS pubDate(+08) | we-mp-rss feed | 主库入库 |
|---|---|---|---|
| 李飞飞世界模型 | 未收录(09:28) | ❌ | ❌ 全通道未达（今 ~09:10 发布，仍在窗口内） |
| GitHub最热架构图 | 9/1 16:26 | ❌ | ✅ id=118130 **source 72 量子位博客** 9/2 01:55+08 |
| 急急急用电 | 9/1 16:24 | ❌ | ✅ id=118131 source 72 同上 |
| 自进化WAM | 9/1 13:12 | ❌ | ✅ id=118133 source 72 同上 |
| A社化身A割 | 9/1 16:15(官网版) | ✅(8/30 公众号版) | ✅ id=64170 source 30 + id=118132 source 72 |

→ 阅读器筛选"量子位"(公众号源)只看到 A社 1 篇，其余 3 篇挂在"量子位博客"源下；李飞飞一文截至 09:28 任何通道都未达（下轮：source 72 于 09:55、we-mp-rss 于 10:23），**尚未构成漏抓**。

**pubDate 过滤器今日无实证受害者**：source 72 在 17:55Z 轮成功入库 3 篇 pubDate 早于当轮的官网文章（说明该轮 lastFetchAt 更早，过滤器未触发）；ETag/304 亦排除。今日唯一真缺口 = 李飞飞一文的上游通道时延/漏抓，待 10:23 轮复核。

**延迟数学（通道正常时）**：最小实测 13min（id 98997）；典型 = 轮次等待 0-60min + 本地 ≤30min ≈ ≤90min；当前量子位新文 = 通道漏抓则无限期。缩短手段：we-mp-rss cron 改 */30、本地 intervalMin 30→15（需先修 P0-1）、前端轮询/SSE（P1-1）、源级 update_time 停滞报警。
