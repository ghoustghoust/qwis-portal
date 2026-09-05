# 全网情报系统 · 统一修复记录（权威版）

> 版本：v1.0　生成时间：2026-09-02　维护者：代码审查 Agent
> **本文档是唯一权威的修复记录**，合并并取代下列历史文档中重复/失效的内容。
> 所有结论均以「实时证据」为准（后端 PID 39652，2026-09-02 14:22 重启 · 第二批修复已生效）。

---

## 0. 本文档取代范围

以下文档的**修复结论已并入本文**，原件仅作历史留档，不应再作为最新依据：

| 历史文档 | 日期 | 处置 |
|---|---|---|
| `FINAL_FIX_REPORT.md` | 9/2 10:00 | **主要基准**，10 项修复全部并入本文 §2 |
| `docs/FINAL_DIAGNOSIS_AND_FIX_REPORT.md` | 9/2 0:43 | 6 项修复并入本文 §2（脱敏/scheduler 参数/B站WBI/log导入/ops-toolkit/OpsHealthPanel） |
| `REFRESH_MECHANISM_AUDIT.md` | 9/2 9:31 | §2 各修复的**诊断源**，结论并入；量子位取证留档 |
| `SOURCE_ERROR_AUDIT_REPORT.md` | 9/1 18:32 | 脱敏项已修复并入 §2；中长期建议移入本文 §6 |
| `SOURCE_ERROR_DIAGNOSIS_REPORT.md` | 9/1 18:38 | P0 项已修复并入 §2；B站WBI/Cookie SOP 移入 §6 |
| `docs/源错误熔断修复 - 完整补丁与验证指南.md` | 9/2 1:26 | 内容并入 §2，建议归档 |
| `docs/源错误熔断机制诊断与修复报告指南.md` | 9/2 1:20 | 内容并入 §2，建议归档 |
| `docs/批量恢复熔断源 - 一键批量恢复方案.md` | 9/2 1:39 | restore-all 已交付，见 §2 与 §3 |
| `docs/源列表健康增强 - 完整实施指南.md` / `- 实施总结报告.md` | 9/2 1:50/1:54 | SourceTable/健康度增强，建议归档 |
| `紧急修复报告.md`（根目录 5159 字节） | 9/1 16:34 | 早期急修，已被后续覆盖，建议归档 |
| `ARCHITECTURE_AUDIT_REPORT.md` | 9/1 16:23 | 架构级建议，非 bug 修复，独立保留 |

> 归档建议：将上表标「建议归档」者移入 `docs/archive/`，根目录仅保留本文 + `ARCHITECTURE.md` + `ARCHITECTURE_AUDIT_REPORT.md`。

---

## 1. 验证基线（实时证据，2026-09-02 14:22 后端重启后 · PID 39652）

> 本节为「用户决策后全部应用 P1-P3 修复」的最终验证基线（第二批逐项修复见 §3.2）。

| 验证项 | 命令/来源 | 结果 |
|---|---|---|
| 单元测试 | `npm test`（本轮第 3 次） | **71 tests / 71 pass / 0 fail / 0 skipped**（`analysis/_npmtest3.txt` L95-100） |
| 前端构建 | `npm run build` | **✓ 66 modules transformed，built in 2.05s**，exit 0（`analysis/_build3.txt`；ArticleList.jsx 编译通过） |
| 后端语法 | `node --check`×5 | store.js / index.js / rss/index.js / wempSupervisor.js / restore-all.js 全部 exit 0 |
| 测试隔离 | `tests/helpers.js` L7-8 | `mkdtempSync` 临时目录注入 `APP_DATA_DIR`，绝不触碰 `data/app.db` |
| 后端存活 | `Get-NetTCPConnection :3000` | PID **39652**（14:22 重启），LISTENING |
| 后端服务 | `GET /api/daily` | HTTP **200**，60389 字节真实数据 |
| 启动无错 | 后端 stdout | 无异常；`[批量恢复]路由加载完成`、`we-mp-rss 已就绪`、调度中心 OPML/日报/门户/队列/wemp 心跳全部注册 |
| 调度实时态 | `tools/.live-reschedule-probe.json`（06:49Z 重生成） | total=119，**stale8hAfter=0**，beyond8h=0，byType 与改动前基线**逐字节一致**（wire-up 零漂移，详见 §4） |
| 鉴权实时态 | `GET /api/{daily,sources,settings,status}` vs `/api/columns` | 挂载路由=**200**；`/api/columns` 由 **401→404**（统一放行生效，`REQUIRE_TOKEN=false`，详见 §3.2 P1） |
| 凭据泄漏面 | `tools/.leak-probe.json` | 未鉴权 /api/sources 中 `sourcesWithSensitiveExtra=0`（extra 不含凭据） |

