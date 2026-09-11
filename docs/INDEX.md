# 全网情报系统 · 文档索引

> 所有有效文档的路径与用途速查。供 Agent 和开发者快速定位上下文。
> 最后更新：2026-09-11（真实环境基准修正：新增 FEATURE_MATRIX，PROJECT_STATUS 等 5 篇归档）

---

## 根目录核心文档

| 文件 | 用途 |
|------|------|
| `ARCHITECTURE.md` | **架构移交文档**（必读）：Vercel 读层 + GH Actions runner 直采架构、数据通路、凭据位置、已知坑、协作规则 |
| `README.md` | 项目 README：快速上手、目录结构、文档导航 |
| `AGENTS.md` | Agent 通用工程规约：会话启动流程、代码规范、工具使用约束 |

## 变更记录（docs/changes/）

| 文件 | 用途 |
|------|------|
| `docs/changes/2026-09-11-runner-direct-collect.md` | **方案A**：云端采集移入 GH Actions runner 直写 Turso（根治网页不自动更新），含根因链/验证数据/遗留事项 |

## 开发文档（docs/）

| 文件 | 用途 |
|------|------|
| `docs/INDEX.md` | **本文档**：文档索引与导航 |
| `docs/CLOUD_PIPELINE_GUIDE.md` | **云端实时信息流交付文档**（接手必读 P0）：GH Actions 管线地图、不可破坏的不变量、改动检查清单、故障决策树 |
| `docs/HANDOVER.md` | **交接/对接文档**：Vercel/Turso/Secrets 配置、API 列表、运维命令 ⚠️ 含敏感凭据，已 gitignore 勿提交 |
| `docs/DELIVERY_VERIFICATION.md` | **交付验证手册**（线上验证必读）：生产环境验证全流程——推送/触发/三端联验/网络限制解法/标准验证剧本 |
| `docs/DEV_GUIDE.md` | **开发者上手指南**（新开发者必读）：部署架构、目录结构、快速上手 Checklist |
| `docs/DEVELOPMENT_STANDARDS.md` | **开发规范与验收标准**：代码规范、双端同步规则、测试要求、PR Checklist |
| `docs/ISSUES.md` | **已知问题清单**（活文档）：P0-P3 分级，含修复记录 |
| `docs/FEATURE_MATRIX.md` | **功能矩阵 SSOT**（唯一权威）：本地 Express vs 云端（Vercel qwis-intel）功能覆盖矩阵、迁移路径、待开发目标；其它文档不再维护矩阵一律指向本文 |
| `docs/RUNBOOK.md` | 运维手册：启动/重启/备份/恢复/Vercel 运维/排障 |
| `docs/REFACTOR_GUIDE.md` | [历史文档] Phase 1-5 重构迁移记录 |
| `docs/ANDROID_SUBMIT_GUIDE.md` | 安卓端提交协议：HTTP Shortcuts 配置规范 |
| `docs/X_SETUP_GUIDE.md` | X/Twitter 接入指南：RSSHub 配置 |

## 功能文档（docs/features/）

| 文件 | 用途 |
|------|------|
| `docs/features/collectors.md` | 采集层架构：适配器契约、注册表、数据仓储、抓取编排、并发防护 |
| `docs/features/scheduler.md` | 调度引擎：tick/scanAndEnqueue 流程、jobs/ 子模块、生命周期 |
| `docs/features/task-queue.md` | SQLite 任务队列：表结构、TaskQueue API、优先级/去重/崩溃恢复 |
| `docs/features/daily-report.md` | 日报引擎：候选筛选、分栏分类、去重限流、AI 降级、出库安检 |
| `docs/features/events-alerts.md` | 事件聚合与报警：纯函数引擎、报警渠道、冷却机制、阈值升级 |
| `docs/features/source-library-autoclassify.md` | 源库管理与自动分类：统一源列表、批量操作、8 类分类目录、OPML 层级解析、破茧栏联动 |
| `docs/features/my-reading.md` | 我的阅读沉淀页：已读+稍后读+收藏聚合、批量操作、Markdown 导出 |

## 决策 Spec（docs/specs/）

| 文件 | 类型 | 内容 |
|------|------|------|
| `docs/specs/03-公众号走托管RSS决策.md` | 已确定 | 公众号走 wechat2rss 托管 RSS |
| `docs/specs/05-任务队列选型决策.md` | 已确定 | SQLite-backed TaskQueue |
| `docs/specs/09-source-library-autoclassify/` | 已实现 | 十期·源库管理+自动分类（2026-09-05 验收通过） |
| `docs/specs/10-my-reading/` | 待审批 | 我的阅读沉淀页 |
| `docs/specs/11-advanced-filter-views/` | 待审批 | 阅读器高级筛选+保存视图 |

## 归档文档（docs/deprecated/）

历史文档归档，仅供参考，不代表当前系统状态：

| 文件 | 归档原因 |
|------|---------|
| `docs/deprecated/PROJECT_STATUS.md` | 与 README 重复约 70% 且大面积过时（漂移严重，违反唯一事实源原则） |
| `docs/deprecated/MODULE_STATUS.md` | 矩阵数据错误（漂移严重，违反唯一事实源原则）；功能矩阵 SSOT 移至 `docs/FEATURE_MATRIX.md` |
| `docs/deprecated/TOOLS.md` | 运维内容已并入 `docs/RUNBOOK.md`（漂移严重，违反唯一事实源原则） |
| `docs/deprecated/HEARTBEAT.md` | 与项目无关的空模板 |
| `docs/deprecated/AGENTS-generic-template.md` | 通用助手模板，项目专用规则见根目录新 `AGENTS.md` |
| `docs/deprecated/IDENTITY.md` | 空模板，从未填写 |
| `docs/deprecated/USER.md` | 空模板，从未填写 |
| `docs/deprecated/SOUL.md` | 通用 Agent 人格模板，无实质内容 |
| `docs/deprecated/PHASE6_REVIEW_REPORT.md` | 已完成的历史审查报告 |
| `docs/deprecated/REPOWIKI_AUDIT_2026-09-06.md` | 已完成的知识库审计 |
| `docs/deprecated/1.CODE_REVIEW_2026-09-05.md` | 已完成的代码审查 |
| `docs/deprecated/VERCEL_MIGRATION.md` | 迁移方向与当前部署矛盾 |
| `docs/deprecated/01-部署架构决策.md` | 已被"Vercel 为主"取代 |
| `docs/deprecated/02-不做云端采集决策.md` | 云端采集现已启用 |
| `docs/deprecated/04-不做Vercel前端决策.md` | Vercel 已解冻进入正式开发 |

## 推荐阅读顺序

1. **新接手**：`docs/CLOUD_PIPELINE_GUIDE.md`（实时链路必读）→ `docs/DEV_GUIDE.md` → `ARCHITECTURE.md` → `docs/DEVELOPMENT_STANDARDS.md`
2. **了解当前状态**：`docs/FEATURE_MATRIX.md`（功能矩阵 SSOT）→ `docs/ISSUES.md`
3. **排障**：`docs/RUNBOOK.md` → `ARCHITECTURE.md` 已知坑
4. **了解决策背景**：`docs/specs/` 按编号顺序阅读
5. **历史重构**：`docs/REFACTOR_GUIDE.md`（标注为历史文档）
