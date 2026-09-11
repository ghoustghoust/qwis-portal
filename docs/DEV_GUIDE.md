# 全网情报系统 · 开发者上手指南

> 最后更新：2026-09-09（文档全面清洗后新建）

---

## 一、系统概述

全网情报系统（QWIS）是私人 AI 情报阅读器，聚合 RSS、微信公众号、B站、抖音、X/Twitter、热榜等多源信息，自动生成每日情报日报，支持 AI 辅助分析（翻译/摘要/分类）和多端推送报警。

**当前部署形态**（2026-09-11 方案A）：Vercel Serverless 为读层主部署；采集/日报/清理主链路在 GitHub Actions runner（`tools/collect-turso.js` 直写 Turso）；本地 Express + SQLite 为开发/灾备。

---

## 二、部署架构

```
GitHub Actions runner（采集/日报/快照/清理，直写 Turso）
        │ @libsql/client HTTPS
        ▼
Turso（东京，唯一云数据源）
        ▲
        │ 读
Vercel Serverless（读层主部署）
  ├─ api/[...slug].js    主 API（读 Turso）
  ├─ api/collect.js      采集函数（手动备份）
  ├─ api/daily-generate.js  日报生成（手动备份）
  ├─ 读者前端（Vite+React+Tailwind）
  └─ Turso（东京，云数据库）

本地 Express（开发/灾备）
  ├─ server/             Express 后端
  ├─ web/                主前端
  ├─ data/app.db         SQLite 数据库
  └─ 抖音 Playwright     仅本地可用
```

---

## 三、目录结构

| 路径 | 说明 |
|------|------|
| `api/` | **Vercel 读层 API**：catch-all 主 API；采集/日报函数为手动备份（主链路在 runner） |
| `server/` | Express 后端（本地开发/灾备）：routes/services/db.js |
| `web/` | 主前端（Vite+React+Tailwind）：index.html + admin.html |
| `portal/` | 原 Vercel 项目（已合并到根项目，待清理） |
| `tools/` | 运维脚本 |
| `tests/` | 回归测试（node:test） |
| `docs/` | 文档 |
| `docs/deprecated/` | 已归档的历史文档 |
| `archive/` | 全部历史资产 |
| `cloud/` | PHP 队列（Token 鉴权） |
| `config/` | customer-config.json |
| `opml/` | bestblogs 源清单 |

---

## 四、快速上手 Checklist

1. **读文档**：本文档 → `ARCHITECTURE.md` → `docs/RUNBOOK.md` → `docs/ISSUES.md`
2. **本地启动**：`start-all.bat` → 浏览器 `http://localhost:3000/reader/`
3. **管理后台**：`http://localhost:3000/admin/`
4. **修改前端**：改 `web/src/` → `npm run build` → Ctrl+F5
5. **修改后端（本地）**：改 `server/` → `restart-server.bat`
6. **修改后端（Vercel）**：改 `api/` → `git push` → **再手动 `vercel --prod --scope kwei888 --yes`**（⚠️ 项目未连 Git 集成，push 不会自动部署；建议在 Dashboard 连接 Git 仓库后免此步）
7. **跑测试**：`npm test`（全绿才算完）
8. **不要修改**：`src-admin/`、`admin.html`（根目录）、`vite.config.js`（根目录）— 这些是 portal 历史副本

---

## 五、关键约定

### 5.1 双端同步规则

改 Vercel API（`api/`）必须同步检查本地 Express（`server/`），反之亦然。双端共享语义但独立实现。

### 5.2 测试要求

- `npm test` 全绿
- `npm run build` 无错
- 涉及云端的跑 `node tools/audit-cloud.js`
- 每个修过的 bug 必须有回归测试

### 5.3 文档更新约定

- 改架构/流程 → 同步更新 `ARCHITECTURE.md`
- 新功能 → 在 `docs/features/` 新增功能文档
- 新决策 → 在 `docs/specs/` 新增 spec

### 5.4 已知坑（必读）

详见 `ARCHITECTURE.md` 第 5 节（18 条血泪史），精选：

1. better-sqlite3 编号参数 `?1` 不支持位置绑定 → 用匿名 `?`
2. 异步回调内同步 DB 操作必须 try/catch
3. 调度器串行是有意的（抖音/B站并发会被封）
4. 图片防盗链 → `referrerpolicy="no-referrer"` + 服务端代理
5. bat 文件必须 GBK 编码 → 用 `tools/gen_bat.py` 生成

---

## 六、阅读顺序推荐

| 场景 | 阅读顺序 |
|------|---------|
| 新接手 | 本文档 → ARCHITECTURE.md → RUNBOOK.md → ISSUES.md |
| 修 bug | ISSUES.md → ARCHITECTURE.md §5 → 对应模块 docs/features/ |
| 新功能 | docs/features/ 相关模块 → ARCHITECTURE.md §3 → DEVELOPMENT_STANDARDS.md |
| 排障 | RUNBOOK.md → ARCHITECTURE.md §5 |