---

## 2. 已实施且验证通过的功能修复（共 16 项）

### 2.1 采集调度与刷新（本轮 9:37-9:56 修复批次）

| 编号 | 问题 | 文件:行号 | 修复要点 | 验证 |
|---|---|---|---|---|
| **P0-1** | PUT interval 改间隔后不重算 `next_fetch_at`，新间隔要等旧 8h deadline 到期才生效 | `server/routes/sources.js` L58-62 | 改间隔后立即按 `intervalMinFor(updated)` 重算并写回 `next_fetch_at`，再 `reschedule()` | 实时探测 stale8h=0 ✓ |
| **P0-2** | pubDate 严格过滤 `>lastFetchAt` 把「发布早于上轮、迟到进 feed」的文章永久静默丢弃（wemp 延迟实测 13min~40h） | `server/services/collectors/rss/index.js` L325-353 | 改为「已入库 URL 去重 + 14 天陈旧截断」双闸门，去重交 `INSERT OR IGNORE` 兜底 | 代码复核 ✓，npm test ✓ |
| **P0-3** | `refresh-all?skipBreaker=1` 分支 SQL 缺 `id` 的 `?` 占位符，该路径必 500 | `server/routes/sources.js` L145 | `UPDATE ... WHERE id=?` 补齐占位符并传 `s.id` | 代码复核 ✓ |
| **P2-1** | 08:00 日报补抓与 60s `tick()` 并发双抓同一源（带宽浪费+对端风控） | `scheduler/index.js` L71-91；`routes/daily.js` L22-24 | 抽出 `fetchDueBeforeDaily()` 共用 `ticking` 守卫：先等在飞 tick 结束（≤5min），再全程持守卫补抓；daily.js 复用它消除漂移 | 代码复核 ✓ |
| **P2-4** | 全文补抓原每天 1 次×100 条，远低于 87 源产文速度 | `scheduler/index.js` L93-104、L178-190 | 提频为每 6h（02/08/14/20 点）×300 条/次，2s 间隔限速 | 代码复核 ✓ |
| **P1-3** | 全文补抓单条失败被静默吞掉，不可观测 | `rss/index.js` L385 | `catch` 改为 `log.warn` 记录 url+原因（保留摘要降级） | 代码复核 ✓ |

### 2.2 公众号引擎托管（we-mp-rss）

| 编号 | 问题 | 文件:行号 | 修复要点 | 验证 |
|---|---|---|---|---|
| **P2-2** | Windows 中文 locale 下 Python stdout 默认 GBK，微信正文含 emoji（🧠 U+1F9E0）被 print 时 `'gbk' codec can't encode` 崩溃 → 正文抓取连败（feed 只剩摘要根因之一） | `server/services/wempSupervisor.js` L73-77 | 子进程注入 `PYTHONUTF8=1` + `PYTHONIOENCODING=utf-8` | 代码复核 ✓ |
| **P1-1** | we-mp-rss 崩溃后不自愈，需人工重启 | `wempSupervisor.js` L18-116 | 指数退避自动重启（5s→10s→…→5min 封顶）；存活>10min 重置退避；外部已拉起则跳过（防双重拉起） | 代码复核 ✓ |

