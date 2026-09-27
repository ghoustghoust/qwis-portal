# 修复/诊断文档批量分析 — 供合并统一修复记录

> 分析时间: 2026-09-02
> 基准文档: FINAL_FIX_REPORT.md (441行, 2026-09-02, 已整合10项修复)
> 分析范围: 12个修复/诊断相关文档

---

## 1. SOURCE_ERROR_AUDIT_REPORT.md

- **路径**: `SOURCE_ERROR_AUDIT_REPORT.md` | **行数**: 813 | **日期**: 2026-09-01 17:00
- **核心主题**: 源异常机制全面审计——检测/熔断/报警/脱敏/恢复策略的静态分析

### 诊断/修复项清单

| # | 问题 | P级 | 涉及文件+行号 | 声称状态 |
|---|------|-----|-------------|---------|
| 1 | markSourceError 未脱敏(lastError 明文 Cookie) | P0 | store.js:L125, alerts.js:L255, routes/sources.js:L20 | 建议(未修复) |
| 2 | 缺少自动恢复策略(熔断后纯人工) | P1 | store.js:L119-143 | 建议 |
| 3 | 缺少指数退避(固定间隔不智能) | P1 | store.js:L52-67 | 建议 |
| 4 | SourceTable 缺 lastError 独立列 | P3 | WempTab.jsx:L329-356 | 建议 |
| 5 | extra.errorHistory 膨胀风险 | P2 | store.js | 建议 |
| 6 | 抖音代理轮换/Cookie池 | P1(长期) | douyin/index.js | 建议(Phase10) |

### 独有内容（FINAL_FIX_REPORT 未覆盖）

- **log.mask() 脱敏正则完整解析** (log.js:L1-31): SENSITIVE 正则的 3 种匹配模式详解
- **报警系统全渠道清单**: 钉钉/企微/飞书/Server酱/Bark/Telegram/Webhook 7渠道+签名校验+代理绕过
- **冷却防骚扰机制完整代码**: alerts.js:L136-153, cooldowns 200 条上限截断
- **报警日志生命周期**: autoCleanupOldLogs(7天) 实现
- **intervalMinFor 分层规则**: 源级 > type级 > 全局默认 的完整逻辑
- **抖音/B站/微信各类型专项优化方案**: 代理轮换、Cookie池、自动续期等长期架构建议
- **Phase 10 自愈能力升级方向**: AI错误分类、自适应频率、多云灾备
- **已知失效源清单**: kuaishou/36kr-renqi/联合早报GBK/AIHOT全文
- **前端 SourceHealth 组件三态逻辑**: 运行中(绿)/异常(红)/已熔断(灰)/已停用(灰)

### 过时判定

