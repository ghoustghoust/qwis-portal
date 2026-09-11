# AGENTS.md — 全网情报系统 · Agent 协作规则

> 任何 AI Agent 接手本项目前**必读**。本文件是项目级强制约束，优先级高于其它文档。
> 原则：**文档从真实环境逆推，不是约束；线上实测是唯一验收标准。**

## 0. 先读什么（顺序固定）

1. `docs/CLOUD_PIPELINE_GUIDE.md` —— 云端实时链路地图 + 不可破坏的不变量（P0）
2. `docs/FEATURE_MATRIX.md` —— 本地/云端/runner 三端功能矩阵（唯一权威，SSOT）
3. `ARCHITECTURE.md` —— 架构决策 + 已知坑（每条坑都对应过一次线上事故）
4. `docs/HANDOVER.md` —— 凭据速查 + API 清单（⚠️ 含密钥，本地文件，永不提交）

## 1. 三端心智模型（改代码前必须知道自己在改哪一端）

| 端 | 代码 | 职责 |
|---|---|---|
| 本地 Express | `server/` | 全功能开发/灾备（抖音/B站/文件快照 only here） |
| Vercel 读层 | `api/`（catch-all `[...slug].js` + collect.js + daily-generate.js） | 线上 API + 管理后台 |
| GH runner | `tools/collect-turso.js` + `.github/workflows/collect.yml` | 采集主链路，直写 Turso |

**采集语义有三份实现**（server/services/collectors/、api/collect.js、tools/collect-turso.js）——改任何一份的过滤/清洗/熔断/去重/UA/间隔，必须同步检查另外两份。

## 2. 强制约束（2026-09-11 审计后新增，违反=事故）

本项目曾长期"本地开发完不推云端、不实测、不写文档"，导致云端停摆 2 天无人发现、5 份文档 5 个版本。以下规则不可协商：

1. **改完必须推云端**：`git push origin main` 即触发 Vercel 自动部署（Git 集成已连）。本地验证 ≠ 完成。
2. **必须云端实测**：按 `docs/DELIVERY_VERIFICATION.md` 流程打真实线上端点（需代理 `http://127.0.0.1:7890` + curl `--ssl-no-revoke`）。截图/curl 响应才算证据。
3. **必须同步文档**：功能变更 → 改 `docs/FEATURE_MATRIX.md` + `docs/HANDOVER.md`；调度/频率/链路变更 → 还要改 `ARCHITECTURE.md` + `docs/RUNBOOK.md` + `docs/CLOUD_PIPELINE_GUIDE.md`。
4. **否定/作废决策也要落档**：推翻旧决策时，在旧文档头部加「已作废 + 日期 + 替代决策链接」，禁止静默删除。
5. **单一事实源**：调度频率、功能矩阵、凭据位置、测试数等易变事实，全库只许一份写死值，其它文档写"见 XX"。
6. **凭据三处同步**：`COLLECT_KEY` / `TURSO_*` 等改值时必须同时改 本地 `.env` + Vercel env + GitHub Secrets（本系统最大血泪坑，曾致全链路 403 停摆 2 天）。
7. **不动刀原则**：没读懂现有实现前不改写；不重写能修的东西；不引入需要无头浏览器的云端功能。

## 3. 测试约定

- `npm test`（node:test，tests/）必须全绿；引用 server/* 的测试文件先 require tests/helpers（APP_DATA_DIR 隔离）
- `node smoke-test.js` 冒烟（生产库副本，零副作用）
- 每个线上修过的 bug 必须有回归测试
- 验收 = npm test 全绿 + `npm run build:vercel` 无错 + 云端实测通过

## 4. 常用入口

| 事项 | 入口 |
|---|---|
| 云端排障 | `docs/RUNBOOK.md` §10 + `GET /api/health/status`（含采集心跳） |
| 手动触发采集 | GH Actions → Run workflow，或 `POST /api/rss/refresh`（标记到期） |
| 凭据/密钥 | `docs/HANDOVER.md` §1.5（本地文件） |
| 待开发清单 | `docs/FEATURE_MATRIX.md` §2 |