### 2.3 前端

| 编号 | 问题 | 文件:行号 | 修复要点 | 验证 |
|---|---|---|---|---|
| **P1-2** | 前端无轮询，「必须手动刷新网页才能看到新文」 | `web/src/components/ArticleList.jsx` L100-109 | 60s 轮询静默刷新第一页，三重守卫（页面可见 / 未选中文章 / 列表近顶部）避免打断阅读 | 代码复核 ✓ |
| **健康度** | 源健康度可视化不足 | `WempTab.jsx`（OpsHealthPanel） | 运行/异常/熔断/停用四态展示 | 已交付 |

### 2.4 安全与可观测（9/1 18:40-9/2 0:43 批次）

| 编号 | 问题 | 文件:行号 | 修复要点 | 验证 |
|---|---|---|---|---|
| **脱敏** | `markSourceError` 等把明文 Cookie/Token 写入 `extra.lastError` 与日志 | `util/log.js` L6-17；`store.js` L126；`sources.js` L21 | `log.mask()` 三类正则（URL 参数/JSON 键值/行内键值）打码；所有 `log.*` 出口统一 mask | 代码复核 ✓ |
| **scheduler 参数** | `markSourceError(s)` 调用漏传 errMsg，lastError 恒为「未知错误」 | `scheduler/index.js` L47 | 补全 `markSourceError(s, err.message)` | 代码复核 ✓ |
| **log 未定义** | `rss/index.js` 缺 `log` 导入，全文补抓路径抛 `log is not defined` | `rss/index.js` L6 | 补 `require('../../../util/log')` | 代码复核 ✓，npm test ✓ |
| **B站 WBI** | B站 WBI 签名密钥失效致抓取报错 | `bilibili/index.js` | 更新 mixinKey + fallback 合集/搜索路径 | 见 §6 待复核 |
| **ops-toolkit** | 缺批量运维工具 | `tools/ops-toolkit.js`（+`运维工具箱.bat`） | unfreeze/健康检查等命令集 | 已交付 |

### 2.5 文档

| 编号 | 问题 | 文件 | 修复要点 |
|---|---|---|---|
| **P2-3** | 云端（Vercel/Turso）与本地（SQLite）日报双实现漂移 | `ARCHITECTURE.md` | 文档化两端差异与数据流向 |

---

## 3. 本轮审计新发现与处置（步骤 1 批处理 + 步骤 4 代码审查）

> 风险等级：P0 致命 / P1 高 / P2 中 / P3 低。「状态」列标明本轮是否已修复。

### 3.1 已修复（本轮直接改代码/脚本，安全无回归）

| 级别 | 发现 | 证据（文件:行号） | 处置 |
|---|---|---|---|
| **P1** | `sync-portal.bat` 用 Unix 重定向 `>/dev/null`，Windows 上 chcp 失败/生成垃圾文件；且 `chcp 936` 使其调用的 node（UTF-8 输出）显示乱码 | `sync-portal.bat` L2 | **已修**：改 `chcp 65001 >nul`，文件转 UTF-8 |
| **P2** | `restart-server.bat` 的 `KILLED=0` 逻辑缺陷：无法区分「端口空闲(找不到PID)」与「权限拒绝」，两者都误判为拒绝访问→pause 退出，**永不执行 npm start**（步骤2 实测该脚本重启失败） | `restart-server.bat` L5-15（旧） | **已修**：重写为 `PID3000` 检测——找到才 kill（errorlevel 判权限），端口空闲直接启动，末尾必执行 npm start |
| **P2** | `restore-all.js` 日志模板字符串被错误转义为 `\${...}`，日志打印字面占位符 `[${s.type}] ${s.name}` 而非真实值，批量恢复操作全程无可观测性 | `server/routes/restore-all.js` L45/53/67 | **已修**：解开转义为 `${...}` + 修正缩进 |
| **P3** | `restore-all.js` `err.message.slice()` 若 message 为 undefined（非 Error 抛出）会二次 TypeError | `restore-all.js` L63 | **已修**：`String(err.message \|\| err).slice(0,200)` |

