# 功能矩阵 · 三端能力覆盖 · 缺口归属 · 工具链口径

> 最后更新：2026-09-28（本表只回答「哪端有什么能力、读数叫什么名字」。**问题与调查过程不在这里写**，去 `docs/ISSUES.md` 与 `docs/features/`；逐轮改了什么由 `docs/STAMPS.md` 自动记）
> **本文档是唯一权威的功能覆盖矩阵**（SSOT），一律**以真实环境逆向推导**：云端能力逐端点实测、本地能力以本地端代码为准，不从其它文档抄。其它文档不再各自维护矩阵，只写"见本文"。
> **✅ 的时效**：各格的实测时点不一样，且中途换过一次库（换库前后的读数不可比）。早于最近一次换库或部署的格**只按形状读**；要拿单格结论当准绳，先按 `docs/DELIVERY_VERIFICATION.md` 复测。逐格复测本轮挂在 `docs/specs/45-doc-validity-adr-split/spec.md` §9。
> 更新规则：任何端点增删改 → 先改本文，再改其它文档。每条功能改动必须云端实测后才允许把矩阵标为 ✅。

---

## 0. 三端定义（先建立正确脑图）

| 端 | 形态 | 职责 | 存储 |
|---|---|---|---|
| **本地**（`server/`，本机端口） | Express + 本地库驱动，PM2 或手动 | 全功能开发与灾备；**需登录态的采集（抖音）与整库文件备份/恢复只在这里** | 本地库文件 |
| **Vercel**（`api/`，https://qwis-intel.vercel.app） | Serverless 读层 + 管理后台 | 面向用户的阅读与管理界面 | Turso（东京） |
| **GH runner**（`tools/collect-turso.js` + `.github/workflows/collect.yml`） | 按固定节奏的定时任务 | 采集 / 早报（双档）/ 我的早报 / 周刊 / 翻译 / 静态导出物 / 清理，直写 Turso | Turso |

**B 站在 runner 上采，不是本地专属**（09-26 核·代码 + 线上源表）；逐项覆盖以 §1 为准，本表头不作穷举。
runner 依赖面只许纯 JS（ADR-21）；定时取值唯一承载处是作业文件，本表不复制取值。

**数据流**：runner 采集 → Turso ⇄ Vercel 读层 → 浏览器。本地与 Turso 之间**没有运行期同步**——手动迁移工具是一次性动作，不构成同步通道（这是一条边界决策，见 ADR-17）。

---

## 1. 功能覆盖矩阵（实测为准）

### 1.1 阅读器（/reader/）

| 功能 | 本地 | Vercel | 说明 |
|---|---|---|---|
| 文章列表（全局时间序/筛选/搜索/游标分页） | ✅ | ✅ | 2026-09-15（27）：默认「今日」滚动 24h 视图（since 参数+smart 排序）；「全部」降级为检索模式（至少一个筛选条件才发请求）；顶部今日早报摘要卡（导语+头条3条+跳全文） |
| 未读口径 | ✅ | ✅ 2026-09-15 | 近 3 天未读（历史自动归档，"未读 25096"式焦虑数字消失；数据不变仅计数口径） |
| 无感刷新 | SSE `/api/events` | ✅ 60s 增量轮询 `/api/articles/since` | 2026-09-11 重写；serverless 不支持长连 |
| 文章详情/已读/稍后读/全部已读 | ✅ | ✅ | 「全部已读」与列表同四轴噪声口径（B107 修掉了云端那份少两轴的副本） |
| 阅读沉淀（我的阅读/批量/导出） | ✅ | ✅ | 09-21 B107：足迹**默认排除热榜/聚合噪声**，前端「含热榜」pill = `include_hot=1` 放回来；判定唯一实现 `lib/noise.js`（白盒 W18）。同批修掉两端筛选分叉 B134 |
| 保存视图 / 分组管理 / 拖拽移动 | ✅ | ✅ 2026-09-12 | 13+14 两项完成 |
| 单源手动刷新 | ✅ | ❌ 404 | 云端替代：`POST /api/rss/refresh`（标记到期，runner ≤15min 补抓） |
| 视频列表 | ✅ | ✅ | 2026-09-14 v2：游标分页 + 播客并入（音频条目）+ tab 生效 |
| 视频详情/收藏/播放 | ✅ | ✅ 2026-09-14 | 云端补齐 `videos/:id`、`/play`（YouTube/B站官方 embed）、`/favorite`；直链解析仍本地专属（B站 Cookie+wbi） |
| 热榜/事件榜（全局时间序） | ✅ | ✅ | 2026-09-11 修复同源成块；2026-09-14：「实时流」更名「AI 信息实时流」并只出 AI 相关内容；精选=自有源六维≥60 且 AI 相关（热榜源不入精选）；事件卡带「分组·信源名」胶囊 + 24 桶趋势折线 + 译文标题优先 + 显示热度严格降序；分类 pills 读 /api/hot/groups（去重、只含有内容的组）；AI 词表共享模块 `lib/ai-relevance.js`；事件榜 runner 预聚合写 settings['hot.eventsCache'] 云端直读（聚合唯一实现 `lib/hot-events.js`，内联 504 治理） |
| 热榜英文原文抓取 `/api/hot/original` | ✅ | ❌ 404 | 依赖 jsdom+Readability，可移植（Pro 时长更稳） |
| 播客音频播放 | ✅ | ✅ 2026-09-14 | 采集历史把 enclosure 音频落进 cover；读层 `lib/media.js` 归位 audio_url，列表 🎧 + 阅读器/日报弹窗播放器（图+声音） |
| 日报中英对照 | — | ✅ 2026-09-14 | 读层实时回填译文标题 + original_title 对照；弹窗修「未知来源」（字段名 source↔source_name）与「打开原文」url 兜底 |

