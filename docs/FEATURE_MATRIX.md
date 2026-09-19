# 功能矩阵 · 迁移路径 · 待开发目标 · 理想态

> 最后更新：2026-09-18（GH runner 职责行补全 7 批次（09-18 清洁轮））
> **本文档是唯一权威的功能覆盖矩阵**（SSOT）。其它文档（MODULE_STATUS 等）不再维护矩阵，一律指向本文。
> 生成方式：**以真实环境逆向推导**——云端能力逐端点实测于 `https://qwis-intel.vercel.app`（2026-09-11），本地能力以 `server/` 代码为准。
> 更新规则：任何端点增删改 → 先改本文，再改其它文档。每条功能改动必须云端实测后才允许把矩阵标为 ✅。

---

## 0. 三端定义（先建立正确脑图）

| 端 | 形态 | 职责 | 存储 |
|---|---|---|---|
| **本地**（`server/`，localhost:3000） | Express + better-sqlite3，PM2/手动 | 全功能开发/灾备；抖音 Playwright、B站 wbi 等重依赖功能 only here | 本地 `data/app.db` |
| **Vercel**（`api/`，qwis-intel.vercel.app） | Serverless 读层 + 管理后台 | 面向用户的阅读与管理界面 | Turso（东京） |
| **GH runner**（`tools/collect-turso.js` + `.github/workflows/collect.yml`） | 每 15min 定时任务 | 采集 / 早报（含 AI 双档）/ 我的早报 / 周刊 / 翻译 / 快照 / 清理，直写 Turso（cron 真值见 `collect.yml:24-36`） | Turso |

**数据流**：runner 采集 → Turso ⇄ Vercel API → 浏览器。本地与 Turso 之间**无自动同步**（tools/migrate-to-turso.js 为手动迁移工具）。

---

## 1. 功能覆盖矩阵（实测为准）

### 1.1 阅读器（/reader/）

| 功能 | 本地 | Vercel | 说明 |
|---|---|---|---|
| 文章列表（全局时间序/筛选/搜索/游标分页） | ✅ | ✅ | 2026-09-15（27）：默认「今日」滚动 24h 视图（since 参数+smart 排序）；「全部」降级为检索模式（至少一个筛选条件才发请求）；顶部今日早报摘要卡（导语+头条3条+跳全文） |
| 未读口径 | ✅ | ✅ 2026-09-15 | 近 3 天未读（历史自动归档，"未读 25096"式焦虑数字消失；数据不变仅计数口径） |
| 无感刷新 | SSE `/api/events` | ✅ 60s 增量轮询 `/api/articles/since` | 2026-09-11 重写；serverless 不支持长连 |
| 文章详情/已读/稍后读/全部已读 | ✅ | ✅ | |
| 阅读沉淀（我的阅读/批量/导出） | ✅ | ✅ | |
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
| 翻译 Skill（已并入 AI 能力） | ✅ | ⚠️ | `ai/translate/*` 端点仍缺；runner 自动翻译优先级=每日早报>我的早报>精选周刊>热点榜>阅读器（2026-09-15 用户口径修正+优先级 id 直接补候选池），手动入队最优先；薄正文走仅标题通道（坑 #A2） |
| 数据（已并入系统） | ✅ | ⚠️ | stats/cleanup ✅；文件型快照/上传/恢复 501（用配置备份替代） |
| 报警管理（已并入系统） | ✅ | ✅ 2026-09-12 | 配置写/测试/清冷却已上云；触发引擎在 runner 批次尾部（15-cloud-alerts） |
| 热点榜设置 | ✅ | ⚠️ | AIHOT backfill/enrich 控制缺 |
| 监控（已并入系统） | ✅ | ⚠️ 近似值 | 无 job_queue 历史，数值为当前状态近似 |
| 早报/我的早报/周刊 管理页 | ❌ | ✅ 2026-09-13 | T3-2 早报中心（生成历史/推送/周刊归档/画像配额）。「周刊归档删除」端点 2026-09-18 才真正可达（此前被误写进 GET 分支，恒 404）；历史表对 mybrief/足迹只能显示 1 行（读单个 `*.latest` 键，非 7 天序列）；「手动生成命令」目前只是文本提示 |
| 早报/周刊 AI 落库守卫 | ✅ | ✅ 2026-09-18 | 唯一实现 `lib/brief-guards.js`（读层按 `schemaVersion` 档位优先取日报，runner 周刊 <4 条不发布）——见不变量 12 / 坑 #32。本地 `server/services/ai/daily.js getLatest()` 同口径 |

