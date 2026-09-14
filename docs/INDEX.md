# 全网情报系统 · 文档索引

> 所有有效文档的路径与用途速查。供 Agent 和开发者快速定位上下文。
> 最后更新：2026-09-15（ISSUES 二次大清洗：09-13~14 完成批全量入 deprecated/ISSUES-resolved-2026-09-14.md；热点榜三阶段/媒体治理/quickscore 落档）

---

## 阅读顺序（固定）

1. **接手必读**：`docs/CLOUD_PIPELINE_GUIDE.md`（实时链路+不变量）→ `AGENTS.md`（强制约束）→ `ARCHITECTURE.md`
2. **当前状态**：`docs/FEATURE_MATRIX.md`（功能 SSOT）→ `docs/ISSUES.md`（活跃问题）→ `docs/NEXT-DEV-REQS.md`（T3 需求）
3. **排障**：`docs/RUNBOOK.md` → `docs/pitfalls/`（踩坑库，按域单文件，30+ 条含症状/根因/规则）
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
| `docs/ISSUES.md` | **活跃问题清单**（只保留未修复/观察中/挂案；已核销历史见 `docs/deprecated/ISSUES-resolved-2026-09-13.md` 与 `ISSUES-resolved-2026-09-14.md`） |
| `docs/DELIVERY-2026-09-14.md` | **交付文档**（09-13~14 全量：最近修改/出错问题/未来计划/文件索引/热点榜二阶段） |
| `docs/NEXT-DEV-REQS.md` | **需求队列**：T3/T4/T5-1/14/16/4 已核销；当前活跃 = T5 剩余项（T5-2 信息架构重构 / T5-3 AI 分领域栏目 / 小组件打包） |
| `docs/pitfalls/` | **踩坑库**（2026-09-13 起）：按域单文件（collection/backend/ai/frontend/deployment/testing），每条含症状/根因/规则/案例，换手必读；ARCHITECTURE §5 只留索引 |
| `docs/DELIVERY_VERIFICATION.md` | 交付验证手册（线上实测流程，代理 127.0.0.1:12000） |
| `docs/DEV_GUIDE.md` | 开发者上手指南 |
| `docs/DEVELOPMENT_STANDARDS.md` | 开发规范与验收标准 |
| `docs/ROADMAP-2026-09.md` | 需求与愿景母文档（用户已拍板决策） |
| `docs/RUNBOOK.md` | 运维手册 |
| `docs/HANDOFF_PROMPT.md` | 新窗口接手提示词 |
| `docs/BESTBLOGS_BORROW.md` | BestBlogs 范式借鉴清单（T3-1 主题全景的需求源头） |
| `docs/deprecated/AUDIT-2026-09-12.md` | [已归档] 09-11~12 交叉审核报告 |
| `docs/deprecated/REFACTOR_GUIDE.md` | [已归档] Phase 1-5 重构记录 |
| `docs/ANDROID_SUBMIT_GUIDE.md` / `docs/X_SETUP_GUIDE.md` | 平台指南 |

## 功能文档（docs/features/）· 决策 Spec（docs/specs/）

- `docs/features/`：collectors / scheduler / task-queue / daily-report / events-alerts / source-library-autoclassify / my-reading（语义权威，长生命周期）
- `docs/specs/`：03 / 05 / 09 / 12（总 spec）+ 13~21 已交付（四件套含验收证据）+ **22 采集路线 RSS 优先决策 / 23 信息过载与茧房防御七层设计 / 24 周刊 v2 杂志型**（2026-09-13）；新项动工前按 mew-spec 建四件套

## 归档（docs/deprecated/ 与 docs/changes/archive/）

漂移/过时/已完结文档统一入档并加头注指向现役文档，包括 2026-09-13 新归档的：
`ISSUES-resolved-2026-09-13.md`（旧问题清单全文）、`ISSUES-resolved-2026-09-14.md`（09-13~09-15 已核销全量：热点榜三阶段/媒体治理/头像回填/精选断更根治）、`changes/archive/2026-09-13-delivery-emergency-fixes.md`（原根目录 DELIVERY 文档）。
