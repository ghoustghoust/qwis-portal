# 全网情报系统 · 文档索引

> 所有有效文档的路径与用途速查。供 Agent 和开发者快速定位上下文。
> 最后更新：2026-09-13 晚（文档大整理：changes 归档制、ISSUES 大清洗、T3 需求定稿、根目录文档去历史堆积）

---

## 阅读顺序（固定）

1. **接手必读**：`docs/CLOUD_PIPELINE_GUIDE.md`（实时链路+不变量）→ `AGENTS.md`（强制约束）→ `ARCHITECTURE.md`
2. **当前状态**：`docs/FEATURE_MATRIX.md`（功能 SSOT）→ `docs/ISSUES.md`（活跃问题）→ `docs/NEXT-DEV-REQS.md`（T3 需求）
3. **排障**：`docs/RUNBOOK.md` → `ARCHITECTURE.md` §5 已知坑（28 条）
4. **凭据**：`docs/HANDOVER.md`（⚠️ 含密钥，本地文件，永不提交）

## 根目录核心文档

| 文件 | 用途 |
|------|------|
| `AGENTS.md` | 项目专用 Agent 强制约束：三端心智模型 + 7 条不可协商规则 |
| `ARCHITECTURE.md` | 架构决策 + 28 条已知坑（§8 历史纪要已收敛为速览+归档指针） |
| `README.md` | 快速上手、目录结构 |

## 变更记录（docs/changes/，活跃层只保留未收敛文档）

| 文件 | 用途 |
|---|---|
| `docs/changes/2026-09-11-runner-direct-collect.md` | **方案A**：云端采集移入 GH runner 直写 Turso（P0 必读，根因链全在里头） |
| `docs/changes/2026-09-13-reader-pagination-and-content-fixes.md` | **09-13 交付全记录**：游标分页断裂/翻译思维链污染/未来pubDate/导航/周刊归档 + 测试隔离事故复盘 + 验证任务执行记录 |
| `docs/changes/archive/` | **已完结变更归档**（09-11 settings-write、09-12 cloud-alerts/my-brief/sources-write、09-13 交付文档）：读 `docs/FEATURE_MATRIX.md` 即可，不再逐篇维护 |

## 开发文档（docs/）

| 文件 | 用途 |
|------|------|
| `docs/INDEX.md` | 本文档 |
| `docs/CLOUD_PIPELINE_GUIDE.md` | 云端实时链路 P0 必读（管线地图/不变量/故障决策树） |
| `docs/FEATURE_MATRIX.md` | **功能矩阵 SSOT**（唯一权威，其它文档不再维护矩阵） |
| `docs/ISSUES.md` | **活跃问题清单**（2026-09-13 大清洗后只留 4 bug + 6 挂案；已核销历史见 `docs/deprecated/ISSUES-resolved-2026-09-13.md`） |
| `docs/NEXT-DEV-REQS.md` | **T3 系列需求**（2026-09-13 定稿）：早报体系 v3 / 管理台早报中心 / 读层性能 / 入早报来源榜；T2 存档在文末 |
| `docs/DELIVERY_VERIFICATION.md` | 交付验证手册（线上实测流程，代理 127.0.0.1:12000） |
| `docs/DEV_GUIDE.md` | 开发者上手指南 |
| `docs/DEVELOPMENT_STANDARDS.md` | 开发规范与验收标准 |
| `docs/ROADMAP-2026-09.md` | 需求与愿景母文档（用户已拍板决策） |
| `docs/RUNBOOK.md` | 运维手册 |
| `docs/HANDOFF_PROMPT.md` | 新窗口接手提示词 |
| `docs/BESTBLOGS_BORROW.md` | BestBlogs 范式借鉴清单（T3-1 主题全景的需求源头） |
| `docs/AUDIT-2026-09-12.md` | 09-11~12 交叉审核报告（历史审阅入口） |
| `docs/REFACTOR_GUIDE.md` | [历史] Phase 1-5 重构记录 |
| `docs/ANDROID_SUBMIT_GUIDE.md` / `docs/X_SETUP_GUIDE.md` | 平台指南 |

## 功能文档（docs/features/）· 决策 Spec（docs/specs/）

- `docs/features/`：collectors / scheduler / task-queue / daily-report / events-alerts / source-library-autoclassify / my-reading（语义权威，长生命周期）
- `docs/specs/`：03 / 05 / 09 / 12（总 spec）+ **13~21 全部已交付**（四件套含验收证据）；新 T3 项动工前按 mew-spec 建四件套

## 归档（docs/deprecated/ 与 docs/changes/archive/）

漂移/过时/已完结文档统一入档并加头注指向现役文档，包括 2026-09-13 新归档的：
`ISSUES-resolved-2026-09-13.md`（旧问题清单 242 行全文）、`changes/archive/2026-09-13-delivery-emergency-fixes.md`（原根目录 DELIVERY 文档，已并入 09-13 交付记录）。