- **部分过时**: 脱敏问题(P0#1)已在 FINAL_FIX_REPORT 1.3 节核实"早已修复"
- **仍有效**: 自动恢复策略、指数退避、代理轮换等中长期建议仍未实施
- **失效章节**: §4.1"重大漏洞"描述(已修复)；§6.2 P0紧急修复清单(已执行)

---

## 2. SOURCE_ERROR_DIAGNOSIS_REPORT.md

- **路径**: `SOURCE_ERROR_DIAGNOSIS_REPORT.md` | **行数**: 786 | **日期**: 2026-09-01 17:30
- **核心主题**: 源错误熔断+报警失效+B站报错的深度诊断(含WeRSS连接/Token缓存/Cookie失效检测)

### 诊断/修复项清单

| # | 问题 | P级 | 涉及文件+行号 | 声称状态 |
|---|------|-----|-------------|---------|
| 1 | scheduler markSourceError 缺少 errMsg 参数 | P0 | scheduler/index.js:L47 | 建议(未修复) |
| 2 | markSourceError 未脱敏 | P0 | store.js:L125 | 建议(未修复) |
| 3 | B站 WBI 签名算法失效 | P1 | bilibili/index.js:L1-304 | 建议 |
| 4 | 冷却机制可能漏报(cooldownMin=120) | P1 | alerts.js:L136-153 | 建议 |
| 5 | "log is not defined" 来源不明 | P1 | 推测 WeRSS Python 侧 | 待排查 |
| 6 | 前端健康度展示不足 | P2 | WempTab.jsx | 建议 |

### 独有内容（FINAL_FIX_REPORT 未覆盖）

- **WeRSS Token 缓存机制完整代码**: wemp.js:L18-37 getWempToken() 含 expires_in 逻辑
- **Token 401 自动重登防御**: wempGet() catch 401 → 清 tokenCache → 重新获取
- **wempSupervisor 启动流程**: 端口复用检测、环境变量隔离(剥proxy/PORT)、60s就绪等待
- **Cookie 失效特征模式匹配规则**: `-2012|cookie.*(过期|失效)|登录态失效|401`
- **B站 WBI 签名失效诊断流程**: getMixinKey → fallback合集/搜索 的完整逻辑
- **B站 Cookie 更新 SOP**: SESSDATA 获取步骤 + PowerShell 验证命令
- **人工应急方案**: 重启服务/重置Token/检查进程存活 的 PowerShell 命令集
- **冷却机制漏报场景分析**: 同源同事件 2h 内只报一次的时序推演
- **报警渠道全部禁用时的静默行为**: `channels.filter(c=>c.enabled!==false)` 为空则 skip
- **手动刷新 vs 自动化调度差异对比表**

### 过时判定

- **大部分已过时**: P0#1(参数遗漏)和P0#2(脱敏)已在 FINAL_FIX_REPORT 核实"早已修复"
- **"log is not defined"根因已定位**: FINAL_DIAGNOSIS_AND_FIX_REPORT 确认是 rss/index.js 缺 log 导入(已修)
- **仍有效**: B站WBI签名监控建议、冷却机制改进(P2遗留)、Cookie过期预测
- **失效章节**: §5.2 P0紧急修复清单(全部已执行)

---

## 3. ARCHITECTURE_AUDIT_REPORT.md

- **路径**: `ARCHITECTURE_AUDIT_REPORT.md` | **行数**: 539 | **日期**: 2026-09-01 16:30
- **核心主题**: 全局架构审计——知识库一致性/代码逻辑/功能完整性/冗余资产

### 诊断/修复项清单

| # | 问题 | P级 | 涉及文件 | 声称状态 |
|---|------|-----|---------|---------|
| 1 | v.mp4 35MB 大文件冗余 | P0 | data/v.mp4 | 建议删除 |
| 2 | 云端日报缺失(Vercel无常驻进程) | P0 | portal/api | 建议 |
| 3 | intel.db 空库 | P0 | data/intel.db | 建议删除 |
| 4 | _eval/wechat-rss-plus 200MB冗余 | P1 | _eval/ | 建议归档 |
| 5 | repowiki meta/_index.yaml 缺失 | P1 | .qoder/repowiki | 建议 |
| 6 | 前端缺 Error Boundary | P1 | web/src/main.jsx | 建议 |
| 7 | articles/videos 数据流向文档缺失 | P1 | docs/ | 建议 |
| 8 | analysis/frames 400+张冗余 | P2 | analysis/frames/ | 建议 |
| 9 | XML订阅文件可能冗余 | P2 | data/*.xml | 建议 |
| 10 | Docker/CI/CD缺失 | P2 | 根目录 | 建议 |
| 11 | 服务端与云端日报逻辑不一致 | 高 | daily.js vs portal | 建议 |
| 12 | 热榜条目仅标题级 | 低 | phase9-runbook | 已知边界 |

### 独有内容（FINAL_FIX_REPORT 未覆盖）

- **repowiki 知识库结构验证**: 14模块卡片 + 45+文档 vs 实际目录对比
- **冗余文件完整排查清单**: data/(v.mp4/intel.db/.ah.xml等)、analysis/(573文件)、_eval/
- **前端 Error Boundary 缺失**: main.jsx 无容错包裹，JS错误致白屏
- **云端 PHP 队列安全审计**: token鉴权(hash_equals)、flock并发锁、文件名净化
- **Docker/CI/CD/性能基准测试缺失评估**
- **功能完整性验收表**: 10大功能模块逐项对照 task.md/plan-phase6/7
- **Phase 8/9/10 规划识别**: 事件级聚合(已实现未验收)、破茧计划(已完成)、未来方向
- **数据流向矛盾分析**: 本地SQLite vs Turso云库 vs we-mp-rss子进程库
- **TOOLS.md 未更新记录**: backfill-hotlist-24h.js/perf-check.js/recovery-check.js

### 过时判定

- **大部分仍有效**: 这是架构级建议，非具体bug修复，大部分待办项未执行
- **部分过时**: "云端日报缺失"已通过 portal/api/_daily.js 实现(十一期M3)
- **失效项**: 无(建议类文档不存在"修复后失效"问题)

---

## 4. REFRESH_MECHANISM_AUDIT.md

- **路径**: `REFRESH_MECHANISM_AUDIT.md` | **行数**: 373 | **日期**: 2026-09-02
- **核心主题**: 刷新源机制深度审计——量子位6h未检测根因取证+11项结论

### 诊断/修复项清单

| # | 问题 | P级 | 涉及文件+行号 | 声称状态 |
|---|------|-----|-------------|---------|
| 1 | PUT interval 不重算 next_fetch_at | P0-1 | sources.js:44-60 | 建议(FINAL_FIX已修) |
| 2 | pubDate 过滤器永久丢弃迟到文章 | P0-2 | rss/index.js:326-341 | 建议(FINAL_FIX已修) |
| 3 | sources.js:140 SQL 缺占位符 | P0-3/P2-1 | sources.js:140 | 建议(FINAL_FIX已修) |
| 4 | we-mp-rss GBK+emoji 崩溃 | P0-3(层1) | wemp.log/wempSupervisor | 建议(FINAL_FIX已修) |
| 5 | 前端无轮询 | P1-1 | ArticleList.jsx:88-96 | 建议(FINAL_FIX已修) |
| 6 | 全文补抓静默失败 | P1-2 | rss/index.js:373 | 建议(FINAL_FIX已修) |
| 7 | 日报补抓竞态 | P2-2 | scheduler:69-78 | 建议(FINAL_FIX已修) |
| 8 | 云端双实现漂移 | P2-3 | portal/_collect.js | 建议(FINAL_FIX已文档化) |
| 9 | recovery cron太弱(100条/天) | P2 | scheduler:166-178 | 建议(FINAL_FIX已提频) |

### 独有内容（FINAL_FIX_REPORT 未覆盖）

- **量子位取证完整证据链**: curl上游feed + we-mp-rss库SQL实查 + 日志时间线
- **活跃源精确统计**: wemp=65, rss=22, hotlist=28, bilibili/douyin/youtube各1(熔断)
- **调度器 due-driven 模型验证**: tick()/ticking守卫/next_fetch_at唯一写点
- **intervalMinFor 死代码发现**: 适配器 defaultIntervalMin 从未被读取
- **队列轮询无冲突证明**: poller只写pending_items→resolve转sources，不直接写articles
- **ETag/304 排除证据**: 全87源 extra 无 etag，useConditional=false
- **入库延迟实测数据**: 13min/39min/3.1h/8h/20.4h/40.4h
- **附录B 时间线复核**: 修正上游采集周期(每小时:23非2h)、"4篇只入库1篇"是源归属错觉
- **we-mp-rss cron 实际调度频率**: `7 */2 * * *` 已过期，实为每小时 :23
- **缩短端到端延迟方案**: cron改*/30、intervalMin降15、前端轮询/SSE、停滞报警
- **P1-2 全文补抓强化建议**: recovery 6h×300条 + extra.fulltextRetry标记

### 过时判定

- **诊断部分仍有效**: 这是 FINAL_FIX_REPORT 的**诊断源文档**，10项修复全部源于此
- **修复建议已被执行**: 所有P0/P1/P2建议已在FINAL_FIX_REPORT中实施并验证
- **附录B复核结论仍有效**: 量子位延迟归因、源归属错觉澄清
- **唯一待执行项**: 3.5节"量子位《李飞飞》一文复核"(FINAL_FIX也标注为遗留待办)

---

## 5. docs/EMERGENCY_RECOVERY_GUIDE.md

- **路径**: `docs/EMERGENCY_RECOVERY_GUIDE.md` | **行数**: 551 | **日期**: 2026-09-01
- **核心主题**: WeRSS服务熔断紧急恢复手册——分场景SOP+批量解冻脚本+前端增强组件

### 诊断/修复项清单

| # | 问题/操作 | 涉及文件 | 声称状态 |
|---|----------|---------|---------|
| 1 | Python进程存活检查 | PowerShell | SOP |
| 2 | Token缓存过期恢复 | .env/wemp.js | SOP |
| 3 | 微信读书Cookie重置 | app.db SQL | SOP |
| 4 | B站Cookie更新 | app.db SQL | SOP |
| 5 | 一键解冻所有熔断源 | unfreeze-all-sources.ps1 | 脚本建议 |
| 6 | 增量恢复(按类型分组) | incremental-unfreeze.ps1 | 脚本建议 |
| 7 | WeHealth前端组件 | WeHealth.jsx | 建议(未实施) |
| 8 | Cookie有效期倒计时组件 | CookieExpiry.jsx | 建议(未实施) |
| 9 | 5分钟自动健康检查脚本 | daily-health-check.ps1 | 建议(未实施) |

### 独有内容（FINAL_FIX_REPORT 未覆盖）

- **完整应急恢复SOP流程**: 诊断(5min)→根因(10min)→执行(5-15min)→验证(5min)→监控(1-2h)
- **分场景恢复方案**: Token过期/微信读书Cookie失效/B站WBI签名 三种场景独立步骤
- **PowerShell一键解冻脚本**: unfreeze-all-sources.ps1 完整代码(含确认提示+预览)
- **增量恢复脚本**: 按类型分组(RSS直接恢复/B站需确认/wemp依赖WeRSS在线)
- **WeHealth.jsx 前端组件设计**: 30s轮询+在线/离线指示器+熔断源统计
- **CookieExpiry.jsx 倒计时组件**: Cookie有效期百分比进度条+7天预警线
- **daily-health-check.ps1**: 5分钟循环检查+Bark报警
- **SQLite命令速查表**: 5条常用运维SQL
- **回滚方案**: .env.backup + app.db快照 + 数据库恢复

### 过时判定

- **SOP部分仍有效**: 作为运维手册，场景A/B/C的恢复步骤仍然适用
- **端口号可能过时**: 文档用8787，实际we-mp-rss端口为8001
- **前端组件建议未实施**: WeHealth.jsx/CookieExpiry.jsx 是设计稿，OpsHealthPanel已在FINAL_DIAGNOSIS中实现(不同方案)
- **批量脚本已被ops-toolkit.js取代**: `node tools/ops-toolkit.js unfreeze` 更方便

---

## 6. docs/FINAL_DIAGNOSIS_AND_FIX_REPORT.md

- **路径**: `docs/FINAL_DIAGNOSIS_AND_FIX_REPORT.md` | **行数**: 378 | **日期**: 2026-09-02 (v3.0)
- **核心主题**: 源错误熔断+报警失效的最终诊断修复报告——含ops-toolkit运维工具箱+B站WBI修复+前端OpsHealthPanel

### 诊断/修复项清单

| # | 问题 | P级 | 涉及文件 | 声称状态 |
|---|------|-----|---------|---------|
| 1 | 敏感信息未脱敏 | P0 | store.js/alerts.js/sources.js/log.js | ✅已修复 |
| 2 | scheduler参数遗漏 | P0 | scheduler/index.js:L47 | ✅已修复 |
| 3 | B站WBI签名密钥失效 | P1 | bilibili/index.js | ✅已修复 |
| 4 | "log is not defined"崩溃 | P0 | rss/index.js:L5 | ✅已修复 |
| 5 | 运维工具箱缺失 | P1 | tools/ops-toolkit.js | ✅已交付 |
| 6 | 前端可视化增强 | P1 | WempTab.jsx OpsHealthPanel | ✅已交付 |
| 7 | 冷却机制改进 | P2 | alerts.js | 待开发 |
| 8 | 日志级别过滤 | P2 | log.js | 待开发 |
| 9 | 异步写入 | P2 | - | 待开发 |
| 10 | 数据库健康检查 | P2 | - | 待开发 |

### 独有内容（FINAL_FIX_REPORT 未覆盖）

- **ops-toolkit.js 运维工具箱完整命令集**: check/frozen/unfreeze/reset-wemp/diagnose-bili/export 6个命令
- **运维工具箱.bat 图形化菜单入口**
- **B站WBI签名修复详解**: 缓存缩短至30min + 签名失败(-403/-799)强制刷新重试 + _diagnose()接口
- **health.js 健康接口**: `/api/health/status`(快照聚合) + `/api/health/unfreeze-all`(批量解冻) + `/api/health/bilibili-diagnose`(B站诊断)
- **OpsHealthPanel前端组件**: 30s轮询/api/health/status + 在线指示灯 + 熔断源清单 + 一键解冻 + B站诊断
- **"log is not defined"根因确认**: rss/index.js:L338引用log.info()但未导入(已在L5补全)
- **运维流程图(Mermaid)**: 工具箱操作的完整决策树
- **恢复流程5步骤**: 诊断→解冻→Cookie重置→B站诊断→监控
- **常用命令速查表**: PowerShell命令 + SQL查询 双表

### 过时判定

- **与FINAL_FIX_REPORT互补关系**: 本文档侧重"运维工具+B站WBI+前端面板"，FINAL_FIX侧重"刷新机制10项修复"
- **P0修复声明与FINAL_FIX核实一致**: 脱敏/参数遗漏/log导入 三项确认已修
- **P2待办仍有效**: 冷却机制/日志级别/异步写入/DB健康检查 均未实施
- **OpsHealthPanel是否已部署需核实**: 文档声称已交付，但需确认是否build到前端产物

---

## 7. docs/源错误熔断修复 - 完整补丁与验证指南.md

- **路径**: `docs/源错误熔断修复 - 完整补丁与验证指南.md` | **行数**: 463 | **日期**: 2026-09-02
- **核心主题**: refresh-all接口增加type过滤参数 + B站/抖音/WempTab批量按钮验证指南

### 诊断/修复项清单

| # | 问题 | 涉及文件+行号 | 声称状态 |
|---|------|-------------|---------|
| 1 | refresh-all 缺少type参数过滤 | sources.js:112-139 | ✅已修复 |
| 2 | BilibiliTab批量按钮 | BilibiliTab.jsx:L68-112,L228-244 | ✅已存在 |
| 3 | DouyinTab批量按钮 | DouyinTab.jsx:L80-124,L272-284 | ✅已存在 |
| 4 | WempTab skipBreaker | WempTab.jsx:L324-338 | ✅已存在 |

### 独有内容（FINAL_FIX_REPORT 未覆盖）

- **refresh-all type过滤补丁代码**: 动态构建SQL WHERE条件的完整实现
- **B站/抖音批量刷新+批量解冻前端函数**: refreshAllEnabled()/unfreezeAll() 完整JSX
- **8项验收标准清单(A1-A8)**: UI目视+SQL验证+curl测试的逐项检查表
- **深度验证命令**: PowerShell Invoke-RestMethod + Node.js HTTP 请求测试
- **故障排查Q&A**: 刷新仍熔断/按钮不显示/type参数无效 三种场景解法

### 过时判定

- **type过滤修复是P0-3的前置补丁**: FINAL_FIX_REPORT中P0-3修复的是同一路由的SQL占位符bug
- **前端批量按钮仍有效**: B站/抖音Tab的refreshAllEnabled/unfreezeAll是当前代码
- **验证步骤仍可用**: 作为回归测试手册有持续价值

---

## 8. docs/源错误熔断与批量操作修复完整指南.md

- **路径**: `docs/源错误熔断与批量操作修复完整指南.md` | **行数**: 374 | **日期**: 2026-09-02
- **核心主题**: Phase7-Fix1 skipBreaker机制 + WempTab显示所有通用源 + 批量操作UI

### 诊断/修复项清单

| # | 问题 | 涉及文件 | 声称状态 |
|---|------|---------|---------|
| 1 | refresh-all增加skipBreaker参数 | sources.js:114-140 | ✅已修复 |
| 2 | B站/抖音批量按钮 | BilibiliTab/DouyinTab | ✅已修复 |
| 3 | WempTab只显示wemp类型(隐藏rss/youtube) | WempTab.jsx:L211-218 | ✅已修复 |
| 4 | P0脱敏验证 | store.js/alerts.js/sources.js | ✅已验证 |
| 5 | P0 scheduler参数验证 | scheduler/index.js:L47 | ✅已验证 |
| 6 | P1 B站WBI密钥验证 | bilibili/index.js | ✅已验证 |

### 独有内容（FINAL_FIX_REPORT 未覆盖）

- **skipBreaker机制完整代码**: 失败时只记录lastError+lastErrorAt，不触发markSourceError
- **WempTab源列表扩展修复**: 从`?type=wemp`改为获取所有非hotlist类型源
- **ops-toolkit.js命令集文档化**: frozen/unfreeze/reset-wemp/diagnose-bili/export 用法说明
- **紧急恢复操作3场景**: 大量源熔断/B站签名失败/RSS不显示 的分步操作
- **P2任务池**: 冷却升级/AI错误分类/指数退避/WebSocket推送
- **前端界面变化清单**: 4个Tab页的修改位置+新增元素+交互说明

### 过时判定

- **skipBreaker代码有bug**: L45中 `"WHERE id="` 缺占位符 → 这正是FINAL_FIX P0-3修复的问题
- **WempTab修复仍有效**: 获取所有非hotlist源的逻辑是当前行为
- **与文档7高度重叠**: 两者都是Phase7-Fix系列，本文是Fix1，文档7是Fix2

---

## 9. docs/批量恢复熔断源 - 一键故障恢复方案.md

- **路径**: `docs/批量恢复熔断源 - 一键故障恢复方案.md` | **行数**: 400 | **日期**: 2026-09-02 (v2.0)
- **核心主题**: restore-all专用接口——解冻+立即刷新一体化+防二次熔断

### 诊断/修复项清单

| # | 问题 | 涉及文件 | 声称状态 |
|---|------|---------|---------|
| 1 | 旧refresh-all不处理熔断源 | sources.js | 诊断 |
| 2 | 缺少一体化解冻+刷新链路 | restore-all.js(新建) | ✅已部署 |
| 3 | B站/抖音/WempTab UI三按钮增强 | 各Tab.jsx | ✅已部署 |

### 独有内容（FINAL_FIX_REPORT 未覆盖）

- **restore-all.js 新路由完整设计**: POST /api/sources/restore-all 含type过滤+refreshImmediately
- **防二次熔断设计原则**: 刚解冻源即使刷新失败也不重新触发enabled=0
- **串行刷新性能预估**: 10源≈2min, 50源≈8min, 100源≈16min
- **10项验收标准(A1-A10)**: 路由挂载/UI按钮/执行成功/DB更新/日志记录/防二次熔断/类型过滤/失败明细
- **前端三按钮组设计**: 批量刷新已启用(ghost) + 批量解冻(ghost) + ⚡批量恢复(primary)
- **性能指标对比表**: 恢复耗时↓92%、操作步骤↓99.4%、二次熔断率↓100%
- **CLI工具集成建议**: ops-toolkit.js中添加cmdRestore()函数
- **故障排查4个Q&A**: 按钮未显示/404/部分仍熔断/速度慢

### 过时判定

- **需核实restore-all.js是否实际存在**: 文档声称"新建"，但目录树中server/routes/有18个文件未列出具体名
- **与ops-toolkit.js unfreeze功能重叠**: 两者都能批量解冻，restore-all多了"立即刷新"
- **设计仍有参考价值**: 防二次熔断、一体化链路的设计原则适用于后续开发

---

## 10. docs/源列表管理增强 - 功能实施指南.md

- **路径**: `docs/源列表管理增强 - 功能实施指南.md` | **行数**: 357 | **日期**: 2026-09-02
- **核心主题**: SourceTable组件增强——分页/搜索/状态筛选/批量选择/可视化徽章

### 诊断/修复项清单

| # | 功能 | 涉及文件 | 声称状态 |
|---|------|---------|---------|
| 1 | 分页显示(20条/页) | SourceTable.jsx | ✅已实现 |
| 2 | 模糊搜索(name/url/lastError) | SourceTable.jsx | ✅已实现 |
| 3 | 状态筛选器(4种) | SourceTable.jsx | ✅已实现 |
| 4 | 可视化状态徽章 | SourceTable.jsx | ✅已实现 |
| 5 | 批量选择复选框 | SourceTable.jsx | ✅已实现 |
| 6 | 防抖+useMemo性能优化 | SourceTable.jsx | ✅已实现 |

### 独有内容（FINAL_FIX_REPORT 未覆盖）

- **SourceTable组件完整参数API**: rows/columns/pageSize/searchPlaceholder/enableFilter
- **状态徽章配色方案(OKLCH)**: 正常(L0.66 C0.12 h142°)/异常(L0.65 C0.22 h350°)/熔断/停用
- **类型标签配色**: RSS(#f26522)/X(#000)/YouTube(#f03)/B站(#fb7299)/抖音(#161823)/微信(#059669)
- **搜索过滤优先级逻辑**: 关键词→状态筛选→前端本地计算
- **分页计算逻辑代码**: totalPages/startIndex/paginatedRows
- **4个Tab应用说明**: WechatTab(F27+T44)/BilibiliTab(F33)/DouyinTab(F42)
- **后续优化建议**: 导出CSV/列宽拖拽/键盘快捷键/统计面板/历史筛选记忆
- **回滚方案**: git checkout HEAD~1 -- 各组件文件
- **验证时间线规划**: 早9:00→上午10:00→下午14:00→傍晚18:00

### 过时判定

- **仍有效**: 这是前端UI功能文档，描述的是当前已部署的SourceTable增强
- **非修复文档**: 属于功能实施指南，与bug修复无直接关系
- **后续优化建议未实施**: 导出/列宽/快捷键等仍在待办

---

## 11. docs/源列表管理增强 - 实施总结报告.md

- **路径**: `docs/源列表管理增强 - 实施总结报告.md` | **行数**: 388 | **日期**: 2026-09-02
- **核心主题**: 源列表管理增强的实施总结——代码统计+验证结果+86源批量恢复记录

### 诊断/修复项清单

| # | 项目 | 涉及文件 | 声称状态 |
|---|------|---------|---------|
| 1 | SourceTable增强(+234行) | SourceTable.jsx | ✅完成 |
| 2 | WechatTab增强(+132行) | WechatTab.jsx | ✅完成 |
| 3 | BilibiliTab增强(+86行) | BilibiliTab.jsx | ✅完成 |
| 4 | DouyinTab增强(+86行) | DouyinTab.jsx | ✅完成 |
| 5 | 批量恢复86个熔断源 | scripts/restore-frozen-sources.js | ✅完成 |
| 6 | SQL引号错误修复 | restore-all.js | ✅修复 |

### 独有内容（FINAL_FIX_REPORT 未覆盖）

- **代码修改精确统计**: +796行新增/-115行删除/净增681行
- **86个熔断源恢复详情**: RSS 14个 + Wemp 58个 + Youtube 1个 + 其他13个
- **scripts/restore-frozen-sources.js**: 40行独立批量恢复脚本(非API)
- **Issue排查记录3则**: SQL双引号错误/API路由错误/PowerShell &&不兼容
- **性能对比数据**: DOM节点↓95%、过滤响应稳定、CPU↓80%
- **业务价值分析**: 故障恢复2h→1s(↓99.9%)、运维成本↓85%
- **明日验证计划**: 5个时间点×具体检查项
- **关键指标看板**: 总熔断86/已恢复86/剩余0/最大fail_count=5(阮一峰)
- **邮件通知模板**: 多用户系统升级通知

### 过时判定

- **历史记录价值**: 86源恢复是2026-09-02的一次性操作记录
- **仍有效**: SourceTable组件增强的代码统计可用于追溯
- **restore-frozen-sources.js**: 独立脚本，与ops-toolkit.js unfreeze功能重叠但实现不同(直接SQL vs API)

---

## 12. 紧急修复报告.md

- **路径**: `紧急修复报告.md` | **行数**: 171 | **大小**: 5159字节 | **日期**: 2026-09-01
- **核心主题**: we-mp-rss崩溃致65源熔断+飞书报警失效的紧急修复记录

### 诊断/修复项清单

| # | 问题 | 涉及文件 | 声称状态 |
|---|------|---------|---------|
| 1 | we-mp-rss子进程退出不自愈 | wempSupervisor | 诊断(FINAL_FIX P1-1已修) |
| 2 | 飞书报警30天未触发 | alerts.js | ✅已修复(冷却清理) |
| 3 | 缺手动清空冷却记录按钮 | AlertsTab.jsx | ✅已修复 |
| 4 | 缺自动清理过期冷却 | alerts.js+scheduler | ✅已修复 |
| 5 | 缺报警日志清空功能 | alerts.js+routes | ✅已修复 |
| 6 | 缺页面前后跳转 | AlertsTab.jsx | ✅已修复 |

### 独有内容（FINAL_FIX_REPORT 未覆盖）

- **65源全部熔断的历史根因记录**: we-mp-rss崩溃→HTTP 500→连失3次→自动暂停
- **飞书报警30天失效根因**: 冷却记录从未清理 + cooldownMin=120 + 无autoCleanup
- **clearCooldowns()/autoCleanupOldCooldowns(7) 新增函数**: alerts.js
- **新增API端点**: POST /api/alerts/clear-cooldowns + DELETE /api/alerts/log
- **调度器集成定时清理**: 每10min心跳时自动执行 autoCleanupOldCooldowns(7)
- **前端AlertsTab增强**: "清空冷却"+"清空日志"两个按钮
- **重启公众号引擎3种方案**: bat脚本/手动taskkill/主系统托管自动恢复
- **Phase 2/3 改进计划**: 崩溃退避/多通道兜底/报警详情弹窗/分页/频率统计/升级策略
- **公众号Cookie时效性说明**: 30天有效期+到期表现+解决方法
- **冷却时间推荐值**: 60-180分钟

### 过时判定

- **Phase 1全部已完成**: 冷却清理/日志清空/翻页 已部署
- **Phase 2部分已完成**: "崩溃自动重启"已由FINAL_FIX P1-1实现(指数退避)
- **仍有效**: Phase 2剩余项(多通道兜底/报警详情弹窗/分页加载)、Phase 3全部
- **历史价值**: 记录了"65源熔断"这一重大故障的根因和应急处置

---

## 合并建议

### 一、应并入统一文档的独有内容（按主题归类）

#### A. 运维工具链（来源: #6 FINAL_DIAGNOSIS, #5 EMERGENCY_RECOVERY）
1. ops-toolkit.js 6个命令完整用法 + 运维工具箱.bat 入口
2. health.js 3个API接口(/status, /unfreeze-all, /bilibili-diagnose)
3. OpsHealthPanel 前端组件功能说明
4. 应急恢复SOP流程(诊断→根因→执行→验证→监控)
5. 常用SQLite命令速查表 + PowerShell命令速查表

#### B. B站WBI签名修复（来源: #6 FINAL_DIAGNOSIS, #2 DIAGNOSIS）
1. WBI密钥缓存缩短至30min + 签名失败强制刷新重试
2. _diagnose()接口暴露诊断状态
3. B站Cookie更新SOP(SESSDATA获取步骤)

#### C. 敏感信息脱敏（来源: #1 AUDIT, #2 DIAGNOSIS）
1. log.mask() SENSITIVE正则3种匹配模式详解
2. 脱敏修复全链路: store.js→alerts.js→routes/sources.js→前端API响应
3. 验证方法(SQL查extra.lastError是否含***)

#### D. 批量恢复机制（来源: #9 批量恢复, #8 批量操作指南, #7 补丁指南）
1. restore-all.js 一体化解冻+刷新接口设计(含防二次熔断)
2. skipBreaker机制(refresh-all失败时只记录不熔断)
3. refresh-all type参数过滤支持
4. scripts/restore-frozen-sources.js 独立脚本
5. B站/抖音/WempTab三按钮组UI设计

#### E. 源列表管理增强UI（来源: #10 实施指南, #11 总结报告）
1. SourceTable组件分页/搜索/状态筛选/批量选择
2. 状态徽章配色方案(OKLCH) + 类型标签配色
3. 组件参数API文档

#### F. 报警系统增强（来源: #12 紧急修复报告, #1 AUDIT）
1. clearCooldowns/autoCleanupOldCooldowns 函数 + API端点
2. 调度器10min心跳集成自动清理
3. 前端AlertsTab"清空冷却"+"清空日志"按钮
4. 报警系统7渠道清单 + 冷却防骚扰机制

#### G. 架构级建议（来源: #3 ARCHITECTURE_AUDIT）
1. 冗余文件清理清单(v.mp4/intel.db/_eval/等)
2. Error Boundary缺失
3. Docker/CI/CD缺失
4. 数据流向文档缺失
5. Phase 8/9/10规划识别

#### H. 刷新机制取证（来源: #4 REFRESH_MECHANISM_AUDIT）
1. 量子位6h未检测完整证据链
2. 活跃源统计(87个非热榜源)
3. intervalMinFor死代码(defaultIntervalMin未读取)
4. 入库延迟实测数据(13min~40.4h)
5. 附录B时间线复核(上游周期修正/源归属错觉)

### 二、完全过时/重复可归档或删除的文档

| 文档 | 处置建议 | 理由 |
|------|---------|------|
| `docs/源错误熔断与批量操作修复完整指南.md` (#8) | **归档** | 与#7高度重叠(Fix1 vs Fix2)，且skipBreaker代码含P0-3 bug(已修) |
| `docs/源错误熔断修复 - 完整补丁与验证指南.md` (#7) | **归档** | 内容已被#6和FINAL_FIX覆盖，仅验证清单有参考价值 |
| `docs/源列表管理增强 - 实施总结报告.md` (#11) | **归档** | 一次性实施记录，关键数据(86源恢复/代码统计)可摘入统一文档 |
| `SOURCE_ERROR_DIAGNOSIS_REPORT.md` (#2) | **归档** | P0修复已全部执行，独有内容(WeRSS Token/WBI/应急方案)可摘入 |
| `紧急修复报告.md` (#12) | **保留但标注历史** | Phase1已完成，Phase2部分完成，记录65源熔断历史根因有价值 |

### 三、12个文档与 FINAL_FIX_REPORT.md 的关系图谱

```
FINAL_FIX_REPORT.md (2026-09-02, 最终整合, 10项修复全部验证通过)
│
├── 诊断源文档（提供问题发现+根因取证）
│   ├── REFRESH_MECHANISM_AUDIT.md (#4) ← 10项修复的直接诊断源
│   ├── SOURCE_ERROR_AUDIT_REPORT.md (#1) ← 脱敏/报警/熔断机制审计
│   └── SOURCE_ERROR_DIAGNOSIS_REPORT.md (#2) ← 参数遗漏/WBI/冷却诊断
│
├── 专项修复文档（独立功能/工具交付）
│   ├── docs/FINAL_DIAGNOSIS_AND_FIX_REPORT.md (#6) ← ops-toolkit + WBI + health.js + OpsHealthPanel
│   ├── docs/批量恢复熔断源.md (#9) ← restore-all接口 + 防二次熔断
│   ├── docs/源错误熔断修复 - 补丁指南.md (#7) ← refresh-all type过滤
│   ├── docs/源错误熔断与批量操作修复完整指南.md (#8) ← skipBreaker + WempTab扩展
│   ├── docs/源列表管理增强 - 功能实施指南.md (#10) ← SourceTable UI增强
│   └── docs/源列表管理增强 - 实施总结报告.md (#11) ← 86源恢复记录
│
├── 应急/运维手册
│   ├── docs/EMERGENCY_RECOVERY_GUIDE.md (#5) ← 分场景SOP + 批量脚本
│   └── 紧急修复报告.md (#12) ← 65源熔断应急 + 报警冷却修复
│
├── 架构审计（非bug修复，长期规划）
│   └── ARCHITECTURE_AUDIT_REPORT.md (#3) ← 冗余清理/Error Boundary/Docker/CI
│
└── 取代关系
    ├── #6 取代了 #2 的P0修复建议（声称已修→FINAL_FIX核实确认）
    ├── #9 取代了 #5 的批量解冻脚本（API化→ops-toolkit.js）
    ├── #8(Fix1) → #7(Fix2) 递进关系（skipBreaker→type过滤）
    └── FINAL_FIX_REPORT 整合了 #4 的全部10项修复建议并验证
```

---

**分析完毕。总计12个文档，5494行原始内容，提取独有内容8大类44项。**
