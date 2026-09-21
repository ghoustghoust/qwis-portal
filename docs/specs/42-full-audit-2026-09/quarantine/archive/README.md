# `archive/` — 历史归档

本目录存放**已不再演进**的历史资产，只作参考，**不作为现状依据**。查现状请去：功能看 `docs/FEATURE_MATRIX.md`、未决问题看 `docs/ISSUES.md`、运维链路看 `docs/RUNBOOK.md`、现役规格看 `docs/specs/`。

处置规则见 `docs/DOC_GOVERNANCE.md` §2.3（六类归档）与 §2.4（归档头注五字段）。本目录**只进不出**：往里搬东西要按 §3 SOP 登记依赖，删这里的东西需单独授权。

## 内容

| 内容 | 说明 |
|---|---|
| `_eval/` | 外部引擎快照 `wechat-rss-plus`，**947 MB**，是裸 gitlink（`160000 commit 87cf9e3`）且仓库**无 `.gitmodules`** → 删了 `git` 救不回来。公众号采集路线已改，此件生死未拍板。**不要在这里改代码**：它不在任何运行链路上，改了不生效 |
| `analysis/` | 早期开发期分析产物与截图，**96 MB**。其中 `frames/`（60 MB）+ `keyframes/`（27 MB）是视频逐帧中间产物，占本目录 87 MB，可再生；`ai hot/`（1.1 MB）是 AI 热点截图，拟并入 `样图/`——目录名带空格，是路径引用的长期隐患 |
| `样图/` | UI 参考样图（9 件），**仍有借鉴价值**：周报页设计样例、热点榜样式对照。本轮审计新发现的 `周报页设计/`、`热点榜/` 两份样例也在这里 |
| `reports/` | 历史审计报告（18 件，含 `ARCHITECTURE_AUDIT_REPORT.md`、`FINAL_FIX_REPORT.md`、`SMOKE_TEST_REPORT.md`）。结论多已被后续 5 轮重构推翻，读之前先对 `docs/ISSUES.md` 校时效 |
| `specs/` | 早期 phase 规格四件套（`plan-phase*.md` / `task-phase*.md` / `checklist.md`）。现役 spec 在 `docs/specs/`，编号 10~42 |
| `docs-deprecated/` | 整篇作废的文档（25 件，含 `A_CLASS_FIX_REPORT.md`、`PROJECT_STATUS.md`、`02-不做云端采集决策.md`）。按 §2.2 每篇必须带「已作废 + 日期 + 替代指针」头注，禁止静默删 |
| `tools/` | 历史一次性脚本（23 件，含 `pw-phase6.cjs`、`pw-phase7.cjs`、`perf-check.js`、`recovery-check.js`）。现役工具在根 `tools/`，两者不要混 |
| `测试/` | 早期测试样例（1 件） |
| `logs/` | 运行日志，**未被 git 跟踪**（tracked=0）→ 删了不丢历史，但也省不了空间（113 KB） |
| `_diag/` | **本轮 spec 42 审计留档，不是历史垃圾**：`portal-0916-abandoned-hotevents.patch`（portal 退役留证）、`portal-quarantine/`（隔离出的 Vercel 本地 env 与 09-02 鉴权放行脚本）、`2026-09-19-e2e-selectors/`（端到端取证）。清理前先看 `docs/specs/42-full-audit-2026-09/` |
| `smoke-reader.png` `smoke-daily.png` `smoke-hot.png` `smoke-admin.png` | 冒烟测试截图 4 张，散在本目录根。现役冒烟产物在 `docs/eval/` 与 `docs/screenshots/` |

**不放什么**：现役文档（进 `docs/`）、被活代码 `require` 的任何东西、新的诊断输出（临时件请进 `_diag/<日期>-<主题>/` 并说明何时可删）、以及任何"我暂时不知道它是不是活的"就直接扔进来的东西——那种情况请在 `docs/ISSUES.md` 立一条挂案，标 `unknown`。

**状态**：frozen。
