> [已归档] 2026-09-09 — 知识库审计已完成的历史报告，修正已合入主代码

# 全网情报系统 · 知识库审计报告

> 审计日期：2026-09-06
> 审计范围：`.qoder/repowiki/`、`docs/`、`TOOLS.md`
> 基线：ARCHITECTURE.md（2026-09-05 晚间版）+ 实际代码库

---

## 一、审计发现总览

### 1.1 一致性验证结果

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 知识索引 `_index.yaml` | **已修正** | 原引用 30+ 个已归档文件，现更新为实际存在的根目录文件 |
| 根模块 `_module.yaml` | **已修正** | 同上 |
| DeepSeek API 卡片 | **已修正** | AI 子系统已下线，标记为「已下线」 |
| 构建系统卡片 | **已修正** | 移除 Docker/wechat-rss-plus 引用 |
| 依赖管理卡片 | **已修正** | 移除 pnpm/wechat-rss-plus/Python 引用 |
| Express 服务端卡片 | **已修正** | 补充 19 路由、classify.js、aihot/、TaskQueue |
| Web 前端卡片 | **已修正** | 补充 MyReadingPage、SourceLibraryTab、FilterPanel、ui/ |
| 运维工具卡片 | **已修正** | 移除不存在的脚本引用 |
| 业务术语表 | **已修正** | 移除「快速学习弹窗」，新增「源库管理」「我的阅读」 |
| 门户模块标题 | **已修正** | 标注「冻结态」 |
| 文档模块标题 | **已修正** | 更新为「项目文档、OPML 订阅源与配置」，补充 config/ |
| 分析模块 scope | **已修正** | `analysis/` → `archive/analysis/` |
| PROJECT_STATUS.md | **已修正** | 更新目录结构、测试数量（189）、修复历史 |
| RUNBOOK.md | **已修正** | 更新测试数量（189） |
| TOOLS.md | **已修正** | 从模板占位符替换为项目实际运维备忘 |

### 1.2 代码库 vs 文档对比

| 维度 | 实际代码 | 文档（修正前） | 文档（修正后） |
|------|----------|----------------|----------------|
| 路由文件数 | 19 个 | 17 个 | 19 个 ✓ |
| 前端页面数 | 5 个（含 MyReadingPage） | 4 个 | 5 个 ✓ |
| 测试数量 | 189 项 | 107 项（2026-09-04） | 189 项 ✓ |
| 服务模块 | 含 classify.js、aihot/、events.js、taskQueue.js | 部分缺失 | 完整 ✓ |
| 根目录 scope | 18 个实际文件 | 52 个（含 30+ 已归档） | 18 个 ✓ |

---

## 二、已执行的修正（共 15 项）

### 2.1 知识索引修正（3 项）

1. **`knowledge/zh/_index.yaml`**：
   - 移除 30+ 个已归档文件引用（如 `archive/docs-deprecated/A_CLASS_FIX_REPORT.md`、`spec-phase*.md`、`checklist-phase*.md` 等）
   - 补充当前实际文件（`.env`、`vercel.json`、`TOOLS.md`、`HEARTBEAT.md` 等）
   - 更新 `exported_at` 时间戳
   - 修正 `analysis_artifacts` scope 为 `archive/analysis/`
   - 更新 `docs_and_data` 标题和 scope（补充 `config/`）
   - 标注 portal 为「冻结态」

2. **根模块 `_module.yaml`**：同步更新 scope 列表

3. **子模块 `_module.yaml`**（3 个）：更新 portal/docs_and_data/analysis_artifacts 标题和 scope

### 2.2 知识卡片修正（7 项）

4. **DeepSeek API 卡片**：标记「已下线」，说明 summary.js 现仅保留 htmlToText()

5. **构建系统卡片**：
   - 移除 `_eval/wechat-rss-plus/` 所有引用（Dockerfile、docker-compose.yml、release.sh、pnpm-workspace.yaml）
   - 标题从「npm scripts + PM2 + Vite + Docker」改为「npm scripts + PM2 + Vite」
   - 补充 `web/vite.admin.config.js`
   - 更新测试数量为 189 项
   - 补充 CI/CD 说明（`.github/workflows/collect.yml`）

6. **依赖管理卡片**：
   - 移除 pnpm/wechat-rss-plus/Python 依赖引用
   - 标题从「npm/pnpm」改为「npm」
   - 简化为项目实际依赖

7. **Express 服务端卡片**：
   - 路由数从「每个文件」更新为「19 个文件」
   - 补充 auth.js、sourcelib.js、reading.js
   - 补充 classify.js、aihot/、taskQueue.js、events.js
   - 更新调度描述（scanAndEnqueue + TaskQueue）
   - 补充中间件注册顺序约束

8. **Web 前端卡片**：
   - 补充 MyReadingPage
   - 补充 SourceLibraryTab、FilterPanel、OverviewRail、LoginGate/LoginModal、BackfillPreviewModal
   - 补充 ui/ 子目录（TagPills/Stars/SourceAvatar/StatCard）
   - 更新 API 描述（自动注入 Bearer token、401 广播）
   - 补充设计 token 类说明