### 1.2 每日情报（/daily/）

| 功能 | 本地 | Vercel | 说明 |
|---|---|---|---|
| 日报阅读 | ✅ | ✅ | runner 每日 09:03（北京）生成 |
| 手动重新生成 | ✅（先补抓到期源） | ✅ 但不补抓、无 AI 增强 | |
| 日报设置（栏目/来源勾选/时间） | ✅ | ❌ 404 | 需 `GET/PUT /api/settings/daily` |
| AI 增强（摘要/评分/tags） | ✅ | ⚠️ 链路已通待移植 | Agnes 云端已修复（2026-09-11，根因=settings.ai 污染）；翻译/摘要/日报增强按 specs/12-roadmap-2026 移植 |

| 候选层每源预配额（级3·44 号 spec 步1） | ❌ 故意不接（见说明） | ✅ | 唯一实现 `lib/prescreen.js`（`applySourceQuota` / `prescreenCapOf` / `prescreenStats`）；配额取 `settings['prescreen.perSourceCap']` 缺省 2，坏值回默认并出声。**换的是源覆盖**：24h 池 2,688 篇 / 469 源，旧写法 `ORDER BY published_at DESC LIMIT 500` 只覆盖 94 源（500 个坑里 352 个是同一批高频源的"第 3 篇以后"）。**第一期生产读数（id=68，09-24 07:53Z）实测：覆盖 94→202 源（2.15×）、调用量 500→337（−32.6%）——原预估「调用量不变、覆盖约 450」已被证伪**，真天花板是宽池读 `CANDIDATE_POOL_READ=2000` 被吃满（`prescreen.pool=2000`、`poolSources=202` → 配额上限 202×2=404），见 ISSUES **H25** 与 `docs/eval/2026-09-24-prescreen-step1.md` §九。**H25 同日核销**：宽池读抬到 6000 后再打一次云端生成器（`POST /api/daily-generate`，09:12Z）得 `id=69` →
`pool=3806`（不再顶格）、`kept=500`（500 坑填满）、`keptSources=313` → **覆盖 202→313（+55%）**；那份生成器是**零模型**的（33 s、0 次调用）。
形状 = 宽池 **6,000** 轻量行（不含正文，单一取值写死在 `lib/prescreen.js`；runner 与两份云端生成器必须同值，由锁 P9 钉不分叉）→ 每源取前 N 篇（默认 2，后台可配 1~100）→ 截 500 送模型；正文到深析阶段按条单取。读数：`stats.prescreen`（池/源数/留下数）、`stats.filterStats`（尝试/通过/剔除/分析/失败/截断/**失败九类归因**）、`stats.timeSplit`（三段分钟数＋两个预算上限）、`stats.analyzeNoBody`（正文取空仍打分条数）。跨档门口径差异与推算禁区见 `docs/ISSUES.md` 的 H25/H27-补 与本表表头注，**不在这里复制数字**。本地 `server/` 按用户裁定不接（不在部署面，锁 P6b 守这个前提）。链路约束见 `docs/CLOUD_PIPELINE_GUIDE.md` 不变量 20

### 1.3 管理后台（/admin/）

> **2026-09-15（spec30）后台收敛为 5 Tab**：源库（组合/问题源/检索三视图 + 平台接入=公众号RSS/B站）/ 早报中心（含日报设置）/ 热点榜策展 / AI 能力（含翻译 Skill）/ 系统（数据+监控+报警分区）；每 Tab 顶部前台对照卡（C1：入口+生效配置摘要+作用对象标注）；抖音 Tab 下架（T5-10）；IconRail 图标配常驻文字标签（T5-8）。

| Tab | 本地 | Vercel | 缺口端点 |
|---|---|---|---|
| 源库 | ✅ | ✅ 2026-09-15 | 三视图（29）+ 四轴批量（27b：batch 扩 spotlight/mute/visible/subscribe/interval/failover + groupScopeId 组级单条 SQL） |
| 公众号 RSS（已并入源库·平台接入） | ✅ | ⚠️ | 新增/删除/单源刷新源 404；OPML 同步/配置备份/队列同步 ✅ |
| B站（已并入源库·平台接入） | ✅ | ✅ 2026-09-12 | 云端采集已通（21）；诊断端点已上 |
| ~~抖音~~（T5-10 后台已下架） | ✅ 本地 | ❌ | 扫码登录/采集依赖 Playwright，**永不云端化**（架构决策） |
| 日报设置（已并入早报中心） | ✅ | ✅ 2026-09-15 | `GET/PUT /api/settings/daily` 云端已在（13-settings-write），UI 并入早报中心 |
| AI 能力 | ✅ | ✅ | config/ping/chat 云端实测可用（2026-09-11 修复） |
| 翻译 Skill（已并入 AI 能力） | ✅ | ⚠️ | `ai/translate/*` 端点仍缺；runner 自动翻译优先级=每日早报>我的早报>精选周刊>热点榜>阅读器（2026-09-15 用户口径修正+优先级 id 直接补候选池），手动入队最优先；薄正文走仅标题通道（坑 #A2）。**09-21 B111：prompt 收成一份** —— 加载与优先级在 `lib/ai-prompts.js`（`settings['ai.prompt.<name>']` → `prompts/<name>.md` → 内嵌兜底），三端（本地端点 / 云端 / runner）与本地精翻模块共用它，落库键统一为 `ai.prompt.*`（白盒 **W20**）|
| 数据（已并入系统） | ✅ | ⚠️ | stats/cleanup ✅；文件型快照/上传/恢复 501（用配置备份替代） |
| 报警管理（已并入系统） | ✅ | ✅ 2026-09-12 | 配置写/测试/清冷却已上云；触发引擎在 runner 批次尾部（15-cloud-alerts） |
| 热点榜设置 | ✅ | ⚠️ | AIHOT backfill/enrich 控制缺 |
| 监控（已并入系统） | ✅ | ⚠️ 近似值 | 无 job_queue 历史，数值为当前状态近似 |
| 早报/我的早报/周刊 管理页 | ❌ | ✅ 2026-09-13 | T3-2 早报中心（生成历史/推送/周刊归档/画像配额）。「周刊归档删除」端点 2026-09-18 才真正可达（此前被误写进 GET 分支，恒 404）；历史表对 mybrief/足迹只能显示 1 行（读单个 `*.latest` 键，非 7 天序列）；「手动生成命令」目前只是文本提示。**2026-09-20 换库后实测**：新库 `settings` 里**没有** `weekly.latest` / `weekly.archive` → 周刊归档页显示"首期将于周五 18:00 生成"、`/api/weekly` 回 `{"ok":true,"empty":"no-content"}`；那 5 期归档只存在于**读封锁的旧库**，等配额解除后回读迁回（旧库不许删，见 `docs/ISSUES.md` B118 与 `docs/HANDOVER.md` §2.1 换库记录）。<br>**09-20 午后读数更新**：dispatch 的 run `1075` 已生成**新第 1 期**（`weekly.latest` 15,977B / `weekly.archive` 16,072B / 1 期，`/api/weekly` 200/27,509B、20 条深析条目）→ 归档页不再是空态；**但这一期没有主线/杂志骨架**（`theme=null`、`storylines` 键不存在，而 `degraded=false`）= **B121**，端到端 E6 因此判产品红 3/3；旧库那 5 期仍未迁回 |
| 早报/周刊 AI 落库守卫 | ✅ | ✅ 2026-09-18 | 唯一实现 `lib/brief-guards.js`（读层按 `schemaVersion` 档位优先取日报，runner 周刊 <4 条不发布）——见不变量 12 / 坑 #32。本地 `server/services/ai/daily.js getLatest()` 同口径 |

### 1.4 采集与调度

| 能力 | 本地 | runner（云端采集） | 说明 |
|---|---|---|---|
| RSS/YouTube/X | ✅ | ✅ | 60min 间隔，ETag 304 |
| 公众号（wemp） | ✅ **唯一能采的一端** | ❌ **云端两份实现都显式排除** | 采集面选不到它（云端各有一份不支持类型清单，都含 wemp；理由：依赖本地微信 Cookie）。**后果**：云端早报里的「公众号文章」没有增量，且**没有本地回灌云端的通路**（ADR-17 那条边界的具体代价，不是某次故障）。存量与最新一篇的时间属现场读数，现读源表或跑只读探针，本文不写 |
| 热榜 29 源 | ✅ | ✅ | 30min 间隔，浏览器 UA 必需 |
| B站 wbi 签名采集 | ✅ | ✅ 2026-09-12 | api/_bilibili.js 三链路（wbi 主链+合集+搜索兜底），匿名可用；播放直链仍本地 |
| 抖音 | ✅ | ❌ 永不 | Playwright 登录态，架构决策 |
| 全文补抓 / AIHOT enrich | ✅ | ❌ 待移植 | |
| 报警引擎（7 渠道） | ✅ | ✅ 2026-09-12 | api/_alerts.js 全量移植（含熔断汇总/AI失败/停滞检测/可诊断文案） |
| 触发可靠性 | 进程常驻 | GH schedule + 外置 HTTP 触发器（双档） | 两档各自按自己的可靠性跑，**本文不判主次**；为什么是双档见 ADR-13。操作事实：**不带 mode 的手动触发只跑采集那一步**，其余档位要么要选对应 mode、要么只认 schedule。外置档内嵌仓库凭据——**轮换时必须同批改这一处**（ADR-12 的边界；漏改的旧表现是整链 403 静默停摆）。任务标识与管理 Key 见 `docs/HANDOVER.md` §1.5；cron 取值以作业文件为唯一事实源。判"某一档现在还剩几档在跑"：现读采集心跳里的 mode |

---

### 1.5 评测与门禁工具链（命令的唯一清单，别处只写"见 §1.5"）

> **2026-09-23 口径（用户裁定）**：本表中 `npm test` / `smoke-test.js` / `build:vercel` / `lint:docs` 为每轮门禁；**`eval:*` 各命令（whitebox/process/f2p/e2e/content/preflight）降级为按需工具**——脚本保留可跑，改到其守护区域时建议运行，不再作每轮必过的门。理由与锁的纪律见 `AGENTS.md` §3 头注；判据档案见 `docs/EVAL_GUIDE.md` 暂缓头注。

| 命令 | 实现 | 作用 | 状态（2026-09-19） |
|---|---|---|---|
| `npm test` | `tests/*.test.js`（node:test，单并发） | 回归网：每条线上修过的 bug 都要有锁。**全库唯一写死条数处**（别的文档一律写「见 §1.5」） | ⚠ **本格读数只在复跑那一轮有效**，下轮不符即以新读数改本格。**取数口径**：`npm test > 文件 2>&1` 再取 `$?`，不许用 `npm test \| tail`（管道退出码是末端命令的，红会读成绿）。当前状态：有固定红，成因与裁决见 `docs/specs/45-doc-validity-adr-split/spec.md` §10 与 `docs/ISSUES.md` |
| `node smoke-test.js` | `smoke-test.js` | 生产库副本冒烟 + 自带对抗性段（超长 URL/特殊字符/空内容/并发/错误边界） | ✅ 20/20，零副作用（**09-19 夜在 HEAD 复跑**：`通过 20 / 失败 0`，真实退出码 0） |
| `npm run build:vercel` | Vite + `api/` | 云端构建面 | ✅ 通过（**09-24 09:07Z 复跑**：`✓ built in 2.06s`，含改动后的 `api/daily-generate.js` 与 `api/[...slug].js`） |
| `npm run lint:docs` | `tools/doc-lint.cjs`（密钥判据 `lib/secrets.js`） | 文档门禁（头注/悬空/INDEX 登记/归档头注/超长提示/**明文密钥两面扫描：已跟踪 + 未跟踪且未被 ignore**/表格超格与断裂/引用与编号类判据/判据自证）。**条目数以工具实存为准，本文不枚举条数** | ⚠ 「零错」当前不可满足：错全部来自仓库根 README 指向已迁走的截图目录 + `docs/archive/` 的历史沉积缺头注（归档层已豁免判红，只报数）。**它是两枚测试锁的前置**——门禁非零会让那两枚锁失去发言权，这条判据缺陷账在 `docs/ISSUES.md`。读数每轮以命令输出为准，本格不写死 |
| `npm run lint:cites` | `tools/doc-lint.cjs --cites`（`--all` 打全部行） | **引用台账（取证面）**：把每处 `file:line` 引用解析到真实文件并打印它指向的那行内容，供人判"还指对吗"；与 `lint:docs` 共用同一套解析，**不并存第二套**。**退出码恒 0**——红线仍是 `lint:docs`，两条门禁抢着判红只会逼人造 ignore | ◐ **本轮口径立场**：`file:line` 锚点属"写死接口"，活文档里逐步铲掉（45 号 spec 原则 1），所以这条台账的用途是**收尾清点**、不是维持清单。MISSING/越界是给人看的清单，不是待办计数 |
| `npm run lint:docs:selftest` | 同上（`--self-test`） | **对判据本身做双向自证**：坏样本必须红 + 合法形态必须不红（44 例，含"少一格不许红""跨表引用同号不许红""抄出被更正的旧写法不许红""豁免词表要认「烂锚/旧引用」这个同义词，否则照实引用烂锚的好文档被判红"四条反例 —— 全是本轮第一版真实犯过的错） | ✅ 44 例全过；由 `tests/regression-doc-lint-rules.test.js` L1~L5 钉进 `npm test`（另两条：分母必须非空、不许有文件级 ignore 短路） |
| `npm run eval:preflight` | `tools/eval-preflight.cjs` + `lib/cloud-site.js` + `lib/alert-channels.js` + `lib/ai-throttle.js` | 环境前置：代理 / **线上 commit==origin/main** / Turso / 隔离 / BL7~BL9 配置真值 | ✅ **9/9、真退 0**（2026-09-20 夜本轮复跑）。逐项读数由脚本自己打印，本格不复制——同一格曾写死 `961fec0` / `sources=1437` / "领先一个提交"，次日全成假事实（`docs/ISSUES.md` B114）；未推送条数的取法：`git rev-list --count origin/main..HEAD`。<br>**此前长期写 ⛔ 6/9 的三条红各自按实情收口，不是"把三条配置修好了"**：① BL7 两条（渠道无出口 / 报警未送达）随 B118 换库副产物转绿，**残余**：旧库 `settings.alerts` 仍是哨兵值，将来从旧库迁 settings 会把它带回来（放行表 #6）；② BL8 那条经查是**判据假红**——线上并无 `ai.minIntervalMs` 字面键，preflight 用 `Number(null)=0` 把"缺键"读成 0，产品侧一直取默认 4000ms；间隔算术已收进 `lib/ai-throttle.js` 一份、判据与产品共用同一实现（见 `docs/ISSUES.md`「BL8-更正」行）；③「HEAD 已推送」随 push 许可拿到转绿（放行表 #11）。<br>⚠️ 第 9 项只判"`settings.ai` 未偏离 env"，**不判"该不该可写"**：可写通道仍开着、审计未落地 = BL9，实施在 39-1/39-3，不许当已交付。<br>作废的一轮状态原文（"文档侧刻意未 push"及其成因）逐字见 `docs/archive/debugging/2026-09-20-round-status-records.md` 的 preflight 行与 `git push` 行 |
| `npm run eval:whitebox` | `tools/eval-whitebox.cjs`（派生实现 `lib/daily-writers.js` + `lib/src-spans.js` + `lib/time-caliber.js`） | 三端一致性（**号位与项数不在本文枚举**，以 `tools/eval-whitebox.cjs` 实存为准；09-23 实测 24 项全绿。`W5/W8/W21/W22` 从未实现；`W3b` **不是独立号位**，是 W3 内部的一条子判据（`tools/eval-whitebox.cjs:68`），旧文档把它当号位列出属于错账。覆盖面例如：假开关、W9 坑↔锁对账、W10 重复判定、W11 入口 Provider 完整性、W12 媒体栏字段对账、**W24 建表源列集不分叉**（server 端可建列 ⊆ lib 端可建列（同名表），且 lib 的 ALTERS 补的列必须已在 SCHEMA 本体 —— B131 由此锁住）、**W13 日报栏目表只许一份**、**W14 入报门槛必须接在每一条 `INSERT INTO daily_reports` 上**、**W15 每个 `MAX(<TEXT 时间列>)` 必须 NULLIF 掉字面串 `'null'`**、**W17 删除/保留谓词三端只许一份**（`lib/retention.js` 单实现 + 派生扫描，B102）、**W18 噪声（热榜/聚合）判定三端只许一份**（`lib/noise.js` 单实现 + 派生扫描，B107：两条 banned 形态只扫字符串字面量，另一条腿是 14 个消费点缺引用即红）、**W19 报警事件表只许一份**（`lib/alert-events.js` 单实现，B109/B45：相邻成员成组才算表，分散单键不误红）、**W20 翻译 prompt 只许 `lib/ai-prompts.js` 一份**（B111/39-6：两条 banned 形态只扫字符串字面量、40 字以下不判（UI 文案里也会出现「资深…翻译专家」），另一条腿是 3 个消费点缺引用即红）、**W16「今日/北京日界」只许一份实现**（与回归锁 B4 共用 `lib/time-caliber.js` 那一份事实：容器 0 点 / 手搓 +8h / 日期串当时刻 / `toDateString()` 比同一天 / UTC 日当"今天" 共 6 种被禁形态全仓派生扫描，浏览器那份 `web/src/beijing-date.mjs` 走 C5 逐时刻比对而不是文本比对）） | ✅ **09-23 于 HEAD `3f89a08` 复跑：24 项全过、真退 0**（号位一律不枚举，口径见左列；`W22` 仍是拟建号，见 `docs/EVAL_GUIDE.md` §4.2 与 B124）。**W9 曾长期红**（09-19 夜实测：坑 #62/#63/#64 在 `tests/` 无 `#NN` 字面引用，判据面只扫 `tests/`；挂账见 `docs/ISSUES.md` B104，锁落在 `tests/regression-eval-substrate.test.js`）。**刻意未写进 whitebox-baseline.json 豁免**——那是历史债账本，用来豁免当轮新造缺口＝自我放行。<br>⚠️ **W9 判据自身的空洞（B104 收口时实测确认；✅ **09-21 已按放行清单 §三 #12 收紧**：只认 `test()` 标题/断言消息里的 `#N`，注释不算，`#12` 也不许顶替 `#1`；判据 `lib/pitfall-coverage.js`、锁 P1~P6，收紧时把 7 条真锁的坑号从注释挪进标题）**：它只按"`tests/` 里有没有 `#NN` 这个字面串"判覆盖，所以**一句注释就能让它绿**——#64 当时就是靠两份锁文件的头注被算成"已锁"的（白盒只报 62/63 不报 64 即为此）。B104 因此按"真锁 + 负向样本"交付，而不是按 W9 的绿灯交付；把 W9 收紧成"坑号须出现在 `test()` 标题或断言消息里"属判据变更，随放行表 #12 一并批。此前"全过"的写法系照抄旧轮未复跑，已更正。此前"全过"的写法系照抄旧轮未复跑，已更正。其余 W1~W8/W10~W16 全过，负向验证逐条做过：W12 摘一处 `source_avatar` 即红并点名行号；W13 塞一份探针栏目表即红并点名文件；**W14 = 5 处生成类写入点 × 3 种摘法 = 15 例全红且点名，另加 8 种形状样本（注释里写门槛 / 门槛只出现在字符串里 / 同函数第二条 INSERT 没门槛 / `INSERT OR REPLACE` / 字面量拼接 / 动态表名 / 只 prepare 不 run）全部按预期**，跑法 `node tools/_probe-w14-selftest.cjs`（**09-19 夜未复跑**：该探针会临时改写 `server/services/ai/daily-ai.js` 再复原，而并行会话正开着这个文件——重跑等于冒丢改动的风险，记为"本轮没跑"而非"过"）；**W15 未按承诺派生（09-19 夜更正）**：判据目前只覆盖手写名单 `POLLUTED=['last_fetched_at']`，实测全仓 4 处取值点（`server/routes/status.js:69/76`、`api/[...slug].js:920/921`）均已 NULLIF——原写在本格的「列名不再手写、由 `lib/dirty-columns.js` 从 DDL 派生、附 5 种躲法自证探针」**属提前宣布交付**：该自证探针（拟建，文件名 `_probe-w15-selftest.cjs`）不存在，`lib/dirty-columns.js` 只是已入库未接线的半成品（原判定见 43 号 spec §五，**09-23 该 spec 已作废删除，锚点见 `docs/ISSUES.md`**；与任务 #30）；「上线当轮抓出 `tools/_diag-media.cjs:17`」亦无法复核（该文件无提交历史）；**W16 的 6 种被禁写法逐个喂样本验证判据抓得到 + 3 个反例不许误伤**，跑法 `node tools/_probe-time-caliber-selftest.cjs`；剥注释/剥字符串的自检 `node tools/_probe-strip-selftest.cjs` → **291 个真实源文件双向判据**（抹完仍可 `node --check`、只出现在注释里的词确实消失、字符串内容不许丢）＋ 3 个杀手样本）。**两支探针 09-19 夜复跑均退 0**：time-caliber → `6 种被禁形态全抓到，3 个反例不误伤，消费点清单有效`；strip → `commentLeft: 0 / stringEaten: 0 → 两个方向都对每个真实源文件成立`） |
| `npm run eval:process` | `tools/eval-process-checks.cjs`（输入 schema 判据 `lib/eval-artifacts.js`） | 过程性二值检查（截图/报告/断言数/三类覆盖/占位文案/证据路径/退出码/参数出处）；**09-21 起 --report 先验输入 schema：喂错退 2 并说清认成了什么，且 fail_env 改退 2（不再与产品红同为 1，免得把人推向删用例）** | ✅ 8/8（F8＝§3.3 三类断言各 ≥1，09-19 夜加。**09-20 夜 B104 轮再复跑**：`自检：8/8 通过`，退 0）。⚠️ **轮内 F1~F8 的"过了"不留痕**（09-20 夜实测，登记 **B127**）：`eval-e2e.cjs` 只在判红时打印 `✗ 过程检查 …`，全绿既不出行也不写进 `report.json`；拿 `--report` 复核本轮 e2e 产物反而造出两条假红（`--report` 要的是 `docs/eval/runs/*.json` 那套 schema，与 e2e 产物不是一套输入）。所以本轮 F1~F8 的准确口径是：**轮内执行、控制台零失败行 = 过了，但产物无落账、事后不可复核**。<br>⚠️ 但 F6"退出码诚实"这条判据本身当晚没管住我——见 §1.5 上方 `npm test` 那格的管道吞码事故：**脚本内部判得对，不代表操作者不会在外面重蹈**，故本轮起把"取真实退出码"写进交付动作（`cmd > file 2>&1; echo EXIT=$?`） |
| `npm run eval:f2p` | `tools/eval-f2p.cjs` | 「改前红/改后绿」取证：`--auto-base` 反查基线、自建 worktree、红因分环境/产品，证据落 `docs/eval/f2p/` | ⛔ **`--self-test` 24/24（09-19 夜复跑，退 0）；但主流程结论本轮复查明出三条，此前"新增锁全部出证"的说法不实**（09-19 夜更正，见 `docs/ISSUES.md` B106）：<br>①**有效出证**：`2026-09-19162655`（门槛 NULL 语义）/ `173056`（B93 手动回拨基线，见坑 #61）/ `173201`（门槛配置归一）/ `185813`（B94 的 A1~A4，改前 4/4 红、改后 4/4 绿）——这四份 base 侧红是**用例名级别**的红，成立。<br>②**不成立且方向危险**：`211325`（13 条时区锁 B1~B6/C0~C6）与 `212614`（regression-daily-ai 第 4 条）、`162707`（`I13`，`missingOwn=["../lib/src-spans"]`）三份 `ok:false`，`why` 写着「13/13 条目标锁改前不红……按 §6 应删掉或重写」——**但 base 侧真实情况是测试文件整体加载崩**（`211325`：`base.tests=2 / fail=2`；`162707`/`212614`：`1/1`，`failedNames` 是**文件名**不是用例名，`missingOwn` 分别是 `../lib/time-window`、`../lib/src-spans`、`.env`）。"文件在基线里不存在"属**没跑到**，按坑 #41 只能判 `env`（退 2，禁止删用例），工具却归到 `product`（退 1，等于授权删掉 13 条好锁）。<br>③**方法论缺口**：B5 这类"锁直接读本轮新建实现文件做突变"的用例，在"基线 = 改动前提交"的构造下**永远不可能改前红**——正确构造是把修复点回退/注入 stub 再跑，而不是让文件不存在。三件待修都在 B106 里；**09-20 夜 B106 收口轮三件全落**：①判定链加"红项全是文件名形态 + 零目标命中 ⇒ `env`/退 2、文案写明禁止删用例"；②`--ledger` 常驻（`node tools/eval-f2p.cjs --ledger`，把 `docs/eval/f2p/*.json` 逐份对账并按新判据重算分类，实测标出旧账里 4 份 B106 形态）；③时区族 13 条锁**重新出证成功**——`--auto-base --tests 20b,20c --cases B1..C6` 得"用例名级改前红 13/13、改后 13 条全绿、退 0"（`2026-09-20135512.json`），§3.9 对该族已满足。**另抓到一条同族新洞**：`--cases B1 B2 …`（空格分隔）被旧版 `argv[i+1]` 静默截成只点 `B1`，13 条目标变 1 条还打印 ✓ —— 现多出来的参数一律退 2 并点名（坑 #65 规则②，锁 `#65-1`）。**反向教训**：把"基线缺本轮新建文件"单独判 env 是过度修正，会让收敛型修复永远出不了 F2P（§6 明令），我犯过一次、被自己的自检探针挡住 |
| `npm run eval:content` | `tools/eval-content.cjs` → `tools/eval-content/*.py` | 41-8 内容质量五维 judge（LLM 分只作趋势与复核触发，不作门禁） | ✅ 已交付；真评需 `--judge`（花配额）+ `--align`（≥3 条产物） |
| `npm run eval:e2e` | `tools/eval-e2e.cjs`（Playwright） | **41-2 端到端评测**：10 条剧本覆盖 6 个前台页 + 后台登录门，DOM ↔ 页面自己发出的响应对账，默认线上、每剧本连跑 3 次 | ◐ **最新验收轮 9/10、真退 1**（产品红 1 / 环境红 0 / flaky 0）：09-21 B109/B112 批复跑，线上 commit `4e5441c` == `origin/main`，`env_lock.acceptance.ok=true`（10 剧本 ×3 × 真实云端），过程层 F1~F8 = 8/8 已落 `report.json.process`（B127 那条产物面判据第一次真跑），证据 `docs/eval/e2e/20260920T225428/`。上一轮（09-20 夜 B104 轮，`liveCommit=7c967bb`）证据 `docs/eval/e2e/20260920T112415/`。**唯一产品红 = E6 周刊 `items=20 storylines=0`，3/3 稳定复现 = B121**（不为绿灯放宽判据，三条修法等你点头）。<br>⚠️ 本格此前把上一轮 `20260919T215110/`（跑在 `961fec04`，10/10 全绿）写成"最新验收轮"，那是 §2.5 漂移 —— 历史证据留着，但**它不再是当前状态**；<br>该 215110 轮的F1~F8 由轮内 `CHECKS` 一并执行。**⚠️ 同轮的 `knownGaps=[]` 与 `uncoveredKinds=[]` 只是"没有剧本级摘出的缺口"和"每条剧本三类断言齐"，不是"功能覆盖全"** —— 手工核对的功能格矩阵（原 `coverage-matrix-20260919.md`，随 41 号 spec 于 09-23 作废删除，锚点见 `docs/ISSUES.md`）给出的是 **39 格里 ✅3 / ◐8 / ⛔28**。上一轮 `20260919T191201/`、更早 `173518`（线上 `c46fd89`）同口径留档）。B85/B84 的线上几何读数按**所引轮次**为准（215110 轮实测）：`rows=34 maxH=93 minTitleW=160`、`800px 溢出 0/34 最长 93px ; 1024px 溢出 0/34 最长 93px`、`mediaCards DOM=6 API=6 art=6 emoji=0`——旧轮 `173518` 的 `rows=37 / 溢出 0/37 / DOM=10 API=10` 是**当时那一期产物的条数**（媒体卡随批次 6↔10 变化），不是回归，本格不再把旧数字写成"持续在案"。**验收轮口径（EVAL_GUIDE §3.7）**：全剧本 × ≥3 轮 × 真实云端才允许 exit 0，`--only`/`--fast`/本地目标一律打 `NOT_ACCEPTANCE` 退 2——跑过 ≠ 验收过。**未覆盖**：①后台 8 板块的写回闭环剧本（需登录态，我不代你登录）；②**数据保留 / 不误删面**——剧本断言的是"页面有内容 / 接口到达 / 无 pageerror"，从不断言"老数据没被删"，所以本行的绿**不能**当作"采集删除语义正确"的证据（原 09-19 夜实测写的是"云端 10,733 条待删从未触发、本地 `datamgr.CLEAN_TABLES` 无豁免且会删全部视频"，出处 43 号 spec 已于 09-23 作废删除，锚点见 `docs/ISSUES.md`。**两条今日均已失效**：① cleanup 已实跑两轮删 59,306 行；② `server/services/datamgr.js:16` 改走 `retentionScope('local')`，`local` 作用域现对 articles 与 videos 双双 `skip`（B102 已修，判据可由 `node -e "require('./lib/retention').scope('local')"` 复核））。两部分均记为未验收 |
| `npm run eval:strip-selftest` | `tools/_probe-strip-selftest.cjs` | 词法视图（`lib/src-spans`）的**双向**自证：抹注释要真抹净、抹代码与字符串内容不许失真（坑 #63）。`npm test` 里由锁 `#63-3` 以 `STRIP_SELFTEST_LIMIT=60` 等距跨目录抽样跑，**本命令跑全量**（328 个文件 ≈52s，交付链门禁轮用） | ✅ 09-20 夜 B104 轮新增：独立审查指出"全量留在门禁轮"当时只是注释里的一句承诺、没有可执行入口，故补该 script 并由 `#63-3` 断言它在。本轮读数：抽样 60 个（含注释 57）三向读数全 0、退 0 |
| `npm run dump:content` | `tools/dump-content.cjs` + `lib/content-dump.js` | **B103 内容级转储**（spec43 D3 的前置闸）：把 `articles`/`videos` 按 id keyset 分页导成 gzip NDJSON 分片 + sha256 清单；子命令 `--full` / 增量 / `--verify` / `--restore --into` / `--mktarget`；输出落 `data/content-dump/<scope>/`（`/data/` 整目录已 ignore，不会进提交） | ✅ 09-21 交付。首轮真转储：云端 59,832 文章 + 1,291 视频 = 161.6MB/154 片、本地 43,467 + 1,161 = 101.4MB，逐片校验通过；回放演练 17.6s 放回全量，抽样 12 行 × 23 列逐字段 0 不一致。锁 D1~D10（`tests/regression-content-dump.test.js` 的 D1~D10）。**删前那份的再校验（09-21）**：`--verify` 逐片通过，59,832 + 1,291 / 150 片 / 161.6MB / 坏片 0 / maxId 296,077 |
| `npm run dump:gate -- --max-age-hours 48` | 同上（`--gate`） | **删除前的"有底牌"判据**：清单在读、逐片校验和/行数/id 区间递增、行数 >0、新鲜度达标 → 才回 `allowed:true`；否则退 1 并列出全部原因（不许"警告后照删"） | ◐ **runner 侧已成强制路径**（09-21 B101 观测批）：`tools/collect-turso.js` 的 `runCleanup` 在 DELETE 前先过 `deleteGate`，不放行就一条都不删并把原因写心跳与日志（锁 CO2/CO3 双向：无转储必挡、有转储必放行）。**仍欠两处**：① 云端手动清理端点的谓词 ✅ **09-21 已并回一份**（新增 `POLICY.cloudManual.retention`，三端时间列统一为 `COALESCE(published_at, created_at)`，W17 的整文件豁免 `PENDING_UNIFY` 同日清空；锁 R5 用同一批夹具逐行证明"改前后选中的行完全相同"），但**还没接闸**——Vercel 无本地盘，直接接等于把该手动工具当场变成永久挡下，须与 ② 一起设计；② **runner 上这道闸此刻必然判"挡下"**（转储是本地盘产物，runner 没有 `data/content-dump/cloud`）—— 安全方向正确，但要让定时清理真能删，得把 manifest 摘要+校验和写进库里当可核验凭证，形态与 `tools/dump-content.cjs` 的在途改动绑定，不擅自定 |
| `node tools/eval-prescreen-learning.cjs` / `node tools/eval-prescreen-behavior.cjs` | 同一套三臂（`fitNB`/`fitCNB`/`fitTfidf` 只有一份，后者 require 前者） | **零额度初筛层效果实验**：前者吃人工标注（`docs/eval/2026-09-24-prescreen-labels.md` 的「判定」列），后者吃**行为标签**（`data/prescreen-lab/corpus.jsonl`，由 `tools/_probe-behavior-corpus.cjs` 只读导出）。判据都是**工作点上的误砍率**（"砍掉池子 X% 时，砍掉的量占全部正样本的比例"），另给长度单特征与随机两条对照 + AUC 自助区间 | ✅ 零网络零模型（learning 侧要连库回查摘要，behavior 侧纯本地 4s）。**09-24 夜首版答案**：三臂 out-of-sample AUC .66~.71（长度对照 .48、随机 .50，区间不重叠）⇒ 信号真；但"误砍 ≤3%"约束下**最多只能砍 10%** ⇒ 采用形态＝兜底排序而非替代 AI 初筛。同轮抓出并修掉**互补 NB 反号**（AUC 0.082→0.918），方向锁 A1~A4（`tests/regression-prescreen-arms.test.js`） |
| `npm run check:retention` | `tools/check-retention.cjs`（谓词取自 `lib/retention.js` 的 `pendingPlan`） | **B101 观测面**（只读）：把"现在有多少条满足删除谓词"两份一起打 —— 落库读数（runner 每批次写 `settings['retention.pending']`，含 14 天历史）+ 本命令现算；另打 cleanup 心跳的**实删数**与删除闸状态 | ✅ 09-21 交付。首轮读数（真实云端）：`articles` 16,669 篇 ｜ 待删 hotlist 138 + retention 6,264 = **6,402 条 = 38.4%** ｜ 心跳 `2026-09-20T22:27 热榜删 26532 + 保留删 24291` ｜ 落库读数尚无（runner 侧新代码未跑批）。锁 `tests/regression-cleanup-observe.test.js:113` CO1~CO5（含"读数==真删条数"逐键对账与"读数缺失时命令不许编一个"） |
| `node tools/audit-cloud.js` | 同名 | 云端 **21** 项只读巡检（判据：只有 `true` 算通过，未验收单列，有失败退 1；**一条 HTTP 响应都没拿到 → 判环境红退 2**，不许伪装成"云端全挂"） | ✅ 20 通过 / 0 失败 / 1 未验收（**09-20 夜 B104 轮复跑，退 0**：`首页/阅读器/日报/热点/管理/meta` 全 200，`admin 未授权拦截 401`、`采集端点鉴权 403`、`状态轻投影 5.4s` 与 `状态重统计(按需) 1.0s` 分流生效、`/api/videos` 10.9s 仍偏慢）（B91：本支脚本此前用全局 fetch 不走代理，实测 19/19 "fetch failed" 被读成云端故障；现统一走 `lib/cloud-site#cloudFetch`，并新增 B26 轻投影/按需重统计两条观测位） |

