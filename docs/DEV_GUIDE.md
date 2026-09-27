# 全网情报系统 · 开发者上手指南

> 最后更新：2026-09-27

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
| `lib/` | 三端共用的单实现层（保留策略、预筛、密钥掩码等）——同一语义只在这里写一份 |
| `tools/` | 运维脚本 |
| `tests/` | 回归测试（node:test） |
| `docs/` | 文档 |
| `cloud/` | PHP 队列（Token 鉴权） |
| `config/` | customer-config.json |
| `opml/` | bestblogs 源清单 |

---

## 四、快速上手 Checklist

1. **读文档**：按 `AGENTS.md` §0 的固定顺序读（本文不复制那份顺序——它抄过一次就已经和 §0 不一致了）
2. **本地启动**：`start-all.bat` → 浏览器 `http://localhost:3000/reader/`
3. **管理后台**：`http://localhost:3000/admin/`
4. **修改前端**：改 `web/src/` → `npm run build` → Ctrl+F5
5. **修改后端（本地）**：改 `server/` → `restart-server.bat`
6. **修改后端（Vercel）**：改 `api/` → `git push` 即可（✅ Vercel 与 GitHub 已连 Git 集成，push main 自动部署）
7. **跑交付链**：按 `AGENTS.md` §3 逐条跑，本文件不复制那份序列
8. **portal 已退役（09-21）**：门户 Vercel 项目已下线、`portal/` gitlink 已从索引移除；本地调度里的门户同步通道默认关（`settings.portal.enabled` 显式置 true 才注册，锁 `tests/regression-audit42-portal-channel.test.js`），别再按它改行为

---

## 五、关键约定

### 5.1 双端同步规则

改云端读层（`api/`）或 runner 那条采集链时，要**同步检查**本地 Express（`server/`）里同语义的那一份，反之亦然——三份实现共享语义、各自独立。**但"同步检查"不等于"三端各写一遍"**：新功能先问它属云端还是本地专属，云端能做的只落云端两份部署面（读层 + runner），本地端按需跟。

### 5.2 测试要求

验收以 `AGENTS.md` §3 为准，这里只补一条它没写的：云端巡检工具有 `node tools/audit-cloud.js`（只读，需生产环境可达），**不替代**云端实测那一步。

### 5.3 文档更新约定

- 改架构/流程 → 同步更新 `ARCHITECTURE.md`
- 新功能 → 在 `docs/features/` 新增功能文档
- 新决策（方向性取舍、"不做什么"）→ 在 `docs/adr/` 落一个编号件：是什么 / 为什么 / 边界与禁止；同一主题被改判时**就地改写那件**，不新开"取代件"、不留旧方案叙述
- 开发一个功能（要拆几步、什么结果算完）→ 在 `docs/specs/` 走 spec 四件套

### 5.4 已知坑（必读）

坑库在 `docs/pitfalls/`（按域一文件，条数不写死，`ARCHITECTURE.md` §5 只是它的索引）。精选：

1. better-sqlite3 编号参数 `?1` 不支持位置绑定 → 用匿名 `?`
2. 异步回调内同步 DB 操作必须 try/catch
3. 调度器串行是有意的（抖音/B站并发会被封）
4. 图片防盗链 → `referrerpolicy="no-referrer"` + 服务端代理
5. bat 文件必须 GBK 编码 → 用 `tools/gen_bat.py` 生成

---

## 六、按场景去哪份文档

**固定阅读顺序只有 `AGENTS.md` §0 一份，本文不复制**（复制过一次就已经和它不一致了——这张表原来就犯过这个错）。按任务类型的入口：

- **修 bug / 复现问题**：`docs/ISSUES.md` 找活跃条目 → 该模块在 `docs/features/` 的那份功能文档
- **线上排障**：`docs/RUNBOOK.md`（含云端排障与止血顺序）
- **加功能**：`docs/INDEX.md` 模块地图先定位到"改的是哪个模块的哪个子模块" → 它的功能文档 → 能力边界看 `docs/FEATURE_MATRIX.md`
