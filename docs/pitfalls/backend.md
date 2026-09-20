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

### #37 同一个判定抄成 N 份：列表与计数、本地与云端各写一遍，副本之间还会各有增减（2026-09-19 实测）
- 症状：`/api/reading?type=podcast` 列表返回 30 行真播客，`counts.all` 却是 0；`type=article` 计数 6413，而按同口径实数是 7282（869 篇公众号文章不进计数）。用户侧看到"筛得出条目、角标显示 0"。
- 根因：一个分类判定（"这篇文章算不算播客/算不算文章"）在**六处**各手写一份 SQL——本地列表、本地计数、云端列表、云端计数、runner 日报栏、runner 周刊栏。六份彼此漂移：四处漏 `'wemp'`，两处计数写 `s.type='douyin'`（把播客当抖音），runner 与日报那两份还比读层少一个 `.opus`。
- 规则：①**分类判定只许有一份实现**，放 `lib/`，列表与计数、本地与云端、runner 都从它取表达式（`lib/reading-filters.js`、`lib/media.js#audioCoverSql`）；②注释写"与 XX 同口径"不构成同口径——**只有能被机器验证的引用才算**（`npm run eval:whitebox` W10 按 LIKE 模式集合重叠度判重，专治"少一个扩展名"这种近似副本）；③改一份必须同时改消费方，回归测试要**同时跑列表 SQL 与计数 SQL 比对条数**（`tests/regression-20260919c.test.js` B60-7），只断言字符串同源不够；④JS 侧正则判定与 SQL 侧 LIKE 判定无法逐字符等价，所以要有 **JS↔SQL 一致性锁**：同一批样本 URL 两边判定必须相同（B60-5）。
- 案例：2026-09-19 云端实测（`tools/_diag-reading-count.cjs`）；登记为 B60/B61，并订正 B29——B29 当时只改了云端列表，本地两端与云端计数未动，属"修复本身单端"的二次违例。

### #38 能力差异用"给人看的文案"表达 = 界面必然说谎（2026-09-19 实测）
- 症状：云端后台「整库快照」区显示「暂无快照」，三个按钮照常可点，点了才吃到 501。用户理解成"这功能还没快照"，而真值是"这个部署形态根本没有这项能力"。
- 根因：云端 `GET /api/data/list` 返回 200 + `{backups: [], note: '云端 Turso 不支持文件型快照…'}`。能力声明藏在 **note 文案**里，前端从不读它，只看 `backups.length` 与一个默认 `ready=true`。服务端确实"说了"，但说的方式对机器不可见。
- 规则：①端点/部署间的**能力差异必须是布尔字段**（如 `fileSnapshots: true|false`），不能只写进 note/日志/文档；②界面空态要先判能力位再判长度——"做不到"和"还没做"是两句不同的话，混说就是骗人；③新增这类分支要有**顺序断言**（回归锁 B56-2 判的是"能力位必须排在长度判断之前"，而不是"不许出现某句文案"，因为后者在本地端是正确文案）；④同类问题在 B58 也发生过：云端把读到的映射 `Object.keys()` 一下丢了，只回名字不回 map，前端 `if (d?.map)` 永不成立且 `.catch(() => {})` 静默 → 界面常年显示过时的内置默认。
- 案例：`docs/ISSUES.md` B56、B58；修复见 `api/[...slug].js#handleDataList/handleHotCategories`、`server/routes/data.js`、`web/src/components/DataTab.jsx`、`lib/hot-categories.js`。

### #55 配置表的"第 N 份副本"会经由「恢复默认」把脏值写进生产库（2026-09-19，B10）
- 症状：线上 AI 版早报的栏目注解是一串关键词复述（「Codex、Claude、豆包…等动向」），而 AI 版本不该显示关键词版注解。
- 根因（实测）：同一张栏目表在仓库里有 **5 份**抄本——`api/daily-generate.js`、`tools/collect-turso.js`（desc 短版）、`api/[...slug].js` **两份**（日报生成用一份、设置段"默认列"一份）、`server/services/ai/daily.js`（desc 写成关键词复述版）。本地那份生成的报告同步进云端，线上就显示回声式注解；而读层的「恢复默认栏目」会把**它自己那份副本写进 `settings.daily.columns`**。
- 关键升级点：「默认值会被写回 settings」的语义，等于把代码副本当成**生产数据的一部分**。这类副本漂了的最终形态不是"界面难看"，是脏值落库——改代码救不回来，得后台点一次恢复默认或授权订正。
- 规则：①配置表/枚举/源类型集合一律放 `lib/` 由三端 require，不在生成端各写一份；②数"有几份实现"必须**按内容特征扫全仓库**，不许按人记忆里的文件清单列（本轮正是靠全仓库扫才发现是 5 份而不是 3 份——我原来的判断就是按清单猜的）；③写回 settings 的默认值要有对账锁，防止默认值本身是脏的。
- 锁：白盒 W13（全仓库扫栏目表，只许 `lib/daily-columns.js` 一份；负向验证=塞一份探针副本即红并点名文件）+ `tests/regression-20260919i.test.js` I8。

### #56 路由接上 ≠ 能访问：`PUBLIC_GET_PATHS` 是精确匹配集合（2026-09-19 实测 401，B26 拆分时自打）
- 症状：把重统计从 `/api/status` 拆成 `GET /api/status/daily-sources` 后，静态判据全绿（路由表里有、handler 有、本地端 200），
  线上 `curl` 一把 **401**。前端右栏的来源榜会永远显示"加载失败"。
- 根因：`api/[...slug].js` 的鉴权用 `PUBLIC_GET_PATHS = new Set([...])` + `Set.has(path)` **精确匹配**，
  不是前缀匹配。新公开端点不显式加进这个集合，就会被当成需要 JWT。
