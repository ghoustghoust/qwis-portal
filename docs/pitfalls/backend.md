# 坑 · 后端与数据（backend）

### #10 better-sqlite3 不支持编号参数 `?1 ?2 ?3`
- 症状：`.run(a,b,c)` 抛 RangeError，UPDATE 空转。
- 规则：一律匿名 `?` 或命名参数对象。（2026-09-04 全文补抓曾因此空转）

### #11 异步回调内的同步 DB 操作必须 try/catch
- 症状：setImmediate/cron 里 prepare 不存在的列 → uncaughtException 崩进程。
- 规则：一切异步回调里的 DB 调用包 try/catch，绝不裸奔。

### #12 pending_items 表结构只有 (id,type,url,name,status,error,imported_at)
- 规则：无 source_id/created_at；文章关联一律经 url JOIN articles 取 a.id。

### #14 Express 中间件按注册序执行
- 案例：2026-09-04 前 authMiddleware 挂在路由后 → 全 API 零鉴权。
- 规则：鉴权/防护中间件必须在路由挂载前注册（index.js 有 P0-1e 回归锁）。

### #15 aggregator 是 extra JSON 标志，不是 sources.type 取值
- 规则：判断聚合源一律 `json_extract(COALESCE(extra,'{}'),'$.aggregator')=1`；`type != 'aggregator'` 恒真（曾致 AIHOT 被越权直抓）。

### #16b cron 任务必须模块级句柄管理
- 症状：reschedule() 重复调 scheduleXxx 叠加定时器（fulltext cron 越挂越多）。
- 规则：改设置先 stop 旧句柄；长任务禁同步执行（门户同步曾 execSync 阻塞数分钟，改 spawn detached + in-flight 守卫）。

### #17 focus 有两种写法，选错互踩
> ✅ **已由 27b 解决（2026-09-15）**：focus 列退役，语义拆为 spotlight（重点）+ subscription.ids（订阅）两轴；
> `focusSourceIds` 全量替换与 batch focus 增量并存的双写法问题随之消失（全量=PUT settings/daily spotlightSourceIds，增量=batch spotlight，落同一列）。
> 下文为历史记录保留。
- 日报设置页 `focusSourceIds`=全量替换（不在名单的源 focus 清零）；源库 batch focus=增量。
- 规则：**新代码一律增量**；全量替换只保留日报设置页一个入口；手动锁定统一走 `extra.categoryLocked`（写入点只有 POST /api/groups/move 与 batch move）。
- ⚠️ 测试侧翻版见 testing.md #27——全量替换语义测试曾把线上订阅清零。

### #23 无索引列上大表查询在云端是致命的
- 案例：2026-09-11 articles 3.6 万行后 `MAX(created_at)`/`ORDER BY COALESCE(...)` 全表扫描 43-46s → Vercel 30s 超时全线 504。
- 规则：新增高频过滤/排序列必须同步建表达式索引（idx_articles_created / idx_articles_pubco）；本地快感觉不出来，云端必炸。2026-09-13 实测 `/api/reading` 11.2s、`/api/status` 6.1s 仍待优化（T3-3）。

### #25 游标值必须与排序键同型（2026-09-13）
- 症状：阅读器 30 条后滑不动；热点榜翻页恒空。
- 根因：`published_at` 存 ISO 文本，游标发 epoch 秒数——SQLite TEXT 与数字串比较按类型序恒假，第二页恒 0 行。
- 规则：游标一律发**排序键的原生列值**（ISO 文本）；排序键为数值表达式（smart）时绑定 `Number(cursorVal)`。云端 handleArticles/handleHot 与本地 server/routes/articles.js 三处已同步；新列表接口必守。

