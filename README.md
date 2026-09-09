# QWis Portal — 全网情报系统

> **Q**uan**W**ang **I**ntel **S**ystem — 私人 AI 情报阅读器
>
> 聚合 RSS、微信公众号、B站、抖音、X/Twitter、热榜等多源信息，自动生成每日情报日报，支持 AI 辅助分析与多端推送报警。

[![License](https://img.shields.io/badge/license-Private-blue)](#)
[![Node](https://img.shields.io/badge/node-%3E%3D20-green)](#)
[![Tests](https://img.shields.io/badge/tests-189%2F189%20passing-brightgreen)](#)

---

## ✨ 核心功能

### 📡 多源采集

| 源类型 | 采集方式 | 说明 |
|--------|----------|------|
| **RSS / Atom** | `rss-parser` | 通用 RSS 适配器，含 `content:encoded` 全文保留、ETag 304 短路、GBK/Big5 编码嗅探、Readability 正文提取 |
| **微信公众号** | wechat2rss 托管 RSS | 375 个 bestblogs 源，图片由对方 img-proxy 代理 |
| **B站视频** | wbi 签名 API | 合集/搜索兜底，匿名 buvid Cookie，playurl 直链解析 |
| **抖音视频** | Playwright headless | 扫码登录，严格串行 ≥10s 间隔，仅本地运行 |
| **热榜聚合** | newsnow API | 微博/知乎/百度/头条/抖音/B站/贴吧/澎湃/凤凰等 29 个热榜源 |
| **YouTube** | 官方频道 RSS | 需代理可达 |
| **X / Twitter** | RSSHub | 依赖第三方 RSS 服务将时间线转为 RSS |

### 📰 每日情报日报

- **四栏目布局**：培训课程 / 重点更新 / AI 技术 / 其它重要
- **智能生成流程**：候选收集 → 关键词分类 → Jaccard ≥0.5 去重 + 同源限流 → 出库安检（乱码/风控错误页过滤）
- **破茧栏**：事件聚合引擎，与用户常读分组交集最小的 Top5 事件
- **定时 + 补跑**：默认每天 08:00 生成，启动时自动补跑错过的日报，前端打开时 stale 即自动补

### 🔥 热点榜

- **AIHOT 聚合源**：分类映射六胶囊（模型 / 产品 / 行业 / 论文 / 教程 / 观点）
- **事件榜**：近 72h 全域条目 Jaccard(≥0.4) 聚类，热度 = Σ权重 × 24h 半衰 × 1.5^(信源数-1)
- **enrich 管线**：pending_items → 串行详情页解析 → 富字段入库

### 🚨 报警系统

- **7 渠道**：钉钉 / 企微 / 飞书 / Server酱 / Bark / Telegram / 自定义 webhook
- **4 事件类型**：源熔断 / 采集停滞 / 队列异常 / 系统错误
- **防骚扰**：120min 冷却期 + 代理失败直连重试

### 📋 源库管理与自动分类

- 全类型源统一列表，四筛选（类型/文件夹/状态）+ 搜索 + 本地分页
- 批量启用/停用/特别关注/移动
- **自动分类**：内置 8 类目录（中英别名归一 + 关键词兜底），新源三挂接点自动入组
- 存量回填 dryRun 预览 → 勾选确认 → apply

### 🔄 云端队列同步

- 手机端/桌面端通过 HTTP Shortcuts 提交链接到云端 PHP 队列
- 本地 poller 每 10min 拉取 → 写入 pending_items → 清空云端
- 支持 B站视频、抖音视频、公众号文章三队列

###  鉴权与数据安全

- **JWT 鉴权**：读者只读 GET 公开，写操作与管理接口需 Bearer Token（7d 有效）
- **整库快照备份**：WAL 安全 backup → `data/backups/app-*.db`
- **按天清理**：可配置 retentionDays（默认 7 天）
- **熔断机制**：源连续失败 3 次自动停用，修好后手动启用清零 fail_count

---

##  页面预览

### 阅读器首页 (`/reader/`)

文章/视频双 Tab + 分组导航 + 未读计数 + 源级状态显示

![阅读器首页](docs/screenshots/01-reader-page.png)

### 每日情报页 (`/daily/`)

四栏目布局（培训课程/重点更新/AI技术/其它）+ 统计卡片 + 破茧栏

![每日情报](docs/screenshots/02-daily-page.png)

### 热点榜页 (`/hot/`)

精选/全部动态/热点榜三 Tab + 六分类胶囊（模型/产品/行业/论文/教程/观点）+ 时间线

![热点榜](docs/screenshots/03-hot-page.png)

### 管理后台 (`/admin/`)

7 Tab（公众号 RSS / B站 / 抖音 / 日报设置 / 数据 / 报警管理 / 热点榜）

![管理后台](docs/screenshots/04-admin-page.png)

### 队列配置面板

嵌入 B站/抖音/公众号 Tab 内 — 云端队列 API 地址 + Token + 轮询间隔 + 同步按钮

![队列配置面板](docs/screenshots/05-queue-panel.png)

---

## 🚀 快速开始

### 环境要求

- Node.js ≥ 20
- npm ≥ 9
- （可选）PM2 — 生产环境进程守护
- （可选）Playwright Chromium — 抖音采集功能

### 安装与启动

```bash
# 1. 克隆仓库
git clone https://github.com/ghoustghoust/qwis-portal.git
cd qwis-portal

# 2. 安装依赖
npm install

# 3. 配置环境变量（复制模板并修改）
cp .env.example .env   # 若存在，否则手动创建 .env

# 4. 构建前端
npm run build

# 5. 启动服务
npm start              # 生产模式
# 或
npm run dev            # 开发模式（nodemon 热重载）

# 6. 访问
# 阅读器:  http://localhost:3000/reader/
# 每日情报: http://localhost:3000/daily/
# 热点榜:   http://localhost:3000/hot/
# 管理后台: http://localhost:3000/admin/
```

### 宝塔 / 服务器部署（PM2）

```bash
# 1. 上传代码（排除 node_modules/ data/ .env）
# 2. 安装依赖
npm install --production

# 3. 抖音功能需 Playwright（约 300MB）
npx playwright install chromium

# 4. 配置 .env（PORT / HTTPS_PROXY 等）

# 5. 构建并启动
npm run build
npm run pm2:start
pm2 save
pm2 startup   # 开机自启

# 6. Nginx 反代 http://127.0.0.1:3000，client_max_body_size 10m
```

### 测试

```bash
npm test              # 回归测试（189 项）
node smoke-test.js    # 冒烟测试（生产库副本，零副作用）
```

---

## 🛠 技术栈

| 层级 | 技术 |
|------|------|
| **后端** | Node.js 20+ / Express 4 / better-sqlite3 (WAL) |
| **前端** | React 18 / Vite 5 / Tailwind CSS 3 |
| **采集** | rss-parser / Playwright (抖音) / undici (HTTP) |
| **调度** | node-cron / 自定义 due 驱动 tick 调度器 |
| **云端** | Vercel Serverless (主部署) / Turso (libSQL) / PHP 队列 |
| **部署** | Vercel (生产) / PM2 (本地开发/灾备) |

---

## 📁 项目结构

```
qwis-portal/
├── server/               # Express 后端
│   ├── routes/           # 20 个 API 路由
│   ├── services/         # 采集器 / AI日报 / 事件聚合 / 报警 / 调度 / 源自动分类
│   ├── cloud/            # 双模式异步数据层（SQLite / Turso）
│   ├── middleware/       # 鉴权中间件（JWT）
│   ├── util/             # HTTP / 日志 / 安全图片代理 / 时间工具
│   ├── db.js             # 本地 better-sqlite3（9 张表 DDL + 增量迁移）
│   └── index.js          # 入口（代理初始化 → 建表 → 路由 → 鉴权 → 调度器）
├── web/                  # 主前端（Vite + React + Tailwind）
│   ├── src/
│   │   ├── pages/        # ReaderPage / DailyPage / HotPage / AdminPage / MyReadingPage
│   │   ├── components/   # Sidebar / ArticleList / SourceLibraryTab / FilterPanel 等
│   │   ├── ui/           # 共享 UI 组件（TagPills / Stars / SourceAvatar / StatCard）
│   │   ├── api.js        # API 客户端（自动注入 Bearer token）
│   │   └── main.jsx      # 入口（IconRail 导航 + pathname 路由）
│   ├── index.html        # 读者入口
│   └── admin.html        # 管理后台入口（独立 bundle）
├── api/                  # Vercel 正式生产代码
│   ├── [...slug].js      # 主 API（catch-all 路由）
│   ├── collect.js        # 采集函数
│   └── daily-generate.js # 日报生成
├── portal/               # 原 Vercel 项目（已合并到根项目）
├── cloud/                # PHP 队列（Token 鉴权 + flock 原子操作）
├── config/               # customer-config.json（客户化配置）
├── opml/                 # bestblogs 源清单（wechat2rss / youtube / podcast）
├── tools/                # 运维脚本
├── tests/                # 回归测试（node:test，189 项）
├── docs/                 # 文档（RUNBOOK / 截图等）
├── archive/              # 历史资产（报告 / 规格 / 分析）
└── trash/                # 退役代码（we-mp-rss 等）
```

---

## ️ 配置说明

### `.env` 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `PORT` | 否 | 服务端口，默认 `3000` |
| `AUTH_SECRET` | 是 | JWT 签名密钥（生产环境必须修改为强随机字符串） |
| `ADMIN_USER` | 是 | 管理员用户名 |
| `ADMIN_PASSWORD` | 是 | 管理员密码 |
| `HTTPS_PROXY` | 否 | 翻墙代理地址（YouTube/X 等海外源需要） |
| `NO_PROXY` | 否 | 不走代理的地址列表（逗号分隔） |
| `CLOUD_BASE_URL` | 否 | 云端队列 API 域名 |
| `TURSO_DATABASE_URL` | 否 | Turso 数据库 URL |
| `TURSO_AUTH_TOKEN` | 否 | Turso 认证 Token |
| `AUTH_DISABLED` | 否 | 设为 `true` 禁用鉴权（仅本机调试） |

### `config/customer-config.json`

客户化配置文件，由 `npm run setup:customer` 读取并生成 `.env`：

| 字段 | 说明 |
|------|------|
| `opmlUrl` | 公众号 OPML 订阅地址 |
| `cloudBaseUrl` | 云端队列 API 域名 |
| `apiToken` | 云端队列 Token（留空自动生成 48 位随机 Token） |
| `deepseekKey` | DeepSeek API Key（留空则 AI 功能关闭） |
| `bilibiliCookie` | B站 Cookie（留空走合集+搜索兜底） |
| `douyinLoginMode` | 抖音登录方式：`qrcode`（扫码）/ `cookie` |
| `intervals` | 各源刷新间隔配置 |
| `proxy` | 本机翻墙代理地址 |

### 管理后台口令

首次访问 `/admin/` 时设置管理口令，存储于 `settings` 表的 `admin.passwordHash` 字段（httpOnly cookie）。

---

## 🔌 API 端点

### 公开只读（GET）

| 端点 | 说明 |
|------|------|
| `GET /api/articles` | 文章列表（默认排除热榜/聚合源） |
| `GET /api/videos` | 视频列表 |
| `GET /api/hot` | 热点榜（精选/全部动态/事件榜） |
| `GET /api/daily` | 每日情报 |
| `GET /api/groups` | 分组列表 |
| `GET /api/sources` | 源列表 |
| `GET /api/status` | 系统状态概览 |
| `GET /api/img` | 图片代理（防盗链） |
| `GET /api/reading` | 阅读记录 |

### 需鉴权（Bearer JWT）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/auth/login` | POST | 获取 JWT Token |
| `/api/sources` | POST/PUT/DELETE | 源管理 |
| `/api/sources/library` | GET | 源库列表（含 itemCount/contentKind） |
| `/api/sources/batch` | POST | 批量操作（启用/停用/关注/移动） |
| `/api/sources/autoclassify` | POST | 自动分类（dryRun/apply） |
| `/api/groups` | POST/PUT/DELETE | 分组管理 |
| `/api/daily` | POST | 手动生成日报 |
| `/api/settings` | GET/PUT | 系统设置 |
| `/api/alerts` | GET/POST/DELETE | 报警管理 |
| `/api/backup` | POST | 整库快照备份 |
| `/api/data/upload` | POST | 数据库上传导入 |
| `/api/queue` | GET/PUT | 队列配置与同步 |
| `/api/health` | GET | 健康自检 |
| `/api/reading` | POST/PUT | 阅读记录写入 |
| `/api/audit` | GET | 审计日志 |

---

## ❓ 常见问题

### Q: 抖音采集为什么只能在本地运行？

抖音采集依赖 Playwright 有头浏览器 + 扫码登录态，云端无头环境无法维持登录状态。目标部署形态为宝塔/自有服务器全量部署，届时抖音功能可在服务器上运行。

### Q: 微信公众号图片加载不出来？

微信公众号图片走 wechat2rss 的 img-proxy 代理，需要 `referrerpolicy="no-referrer"` 属性。服务端图片代理（`/api/img`）已自动处理。

### Q: 源被自动停用了？

系统有熔断机制：源连续失败 3 次自动 `enabled=0`。可在管理后台「源库」Tab 批量恢复，或单源手动启用（启用时自动清零 fail_count）。

### Q: 如何添加新的 RSS 源？

1. 打开管理后台 `/admin/` → 「公众号 RSS」Tab
2. 粘贴 RSS Feed URL，填写显示名称
3. 保存后系统自动加入调度队列

### Q: 海外源（YouTube/X）抓不到内容？

在 `.env` 中配置 `HTTPS_PROXY` 指向本地代理（如 Clash 默认 `http://127.0.0.1:7890`）。国内服务（云端队列/DeepSeek）会自动通过 `NO_PROXY` 绕过代理。

### Q: 日报没有自动生成？

- 检查调度器是否正常运行：`npm run pm2:logs`
- 手动触发：管理后台 → 「日报设置」Tab → 「重新生成」
- 前端打开 `/daily/` 时 stale 会自动补跑

### Q: 如何备份和恢复数据？

- **备份**：管理后台 → 「数据」Tab → 「整库快照」，或调用 `POST /api/backup`
- **恢复**：管理后台 → 「数据」Tab → 上传 `.db` 文件（文件名白名单 + SQLite 头校验）

---

## 📋 运维命令速查

| 命令 | 说明 |
|------|------|
| `npm start` | 启动服务（生产模式） |
| `npm run dev` | 开发模式（nodemon 热重载） |
| `npm run build` | 构建前端 |
| `npm test` | 运行回归测试（189 项） |
| `npm run pm2:start` | PM2 启动守护进程 |
| `npm run pm2:restart` | PM2 重启 |
| `npm run pm2:logs` | PM2 查看日志 |
| `node smoke-test.js` | 冒烟测试（零副作用） |
| `node tools/audit-cloud.js` | 云端 19 项健康检查 |
| `node tools/sync-portal.js` | 手动同步门户快照 |

---

##  文档索引

| 文档 | 说明 |
|------|------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | 架构文档（系统全景、数据通路、已知坑、协作规则） |
| [docs/DEV_GUIDE.md](docs/DEV_GUIDE.md) | 开发者上手指南 |
| [docs/DEVELOPMENT_STANDARDS.md](docs/DEVELOPMENT_STANDARDS.md) | 开发规范与验收标准 |
| [docs/ISSUES.md](docs/ISSUES.md) | 已知问题清单（活文档） |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | 运维手册 |
| [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) | 项目状态说明 |
| [docs/INDEX.md](docs/INDEX.md) | 文档索引 |
| [docs/ANDROID_SUBMIT_GUIDE.md](docs/ANDROID_SUBMIT_GUIDE.md) | 安卓端提交客户端指南 |
| [docs/X_SETUP_GUIDE.md](docs/X_SETUP_GUIDE.md) | X/Twitter RSSHub 设置指南 |

---

## ⚠️ 注意事项

- **上公网前必须启用 API 鉴权**：设置 `AUTH_SECRET` 为强随机字符串，修改默认 `ADMIN_USER`/`ADMIN_PASSWORD`
- **敏感文件已排除**：`cloud/token.json`、`.env`、`data/` 均在 `.gitignore` 中
- **bat 文件必须 GBK 编码**：用 `tools/gen_bat.py` 生成，不要手改
- **better-sqlite3 单进程锁**：不可 cluster 多实例，PM2 配置 `instances: 1`
- **Vercel 为主部署**：`api/` 目录为正式生产代码，本地 Express 为开发/灾备

---

##  License

Private — 个人项目，保留所有权利。