**基址与凭据口径**：云端域名只在 `lib/cloud-site.js` 一份（Python 侧由 `tools/eval-content.cjs` 经 `CLOUD_SITE` 传入，不许第二份）；
报警"有出口/已送达"的判据只在 `lib/alert-channels.js` 一份；密钥永不明文回显，日志与报告只留前 4 后 4 指纹。

> **~~缺口（AGENTS §3 交付链第 2 步现在无可查对象）~~ → 已补上（2026-09-23）**：新增 `.github/workflows/ci.yml`
> （push/PR 跑 `npm test` + `lint:docs`，node 24、`npm ci` 带脚本编译 better-sqlite3、无 secrets）。
> 判卷权自此外移 GitHub——agent 自报"过了"不再算数，以 Actions 日志为准。云端凭据不入库：
> 读 `.env` 的测试在 CI 下按文件内标记处理（云端用例名带「CI 无 .env 凭据，跳过」，或退 `file:` 本地库）。
> `eval:*` 各命令按本节头部 09-23 口径为按需工具，不进 CI。

---

## 2. 本表里的缺口对应什么（需求队列的 SSOT 是 `docs/NEXT-DEV-REQS.md`，本节不复制排期）

已完成项**不在本表**（活文档只写现状；要回看哪年做完的走 git）。这里只回答一件事：§1 里每个 ❌/⚠ 是不是有人管、管到哪。