### 1.4 采集与调度

| 能力 | 本地 | runner（云端采集） | 说明 |
|---|---|---|---|
| RSS/公众号/YouTube/X | ✅ | ✅ | 60min 间隔，ETag 304 |
| 热榜 29 源 | ✅ | ✅ | 30min 间隔，浏览器 UA 必需 |
| B站 wbi 签名采集 | ✅ | ✅ 2026-09-12 | api/_bilibili.js 三链路（wbi 主链+合集+搜索兜底），匿名可用；播放直链仍本地 |
| 抖音 | ✅ | ❌ 永不 | Playwright 登录态，架构决策 |
| 全文补抓 / AIHOT enrich | ✅ | ❌ 待移植 | |
| 报警引擎（7 渠道） | ✅ | ✅ 2026-09-12 | api/_alerts.js 全量移植（含熔断汇总/AI失败/停滞检测/可诊断文案） |
| 触发可靠性 | 进程常驻 | GH schedule（会丢）+ cron-job.org 外置触发（主力） | 双保险 2026-09-11 落地。cron-job 任务 **8430047**：每 15min POST workflow_dispatch 叫醒 collect job（dispatch 只跑采集，日报/快照不会被 15min 刷）；控制台 <https://console.cron-job.org/dashboard>，API Key 见 HANDOVER §1.5；任务内嵌 GitHub PAT，PAT 轮换须同步；2026-09-14 API 实测 enabled、全绿准点。**2026-09-18 追加**：`workflow_dispatch` 带 `inputs.mode`（choice，默认 `collect`；cron-job 不传 inputs → 取默认，语义完全不变），人工可选 `daily-ai`/`daily-ai-evening`/`mybrief`/`weekly` 单独补跑——周刊此前每周只有周五一次 schedule 且无任何补跑口，是 09-17 那周断更的直接成因；cron 具体值以 `collect.yml` 为唯一事实源 |

---

### 1.5 评测与门禁工具链（命令的唯一清单，别处只写"见 §1.5"）

