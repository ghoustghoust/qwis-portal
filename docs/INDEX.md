# 全网情报系统 · 文档索引

> 所有有效文档的路径与用途速查，供 Agent 和开发者快速定位上下文。
> **本文件是全量地图**：`docs/` 下任何 `.md`/`.json` 未在此登记即为失踪文档（`tools/doc-lint.cjs` 会报）。
> 文档自身的清洁与归档规则 → `docs/DOC_GOVERNANCE.md`。
> 最后更新：2026-09-18（文档清洁轮：重建全量索引、补 `archive/` 分类层、DELIVERY 流水下沉）

---

## 阅读顺序（固定）

1. **接手必读**：`docs/CLOUD_PIPELINE_GUIDE.md`（实时链路+不变量）→ `AGENTS.md`（强制约束）→ `ARCHITECTURE.md`
2. **当前状态**：`docs/FEATURE_MATRIX.md`（功能 SSOT）→ `docs/ISSUES.md`（活跃问题）→ `docs/NEXT-DEV-REQS.md`（需求队列）
3. **排障**：`docs/RUNBOOK.md` → `docs/pitfalls/`（踩坑库）→ `docs/archive/README.md`（反向索引：按症状查历史）
4. **凭据**：`docs/HANDOVER.md`（⚠️ 含密钥，本地文件，永不提交）
5. **交付末尾**：按 `docs/DOC_GOVERNANCE.md` §3 做清洁与归档

新窗口接手直接把 `docs/HANDOFF_PROMPT.md` 整段复制给 Agent。

## 根目录核心文档（3 份，不再增）

| 文件 | 用途 |
|------|------|
| `AGENTS.md` | 项目专用 Agent 强制约束：三端心智模型 + 7 条不可协商规则 |
| `ARCHITECTURE.md` | 架构决策 + 已知坑索引（条数以 `docs/pitfalls/` 为准，不写死） |
| `README.md` | 快速上手、目录结构 |

## docs/ 顶层：底层文档白名单

白名单由 `docs/DOC_GOVERNANCE.md` §2.1 定义，本表是它的镜像。新增文件进顶层必须先进白名单。

