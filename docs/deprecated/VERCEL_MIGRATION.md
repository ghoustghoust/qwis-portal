> [已归档] 2026-09-09 — 原迁移指南方向（本地→Vercel 过渡）已被「Vercel 为主部署」决策取代

# 全网情报系统 Vercel 迁移指南

> 本文档记录从 Express+SQLite 本地架构迁移到 Vercel Serverless 架构的全部变更和操作步骤。
> 创建时间: 2026-09-08

## 新增文件清单

| 文件 | 用途 |
|------|------|
| `lib/db.js` | 统一异步数据层（本地 better-sqlite3 / 云端 Turso 双模式） |
| `lib/collectors/repo.js` | 异步数据仓储（Serverless 兼容） |
| `lib/collectors/fetcher.js` | 异步抓取编排（Serverless 兼容） |
| `api/collect.js` | Serverless 采集函数（RSS/热榜/B站） |
| `api/daily-generate.js` | Serverless 日报生成函数 |
| `api/[...slug].js` | Catch-all API 路由（替代 20 个 Express 路由） |
| `tools/migrate-to-turso.js` | SQLite → Turso 数据迁移脚本 |
| `tools/generate-snapshots.js` | 静态快照生成工具 |
| `tools/archive-articles.js` | 文章归档工具（热/冷数据分离） |
| `web/src/snapshot.js` | 前端双通道数据加载器 |
| `vercel.json` | Vercel 部署配置 |
| `public/data/` | 静态快照输出目录 |

## 修改文件清单

| 文件 | 变更 |
|------|------|
| `.github/workflows/collect.yml` | 扩展为 4 个 Job（采集/日报/快照/清理） |
| `package.json` | 新增 build:vercel / migrate:turso / snapshots / archive 脚本 |

## 迁移步骤（按顺序执行）

### Step 1: 创建 Turso 数据库

```bash
# 安装 Turso CLI
curl -sSfL https://get.turso.sh | sh

# 创建数据库（选东京区域）
turso db create qwis-intel --region nrt

# 获取连接信息
turso db show qwis-intel --url
turso db tokens create qwis-intel
```

### Step 2: 配置环境变量

**本地 `.env` 添加:**
```
TURSO_DATABASE_URL=libsql://qwis-intel-xxx.turso.io
TURSO_AUTH_TOKEN=eyJ...
COLLECT_KEY=你的采集密钥（任意字符串）
AUTH_SECRET=你的JWT密钥（至少32字符）
ADMIN_USER=admin
ADMIN_PASSWORD=你的管理密码
```

**Vercel 项目环境变量（Dashboard → Settings → Environment Variables）:**
```
TURSO_DATABASE_URL = libsql://qwis-intel-xxx.turso.io
TURSO_AUTH_TOKEN = eyJ...
COLLECT_KEY = （同上）
AUTH_SECRET = （同上）
ADMIN_USER = admin
ADMIN_PASSWORD = （同上）
```

**GitHub Actions Secrets（Settings → Secrets → Actions）:**
```
VERCEL_URL = https://你的项目.vercel.app
COLLECT_KEY = （同上）
TURSO_DATABASE_URL = （同上）
TURSO_AUTH_TOKEN = （同上）
```

### Step 3: 迁移数据

```bash
# 先 dry-run 统计
MIGRATE_DRY_RUN=1 npm run migrate:turso

# 确认无误后执行迁移（含归档）
MIGRATE_ARCHIVE=1 npm run migrate:turso
```

### Step 4: 生成初始快照

```bash
npm run snapshots
```

### Step 5: 部署到 Vercel

```bash
# 安装 Vercel CLI（如未安装）
npm i -g vercel

# 首次部署（交互式配置）
vercel

# 后续部署
vercel --prod
```

### Step 6: 验证

1. 访问 `https://你的域名/data/meta.json` → 应返回 JSON 元数据
2. 访问 `https://你的域名/api/status` → 应返回状态汇总
3. 访问 `https://你的域名/api/articles` → 应返回文章列表
4. 访问 `https://你的域名/api/daily` → 应返回最新日报

### Step 7: 配置 GitHub Actions

推送代码后，GitHub Actions 会自动按 cron 执行：
- 整点采集（每小时 :00）
- 日报生成（北京时间 8:00）
- 快照生成（北京时间 9:00）
- 数据清理（北京时间 4:00）

## 本地开发（迁移后）

本地开发仍然可用，`lib/db.js` 通过环境变量自动切换：
- 不设 `TURSO_DATABASE_URL` → 走本地 `data/app.db`（better-sqlite3）
- 设了 → 走 Turso 云端

```bash
# 本地开发（Express 模式，走 SQLite）
npm run dev

# 本地开发（模拟 Vercel，走 Turso）
TURSO_DATABASE_URL=xxx npm run dev:web
```

## 成本预估

| 服务 | 方案 | 月费 |
|------|------|------|
| Turso | Scale 方案 | $29 |
| Vercel | Pro 方案（如需 60s 函数超时） | $20 |
| Vercel | Hobby 方案（10s 超时，采集可能不够） | 免费 |
| **合计** | | **$29-49/月** |

## 回退方案

本地 Express 系统完整保留。如果 Vercel 部署出问题：
1. 停止 GitHub Actions（Settings → Actions → Disable）
2. 启动本地服务：`npm start`
3. 本地系统仍走 `data/app.db`，数据完整

## 架构对照

```
旧架构:
  本地 Express + SQLite + PM2 → 浏览器

新架构:
  GitHub Actions (定时) → Vercel Serverless Functions → Turso (云数据库)
                                                    ↓
  浏览器 → Vercel 静态托管 (快照 + React SPA) ←──┘
```