9. **运维工具卡片**：
   - 移除不存在的 `backfill-hotlist-24h.js`、`submit.ps1`、`.live-probe.cjs`、`.pw-phase*.cjs`
   - 补充实际存在的工具说明（sync-portal.js、export-portal.js、import-bestblogs-opml.js、audit-cloud.js）

10. **业务术语表**：
    - 移除「快速学习弹窗」（DeepSeek AI 速览已下线）
    - 新增「源库管理」术语
    - 新增「我的阅读」术语
    - 修正 AC12 验收描述（移除「AI 速览」）

### 2.3 项目文档修正（3 项）

11. **PROJECT_STATUS.md**：
    - 更新日期戳为 2026-09-06
    - 更新目录结构（19 路由、5 页面、ui/ 子目录、JWT 鉴权）
    - 更新测试数量为 189 项
    - 补充修复历史（Phase 6-9 重构、十期·源库+自动分类、知识库审计更新）

12. **RUNBOOK.md**：
    - 更新测试数量为 189 项

13. **TOOLS.md**：
    - 从模板占位符替换为项目实际运维备忘
    - 补充常用命令、运维脚本清单、关键配置位置、文档导航

### 2.4 Wiki 状态说明（1 项）

14. **`⚠️此WIKI已过期-请先读我.md`**：
    - 更新为「Wiki 状态说明（2026-09-06 更新）」
    - 列出本次审计修正的 10 项内容
    - 保留历史遗留提醒（AI 下线、we-mp-rss 退役、content/ 过时、部署方向变更）
    - 更新可信阅读顺序

---

## 三、风险评估

### 3.1 高风险（已修复）

| 风险 | 等级 | 状态 | 说明 |
|------|------|------|------|
| 知识索引引用已归档文件 | 高 | 已修复 | 30+ 个文件引用指向不存在的根目录路径 |
| DeepSeek API 卡片描述已下线功能 | 高 | 已修复 | 可能误导 Agent 调用不存在的 AI 接口 |
| 构建系统引用 Docker/wechat-rss-plus | 高 | 已修复 | 张冠李戴，本项目无 Dockerfile |
| 测试数量严重过时 | 中 | 已修复 | 107 → 189，影响验收判断 |

### 3.2 中风险（已修复）

| 风险 | 等级 | 状态 | 说明 |
|------|------|------|------|
| 路由数量不一致 | 中 | 已修复 | 17 → 19，遗漏 auth/sourcelib/reading |
| 前端页面缺失 | 中 | 已修复 | 缺少 MyReadingPage |
| 服务模块描述不完整 | 中 | 已修复 | 缺少 classify.js、aihot/、taskQueue.js |
| TOOLS.md 为模板占位符 | 中 | 已修复 | 无项目实际信息 |

### 3.3 低风险（已标记）

| 风险 | 等级 | 状态 | 说明 |
|------|------|------|------|
| content/ 树内容过时 | 低 | 已标记 | 行号引用过时，混入 wechat-rss-plus 内容 |
| 根目录 portal 构件残留 | 低 | 已标记 | ARCHITECTURE.md §2 已明确标注「不要使用/修改」 |

---

## 四、遗留问题与后续行动

### 4.1 建议后续行动

| 行动 | 优先级 | 说明 |
|------|--------|------|
| 清理根目录 portal 构件 | P2 | `api/`、`src-admin/`、`admin.html`、`vercel.json`、`vite.config.js`、`vite.admin.config.js`、`copy-routes.js` 是历史副本，待清理 |
| 更新 content/ 树 | P3 | 7 篇内容文档仍有过时行号引用和 wechat-rss-plus 混入，建议重新生成或手动更新 |
| 补充 Phase 6-9 功能文档 | P3 | `docs/features/` 缺少 sourcelib、classify、reading 等新功能的独立文档 |
| 归档 trash/ 中退役代码 | P4 | we-mp-rss 退役代码已在 trash/，可考虑定期清理 |

### 4.2 已确认的已知坑（无需行动）

以下问题已在 ARCHITECTURE.md §5 中记录，本次审计确认仍然有效：
- better-sqlite3 编号参数不支持位置绑定
- 异步回调内同步 DB 操作必须 try/catch
- pending_items 表只有 6 列
- 调度器串行是有意的
- mmbiz.qpic.cn 图片防盗链
- 云端/本地采集语义漂移
- aggregator 是 extra 标志不是 type 取值
- cron 任务必须模块级句柄管理
- focus 有两种写法
- 回归测试必须驱动真实路由

---

## 五、审计结论

本次审计共发现 **15 项不一致/过时问题**，全部已修正。知识库（`knowledge/` 树）现已与代码库状态一致。`content/` 树仍有部分过时内容，已在 Wiki 状态说明中标记。

**当前系统状态快照**：
- 测试：**189 项全绿**（2026-09-06）
- 路由：19 个 API 路由文件
- 前端页面：5 个（reader/daily/hot/my-reading/admin）
- 服务模块：完整（collectors/ai/aihot/events/classify/hot/queue/scheduler/alerts/backup/datamgr）
- 部署方向：宝塔/自有服务器全量部署，Vercel portal 冻结态

---

*报告生成时间：2026-09-06 10:30*
*审计工具：repowiki 知识卡片 + 代码库交叉验证*