| 文件 | 用途 |
|---|---|
| `INDEX.md` | 本文档（地图） |
| `DOC_GOVERNANCE.md` | **文档清洁与归档规范**（六类分类 + SOP + 门禁） |
| `CLOUD_PIPELINE_GUIDE.md` | 云端实时链路 P0 必读（管线地图/不变量/故障决策树） |
| `FEATURE_MATRIX.md` | **功能矩阵 SSOT**（本地/云端/runner 三端能力矩阵） |
| `ISSUES.md` | **活跃问题 SSOT**（活跃 bug / 观察中 / 挂案；已核销见 `deprecated/`、`archive/debugging/`） |
| `NEXT-DEV-REQS.md` | **需求队列 SSOT**（T 系列，未开工/在途） |
| `RUNBOOK.md` | 运维手册（本地/宝塔/云端排障） |
| `DELIVERY_VERIFICATION.md` | 交付验证手册（线上实测流程，代理 `127.0.0.1:12000`） |
| `EVAL_GUIDE.md` | **评测规范 SSOT**：端到端（环境前置/剧本/三类断言/四分类/flaky/性能预算/**过程性二值检查**）+ 白盒（W1~W9 不变量）+ **内容质量（LLM-as-a-Judge 五维加权）** + F2P-P2P 改前必红 + 去污染四条 + 门禁产物。AGENTS §3 第 4 层 |
| `DEVELOPMENT_STANDARDS.md` | 开发规范与验收标准 |
| `DEV_GUIDE.md` | 开发者上手指南 |
| `ROADMAP-2026-09.md` | 需求与愿景母文档（用户已拍板决策，只留决策） |
| `HANDOVER.md` | 凭据位置 + 端点清单（本地，含密钥） |
| `HANDOFF_PROMPT.md` | 新窗口接手提示词（只指路，不复述进度） |
| `ANDROID_SUBMIT_GUIDE.md` | 对接·现役：安卓 HTTP Shortcuts 提交链路（`tools/setup-customer.js` 指名引用） |
| `X_SETUP_GUIDE.md` | 对接·现役：RSSHub 自建 + X cookie 配置 |
| `BESTBLOGS_BORROW.md` | BestBlogs 范式借鉴清单（T3 需求源头；T3 收尾后下沉 `archive/feature/`） |

## 变更记录（docs/changes/）

| 文件 | 用途 |
|---|---|
| `changes/2026-09-11-runner-direct-collect.md` | **方案A**：云端采集移入 GH runner 直写 Turso（P0 必读，根因链全在里头；文中「每 30min」已被 09-11 后续加密为 15min，以 `collect.yml` 为准） |
| `changes/archive/` | 已完结变更归档（09-11 settings-write、09-12 cloud-alerts / my-brief / sources-write、09-13 delivery-emergency-fixes）：读 `FEATURE_MATRIX.md` 即可，不逐篇维护 |

## 踩坑库（docs/pitfalls/）· 语义权威，只累积不归档

每条含症状/根因/规则/案例；换手必读。域文件与编号索引见 `pitfalls/README.md`，`ARCHITECTURE.md` §5 只留同一张表的镜像。

| 域文件 | 覆盖 |
|---|---|
| `pitfalls/collection.md` | #4 #6 #7 #9 #19 #28 #29 #30 |
| `pitfalls/backend.md` | #10 #11 #12 #14 #15 #16b #17 #23 #25 #31 #33 |
| `pitfalls/ai.md` | #8 #24 #26 #32 #34 #A1 #A2 |
| `pitfalls/frontend.md` | #1 #2 #16 #F1 |
| `pitfalls/deployment.md` | #5 #20 #21 #22 #D1 #D2 |
| `pitfalls/testing.md` | #13 #18 #27 #T1 |

## 功能文档（docs/features/）· 模块干什么（长生命周期）

`collectors.md`（采集器与信源）· `scheduler.md`（本地调度器）· `task-queue.md`（SQLite 队列）· `daily-report.md`（日报）· `events-alerts.md`（事件与报警）· `source-library-autoclassify.md`（源库与自动分类）· `my-reading.md`（我的阅读）

## 决策 Spec（docs/specs/）

- **单文件决策**：`03-公众号走托管RSS决策.md`、`05-任务队列选型决策.md`、`22-rss-first-collection-decision.md`、`23-information-overload-defense.md`、`24-weekly-v2-magazine.md`、`25-hot-redesign.md`、`26-platform-ia-refactor.md`、`P1-12-401-handling-fix.md`
- **四件套齐**（spec/plan/task/checklist）：`09` `11` `13`~`21`
- **只有 spec.md**（2026-09-18 清洁核实，别再声称四件套完成）：`10-my-reading`、`12-roadmap-2026`、`27-reader-today`、`27b-source-axes`、`28-hot-redesign`、`29-source-groups`、`30-admin-consolidation`、`31-media-playback`、`32-content-typography`、`33-misc-fixes`、`34-misc-fixes`
- **在途/待批（2026-09-19 批注轮，全部未动工）**：
  `35-selfheal-admin-console/`（自愈引擎 + 源健康度窗口 + 彩色百分比；其 35D 已移交 38）、
  `36-reading-semantics/`（未知日期/类型筛选/足迹口径/阅读器性能）、
  `37-alerts-observability/`（报警链路恢复 + 结构化事件 + CI 可观测）、
  `38-admin-ia-refactor/`（后台信息架构与功能隔离，取代 35D）、
  `39-ai-console/`（AI 能力台：env-only 裁决、假开关清除、模型枚举与耗时）、
  `40-brief-center-products/`（三报统一期/档位/历史 + 归档投影 + 脏数据订正）、
  `41-e2e-whitebox-eval/`（端到端 + 白盒评测与去污染，验收流程升级）

## 接口契约（docs/contracts/）· 读层响应形状，改 API 必须同步

`articles-list.json` · `articles-since.json` · `daily-report.json` · `hot-items.json` · `sources-list.json`

## 截图（docs/screenshots/）· 前端改版的视觉基线

`01-reader-page` `02-daily-page` `03-hot-page` `03b-hot-realtime` `04-admin-page` `05-queue-panel` `05-videos-page` `06-reader-full` `07-admin-brief-center` `08-admin-system` `09-mybrief-page` `10-weekly-page` `11-hot-events` `12-reading-page`（.png）

## 归档层

- **`docs/archive/`（分类归档，规则见 GOVERNANCE §2.3）**：`README.md`（反向索引）· `debugging/2026-09-13-reader-pagination-and-content-fixes.md` · `debugging/2026-09-14-delivery.md`；`feature/` `optimization/` `integration/` `credentials/` 待用
- **`docs/deprecated/`（整篇作废，头注含替代指针）**：`ISSUES-resolved-2026-09-13.md` · `ISSUES-resolved-2026-09-14.md` · `AUDIT-2026-09-12.md` · `REFACTOR_GUIDE.md` · `MODULE_STATUS.md` · `PROJECT_STATUS.md` · `VERCEL_MIGRATION.md` · `PHASE6_REVIEW_REPORT.md` · `REPOWIKI_AUDIT_2026-09-06.md` · `1.CODE_REVIEW_2026-09-05.md` · `01/02/04` 三条已作废决策 · `AGENTS-generic-template.md` · `HEARTBEAT.md` `IDENTITY.md` `SOUL.md` `TOOLS.md` `USER.md`（早期 Agent 模板残留）
- **仓库根 `archive/`**：`docs-deprecated/`（DEPLOYMENT、phase9-runbook、A_CLASS_FIX_REPORT 等历史件）+ 分析产物/样例/评测素材

## 重复文档树（⚠️ 不是权威）

`portal/` 是独立 git 仓库（根以 gitlink 引用，无 `.gitmodules`，见 `ISSUES.md` H9），内含一份**过时的 `docs/` 副本**。任何修订只落根树；`tools/sync-portal.js`、`sync-portal.bat` 不许再用来同步文档。