修复后 `node --check` exit=0，`npm test` 仍 **71/71 通过**，后端已重启使改动生效（第一批 PID 29956 → 第二批 PID 39652）。

### 3.2 已修复（第二批：用户决策「鉴权统一放行 + 全部应用 + 每改验证」后）

> 用户就本节原「待决策」项拍板：**鉴权统一放行**（移除 `.env` 的 `API_TOKEN`，匹配单用户本机/可信局域网定位）；**全部 P2/P3 韧性/一致性缺陷应用并逐项验证**。以下逐项已修复（验证证据见 §1 基线）：
>
> **2026-09-02 完整复审**：逐项对照真实代码（新鲜 Read）+ `node --check`×5=0 + `npm test` 71/71 + `npm run build` exit0 复核；用户再确认「鉴权统一放行、intervalMinFor wire-up、restore-all 软上限」三项均维持现状，**无需回滚**。复审同时订正了本节与附录 B 早期照 plan 写就的失真引用（路径缺 `collectors/`、`activeFetches`/`MAX_IMMEDIATE_REFRESH`/`_wempLogFd` 标识符错、行号漂移、以及一处**虚构的「index.js L48 传 adapterDefault」改动**——该改动从未发生）。因主仓库无 .git 且 transcript 仅存 text，「变更前」快照不可机器恢复；但 SearchReplace 精确匹配机制排除了「误配过时快照」的可能。

