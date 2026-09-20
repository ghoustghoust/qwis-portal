# `scripts/`

**放什么**：给**人手工执行**的运维脚本（`npm run` 之外的入口）。现役两件：

| 文件 | 干什么 | 装载方 |
|---|---|---|
| `restore-frozen-sources.js` | 批量把熔断源（`enabled=0` 且 `fail_count>=3`）恢复成可采 | `require('../server/db')` → **只打本地 SQLite，不碰 Turso**（AGENTS §1 三端语义） |
| `test-agnes-api.js` | Agnes API 连通性测试（文件头自述；用法 `node scripts/test-agnes-api.js`） | 独立跑，无人调用 |

**不放什么**：会被调度器 / workflow 调用的链路代码 —— 那属于 `tools/`（runner 与一次性取证脚本的家）。往这里加"自动化会碰到的东西"，就等于把主链路藏进一个没人 review 的目录。

**归属端**：本地（人工执行）

**状态**：active —— 但**两件都没有回归锁**，改它们等于无保护改动；`restore-frozen-sources.js` 的"批量恢复熔断源"动作与 `docs/ISSUES.md` 的批量解冻口径同源，改口径要一起改