| 命令 | 实现 | 作用 | 状态（2026-09-19） |
|---|---|---|---|
| `npm test` | `tests/*.test.js`（node:test，`--test-concurrency=1`） | 回归网：每条线上修过的 bug 都要有锁 | ⛔ **440** 条 / **1 必现红 + 1 条 flaky** / 0 跳过（**三轮全量复跑，真实退出码恒 1**；此前本格写"0 红"是照抄旧轮结论 + 用 `npm test \| tail` 看输出被管道吞掉退出码造成的假绿——正是 `eval:process` 里 `check_exit_code_honest` 防的那个动作，我自己踩了）。① **必现红 = G3**（`tests/regression-20260919g.test.js:47` 断言 whitebox 退出 0，红因 = **B104** 的 W9：坑 #62/#63/#64 无 `tests/` 引用；B104 修好它随之转绿）；② **flaky = `tests/regression-my-brief.test.js:82`**「2. 有订阅 + settings 报告 → 正常透传」：驱动子进程在退出阶段以 `0xC0000005` 崩溃，而断言载荷 `BODY {"ok":true,…}` 已正确打印；三轮全量 **1 红 2 绿**、单跑 3/3 绿 ⇒ 判 `fail_flaky`（B105，属测试地基，不是产品缺陷，但它随时能伪装成产品红）。B83 已收口——七份"直打生产 Turso"的回归测试全部搬到本地文件库。09-20 凌晨 +13：`20260920b` B1~B6（时区口径）+ `20260920c` C0~C6（日报"同一天"判定 + 前后端日历对账）。**本行是全库唯一写死测试条数的地方**，其它文档一律写"见 FEATURE_MATRIX §1.5"） |
| `node smoke-test.js` | `smoke-test.js` | 生产库副本冒烟 + 自带对抗性段（超长 URL/特殊字符/空内容/并发/错误边界） | ✅ 20/20，零副作用（**09-19 夜在 HEAD 复跑**：`通过 20 / 失败 0`，真实退出码 0） |
| `npm run build:vercel` | Vite + `api/` | 云端构建面 | ✅ 通过（上一轮实测；**本轮未复跑**——避免与并行改动争抢 `web/dist` 产物，计为"本轮没跑"而非"过"） |
| `npm run lint:docs` | `tools/doc-lint.cjs` | 文档门禁六条（头注/悬空/INDEX/归档头/超长/明文密钥）+ 第 7 条目录索引提示 | ✅ 0 错（`docs/eval/` 机器产物不参与悬空扫描）。⚠️ 第 7 条"目录索引待维护 7 处"**跑 `gen-dir-index.cjs` 修不掉**——脚本只建骨架、不写自动段，详见 **B108**（AGENTS §2.8 的"刷新自动段"表述与工具实际行为不符，待改口径或补能力） |
| `npm run eval:preflight` | `tools/eval-preflight.cjs` + `lib/cloud-site.js` + `lib/alert-channels.js` | 环境前置：代理 / **线上 commit==origin/main** / Turso / 隔离 / BL7~BL9 配置真值 | ⛔ 6/9（红=BL7 两条 + BL8，均为待授权，非环境问题）。**09-19 夜复跑同口径**（退 1）：proxy ✓ / HEAD 已推送 `961fec0` ✓ / 线上 commit == origin/main ✓ / Turso 可读 `sources=1437` ✓；BL7 两条实时读数——渠道清单只有 `test-ch:http://127.0.0.1/…`（无真实出口）**且**最新一条报警（`2026-09-19T22:20`）`fetch failed` 未送达、近 50 条仍无一次成功；BL8 `ai.minIntervalMs=0`。另提示"工作区有未提交改动"（本轮我的文档改动，属预期） |
| `npm run eval:whitebox` | `tools/eval-whitebox.cjs`（派生实现 `lib/daily-writers.js` + `lib/src-spans.js` + `lib/time-caliber.js`） | 三端一致性 W1~W16（含 W3b 假开关、W9 坑↔锁对账、W10 重复判定、W11 入口 Provider 完整性、W12 媒体栏字段对账、**W13 日报栏目表只许一份**、**W14 入报门槛必须接在每一条 `INSERT INTO daily_reports` 上**、**W15 每个 `MAX(<TEXT 时间列>)` 必须 NULLIF 掉字面串 `'null'`**、**W16「今日/北京日界」只许一份实现**（与回归锁 B4 共用 `lib/time-caliber.js` 那一份事实：容器 0 点 / 手搓 +8h / 日期串当时刻 / `toDateString()` 比同一天 / UTC 日当"今天" 共 6 种被禁形态全仓派生扫描，浏览器那份 `web/src/beijing-date.mjs` 走 C5 逐时刻比对而不是文本比对）） | ⛔ **15/16 —— 09-19 夜在最终 HEAD 复跑实测：W9 红**（本轮新增坑 #62/#63/#64 在 `tests/` 无 `#NN` 字面引用，判据面只扫 `tests/`；挂账见 `docs/ISSUES.md` B104。**刻意未写进 whitebox-baseline.json 豁免**——那是历史债账本，用来豁免当轮新造缺口＝自我放行）。此前"全过"的写法系照抄旧轮未复跑，已更正。其余 W1~W8/W10~W16 全过，负向验证逐条做过：W12 摘一处 `source_avatar` 即红并点名行号；W13 塞一份探针栏目表即红并点名文件；**W14 = 5 处生成类写入点 × 3 种摘法 = 15 例全红且点名，另加 8 种形状样本（注释里写门槛 / 门槛只出现在字符串里 / 同函数第二条 INSERT 没门槛 / `INSERT OR REPLACE` / 字面量拼接 / 动态表名 / 只 prepare 不 run）全部按预期**，跑法 `node tools/_probe-w14-selftest.cjs`（**09-19 夜未复跑**：该探针会临时改写 `server/services/ai/daily-ai.js` 再复原，而并行会话正开着这个文件——重跑等于冒丢改动的风险，记为"本轮没跑"而非"过"）；**W15 未按承诺派生（09-19 夜更正）**：判据目前只覆盖手写名单 `POLLUTED=['last_fetched_at']`，实测全仓 4 处取值点（`server/routes/status.js:69/76`、`api/[...slug].js:920/921`）均已 NULLIF——原写在本格的「列名不再手写、由 `lib/dirty-columns.js` 从 DDL 派生、附 5 种躲法自证探针」**属提前宣布交付**：该自证探针（拟建，文件名 `_probe-w15-selftest.cjs`）不存在，`lib/dirty-columns.js` 只是未跟踪半成品（见 `docs/specs/43-collect-retention-safety/spec.md` §五 与任务 #30）；「上线当轮抓出 `tools/_diag-media.cjs:17`」亦无法复核（该文件无提交历史）；**W16 的 6 种被禁写法逐个喂样本验证判据抓得到 + 3 个反例不许误伤**，跑法 `node tools/_probe-time-caliber-selftest.cjs`；剥注释/剥字符串的自检 `node tools/_probe-strip-selftest.cjs` → **291 个真实源文件双向判据**（抹完仍可 `node --check`、只出现在注释里的词确实消失、字符串内容不许丢）＋ 3 个杀手样本）。**两支探针 09-19 夜复跑均退 0**：time-caliber → `6 种被禁形态全抓到，3 个反例不误伤，消费点清单有效`；strip → `commentLeft: 0 / stringEaten: 0 → 两个方向都对每个真实源文件成立`） |
| `npm run eval:process` | `tools/eval-process-checks.cjs` | 过程性二值检查（截图/报告/断言数/三类覆盖/占位文案/证据路径/退出码/参数出处） | ✅ 8/8（F8＝§3.3 三类断言各 ≥1，09-19 夜加。**09-19 夜复跑**：`自检：8/8 通过`，退 0）。⚠️ 但 F6"退出码诚实"这条判据本身当晚没管住我——见 §1.5 上方 `npm test` 那格的管道吞码事故：**脚本内部判得对，不代表操作者不会在外面重蹈**，故本轮起把"取真实退出码"写进交付动作（`cmd > file 2>&1; echo EXIT=$?`） |
| `npm run eval:f2p` | `tools/eval-f2p.cjs` | 「改前红/改后绿」取证：`--auto-base` 反查基线、自建 worktree、红因分环境/产品，证据落 `docs/eval/f2p/` | ⛔ **`--self-test` 24/24（09-19 夜复跑，退 0）；但主流程结论本轮复查明出三条，此前"新增锁全部出证"的说法不实**（09-19 夜更正，见 `docs/ISSUES.md` B106）：<br>①**有效出证**：`2026-09-19162655`（门槛 NULL 语义）/ `173056`（B93 手动回拨基线，见坑 #61）/ `173201`（门槛配置归一）/ `185813`（B94 的 A1~A4，改前 4/4 红、改后 4/4 绿）——这四份 base 侧红是**用例名级别**的红，成立。<br>②**不成立且方向危险**：`211325`（13 条时区锁 B1~B6/C0~C6）与 `212614`（regression-daily-ai 第 4 条）两份 `ok:false`，`why` 写着「13/13 条目标锁改前不红……按 §6 应删掉或重写」——**但 base 侧真实情况是两个测试文件整体加载崩**（`base.tests=2 / fail=2`，`failedNames` 是**文件名**不是用例名，`missingOwn=["../lib/time-window"]`）。"文件在基线里不存在"属**没跑到**，按坑 #41 只能判 `env`（退 2，禁止删用例），工具却归到 `product`（退 1，等于授权删掉 13 条好锁）。<br>③**方法论缺口**：B5 这类"锁直接读本轮新建实现文件做突变"的用例，在"基线 = 改动前提交"的构造下**永远不可能改前红**——正确构造是把修复点回退/注入 stub 再跑，而不是让文件不存在。三件待修都在 B106 里，**在它们修好之前，本轮时区族的 F2P 视为未取证**（AGENTS §3.9 不满足） |
| `npm run eval:content` | `tools/eval-content.cjs` → `tools/eval-content/*.py` | 41-8 内容质量五维 judge（LLM 分只作趋势与复核触发，不作门禁） | ✅ 已交付；真评需 `--judge`（花配额）+ `--align`（≥3 条产物） |
| `npm run eval:e2e` | `tools/eval-e2e.cjs`（Playwright） | **41-2 端到端评测**：10 条剧本覆盖 6 个前台页 + 后台登录门，DOM ↔ 页面自己发出的响应对账，默认线上、每剧本连跑 3 次 | ✅ **最新验收轮已过：10/10 ×3 全绿**（线上 `961fec04` == origin/main == HEAD，证据 `docs/eval/e2e/20260919T215110/`，`liveCommit` 已钉进 env_lock、`acceptance.ok=true`、产品红 0/环境红 0/flaky 0、`knownGaps=[]`、`uncoveredKinds=[]`、无 consoleError；F1~F8 由轮内 `CHECKS` 一并执行。上一轮 `20260919T191201/`、更早 `173518`（线上 `c46fd89`）同口径留档）。B85/B84 的线上几何读数按**所引轮次**为准（215110 轮实测）：`rows=34 maxH=93 minTitleW=160`、`800px 溢出 0/34 最长 93px ; 1024px 溢出 0/34 最长 93px`、`mediaCards DOM=6 API=6 art=6 emoji=0`——旧轮 `173518` 的 `rows=37 / 溢出 0/37 / DOM=10 API=10` 是**当时那一期产物的条数**（媒体卡随批次 6↔10 变化），不是回归，本格不再把旧数字写成"持续在案"。**验收轮口径（EVAL_GUIDE §3.7）**：全剧本 × ≥3 轮 × 真实云端才允许 exit 0，`--only`/`--fast`/本地目标一律打 `NOT_ACCEPTANCE` 退 2——跑过 ≠ 验收过。**未覆盖**：①后台 8 板块的写回闭环剧本（需登录态，我不代你登录）；②**数据保留 / 不误删面**——剧本断言的是"页面有内容 / 接口到达 / 无 pageerror"，从不断言"老数据没被删"，所以本行的绿**不能**当作"采集删除语义正确"的证据（09-19 夜实测：云端保留清理 10,733 条待删从未触发、本地 `datamgr.CLEAN_TABLES` 无豁免且会删全部视频，见 `docs/specs/43-collect-retention-safety/spec.md`）。两部分均记为未验收 |
| `node tools/audit-cloud.js` | 同名 | 云端 **21** 项只读巡检（判据：只有 `true` 算通过，未验收单列，有失败退 1；**一条 HTTP 响应都没拿到 → 判环境红退 2**，不许伪装成"云端全挂"） | ✅ 20 通过 / 0 失败 / 1 未验收（**09-19 夜复跑，退 0**：`admin 未授权拦截 401`、`采集端点鉴权 403`、`/api/videos 200 / 2678ms`、`静态快照兜底 200`）（B91：本支脚本此前用全局 fetch 不走代理，实测 19/19 "fetch failed" 被读成云端故障；现统一走 `lib/cloud-site#cloudFetch`，并新增 B26 轻投影/按需重统计两条观测位） |

