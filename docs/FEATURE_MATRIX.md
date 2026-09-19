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
| `npm test` | `tests/*.test.js`（node:test，`--test-concurrency=1`） | 回归网：每条线上修过的 bug 都要有锁 | ✅ 417 条 / 0 红 / 0 跳过（约 94s；**B83 已收口——七份"直打生产 Turso"的回归测试全部搬到本地文件库**，不再有分钟级缓存轮询，也不再往生产数据层写东西） |
| `node smoke-test.js` | `smoke-test.js` | 生产库副本冒烟 + 自带对抗性段（超长 URL/特殊字符/空内容/并发/错误边界） | ✅ 20/20，零副作用 |
| `npm run build:vercel` | Vite + `api/` | 云端构建面 | ✅ 通过 |
| `npm run lint:docs` | `tools/doc-lint.cjs` | 文档门禁六条（头注/悬空/INDEX/归档头/超长/明文密钥） | ✅ 0 错（`docs/eval/` 机器产物不参与悬空扫描） |
| `npm run eval:preflight` | `tools/eval-preflight.cjs` + `lib/cloud-site.js` + `lib/alert-channels.js` | 环境前置：代理 / **线上 commit==origin/main** / Turso / 隔离 / BL7~BL9 配置真值 | ⛔ 6/9（红=BL7 两条 + BL8，均为待授权，非环境问题） |
| `npm run eval:whitebox` | `tools/eval-whitebox.cjs` | 三端一致性 W1~W13（含 W3b 假开关、W9 坑↔锁对账、W10 重复判定、W11 入口 Provider 完整性、W12 媒体栏字段对账、**W13 日报栏目表只许一份**） | ✅ 全过（W12/W13 都做过负向验证：摘掉一处 `source_avatar` 即红并点名行号；塞一份探针栏目表即红并点名文件） |
| `npm run eval:process` | `tools/eval-process-checks.cjs` | 过程性二值检查（截图/报告/断言数/三类覆盖/占位文案/证据路径/退出码/参数出处） | ✅ 8/8（F8＝§3.3 三类断言各 ≥1，09-19 夜加） |
| `npm run eval:f2p` | `tools/eval-f2p.cjs` | 「改前红/改后绿」取证：`--auto-base` 反查基线、自建 worktree、红因分环境/产品，证据落 `docs/eval/f2p/` | ✅ 自检 24 项；b~f + g 六个锁文件已出证 |
| `npm run eval:content` | `tools/eval-content.cjs` → `tools/eval-content/*.py` | 41-8 内容质量五维 judge（LLM 分只作趋势与复核触发，不作门禁） | ✅ 已交付；真评需 `--judge`（花配额）+ `--align`（≥3 条产物） |
| `npm run eval:e2e` | `tools/eval-e2e.cjs`（Playwright） | **41-2 端到端评测**：10 条剧本覆盖 6 个前台页 + 后台登录门，DOM ↔ 页面自己发出的响应对账，默认线上、每剧本连跑 3 次 | ✅ **最新验收轮已过：10/10 ×3 全绿**（线上 `aec9bb7`，证据 `docs/eval/e2e/20260919T123438/`，`acceptance.ok=true`、产品红 0/环境红 0/flaky 0、`knownGaps=[]`、`uncoveredKinds=[]`；`eval:process` 自检 8/8）。本轮同时给出 B85/B84 的线上几何读数：`rows=37 maxH=129 minTitleW=160`、`800px 溢出 0/37 ; 1024px 溢出 0/37`、`mediaCards DOM=10 API=10 art=10 emoji=0`。**验收轮口径（EVAL_GUIDE §3.7）**：全剧本 × ≥3 轮 × 真实云端才允许 exit 0，`--only`/`--fast`/本地目标一律打 `NOT_ACCEPTANCE` 退 2——跑过 ≠ 验收过。**未覆盖**：后台 8 板块的写回闭环剧本（需登录态，我不代你登录）→ 那部分仍记为未验收 |
| `node tools/audit-cloud.js` | 同名 | 云端 19 端点只读巡检（判据：只有 `true` 算通过，未验收单列，有失败退 1） | ✅ 18 通过 / 0 失败 / 1 未验收 |

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