| 级别 | 原缺陷 | 修复方案 | 文件:行号 | 验证 |
|---|---|---|---|---|
| **P1** | 鉴权中间件注册顺序 bug：路由先挂载、authMiddleware 后注册（L75，在所有挂载之后）→挂载路由绕过鉴权；前端从不发 token；`/api/columns` 未挂载落中间件返 401（行为不一致） | **统一放行**：`.env` 注释 `API_TOKEN=`→`REQUIRE_TOKEN=false`，`/api/*` 一致免 token；并在 `index.js` 中间件处补注释，记录「未来若启用 REQUIRE_TOKEN 必须把 authMiddleware 移到路由挂载之前」的 dormant 顺序缺陷 | `.env` L3-4（注释，token 值保留可恢复）；`server/index.js` L69-74（注释）、L75（app.use） | `/api/columns` 实测 **401→404**；`/api/{daily,sources,settings,status}`=200；14:22 重启无错 |
| **P2** | `store.fetchSource` 无 in-flight 锁，并发可重复抓同一源 | 模块级 `inFlight:Set`（L81），`fetchSource` 包装器：入口 `has(id)→return{skipped}`（L88-91）、`add(id)`（L92）、委托原体 `fetchSourceInner`（L100）、`finally` 释放（L96） | `server/services/collectors/store.js` L79-98 | `node --check`✓；`npm test` 71/71✓ |
| **P2** | `rss` 全文补抓循环无总超时，最坏 7.5min/源期间持 `ticking` 阻塞后续源 | 加 60s 批预算：循环前记 `ftStart`（L373），每条前检查 `Date.now()-ftStart>FT_BUDGET_MS`(60000，L374) 即 `break`+`log.warn`（L377-380） | `server/services/collectors/rss/index.js` L371-380 | `node --check`✓；`npm test` 71/71✓ |
| **P2** | `restore-all?refreshImmediately=true` 无条数上限，单请求串行 fetch N 源可挂起数分钟 | 软上限 `REFRESH_CAP=20`（L58）：超限源只解冻不立即抓、逐条标 `deferred:true`（L59-63），交调度器按 next_fetch_at 自然补抓；返回体 `{ok,message,restored,refreshed,failed,results}`（L82-89）。**局限**：软上限界定但未根除最坏挂起（20×单源全文预算仍可数十分钟），更稳健方案为异步 job+立即返 id（**2026-09-02 复审：用户确认维持软上限，异步 job 列为可选未来增强**） | `server/routes/restore-all.js` L56-63 | `node --check`✓；`npm test` 71/71✓ |
| **P2** | `wempSupervisor` 父进程被强杀时 `process.once('exit')` 同步钩子 vs `spawn taskkill` 异步→子进程 Python 孤儿 | `killChild()`（L35-46）内用 `spawnSync('taskkill',['/PID',pid,'/T','/F'])`（L43）替代异步 spawn；经 `process.once('exit',killChild)`（L135）+ SIGINT/SIGTERM 钩子（L136-138）同步调用，确保 taskkill 完成后再退出 | `server/services/wempSupervisor.js` L35-46、L135-138 | `node --check`✓ |
| **P2** | 证据卫生：`.reschedule-out.json`（`stale8hAfter:115==total` 自相矛盾）等 6 个一次性脏证据残留 | 删除全部 6 个一次性证据文件；实时可复现证据改由 `.live-probe.cjs`/`.auth-probe.cjs`/`.leak-probe.cjs` 按需生成 | `tools/.reschedule-out.json`、`.verify-p0/p02/p11.json`、`.probe-a/b.json`（均已删） | 复核 `tools/` 0 残留✓（详见 §4） |
| **P3** | `wempSupervisor` 每次重启 `openSync(wemp.log)` 新 fd 不关闭→fd 泄漏 | `start()` 每次 `openSync` 的局部 `logFd`（L88），在 `child.on('exit')` 钩子内 `closeSync(logFd)`（L102）释放；重启流程先 exit 关旧 fd 再 start 开新 fd，无泄漏（非模块级复用） | `server/services/wempSupervisor.js` L88、L102 | `node --check`✓ |
| **P3** | `rss.defaultIntervalMin:480` 死代码，`store.intervalMinFor` 不读它（硬编码 magic number） | wire-up（**无签名变更、未改 index.js**）：`intervalMinFor(source)` 内部加 `adapterDefault(t)` 闭包（L64-68，调 `registry.getAdapter(t).defaultIntervalMin`，registry L5 导入）；bilibili/douyin/fallback 分支改用 `adapterDefault(t)` 回退硬编码（L69/70/76），rss/wechat/x/youtube 仍走 intervals.rss 缺省 8 小时（L72-73）。零漂移：bilibili 适配器默认=60、douyin=360 恰等旧硬编码，hotlist/wemp 全带 extra.intervalMin。**注**：另一可选方案是直接删死字段，wire-up 旨在兑现 registry 适配器契约 | `server/services/collectors/store.js` L54-77 | `node --check`✓；实时探测 byType 与基线**逐字节一致**（零漂移，§4） |
| **P3** | `restore-all` 批量 UPDATE 未包事务，中途崩溃→部分状态 | `db.transaction()` 包裹整批解冻 UPDATE（`applyRestore` 定义 L36-49、调用 L50），中途异常全回滚 | `server/routes/restore-all.js` L35-50 | `node --check`✓；`npm test` 71/71✓ |
| **P3** | `ArticleList.jsx` 在 setState updater 内调父回调 `onItems?.()`，React 反模式，StrictMode 双触发 | `onItems` 移出 updater，改 `useEffect(()=>{onItems?.(items)},[items,onItems])`（L127-129）；父 `ReaderPage.jsx` L85 传 `setArticleItems`（React setState，身份恒定）→ 依赖中 onItems 不致额外触发，无死循环 | `web/src/components/ArticleList.jsx` L1（导入 useEffect）、L125-129 | `npm run build`✓ 66 modules/2.05s |
| **P3** | `tools/` 过时重复副本（旧 buggy `restart-server.bat`、旧 `start-all.bat`），误运行命中旧 bug | 删除 `tools/restart-server.bat`、`tools/start-all.bat`；根目录版为唯一权威（已修） | `tools/restart-server.bat`、`tools/start-all.bat`（均已删） | 复核 `tools/*.bat` 仅剩 `运维工具箱.bat`✓ |