**基址与凭据口径**：云端域名只在 `lib/cloud-site.js` 一份（Python 侧由 `tools/eval-content.cjs` 经 `CLOUD_SITE` 传入，不许第二份）；
报警"有出口/已送达"的判据只在 `lib/alert-channels.js` 一份；密钥永不明文回显，日志与报告只留前 4 后 4 指纹。

> **缺口（AGENTS §3 交付链第 2 步现在无可查对象）**：仓库只有一个 `collect.yml`（`schedule` + `workflow_dispatch`），
> **没有 push-CI** → 我推 10 次 GitHub 上也不会有一次跑 `npm test`/`lint:docs`，"Actions 是否报错"因此只能查采集批次、查不到代码质量。
> 补 `.github/workflows/ci.yml`（push/PR 跑 `npm test` + `lint:docs` + `eval:whitebox`，node 单版本、无 secrets）是一行决定，
> 但会消耗 Hobby 免费 Actions 分钟数 → **等用户点头再加**（B70 之外单列，因为它是流程缺口不是代码缺陷）。

---

## 2. 待开发目标（按优先级）

| 优先级 | 事项 | 依赖 | 预期效果 |
|---|---|---|---|
| ~~T5-2~~ | ~~前后台信息架构重构~~ | — | ✅ 已完成 2026-09-15（specs 26→27 今日视图+27b 源四轴+29 源库三视图+30 后台 5 Tab；commit `f338ac1`+`83db503`；云端冒烟全过） |
| ~~T5-8~~ | ~~IconRail 图标配文字~~ | — | ✅ 已完成 2026-09-15（随 spec30） |
| ~~T5-10~~ | ~~抖音板块下架~~ | — | ✅ 已完成 2026-09-15（随 spec30） |
| **T3（2026-09-13 定稿，等用户确认）** | **早报体系 v3 / 管理台早报中心 / 读层性能 / 入早报来源榜** | 见 `docs/NEXT-DEV-REQS.md` | 晚间生成的公共版+个性化早报（主题全景四视角/补充阅读10篇/生成>翻译调度/周报AI总结注脚/阅读足迹回顾），管理台可管，三慢接口 P95<2s |
| P0 | **设置写 API**（`PUT /api/settings` + `/api/settings/daily`） | 无 | 云端管理台可保存视图/日报栏目/队列配置/保留天数，4 个 Tab 复活 |
| ~~P0~~ | ~~源写 API~~ | — | ✅ 已完成 2026-09-12（14-sources-write：12 项回归测试绿；autoclassify N+1 优化 70s→0.7s） |
| ~~P1~~ | ~~DEEPSEEK_API_KEY 接入~~ | — | ✅ 已作废：Agnes 云端修复可用（2026-09-11），用户决策优先用免费 Agnes |
| ~~P1~~ | ~~AI 翻译/摘要移植~~ | — | ✅ 翻译链已完成 2026-09-12（17-translate：多轮精翻管线+手动入队+中英切换+机翻标记）；日报 AI 评分归 18 |
| ~~P1~~ | ~~早报体系 v2~~（每日情报→每日早报 AI 策展） | — | ✅ 已完成 2026-09-12（18-daily-ai-v2：两阶段初筛+六维深析+主题导语+降级链+黄金集；限量真实生成实测通过） |
| ~~P1~~ | ~~B站 wbi 采集移植 runner~~ | — | ✅ 已完成 2026-09-12（21-bilibili-runner：三链路移植+真实采集 34 视频实测+匿名降级可用） |
| ~~P2/P0-3~~ | ~~云端报警引擎~~ | — | ✅ 已完成 2026-09-12（15-cloud-alerts：7渠道引擎上 runner 批次尾部 + 配置写端点 + 可诊断文案 + 熔断每日汇总；用户飞书渠道已在 Turso） |
| P2 | 热榜原文抓取 `/api/hot/original` 移植 | jsdom 包体积 | 热榜英文条目一键看原文 |
| P2 | AIHOT enrich/backfill 移植 runner | 串行限速 | 热点条目富字段 |
| P3 | 视频详情/收藏 | — | 播放直链永不云端化（B站 Cookie 风控），仅做详情/收藏 |
| 永不 | 抖音采集/登录、文件型 .db 快照、SSE | 架构决策 | 本地专属；云端已分别用 501 指引、配置备份、轮询替代 |