| 缺口（§1 里的格） | 状态 | 去处 |
|---|---|---|
| 云端整库文件备份与恢复 | **永不做**（serverless 文件系统约束，不是待办） | 边界理由见 ADR-02 的那刀与 `docs/adr/` |
| 抖音采集、播放直链解析 | **永不做**（需登录态 / Cookie 风控） | ADR-02 |
| 公众号（wemp）云端采集 | **云端两份实现都显式排除**，本地是唯一能采的一端 | 后果与排查见 `docs/ISSUES.md`；不许写成"云端也有" |
| 单源手动刷新的云端等价 | 已用「标记到期 + runner 下轮补抓」替代 | 端点清单见 `docs/HANDOVER.md` §3 |
| 热榜英文原文抓取 | 在途，卡在依赖体积 | `docs/NEXT-DEV-REQS.md` |
| 全文补抓 / AIHOT 富字段回填 | 在途待移植 | 同上 |
| 设置写通路（部分门槛键没有写入口） | **缺陷**，不是设计 | `docs/ISSUES.md` H41 三型静默失真 |
| 云端手动清理未接删除闸 | **缺口**，与安全方向绑定，未擅定 | `docs/ISSUES.md`（清理闸那一族） |

### 迁移方法论（每个要上云的项都按此流程）

1. 以本地实现的**语义**为准 → 2. 在云端部署面写出对应实现 → 3. 本地构建与语法自检 → 4. 推 main 自动部署 → 5. **线上实测**（`docs/DELIVERY_VERIFICATION.md`）→ 6. 更新本矩阵；端点有变再改 `docs/HANDOVER.md` §3。
   新端点要同一次改三处、且必须真打线上（ADR-04）。