- 规则：①云端新增任何 GET 端点，**同一次改动里**必须处理三处——路由表、鉴权白名单（或明确它要鉴权）、消费方；
  ②这类"多张清单要同时改"的分支要有**成对断言**（锁 I10 同时断言 `path === '/api/status/daily-sources'` 与
  `PUBLIC_GET_PATHS` 含该串），只断一条就是假绿；③**本地端通过不等于云端通过**（本地 Express 单用户放行，测不到这层），
  所以新端点必须有一次真打线上（AGENTS §2 条 2 的存在理由，本轮就是靠它抓回来的）。
- 案例：`2ecf3d4`（B26 拆分补丁）。

### #60 迁移期字面串 `'null'`：文本序里它比任何 ISO 时间都大，`MAX()` 一次毒掉两端各自的「最后同步」
- 症状：后台「RSS 最后同步」自上线起恒显示"从未同步"，但库里明明一直在抓。根因不是没抓，是 `sources` 里有 1 行 `last_fetched_at` 存的是**字符串 `'null'`**（`tools/migrate-to-turso.js` 迁移期把 JS `null` 直接 `String()` 落库那一族，与 B15 的 24855 条 `read_at='null'` 同源）。SQLite 里时间是 TEXT，`'null' > '2026-09-19T…'` 按字典序成立 → `MAX(last_fetched_at)` 取到它 → 读层那句 `if (v === 'null') return null` 又把它变成 `null` → 界面显示"从未同步"。
- 为什么能活这么久：①**污染在数据里，判据在代码里**——只看代码看不出问题；②这类聚合在**三端各写一遍**（本地 `status.js` 的 rss 与 bilibili、云端 `[...slug].js` 的两条、还有一支诊断脚本），我第一轮只给 `rss` 那条加了 `NULLIF`，于是"已修"的说法对一半（B93 上一版就犯在这里）；③接口巡检/端到端都只看"200 且字段存在"，`null` 是合法值 → 永远绿。
- 规则：①**在 SQL 层排**（`MAX(NULLIF(col,'null'))`），不要在 JS 里补兜底——JS 补了 `MAX` 仍然是错的值，其它消费方继续中毒；②`MIN()` 不在此列（`'null'` 抢不到最小），**别为了判据对称去改无关代码**，说清为什么只收 MAX；③这类"每个写入/读取点各写一遍"的不变量，判据必须**从事实派生**：白盒 **W15** 扫全仓 `MAX(<已知污染列>)` 出现点并要求同一表达式里有 `NULLIF`（本轮它当场抓出第 5 处：`tools/_diag-media.cjs`，正是"两端各写一遍必漏一端"的实测样本）；④**这是绕过污染、不是订正污染**：B15/BL10 的数据订正（等授权）没做之前，任何按文本比较这些列的地方都仍可能出怪结果，登记时不许写"脏数据已修"。
- 案例：`server/routes/status.js:67,74`、`api/[...slug].js:919,920`、`tools/_diag-media.cjs:17`；判据 W15；行为锁 `tests/regression-20260919i.test.js` I14（种"一行真时间戳 + 一行字面串 `'null'`"，断言端点回真时间戳，并带两条前提探针防空库假绿）。

### #70 JS 数字绑进 `json_set` 落成 `1.0`（real），要 integer 必须 `CAST(? AS INTEGER)`（2026-09-21 写 B112 的锁时实测）
- 症状/诱因：B112 要把 `daily_reports.stats.$.schemaVersion` 的三种形态（缺失 / 数字 / 字符串 `"1"`）统一成"写入侧只走常量"。
  第一版我以为"`json_set(stats,'$.schemaVersion', ?)` 绑一个 JS number 就对了" —— 实测 `json_type()` 返回 **`real`**，库里会变成 `1.0`。
  读侧 `Number(...)` 照样兜得住，所以**这条如果只跑一次代码看不出来**，它只会让"字段有几种类型"从三种变成四种。
- 根因：驱动把 JS number 当 double 送进 SQLite（不是 integer），`json_set` 按值的类型存；带引号的 SQL 字面量则是 text（收口前那 1 行 `"1"` 就是这么来的）。
- 规则：①凡是要往 JSON 列里写"必须是整数"的值，SQL 里写 **`CAST(? AS INTEGER)`**，常量仍从 JS 侧传；
  ②判"类型对不对"必须用 **`json_type(stats,'$.path')`** 实测，不要看代码里那个数字长什么样（与 #60 同族：污染在数据里，判据在代码里就等于看不见）；
  ③改这类字段时**读侧不许顺手收紧**成"只认 integer"——存量行有真实历史形态，收紧会把它们降级（Q5 就是钉这条）。
- 判据侧的连带教训（同一轮踩到）：想表达"赋值处不是 `CAST(`" 时**别写 `,\s*(?!CAST)`** —— `\s*` 会回溯出"零个空格"的匹配，而 lookahead 在空格位置上成立，于是**唯一正确的写法反而被判红**（实测 W14 当场把自己的修复判成违规）。改成"先取到赋值右侧的值，再用 `^\s*CAST\s*\(/` 测形状"（`schemaSetIsBad()`），一条规则一次匹配，不给回溯留位置。
- 案例：`tools/collect-turso.js` 的降级分支；行为锁 `tests/regression-daily-schema-version.test.js` Q4（四种形态逐个断言 + 仓库 SQL 形状）；判据 = 白盒 W14 扩的一条（档位字段必须走 `DAILY_SCHEMA_VERSION` 常量，SQL 里赋值只放行 `CAST(? AS INTEGER)`）。
