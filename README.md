# QWis Portal — 全网情报系统

> 最后更新：2026-10-01
> **Q**uan**W**ang **I**ntel **S**ystem — 私人 AI 情报阅读器
>
> 聚合 RSS、微信公众号、B站、抖音、X/Twitter、热榜等多源信息，自动生成每日情报日报与个性化早报，支持 AI 辅助分析、翻译、精选周刊和多端推送报警。
>
> **生产地址**：<https://qwis-intel.vercel.app>

[![License](https://img.shields.io/badge/license-Private-blue)](#)
[![Node](https://img.shields.io/badge/node-%3E%3D20-green)](#)
[![Deploy](https://img.shields.io/badge/deploy-Vercel-black?logo=vercel)](https://qwis-intel.vercel.app)

---

## ✨ 核心功能

### 📡 多源采集

| 源类型 | 采集方式 | 说明 |
|--------|----------|------|
| **RSS / Atom** | `rss-parser` | 通用 RSS 适配器，含 `content:encoded` 全文保留、ETag 304 短路、GBK/Big5 编码嗅探、Readability 正文提取 |
| **微信公众号** | wechat2rss 托管 RSS | bestblogs 系托管源（数量现读源表），图片由对方 img-proxy 代理 |
| **B站视频** | wbi 签名 API | 合集/搜索兜底，匿名 buvid Cookie，playurl 直链解析 |
| **抖音视频** | Playwright headless | 扫码登录，严格串行 ≥10s 间隔，仅本地运行 |
| **热榜聚合** | newsnow API | 多平台热榜聚合（源数现读源表） |
| **YouTube** | 官方频道 RSS | 需代理可达 |
| **X / Twitter** | RSSHub | 需自备 RSSHub 实例——本仓从未部署过，未配置则可填可存但抓不到内容（`docs/ISSUES.md` H40） |
| **播客音频** | RSS enclosure | 音频直链 + 封面归位，阅读器内嵌播放器 |

### 📰 每日情报日报 & 早报体系

- **每日早报**：晚间主批 + 夜间备跑兜底（时刻以作业文件 `.github/workflows/collect.yml` 为唯一事实源）；栏目由全站唯一一份栏目表实现，文档不复述栏目名
- **我的早报**：个性化订阅源 + 智能推荐，基于用户关注分组加权
- **精选周刊**：AI 策展周度精选，主题全景四视角
- **智能生成流程**：候选收集 → 关键词分类 → 去重 + 同源限流 → 出库安检（乱码/风控错误页过滤）；各环节参数取值以共用实现为准
- **破茧栏**：仅本地端，未移植云端（`docs/ISSUES.md` H22）
- **AI 增强**：摘要/评分/标签/翻译（多轮精翻管线 + 中英对照）

### 🔥 AI 热点榜

- **AI 精选**：自有源达分数门槛且 AI 相关（取值见 `docs/features/hot-and-weekly.md` §七），热榜源不入精选
- **AI 信息实时流**：只出 AI 相关内容，固定周期轮询刷新（ADR-06）
- **热搜事件**：采集批次预聚合、云端直读（聚合窗口与参数见 `docs/features/hot-and-weekly.md`）
- **分类胶囊**：分类映射的现状是"三处不同源"（界面 / 设置键 / 云端过滤各一份），见 `docs/features/hot-and-weekly.md` §二与 `docs/ISSUES.md` H49
- **enrich 管线**：仅本地端，云端待移植（`docs/FEATURE_MATRIX.md` §1.4）

### 🚨 报警系统

- **7 渠道**：钉钉 / 企微 / 飞书 / Server酱 / Bark / Telegram / 自定义 webhook
- **事件类型与触发判据**：见 `docs/features/events-alerts.md`
- **防骚扰**：冷却语义见 `docs/features/events-alerts.md`

### 📋 源库管理与源四轴模型

- **四轴语义**：上架（enabled）→ 收录（reader_visible）→ 订阅（subscription）→ 重点（spotlight）/ 屏蔽（muted）
- 全类型源统一列表，三视图（组合卡片 / 问题源 / 检索）+ 平台接入 + 搜索 + 本地分页
- 批量操作：启用/停用/特别关注/移动/屏蔽/收录（组级单条 SQL，云端 serverless 友好）
- **自动分类**：内置 8 类目录（中英别名归一 + 关键词兜底），新源三挂接点自动入组
- 存量回填 dryRun 预览 → 勾选确认 → apply

### 🔄 云端队列同步（未启用）

- 通路：手机/桌面提交链接到仓外 PHP 队列站点 → 本地 poller 定时拉取写入 pending_items → 清空对端
- ⚠️ **这条链路当前不是活的**：对端实例从未部署，"可填可存但抓不到任何东西"；处置三选一等你拍（`docs/ISSUES.md` H40）。运维说明见 `docs/RUNBOOK.md` §4

### 🛡 鉴权与数据安全

- **JWT 鉴权**：读者只读 GET 公开，写操作与管理接口需 Bearer Token（有效期属实现细节，ADR-12）
- **整库备份**：WAL 安全 backup → `data/backups/app-*.db`
- **按天清理**：保留天数是唯一可改项（settings），没有清理总开关（ADR-22）
- **熔断机制**：源连续失败达阈值自动停用，阈值按类型分档（视频类更高，取值在共用实现一处）；修复后手动启用清零 fail_count

---

## 🖥 页面一览

> 界面截图不再随仓库分发（图片目录已下架），**形态以线上为准**（生产地址见文首）。下表是各页此刻承载的东西；能力有没有对上某一端，查 `docs/FEATURE_MATRIX.md` §1，那才是权威矩阵。

| 页面 | 现在有什么 |
|---|---|
| 阅读器 `/reader/` | 文章/视频双 Tab + 分组导航 + 今日早报摘要卡 + 「今日」滚动 24h 视图 + 未读计数 |
| 每日早报 `/daily/` | 多栏目版面（栏目表全站一份实现）+ 统计卡片 + AI 评分/摘要 + 中英对照 |
| 我的早报 `/mybrief/` | 个性化订阅源 + 智能推荐 + 主题导语 + 阅读足迹回顾 |
| 精选周刊 `/weekly/` | AI 策展周度精选 + 主题全景四视角 + 补充阅读 |
| 热点榜 · AI 精选 `/hot/` | 自有源达门槛且 AI 相关 + 分类胶囊 |
| 热点榜 · AI 信息实时流 | 只出 AI 相关内容 + 固定周期刷新 + 分类筛选 |
| 热点榜 · 热搜事件 | 预聚合事件聚类 + 趋势折线 + 分组信源胶囊 + 热度降序 |
| 我的阅读 `/reading/` | 阅读沉淀 + 批量管理 + 导出 + 阅读足迹 |
| 管理后台 `/admin/` | 5 Tab 收敛：源库（组合/问题源/检索/平台接入）/ 早报中心 / 热点榜策展 / AI 能力 / 系统 |
| 管理后台 · 早报中心 | 生成历史 + 订阅源配置 + 日报栏目/时间设置 + 晚间主批配置 |
| 管理后台 · 系统 | 数据/监控/报警分区 + 整库备份 + 健康状态 |

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
# 阅读器:    http://localhost:3000/reader/
# 每日早报:  http://localhost:3000/daily/
# 我的早报:  http://localhost:3000/mybrief/
# 精选周刊:  http://localhost:3000/weekly/
# 热点榜:    http://localhost:3000/hot/
# 我的阅读:  http://localhost:3000/reading/
# 管理后台:  http://localhost:3000/admin/
```

### 服务器常驻（可选，非主部署面）

把本地端长期跑在一台服务器上的做法（依赖安装、代理、鉴权豁免等注意事项）见 `docs/RUNBOOK.md` §2/§3。主部署面是 Vercel 读层 + GH runner 采集（ADR-01），本地端是开发与灾备。

### 测试

```bash
npm test              # 回归测试
node smoke-test.js    # 冒烟测试（生产库副本，零副作用）
```

---

## 🛠 技术栈

| 层级 | 技术 |
|------|------|
| **后端** | Node.js 20+ / Express 4 / better-sqlite3 (WAL) |
| **前端** | React 18 / Vite 5 / Tailwind CSS 3 |
| **采集** | rss-parser / Playwright (抖音) / undici (HTTP) |
| **调度** | node-cron / 自定义 due 驱动 tick 调度器（本地）；云端主链路 = GH Actions runner 直写 Turso，双档触发（GH schedule + 外置 HTTP 触发器，ADR-13） |
| **AI** | Agnes 云端（日报增强/评分/翻译/摘要）；多轮精翻管线 + 薄正文仅标题通道 |
| **云端** | Vercel Serverless (读层+管理台) / Turso (libSQL, 东京) / GH Actions runner (采集) / PHP 队列 |
| **部署** | Vercel (生产读层) + GH Actions (定时采集) / PM2 (本地开发/灾备) |

---

## 📁 项目结构

```
qwis-portal/
├── server/               # Express 后端
│   ├── routes/           # API 路由
│   ├── services/         # 采集器 / AI日报 / 事件聚合 / 报警 / 调度 / 源自动分类
│   ├── cloud/            # 双模式异步数据层（SQLite / Turso）
│   ├── middleware/       # 鉴权中间件（JWT）
│   ├── util/             # HTTP / 日志 / 安全图片代理 / 时间工具
│   ├── db.js             # 本地 better-sqlite3（建表 DDL + 增量迁移）
│   └── index.js          # 入口（代理初始化 → 建表 → 路由 → 鉴权 → 调度器）
├── web/                  # 主前端（Vite + React + Tailwind）
│   ├── src/
│   │   ├── pages/        # ReaderPage / DailyPage / HotPage / AdminPage / MyBriefPage / WeeklyPage / ReadingPage
│   │   ├── components/   # Sidebar / ArticleList / SourceLibraryTab / FilterPanel / PodcastCover 等
│   │   ├── ui/           # 共享 UI 组件（TagPills / Stars / SourceAvatar / StatCard）
│   │   ├── api.js        # API 客户端（自动注入 Bearer token）
│   │   └── main.jsx      # 入口（IconRail 导航 + pathname 路由）
│   ├── index.html        # 读者入口
│   └── admin.html        # 管理后台入口（独立 bundle）
├── lib/                  # 共用模块（AI 相关性 / 热榜事件 / 源四轴 / 媒体 / 文本清洗）
├── api/                  # Vercel 读层 API
│   ├── [...slug].js      # 主 API（catch-all 路由）
│   ├── collect.js        # 采集函数（手动备份）
│   └── daily-generate.js # 日报生成（手动备份）
├── cloud/                # PHP 队列（Token 鉴权 + flock 原子操作）
├── config/               # customer-config.json（客户化配置）
├── opml/                 # bestblogs 源清单（wechat2rss / youtube / podcast）
├── tools/                # 运维脚本（collect-turso.js = 云端采集主链路）
├── tests/                # 回归测试（node:test）
└── docs/                 # 文档（全量地图见 docs/INDEX.md：pitfalls / adr / features / eval 等）
```

---

## ⚙️ 配置说明

### `.env` 环境变量

必需变量的清单与位置矩阵只有一处：`ARCHITECTURE.md` §6（凭据速查在本地件 `docs/HANDOVER.md` §1.5，永不提交）；模板见 `.env.example`。常用项：`PORT`（服务端口）、`AUTH_SECRET`（JWT 签名密钥）、`ADMIN_USER` / `ADMIN_PASSWORD`（管理口令）、`HTTPS_PROXY`（海外源代理）、`TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`（云库）。

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

管理账号来自环境变量 `ADMIN_USER` / `ADMIN_PASSWORD`（本地 `.env` + Vercel env），登录换令牌（ADR-12）。`settings` 表里那个口令哈希键**不是鉴权入口**，只是"不回显"名单的成员——把它设上不会让任何接口放行。

---

## 🔌 API 端点

### 公开只读（GET）

| 端点 | 说明 |
|------|------|
| `GET /api/articles` | 文章列表（默认排除热榜/聚合源，支持 `since` 增量 + `smart` 排序） |
| `GET /api/articles/since` | 文章增量（前端固定周期轮询用） |
| `GET /api/videos` | 视频列表（游标分页 + 播客并入） |
| `GET /api/hot` | 热点榜（精选/全部动态/事件榜） |
| `GET /api/hot/groups` | 热点分类列表（去重、只含有内容的组） |
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
| `/api/sources/batch` | POST | 批量操作（enable/spotlight/mute/visible/subscribe/interval/failover + groupScopeId） |
| `/api/sources/autoclassify` | POST | 自动分类（dryRun/apply） |
| `/api/groups` | POST/PUT/DELETE | 分组管理 |
| `/api/daily` | POST | 手动生成日报 |
| `/api/settings` | GET/PUT | 系统设置 |
| `/api/settings/daily` | GET/PUT | 日报设置 |
| `/api/alerts` | GET/POST/DELETE | 报警管理 |
| `/api/backup` | POST | 整库备份 |
| `/api/data/upload` | POST | 数据库上传导入 |
| `/api/queue` | GET/PUT | 队列配置与同步 |
| `/api/health` | GET | 健康自检 |
| `/api/reading` | POST/PUT | 阅读记录写入 |
| `/api/audit` | GET | 审计日志 |

> 本表是本地端速查。云端读层的响应形状见 `docs/contracts/`；管理端点全表在本地件 `docs/HANDOVER.md` §3（含密钥，已 gitignore，不入库）。

---

## ❓ 常见问题

### Q: 抖音采集为什么只能在本地运行？

抖音采集依赖 Playwright + 扫码登录态，**仅本地端**，永不上云（ADR-02）。要长期跑就按 `docs/RUNBOOK.md` §3 托管本地端。

### Q: 微信公众号图片加载不出来？

微信公众号图片走 wechat2rss 的 img-proxy 代理，需要 `referrerpolicy="no-referrer"` 属性。服务端图片代理（`/api/img`）已自动处理。

### Q: 源被自动停用了？

系统有熔断机制：源连续失败达阈值（按类型分档，取值在共用实现）自动 `enabled=0`。可在管理后台「源库」Tab 批量恢复，或单源手动启用（启用时自动清零 fail_count）。

### Q: 如何添加新的 RSS 源？

1. 打开管理后台 `/admin/` → 「源库」Tab → 「平台接入」
2. 粘贴 RSS Feed URL，填写显示名称
3. 保存后系统自动加入调度队列并尝试自动分类

### Q: 海外源（YouTube/X）抓不到内容？

在 `.env` 中配置 `HTTPS_PROXY` 指向本地代理。国内服务（云端队列/DeepSeek）会自动通过 `NO_PROXY` 绕过代理。

### Q: 日报没有自动生成？

- 云端：晚间主批 + 夜间备跑由 GH Actions runner 生成（时刻以作业文件 `.github/workflows/collect.yml` 为准）；排查先看 Turso settings `cloud.collect` 心跳，再看 GitHub Actions 运行记录
- 本地：检查调度器 `npm run pm2:logs`；手动触发：管理后台 → 「早报中心」→ 「重新生成」

### Q: 如何备份和恢复数据？

- **备份**：管理后台 → 「系统」Tab → 「整库快照」，或调用 `POST /api/backup`
- **恢复**：管理后台 → 「系统」Tab → 上传 `.db` 文件（文件名白名单 + SQLite 头校验）
- **云端语义**：配置备份存 Turso `settings` 表；文件型整库备份在云端不支持（501），需整库迁移请用 `tools/migrate-to-turso.js`

---

## 📋 运维命令速查

日常启停：`npm start`（生产模式）/ `npm run dev`（开发热重载）/ `npm run build`（改了 `web/src` 必须重建）/ `npm run pm2:*`（进程守护）。

验证与门禁命令的唯一清单（`npm test`、冒烟、文档门禁等各自"判什么、怎么取读数"）见 `docs/FEATURE_MATRIX.md` §1.5；运维排障命令见 `docs/RUNBOOK.md` §6。

---

## 📖 文档索引

| 文档 | 说明 |
|------|------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | 架构文档（系统全景、数据通路、已知坑、协作规则） |
| [docs/FEATURE_MATRIX.md](docs/FEATURE_MATRIX.md) | 功能矩阵（功能/端点状态唯一权威） |
| [docs/CLOUD_PIPELINE_GUIDE.md](docs/CLOUD_PIPELINE_GUIDE.md) | 云端定时管线指南 |
| [docs/INDEX.md](docs/INDEX.md) | 文档地图（全量索引 + 模块地图） |
| [docs/DOC_GOVERNANCE.md](docs/DOC_GOVERNANCE.md) | 文档清洁与治理规范（写作尺子 + 门禁） |
| [docs/EVAL_GUIDE.md](docs/EVAL_GUIDE.md) | 评测现状与重建原则 |
| [docs/HANDOVER.md](docs/HANDOVER.md) | 交接/对接文档（Vercel 配置、凭据速查、API 列表）⚠️ 含敏感凭据，已 gitignore |
| [docs/DEV_GUIDE.md](docs/DEV_GUIDE.md) | 开发者上手指南 |
| [docs/DEVELOPMENT_STANDARDS.md](docs/DEVELOPMENT_STANDARDS.md) | 开发规范与验收标准 |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | 运维手册 |
| [docs/ISSUES.md](docs/ISSUES.md) | 已知问题清单（活文档） |
| [docs/DELIVERY_VERIFICATION.md](docs/DELIVERY_VERIFICATION.md) | 交付验证清单 |
| [docs/NEXT-DEV-REQS.md](docs/NEXT-DEV-REQS.md) | 待开发需求 |
| [docs/pitfalls/](docs/pitfalls/) | 踩坑库（采集/后端/AI/前端/部署/测试 六域；条数以各域文件为准） |
| 功能规格件 | 在途批次的**工作文件**：判完生死即整批删，持久部分搬进 `docs/adr/` 与 `docs/features/`（规矩见 [docs/DOC_GOVERNANCE.md](docs/DOC_GOVERNANCE.md) §2.1 与 §7）。当前没有常驻的规格库 |

---

## ⚠️ 注意事项

- **上公网前必须启用 API 鉴权**：设置 `AUTH_SECRET` 为强随机字符串，修改默认 `ADMIN_USER`/`ADMIN_PASSWORD`
- **敏感文件已排除**：`cloud/token.json`、`.env`、`data/` 均在 `.gitignore` 中
- **bat 文件必须 GBK 编码**：用 `tools/gen_bat.py` 生成，不要手改
- **better-sqlite3 单进程锁**：不可 cluster 多实例，PM2 配置 `instances: 1`
- **Vercel 为读层主部署**：`api/` 目录为读 API 代码；采集/日报主链路在 GH Actions runner（`tools/collect-turso.js` 直写 Turso），本地 Express 为开发/灾备
- **凭据三处同步**：`COLLECT_KEY` / `TURSO_*` 等改值时必须同时改 本地 `.env` + Vercel env + GitHub Secrets

---

## 📄 License

Private — 个人项目，保留所有权利。
