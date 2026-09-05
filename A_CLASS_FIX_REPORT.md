# A 类硬伤修复报告（2026-09-04）

> 范围：2026-09-04 全项目审计（4 路并读：repowiki/docs、server 后端、web+portal 前端云端、22 份报告）发现的 **A 类现存代码级硬伤**，全部 12 项已修复，另有对抗性审查二轮发现 8 项一并修复。
> 验证：`npm test` 92/92 绿；`npm run build`（web）与 `portal` build 双绿；`node smoke-test.js` 20/20。
> 回归测试：`tests/regression-aclass.test.js`（21 项，动态 + 静态断言混合）。

## 一、A 类 12 项修复明细

| # | 问题 | 修复 | 涉及文件 |
|---|---|---|---|
| A1 | 聚合源刷新后 setImmediate 内 INSERT pending_items 引用不存在的 source_id/created_at 列，prepare 抛错可崩进程 | 改用真实列 (type,url,name,status,imported_at) + 整体 try/catch | store.js |
| A2 | enrichMissing 把 pending_items.id 当 articles.id 用，补抓链全废 | 改取 `a.id AS article_id`、删除用 `r.pending_id` | enrich.js |
| A3 | 调度器清理 `require('../services/datamgr')` 路径错误，MODULE_NOT_FOUND 被吞，自动清理从未执行 | 改 `require('../datamgr')`；保留天数改读 `settings.data.retentionDays`（≥1 下限，默认 7，与 DataTab 联动） | scheduler/index.js |
| A4 | 全文补抓 UPDATE 引用不存在的 updated_at 列 + 调用不存在的 log.debug，每 6h 全量失败 | 去 updated_at；去逐条 debug 日志 | scheduler/index.js |
| A5 | hotlist 热度 score 入库被丢弃（insertArticle 列清单无 score） | 入库带 score（Number 归一）；冲突时刷新热度值，空值不清空 | store.js |
| A6 | DataTab：React.useRef 未导入必崩；list/stats/preview 字段名全错位（backups/sizeBytes/willDelete）；导入快照是空壳 | 全面对齐后端契约；新增真实上传链路 | DataTab.jsx、data.js、datamgr.js |
| A7 | 抖音扫码登录前后端死链（前端调 /api/auth/douyin/*，后端不存在） | 补齐双端点：GET status（查 credentials）+ POST start（有头浏览器扫码，5min 超时自动关窗） | auth.js、douyin/index.js |
| A8 | AlertsTab 清空日志调不存在的 api.delete；单条删除是假删除 | 改 api.del；新增后端 DELETE /api/alerts/log/:index | AlertsTab.jsx、alerts.js（路由） |
| A9 | portal src-admin：SourcesTab 重复声明（后者实为微信读书扫码）+ WereadTab 未定义 + 误放 HotSettingsTab（构建必炸） | 第二个正名 WereadTab；HotSettingsTab 移除（云端无对应后端），文件移 trash/ | portal/src-admin/App.jsx |
| A10 | portal/api/backfill.js 导出对象而非 handler，是无鉴权的非法 serverless 函数 | 改名 `_backfill.js`（下划线前缀不进 Vercel 路由），调用点同步 | portal/api/ |
| A11 | scripts/restore-frozen-sources.js 把 extra 清成 '{}'，抹掉 intervalMin/etag（P0-1 故障重现） | 只删 lastError/lastErrorAt，其余配置保留 | scripts/restore-frozen-sources.js |
| A12 | smoke-test.js 直写生产库 data/app.db | 启动时 better-sqlite3 backup 到临时副本 + APP_DATA_DIR 注入；硬编码计数改非空断言 | smoke-test.js |

## 二、对抗性审查（3 路攻击）后的二轮修复

| 级别 | 问题 | 修复 |
|---|---|---|
| 🔴 | A4 修复引入新错：`?1 ?2 ?3` 编号参数在 better-sqlite3 位置绑定下必抛 RangeError，全文补抓仍空转 | 改匿名 `?`（scheduler/index.js） |
| 🔴 | tests/aihot-parse.test.js 未 require helpers，npm test 以读写模式打开生产库（并删除 wal/shm） | 首行加 `require('./helpers')`；新增 R2-1 全量扫描守卫 |
| 🟡 | saveUpload 同名上传静默覆盖损毁已有快照 | 同名拒绝（existsSync 检查） |
| 🟡 | smoke-test 引导失败泄漏含 credentials 的临时副本 | mkdtemp 挪到 existsSync 之后 + catch 兜底清理 |
| 🟡 | enrichMissing「文章不存在删悬挂」分支因 INNER JOIN 不可达 | 入口预清理悬挂 pending 行，删死分支 |
| 🟡 | 报警日志单删 TOCTOU（删除瞬间新记录 prepend 会删错目标） | 下标 + at 指纹双校验，位移时按指纹重定位 |
| 🟢 | 抖音 startLogin 竞态（check 与赋值间隔 await，并发双击起 2 个浏览器） | loginInFlight Promise 占位 |
| 🟢 | alerts.clearCooldowns 清错键（清 settings['alerts'].cooldowns，生效的是 settings['alerts.cooldowns'] 且有内存缓存）——「清空冷却」实际无效 | 清正确键 + 失效内存缓存 |
| 🟢 | score 字符串热度被静默丢弃 | Number(a.score) 归一 |

### 审查确认「守住」的点（无需改）
upload 路径穿越/假文件头全拦；updateArticleScore 守卫语义正确；store.js lastError 清除无回归；douyin/status 纯查库不触发浏览器；AlertsTab 分页下标换算正确；portal 构建产物无 HotSettingsTab 残留；COLLECT_KEY 校验先于 mode 分支；解冻脚本实测 11/11（intervalMin/etag 保留、非法 JSON 不崩）。

### 已知遗留（低危，未修）
- hotlist 热度值与 AIHOT 评分共用 articles.score 列，同 URL 冲突时热度会覆盖评分（语义混用）。
- smoke-test 有 4 个安慰剂断言（恒真），断言质量待提升。
- portal admin 保存报警配置会整体回写 recentLog，保存期间新日志可能丢失（既有）。
- 本地 /api/* 无鉴权是既有设计（本机个人工具），upload/restore 等写接口在局域网暴露面需注意。

## 三、对既有报告的更正

- `DATA_TAB_FIX_REPORT.md` 声称的 `tests/data-tab-fix-verification.test.js`（15 项）**从未存在**，且其宣称修复的问题当时仍有崩溃级 bug。本次 DataTab 修复由 regression-aclass.test.js 真实覆盖。
- `ARCHITECTURE.md` 已同步：已知坑 +5 条（编号参数/异步 DB 防护/pending_items 结构/smoke 隔离/测试隔离），健康自检口径 71→92 项。

---

# 第二轮：B/C 类修复（2026-09-04，云端漂移 + 功能冲突）

> 前置决策（用户拍板，已记入 ARCHITECTURE.md §0）：**目标云端形态 = 宝塔/自有服务器全量部署（含 we-mp-rss + 抖音 Playwright），Vercel portal 进入冻结态**——冻结期只修安全项，功能语义漂移不再逐条对齐。
> 验证：npm test 105/105 绿；web + portal 双端 build 绿；img 代理安全实测 6/6 攻击向量拦截。
> 回归测试：tests/regression-bc.test.js。

## B 类（冻结期安全项，portal 侧）

| # | 修复 | 文件 |
|---|---|---|
| B18 | /api/img 加完整 SSRF 防护（DNS 解析后逐 IP 校验、IPv4-mapped IPv6 归一、重定向逐跳校验、流式累计 15MB 上限），抽到 `_safeimg.js` | portal/api/[...slug].js、_safeimg.js |
| B15 | read-all、daily/regenerate 收管理员口令鉴权（isAuthed，fail-closed） | portal/api/_handlers.js |

B13/B14/B16/B17/B19（热点榜数据源、日报语义、熔断计数位置、unread/视频收藏、三层 schema）按冻结决策**不修**，迁移到宝塔后 portal 整体退役，漂移自然消解。

## C 类（本地功能冲突/职责重叠，全修）

| # | 修复 | 文件 |
|---|---|---|
| C21 | WempTab 只列 type='wemp' 源（不再把 B站/抖音/rss 源列进公众号管理表） | WempTab.jsx |
| C22 | 熔断解冻收敛为唯一实现 `store.unfreezeSource`（清 fail_count/启用/清 lastError，保留 intervalMin/etag），toggle、health unfreeze(-all)、restore-all、scripts 四入口全部改走它 | store.js + 4 调用方 |
| C23 | 两套备份厘清为有意并存（/api/backup=配置轻量迁移；/api/data=整库快照灾备），头部注释划清边界 | routes/backup.js |
| C24 | daily 配置双写统一校验：validateDailyPatch 抽到 routes/daily.js 导出，settings.js 复用 | daily.js、settings.js |
| C25 | opml /refresh 失败改走 markSourceError（计入 fail_count/熔断体系） | opml.js |
| C26 | （已在第一轮 A3 顺带修复：retentionDays 接入调度器清理） | scheduler/index.js |
| C27 | SourceTable 无消费方的批量选择整体移除、伪防抖删除；DailySettingsModal 死双实现移 trash；BilibiliTab/DouyinTab 无引用 refreshAll 删除 | SourceTable.jsx 等 |
| C28 | 侧栏 counts 契约落地：/api/articles 返回 {later,history}，/api/videos 返回 {favorite,history}；空态文案改指 /admin/ | articles.js、videos.js、Sidebar.jsx、VideoGrid.jsx |

## 对抗性审查二轮（B/C 修复后）发现 + 三轮修复

| 级别 | 问题 | 修复 |
|---|---|---|
| 🔴 高 | img 代理三条 SSRF 绕过（IPv4-mapped IPv6 直连内网、302 跳板不重检、chunked 绕过大小上限）——**主系统 routes/img.js 同病** | 新建 server/util/safeimg.js，本地+云端双端换用；实测 6 攻击向量全拦截 |
| 🟡 中 | settings.js PUT 校验后置：`{intervals 合法, daily 非法}` → 400 但 intervals 已写库（部分写入语义欺诈） | 校验前置：先全部校验通过再统一写入 |
| 🟡 中低 | 批量刷新逐源报警会打爆渠道限流（87 源 × N 渠道） | markSourceError 支持 `silent`，refresh-all / opml /refresh 批量路径静默 + 结尾一条汇总报警 |
| 🟢 低 | restore-all 事务内 unfreezeSource 返回 false 仍记 restored:true | 改为跳过不虚报 |
| 🟢 低 | SourceTable 批量选择「可达但无消费方」仍是死功能 | 整体移除（比半吊子功能干净） |

### 审查确认守住
read-all/regenerate 鉴权 fail-closed、cookie 不可伪造；unfreezeSource 事务嵌套安全、toggle 停用路径语义不变、无循环依赖；WempTab 收窄后无孤儿类型；opml extra 竞态在本路径不触发。

### 遗留（记录在案，本轮不修）
- portal 非云端模式下未授权 POST 返回 500 而非 401；later/favorite 的 noop 分支对非 POST 谎称成功（冻结态，随 portal 退役消解）。
- 管理口令 token 无内嵌过期（改口令即失效，低危）。
- 回归测试的静态断言对「注释欺骗」无防御（已尽量用动态测试覆盖关键路径）。

---

# 第三轮：we-mp-rss 退役 + bestblogs 源迁移（2026-09-04）

> 决策（用户拍板）：we-mp-rss 整体退役（太重、未内部集成、需多开服务），公众号职责由 bestblogs wechat2rss 托管 RSS 接替；缺失的 28 个原 wemp 源接受损失；YouTube 走代理可用一并迁入。
> 验证：npm test 107/107 绿；双端 build 绿；实启动验证（/api/wemp 404、671 源在线）；YouTube 链路代理实测修复后正常。

## 迁移（tools/import-bestblogs-opml.js，幂等可重跑）

- wechat2rss 公众号 **375** 源 → type='rss'，分组「公众号」
- YouTube **124** 源 → type='youtube'，分组「YouTube」（rss 适配器别名入 videos 表）
- 播客 **60** 源 → type='rss'，分组「播客」
- 旧 **65** 个 wemp 源 enabled=0（历史文章保留，生产快照 `data/backups/app-20260904-180351.db` 可回滚）
- 首刷 next_fetch_at 6h 内随机错峰；URL 去重优先，同名去重仅同 OPML 内生效

## 退役清单（均移 trash/）

services/wempSupervisor.js、routes/wemp.js、collectors/wemp/、WempTab.jsx、tests/wemp-routes.test.js、tools/wemp-*.js|py、seed-mp-library.js、fix-wemp-shells.js；scheduler wemp 心跳、alerts wemp 双事件、health wemp 字段、ops-toolkit reset-wemp、monitor-local wemp 检测、start-all.bat/gen_bat.py 横幅与 8001 检查、.env WEMP_* 全部移除；docs/ 三份 wemp 文档加废弃标注。

## 对抗性审查发现 + 修复

| 级别 | 问题 | 修复 |
|---|---|---|
| 🔴 P0 | **rss 适配器 YouTube 分支必崩**：`!!result.notModified` 在非条件请求路径 result=null 时抛 TypeError，124 个新 youtube 源首抓全灭+3 分钟熔断 | `!!(result && result.notModified)`（rss/index.js:360）+ 回归测试 |
| 🟠 P1 | 侧栏混入 65 个停用 wemp 源（36 同名重复 + 854 篇死未读） | Sidebar 改拉 `/api/sources?enabled=1` |
| 🟡 P2 | 播客 7 源被跨 OPML 同名去重误杀 | 同名去重仅同 OPML 内生效，补迁 7 个 |
| 🟡 P2 | start-all.bat 横幅/8001 检查/扫码提示三处误导 + .env WEMP_* 明文口令残留 | gen_bat.py 模板更新重新生成；.env 清理 |
| 🟢 P3 | 破茧栏 FAMILIAR 缺新分组名 | 补「公众号/播客/YouTube」 |

### 守住项
迁移数据零缺失、URL 形态统一、错峰正确、分组 kind 匹配；wemp 停用源调度器 SQL 级排除实测不误抓、误启用会安全熔断；wechat2rss 实测 content:encoded 全文入库；日报/事件聚合自动覆盖新源；web/dist 无 WempTab 残留。

### 遗留（记录在案）
- portal/ 冻结态残留 wemp 逻辑（_collect fetchWemp、_admin 扫码复活 wemp、_daily 候选类型）——随 portal 退役消解，不修。
- wechat2rss feed 无 per-item author（上游限制），文章卡片作者列回退显示源名。
- 侧栏 500+ 行无虚拟化（当前量级可接受，未做）。
- RSS 增量过滤器只收 14 天内条目：周更 YouTube 频道历史视频不回溯，新视频正常进。

---

# 第四轮:D 类文档收口 + 功能完整性检测 + 检测发现的真问题修复(2026-09-04)

## D 类收口
- `.qoder/repowiki/⚠️此WIKI已过期-请先读我.md`:标注幽灵 AI 文档、_eval 张冠李戴、行号过期,给出可信阅读顺序
- `archive/reports/⚠️阅读前必看-可信度分级.md`:17 份历史报告按 ❌不可信/⚠️部分可信/✅可信 三级标注
- 其余 D 项(31/32/33)已在清洁轮闭环(Token 脱敏归档、Node 版本统一进 RUNBOOK、bridge.js/seed-mp-library/垃圾文件/一次性脚本均已移除或归档)

## 功能完整性检测(生产库副本 + 真实启动,25 项)
24 项全过;/api/daily 的「非法 JSON」是我测试脚本的假阳性(sections 已是对象,不应再 JSON.parse)。

## 检测抓到的真问题(已修,生产库,快照 app-20260904-210336.db)
1. 🔴 **AIHOT 三源 extra='{}',aggregator 标志丢失** → /api/hot 空、enrich 管线沉寂。确认是旧版 restore-frozen-sources 清 extra 的历史误伤(A11 预言的现象)。已按 setup-customer.js L102-104  canonical 恢复(热榜 {aggregator,intervalMin:30}、精选全文 {+marksFeatured}、日报 {}),/api/hot 实测恢复 30 条/页
2. 🔴 **59 个 youtube 源被 BUG-1 误伤熔断**(修复前的首抓 TypeError 三振)→ 已用 unfreezeSource 全部解冻(61 个)
3. 剩余熔断源 2 个(douyin 登录墙、1 个 rss)属需人工处理的正常熔断