**唯一保留未改（经评估为合理现状，非缺陷）**：`start-all.bat`「端口占用即跳过」是**防双启的正确行为**；「不构建前端」是可接受缺口——本轮已手动 `npm run build` 刷新 `web/dist`，给每次冷启动强加 build 会拖慢启动；且该脚本为 GBK+`chcp 936` 内部自洽（用户控制台正常显示，mojibake 仅 UTF-8 查看视角），强转 UTF-8 反有破坏中文 echo 风险，故保持原样。

---

## 4. 证据卫生与已知矛盾澄清

### 4.1 `.reschedule-out.json` 的 `stale8hAfter` 矛盾（已澄清）

- **矛盾**：`FINAL_FIX_REPORT.md` L376 声称「115 源重排，stale8hAfter=0」，但保留的证据文件 `tools/.reschedule-out.json` L61 却是 `stale8hAfter:115`。
- **实时复核**（`tools/.live-reschedule-probe.json`，12:02）：total=**119**，stale8hAfter=**0**，byType 显示 wemp(65)/hotlist(28) 期望间隔=30min、rss(22)=480min，`futureDist.beyond8h=0`。
- **判定**：旧文件的 `stale8hAfter:115` **恰等于它自己的 `total:115`**——那个一次性脚本（`.verify-p0.cjs`，已删）的指标是**误标/有 bug 的**（把「全部源数」当成「陈旧源数」），同文件 byType 又显示 wemp/hotlist=30min，自相矛盾。**报告 L376 的功能结论（无残留 8h 陈旧 deadline）经实时数据证实为真**，但其引用的证据文件本身是脏的。
- **处置**：风险从「P0 修复失效」降为「P2 证据卫生缺陷」，**本轮已修复**：`tools/.reschedule-out.json` 及其余 5 个一次性脏证据（`.verify-p0/p02/p11.json`、`.probe-a/b.json`）已全部删除；实时证据改用 `tools/.live-probe.cjs` → `.live-reschedule-probe.json` 按需重生成（最新 06:49Z：total=119 / stale8hAfter=0 / byType 与改动前基线逐字节一致）。

### 4.2 报告声称「跑完删除」的证据文件（本轮已全部清理）

`FINAL_FIX_REPORT.md` 称验证脚本跑完即删，但审计时 `.verify-p0.json`/`.verify-p02.json`/`.verify-p11.json`/`.reschedule-out.json`/`.probe-a.json`/`.probe-b.json` **6 个证据文件全部仍在** `tools/`（文档与实际不符，P3 证据卫生，不影响功能）。**本轮已删除全部 6 个**；复核 `tools/` 下 `.verify*`/`.probe-*`/`.reschedule*` **0 残留**，仅保留可复现的实时探测脚本与输出（附录 A）。

---

## 5. 遗留待办（中长期，来自各审计文档仍有效建议）

- **源异常自愈**：熔断后纯人工恢复→建议半自动恢复策略 + 指数退避（SOURCE_ERROR_AUDIT §2/§3）
- **B站 WBI 签名监控**：密钥失效需人工更新 SESSDATA，建议加失效预测报警（SOURCE_ERROR_DIAGNOSIS §3）
- **抖音/B站代理轮换 + Cookie 池**：Phase 10 长期架构（SOURCE_ERROR_AUDIT §6）
- **前端 Error Boundary 缺失**：`web/src/main.jsx` 无容错包裹，JS 错误致白屏（ARCHITECTURE_AUDIT §6）
- **冷却机制改进 / 日志级别过滤 / 异步写入 / DB 健康检查**：FINAL_DIAGNOSIS §7-10 待开发
- **量子位《李飞飞》一文复核**：REFRESH_MECHANISM_AUDIT §3.5 唯一未执行项
- **冗余资产清理**：`data/v.mp4`(35MB)、`data/intel.db`(空库)、`analysis/frames`(400+张)、`_eval/`(200MB)（ARCHITECTURE_AUDIT §1-4）

