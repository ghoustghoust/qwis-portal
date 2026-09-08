# 全网情报系统 · 文档索引

> 所有有效文档的路径与用途速查。供 Agent 和开发者快速定位上下文。
> 最后更新：2026-09-06

---

## 根目录核心文档

| 文件 | 用途 |
|------|------|
| `ARCHITECTURE.md` | **架构移交文档**（必读）：系统全景、数据通路、凭据位置、已知坑、协作规则、模块架构图 |
| `AGENTS.md` | Agent 通用工程规约：会话启动流程、代码规范、工具使用约束 |

## 项目文档（docs/）

| 文件 | 用途 |
|------|------|
| `docs/INDEX.md` | **本文档**：文档索引与导航 |
| `docs/PROJECT_STATUS.md` | 项目状态说明：架构概览、功能清单、部署方式、已知限制、快速上手 |
| `docs/RUNBOOK.md` | 运维手册：启动/重启/备份/恢复/排障操作手册 |
| `docs/REFACTOR_GUIDE.md` | 架构重构迁移指南：文件拆分映射表 + import 路径变更 |
| `docs/ANDROID_SUBMIT_GUIDE.md` | 安卓端提交协议：HTTP Shortcuts 配置规范 |
| `docs/X_SETUP_GUIDE.md` | X/Twitter 接入指南：RSSHub 配置 |
| `docs/PHASE6_REVIEW_REPORT.md` | Phase 6 对抗性审查报告：故障场景验证结果 |

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
| `docs/specs/01-部署架构决策.md` | 已确定 | 宝塔/自有服务器全量部署 |
| `docs/specs/02-不做云端采集决策.md` | 不做 | 云端不跑采集函数 |
| `docs/specs/03-公众号走托管RSS决策.md` | 已确定 | 公众号走 wechat2rss 托管 RSS |
| `docs/specs/04-不做Vercel前端决策.md` | 不做 | Vercel portal 冻结态 |
| `docs/specs/05-任务队列选型决策.md` | 已确定 | SQLite-backed TaskQueue |
| `docs/specs/09-source-library-autoclassify/` | 已实现 | 十期·源库管理+自动分类（spec/plan/task/checklist 四件套，2026-09-05 验收通过） |
| `docs/specs/10-my-reading/` | 待审批 | 我的阅读沉淀页（样图 4.png，spec 已起草） |
| `docs/specs/11-advanced-filter-views/` | 待审批 | 阅读器高级筛选+保存视图（样图 3.png/2.png，spec 已起草） |

## 归档文档（archive/docs-deprecated/）

历史文档归档，仅供参考，不代表当前系统状态：

| 文件 | 说明 |
|------|------|
| `archive/docs-deprecated/A_CLASS_FIX_REPORT.md` | 2026-09-04 A 类硬伤修复报告（12 项 + 8 项对抗性审查） |
| `archive/docs-deprecated/DEPLOYMENT.md` | 旧部署指南（已被 ARCHITECTURE.md 取代） |
| `archive/docs-deprecated/EMERGENCY_RECOVERY_GUIDE.md` | 旧紧急恢复指南 |
| `archive/docs-deprecated/phase9-runbook.md` | 旧九期运维手册（已被 docs/RUNBOOK.md 取代） |

## 推荐阅读顺序

1. **新接手**：`ARCHITECTURE.md` → `docs/PROJECT_STATUS.md` → `docs/RUNBOOK.md`
2. **重构后接手**：`docs/REFACTOR_GUIDE.md` → `docs/features/` 各模块文档
3. **了解决策背景**：`docs/specs/` 按编号顺序阅读
4. **排障**：`docs/RUNBOOK.md` → `ARCHITECTURE.md` 第 5 节（已知坑）