### #31 SQLite 表达式树深度上限 100，超长 OR 链必炸（2026-09-14）
- 症状：实时流 AI 词表过滤（约 110 个 `LIKE/GLOB` 用 OR 连成链）在 Turso 报 `SQLITE_UNKNOWN: Expression tree is too large (maximum depth 100)`，`/api/hot?tab=all` 恒 500。
- 根因：扁平 `a OR b OR c …` 是左深树，深度=条件数，过 100 即拒。
- 规则：动态拼 OR 条件一律用**平衡二叉树**拼接（`orTree()`，深度 ≈ log2N）；本地 better-sqlite3 同样受限，别以为只有云端炸。


### #33 runner 调用了从未定义的查询助手，被 try/catch 吞成一行日志（2026-09-18 线上抓出）
- 症状：我的早报「阅读足迹」卡**从来没有出现过**（线上 `settings` 里连 `reading.digest` 键都不存在）；`daily-ai` 的 `stats.videos` 恒 0；collect 批次「少量失败」分支下 `collectStalled` 停滞检测整体不触发。表面看都像"功能没接上"。
- 真根因：`tools/collect-turso.js` 只定义了 `qAll()` / `qRun()`，**`qOne()` 从未定义却被 6 处调用**（`:648 :655 :725 :970 :971 :1216`）。每处都是 `ReferenceError: qOne is not defined`，而调用点全在 `try { … } catch (e) { log('…（已隔离）') }` 里 → 异常被降级成一行没人看的 runner 日志，功能静默归零。
- 放大效应：`:648`（逐条源报警）与 `:658`（停滞检测）**在同一个 try 块里**，前者一抛，后者直接跳过——这正是 AGENTS.md §2 开头「云端停摆 2 天无人发现」的机制级成因之一。
- 规则：①被 `catch` 隔离的辅助函数**必须假定自己会静默失败**，关键产物落库/报警不要整块塞进同一个 try；②新增 `lib`/script 里的查询助手，同区一次性配齐 `qAll/qOne/qRun` 三件套，别只加两个；③**每次线上修过的 bug 必须有回归锁**——本次用静态断言锁死「runner 不得调用未定义的 `q*` 助手」（`tests/regression-20260918.test.js` 第 3/4 项），这类"未定义标识符"用一条 grep 式测试就能永久拦住，成本远低于一次事故。
- 同族历史：`rss/index.js` 缺 `log` 导入 → 大规模熔断无法定位（坑 #20 同族：局部缺失被静默吞掉）。

### #36 `typeof null === 'object'`：迁移序列化把 NULL 写成字符串 `'null'`，毒害一切「IS NOT NULL」口径（2026-09-19 实测）
- 症状：「我的阅读」显示 已读 25142 = 全部 25142；未读角标恒 0；`read_at >= datetime('now','-1 day')` 命中 2.5 万行，看起来像"有人批量标已读"（旧 B15 就是这么误诊的）。
- 根因：`tools/migrate-to-turso.js:250` 序列化写 `if (typeof v === 'object') return JSON.stringify(v)`，而 **`typeof null === 'object'`** → NULL 列被写成字面字符串 `'null'`。实测云端 `read_at='null'` 24855 行、`tags='null'` 24355、`reason='null'` 24799、`videos.watched_at='null'` 846；真 ISO 已读只有 287 条。本地库干净 → **污染只在迁移目标端**。
- 规则：①任何"值→存储字符串"的序列化必须先显式处理 `v === null`/`undefined`，禁止用 `typeof === 'object'` 当判据；②凡"IS NOT NULL 即真值"的口径（保留清理豁免、未读角标、阅读足迹）都要额外排除 `'null'`/`''` 字面串，或在写入侧就不产生；③**字符串与 ISO 时间比较是文本序**（`'null' > '2026-…'` 为真），任何"最近 N 天"统计若命中数异常巨大，先查列里有没有字面串，再谈业务解释；④诊断结论必须区分"数据被写了"与"数据被写歪了"——两者修法完全不同。
- 案例：2026-09-19 20 条批注实测；订正 `docs/ISSUES.md` B15（原误诊）与 BL10；受影响口径 `api/[...slug].js:1958`（保留清理）、`:876/:917`（未读角标）、`tools/collect-turso.js:974`（阅读足迹）。