### 迁移方法论（每个 P0/P1 项都按此流程）
1. 本地 `server/routes/*.js` 语义为准 → 2. `api/[...slug].js` 写 Turso 版 handler → 3. `npm run build:vercel` + 本地 node --check → 4. push main 自动部署 → 5. **线上实测（docs/DELIVERY_VERIFICATION.md 流程）** → 6. 更新本矩阵 + HANDOVER §3。

---

## 3. 理想态（全部落地后的系统面貌）

**用户视角**：打开 `https://qwis-intel.vercel.app` ——
- 阅读器每 60 秒无感提示新内容，文章流全局时间序、小时级新鲜；热榜 30 分钟级；日报每天 09:03 自动生成且带 AI 评分/摘要；英文文章自动精翻。
- 管理后台 11 个 Tab 全部可用：加源/分组/批量管理/自动分类/日报栏目/报警渠道/数据清理，全部云端生效，15 分钟内反映到信息流。
- 任何一环停摆（采集停滞/源熔断/日报失败）→ webhook 主动报警到钉钉/Bark。

**数据流**：手机/桌面提交链接 → PHP 队列 → runner 拉取解析 → Turso；runner 每 15min 全量采集（cron-job.org 敲门，GH schedule 备份）→ Turso → Vercel 读层 → 浏览器轮询增量。

**本地角色**：抖音/B站重依赖采集 + 整库文件快照灾备 + 新功能开发沙箱，开发完成必须当日移植云端并实测。

---

## 4. 本次审计的根因（为什么文档/云端长期漂移）

1. **本地中心主义流程**：以往 agent 在本地开发→本地验证→结束，push 和云端验证不在验收标准里。
2. **多份事实拷贝**：调度频率/功能矩阵/测试数在 5-6 份文档各写一份，改一处必漂移。
3. **否定决策不落档**：云端"不做 XX"的决策（不做云端采集/不做 Vercel 前端）后来被推翻，但旧决策文档没有作废标注，新 agent 读到旧决策继续沿用。
4. **无真实环境验收环节**：没有任何文档要求"以线上实测为准"。

**强制约束已写入根目录 `AGENTS.md`**，后续所有 agent 必须遵守。