---

## 附录 A：实时验证证据文件（本轮生成，可复现）

| 文件 | 用途 |
|---|---|
| `tools/.live-probe.cjs` → `.live-reschedule-probe.json` | 实时 next_fetch_at 间隔分布，复核 stale8h（最新 06:49Z） |
| `tools/.live-probe-before.json` | 改动前 byType 基线快照（与最新输出逐字节对比，证 intervalMinFor wire-up 零漂移） |
| `tools/.auth-probe.cjs` → `.auth-probe.json` | 未鉴权端点探测（**改动前基线**：columns=401 不一致；改动后统一放行 columns=404 见 §1） |
| `tools/.leak-probe.cjs` → `.leak-probe.json` | extra 凭据泄漏面扫描（只报键名/长度，不打印值） |
| `analysis/_npmtest.txt` / `_npmtest2.txt` / `_npmtest3.txt` | npm test 完整输出（71/71 ×3，含第二批改动后） |
| `analysis/_build3.txt` | 前端 `npm run build` 输出（66 modules / built in 2.05s / exit 0） |
| `analysis/_restart2.txt` / `_verify_restart2.txt` | 后端重启全过程 + 存活验证 |

## 附录 B：修改文件清单

**第一批（§3.1，批处理 + 路由转义）**
- `sync-portal.bat`（chcp+`/dev/null`→`nul`，GBK→UTF-8，BOM-free 已核）
- `restart-server.bat`（KILLED 逻辑重写为 PID3000 检测，GBK→UTF-8，BOM-free 已核）
- `server/routes/restore-all.js`（模板字符串解转义，现 L47/L63/L77/L84 反引号正常 + L73 err 防御 `String(err.message 或 err).slice(0,200)`）

**第二批（§3.2，用户决策后全部应用）**
- `.env`（L3-4 注释 `API_TOKEN=` → 统一放行，`REQUIRE_TOKEN=false`；token 值保留，删 L4 行首 `# ` 即恢复）
- `server/index.js`（**仅** L69-74 补 dormant 鉴权顺序注释、L75 app.use；未因 intervalMinFor 改动）
- `server/services/collectors/store.js`（L79-98 inFlight 锁：Set L81 + fetchSource 包装器 L86-98 + 原体改名 fetchSourceInner L100；L54-77 intervalMinFor 内部 adapterDefault 闭包 wire-up，无签名变更）
- `server/services/collectors/rss/index.js`（L371-380 全文补抓 60s 批预算：ftStart L373、FT_BUDGET_MS L374、break+warn L377-380）
- `server/routes/restore-all.js`（L35-50 db.transaction 包裹批量解冻 UPDATE；L56-63 REFRESH_CAP=20 软上限 + 逐条 deferred）
- `server/services/wempSupervisor.js`（L88/L102 logFd openSync/closeSync 防泄漏；L35-46 killChild 用 spawnSync L43 防孤儿，经 L135-138 exit/信号钩子同步调用）
- `web/src/components/ArticleList.jsx`（L1 导入 useEffect；L125-129 onItems 移出 updater 改 useEffect，父 ReaderPage.jsx L85 传 setArticleItems 恒定身份无循环）

**删除文件**
- `tools/restart-server.bat`、`tools/start-all.bat`（过时重复副本）
- `tools/.reschedule-out.json`、`.verify-p0.json`、`.verify-p02.json`、`.verify-p11.json`、`.probe-a.json`、`.probe-b.json`（6 个一次性脏证据）
