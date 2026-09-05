# 全网情报系统（私人 AI 情报阅读器）复刻 Plan

> 依据已批准的 spec.md（52 条 F / 7 条 N / 12 条 AC / 五期交付）。
> 技术栈：Node.js 20 + Express 后端、React 18 + Vite + Tailwind 前端、SQLite 存储、PHP 云端队列、Windows 开发运行。

## 架构概览

```
┌─ 提交端 ────────────────┐   ┌─ 云端（宝塔 PHP 站点）──────────┐
│ 安卓 HTTP Shortcuts      │   │ wechat-rss-queue.php           │
│ Windows 提交工具 (PS)   │──▶│ bilibili-video-queue.php       │
│ （均：识别平台+POST）    │   │ douyin-video-queue.php (+JSON) │
└──────────────────────────┘   └──────────▲─────────────────────┘
                                          │ GET pull / clear（Token）
┌─ 本地服务（Windows，Node + Express，单进程）──────────────────────────┐
│ QueuePoller ─▶ pending 表 ─▶ 解析成正式订阅                            │
│ Scheduler ─▶ Collectors（wechat/rss/bilibili/douyin/x 适配器）─▶ SQLite │
│ DailyEngine（cron）─▶ 栏目规则 + DeepSeek ─▶ daily_reports            │
│ REST API /api/* ─▶ 前端                                                │
└───────────────────────────▲──────────────────────────────────────────┘
                            │ HTTP
┌─ 前端（React SPA，由后端静态托管）─────────────────────────────────────┐
│ /reader/ 阅读器（文章+视频）  /daily/ 日报  /wechat/ 设置（三 Tab）      │
└────────────────────────────────────────────────────────────────────────┘
```

六个组件：
- **web/**：React SPA，三页面路由（F1~F42 的界面层），三主题 CSS Variables。
- **server/**：Express 应用。REST API + 静态托管前端产物 + 三页面路由（F52）。
- **collectors/**：采集适配器框架（F49），内置 wechat、bilibili、douyin、generic-rss、x-rsshub 五个适配器（F21~F42、F47、F48）。
- **scheduler/**：node-cron + interval 调度全部定时任务（OPML/RSS/B站/抖音/队列轮询/日报生成）。
- **cloud/**：三个 PHP 队列端点 + 公共库（F43），上传宝塔站点即用。
- **tools/**：setup:customer 配置脚本（F51）、Windows 提交工具（F46）、安卓 HTTP Shortcuts JSON 生成器（F45）。

## 核心数据结构

### SQLite 表（`data/app.db`，better-sqlite3）

```sql
-- 分组（文章/视频通用，F2/F3）
groups(id INTEGER PK, kind TEXT,        -- 'article' | 'video'
       name TEXT, sort INTEGER)

-- 订阅源（全部类型统一一张表，F2/F27/F33/F42/F47/F48）
sources(id INTEGER PK, type TEXT,       -- 'wechat'|'bilibili'|'douyin'|'rss'|'x'
        name TEXT, url TEXT,            -- RSS 链接 / 主页链接
        avatar TEXT, uid TEXT,          -- B站 uid / 抖音 sec_uid
        group_id INTEGER NULL, focus INTEGER DEFAULT 0,  -- 重点关照(F18)
        enabled INTEGER DEFAULT 1,
        status TEXT DEFAULT 'ok',       -- ok|error|pending
        last_fetched_at TEXT, next_fetch_at TEXT,
        extra TEXT,                     -- JSON：Cookie 引用、平台参数
        created_at TEXT)

-- 文章（F4~F7、F47/F48 的 RSS 内容也进这里）
articles(id INTEGER PK, source_id INTEGER, title TEXT, url TEXT UNIQUE,
         author TEXT, cover TEXT, summary TEXT, content_html TEXT,
         published_at TEXT, read_at TEXT NULL,   -- 已读→历史存档
         later INTEGER DEFAULT 0,                 -- 稍后阅读
         created_at TEXT)

-- 视频（F8/F9）
videos(id INTEGER PK, source_id INTEGER, platform TEXT, -- bilibili|douyin|youtube
       title TEXT, url TEXT UNIQUE, vid TEXT,           -- bvid / 抖音 id / yt id
       cover TEXT, duration INTEGER, author TEXT, intro TEXT,
       published_at TEXT, favorite INTEGER DEFAULT 0, created_at TEXT)

-- 云端队列拉回的待处理条目（F24/F32/F42）
pending_items(id INTEGER PK, type TEXT, url TEXT, name TEXT,
              status TEXT DEFAULT 'pending',            -- pending|resolved|failed
              error TEXT, imported_at TEXT)

-- 日报（F13~F20）
daily_reports(id INTEGER PK, generated_at TEXT, window_hours INTEGER,
              stats TEXT,      -- JSON：候选数/文章数/视频数
              sections TEXT)   -- JSON：[{column, items:[{kind,ref_id,title,summary,score,...}]}]

-- 键值设置（主题、AI、日报、栏目、队列、间隔等全部配置，F11/F18/F21~F25/F50）
settings(key TEXT PK, value TEXT)      -- value 为 JSON 字符串

-- 平台登录态（F35/F37/F38）
credentials(platform TEXT PK, cookie TEXT, updated_at TEXT)
```

### 栏目配置（settings 中 `daily.columns`，F15/F18）

```json
[{ "id": "c1", "name": "培训课程发布", "desc": "课程/训练营/社群招募…",
   "keywords": ["课程","训练营","社群","招募","培训"], "builtin": false },
 { "id": "focus", "name": "重点更新", "special": "focus" },
 { "id": "c2", "name": "AI技术", "desc": "Codex、Claude…", "keywords": ["Codex","Claude","Agent","RAG","MCP"] },
 { "id": "fallback", "name": "其它重要", "special": "fallback" }]
```

### 采集适配器接口（F49，每个适配器一个 JS 模块）

```js
// collectors/<name>/index.js 导出
module.exports = {
  type: 'bilibili',
  match(url) {},                 // 识别用户粘贴的链接是否属于本类型 → false | {uid, name?}
  async resolve(input) {},       // 解析出订阅源字段 {name, url, uid, avatar}
  async fetch(source, ctx) {},   // 拉取内容 → {articles: [...], videos: [...]}
  defaultIntervalMin: 60,
}
// registry.js：const adapters = { wechat, bilibili, douyin, rss, x }；新增源 = 新增目录 + 登记一行
```

### 云端队列协议（F43，PHP 端，JSON 文件存储 `<name>-queue.json`）

```
POST <endpoint>          {token, url, name, type}   → {ok:true}
GET  <endpoint>?token=&action=pull                  → {ok:true, count:N, items:[...]}
GET  <endpoint>?token=&action=clear                 → {ok:true}
Token 错误/缺失 → 403 {ok:false, error}
```

### REST API（Express `/api`，前端唯一数据源）

| 路由 | 用途（F 映射） |
|------|---------------|
| GET `/api/articles?tab=all\|later\|history&source_id&group_id&q&cursor` | 文章列表/稍后读/历史搜索（F4/F6/F7） |
| GET `/api/articles/:id` · POST `:id/read` `:id/later` · POST `/api/articles/read-all` | 阅读/状态流转（F5/F6/F7） |
| GET `/api/videos?tab=&source_id&group_id` · GET `/api/videos/:id` · GET `/api/videos/:id/play?mode=direct\|official` · POST `:id/favorite` | 视频网格/详情/直链（F8/F9/F35） |
| GET/POST/PUT/DELETE `/api/sources?type=` · POST `:id/refresh` `:id/toggle` | 订阅源管理（F27/F30/F33/F40/F47） |
| GET/POST/PUT/DELETE `/api/groups` · POST `/api/groups/move` | 分组与拖拽（F2/F3） |
| GET `/api/status` | 三个设置 Tab 的状态卡汇总（F23/F28/F36） |
| POST `/api/opml/sync` · POST `/api/rss/refresh` | 公众号手动同步（F21/F22） |
| POST `/api/queue/sync` | 手动拉取三队列（F24/F31/F41/F44） |
| POST `/api/ai/summary` {kind, id} · GET/PUT `/api/settings/ai` | AI 速览与配置（F10/F11） |
| GET `/api/daily` · POST `/api/daily/regenerate` · GET/PUT `/api/settings/daily` | 日报与设置（F13~F19） |
| POST `/api/backup` · POST `/api/backup/restore` · GET `/api/backup/latest` | 备份恢复（F26） |
| POST `/api/auth/douyin/start` · GET `/api/auth/douyin/status` | 抖音扫码登录（F37/F38） |
| GET/PUT `/api/settings` | 间隔/队列地址等通用配置（F21~F25/F29/F39/F50） |

## 模块设计

### collectors/registry.js — 适配器登记（F49）
**职责：** 加载全部适配器，按 type 分发；新源接入 = 新增目录 + 登记。
**对外接口：** `getAdapter(type)`、`detectByUrl(url)`（提交链接自动归类，F45/F46 复用）。

### collectors/wechat — 公众号（F21~F27）
**职责：** OPML 拉取与解析（「今天看啥」）、按 OPML 中各源 RSS 链接抓文章、状态卡统计（新增/恢复/更新）。
**依赖：** rss-parser、DB、settings（间隔）。

### collectors/bilibili — B站（F28~F35）
**职责：** 主页/视频链接/uid 识别（`space.bilibili.com/(\d+)`、BV 号反查、纯数字 uid）；官方 API 拉视频列表；Cookie（credentials 表）解析 playurl 直链（F9）；失败提示文案按 spec 原样返回（F30）。
**依赖：** fetch（带 Cookie）、DB。

### collectors/douyin — 抖音（F36~F42）
**职责：** Playwright 拉起本机 Chromium 扫码登录并保存 storageState（F38）；主页/分享链接/sec_uid 识别（F40）；**严格串行队列**刷新，任务间隔 ≥10s（F39、N4）。
**依赖：** playwright、DB、credentials。

### collectors/rss — 通用 RSS/Atom（F47）
**职责：** 任意 RSS 地址订阅（YouTube 频道 RSS、Claude/OpenAI 博客）；YouTube 链接自动转为频道 RSS。

### collectors/x — X 接入（F48）
**职责：** 接收 RSSHub/第三方实例地址模板 + 用户名，拼出 RSS 后委托 rss 适配器。

### queue/poller.js — 云端队列轮询（F24/F31/F41/F44）
**职责：** 按间隔（默认 10min）依次 pull 三端点 → 写入 pending_items → clear 云端 → 异步调对应适配器 resolve 转正式订阅；失败重试只在本机记录。

### ai/deepseek.js — DeepSeek 客户端（F10/F18、N7）
**职责：** OpenAI 兼容 POST；Key 未配置时抛「未配置」；HTTP 错误码原样透传（402 等）。

### ai/summary.js — AI 速览（F10/F11）
**职责：** 取正文 → 套提示词（settings 可改、可恢复默认）→ 返回摘要；时间范围设置影响日报候选而非单篇速览。

### ai/daily.js — 日报引擎（F13~F19）
**职责：** 按统计窗口取候选 → 栏目规则引擎（focus 源全收 → 关键词命中 → fallback 兜底）→ 可选 DeepSeek 生成摘要/重要度 → 写 daily_reports；关键词排序模式不调 AI（N7 降级）。

### scheduler/index.js — 调度中心
**职责：** 注册全部定时任务：OPML（12h）、RSS（8h）、B站（60min）、抖音串行队列（360min）、队列轮询（10min）、日报 cron（每日生成时间，默认 08:00）；全部间隔读 settings，改动即重排。

### server/ — Express 应用
**职责：** 上表 REST API；静态托管 `web/dist`；`/reader/`、`/daily/`、`/wechat/` 三路由返回 SPA（F52）；敏感字段（Token/Key/Cookie）读取接口脱敏、写入接口「留空不覆盖」（N2、F18/F25）。

### web/ — React SPA
**页面：** ReaderPage（三栏 + 双 Tab + 详情页/播放器 + AI 面板 + 主题切换）、DailyPage（页头/统计卡/栏目/快速学习弹窗/设置弹窗含栏目管理）、SettingsPage（公众号/B站/抖音三 Tab 全部表单与状态卡）。
**公共：** apiClient、主题 Provider（`data-theme` + localStorage，F12/N6）、toast、相对时间格式化。

### cloud/ — PHP 队列（F43）
单文件端点 ×3 + `_queue_lib.php`（Token 校验、JSON 读写、pull/clear）。无数据库依赖，上传即用。

### tools/（F45/F46/F51）
- `setup-customer.js`：读 `config/customer-config.json` → 生成 `.env`、初始化 DB、写队列 Token、生成安卓 HTTP Shortcuts JSON、生成 Windows 提交快捷方式。
- `submit.ps1` + 桌面快捷方式（绑快捷键）：读剪贴板 → 识别平台 → 确认弹窗 → POST。
- `http-shortcuts-template.json`：按用户 Token/域名渲染导出。

## 模块交互

**采集主链路：** Scheduler 到点 → registry 取适配器 → fetch() 拉取 → 去重（url UNIQUE）入库 → 更新 sources 时间/状态 → 前端下次 GET 拿到新数据。

**提交链路（F43~F46）：** 安卓分享/Windows 快捷键 → POST PHP 队列 → QueuePoller pull → pending_items（设置页可见/可复制）→ 后台 resolve → sources 正式订阅 → clear 云端。

**AI 速览（F10）：** 前端星星按钮 → POST /api/ai/summary → 取 content_html 纯文本 → DeepSeek → 返回面板；异常透传错误码。

**日报（F13~F19）：** cron 到点（或手动重新生成）→ daily.js 取窗口内候选 → 栏目规则分栏 → 启用 AI 时逐条摘要+重要度 → 写 daily_reports → 前端展示/快速学习弹窗读同一数据源。

**抖音登录（F38）：** 前端点「打开抖音登录窗口」→ /api/auth/douyin/start → Playwright 起浏览器 → 轮询登录态 → 保存 credentials → 自动关闭 → 状态卡刷新。

**依赖方向（无环）：** web → server/routes → services（collectors/ai/queue/backup）→ db；scheduler → 同一 services 层；tools 只写配置不碰业务。

## 文件组织

```
d:\全网情报系统\
├── package.json                 — 脚本：install / start / test / setup:customer / build
├── config/customer-config.json  — F50 全部配置项（含示例值注释）
├── server/
│   ├── index.js                 — Express 入口、静态托管、三页面路由
│   ├── db.js                    — SQLite 连接 + 建表迁移
│   ├── routes/                  — articles.js videos.js sources.js groups.js
│   │                              status.js opml.js queue.js ai.js daily.js
│   │                              backup.js auth.js settings.js
│   ├── services/
│   │   ├── collectors/          — registry.js + wechat/ bilibili/ douyin/ rss/ x/
│   │   ├── queue/poller.js      — 云端队列轮询
│   │   ├── ai/deepseek.js       — AI 客户端
│   │   ├── ai/summary.js        — AI 速览
│   │   ├── ai/daily.js          — 日报引擎 + 栏目规则
│   │   ├── scheduler/index.js   — 全部定时任务
│   │   └── backup.js            — 备份/恢复（F26）
│   └── util/                    — http.js（重试/超时）、time.js、log.js
├── web/
│   ├── vite.config.js · tailwind.config.js
│   └── src/
│       ├── main.jsx · api.js · theme.jsx
│       ├── pages/ReaderPage.jsx · DailyPage.jsx · SettingsPage.jsx
│       └── components/          — Sidebar ArticleList ArticleView VideoGrid
│                                  VideoDetail AiPanel AiSettingsModal
│                                  DailyHeader StatCards ColumnSection
│                                  QuickStudyModal DailySettingsModal
│                                  WechatTab BilibiliTab DouyinTab
│                                  StatusCard SourceTable PendingList …
├── cloud/
│   ├── _queue_lib.php           — Token 校验 + JSON 存储
│   ├── wechat-rss-queue.php
│   ├── bilibili-video-queue.php
│   └── douyin-video-queue.php
├── tools/
│   ├── setup-customer.js        — F51 一键配置
│   ├── submit.ps1               — F46 Windows 提交工具
│   └── http-shortcuts-template.json — F45 安卓配置模板
├── data/                        — app.db、backups/（gitignore）
├── docs/
│   ├── DEPLOYMENT.md            — Windows 本地 + 宝塔 PHP 部署（五期）
│   └── ANDROID_SUBMIT_GUIDE.md  — HTTP Shortcuts 图文指南（F45）
└── tests/                       — 关键服务层单测（栏目规则、链接识别、队列协议）
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 后端框架 | Node.js 20 + Express 4 | 与原作一致，生态熟，Windows 零障碍 |
| 数据库 | SQLite（better-sqlite3） | 单用户本地系统零配置；同步 API 稳定；单文件天然支撑 F26 备份 |
| 前端 | React 18 + Vite + Tailwind（用户选定） | 三页面 SPA 由后端静态托管，免独立部署 |
| 主题方案 | CSS Variables + `data-theme` + localStorage | 三套主题即时切换、刷新保持（F12/N6），无闪烁 |
| 定时任务 | node-cron（日报）+ setInterval（轮询类） | cron 表达式精确到「每日 08:00」；间隔任务简单可靠 |
| RSS 解析 | rss-parser | RSS/Atom 通吃，公众号第三方源与 YouTube 复用（F21/F47） |
| B站链路 | fetch + 官方 API + Cookie 头 | 无需 RSSHub（F28）；playurl 直链支撑内嵌播放（F9/F35） |
| 抖音链路 | Playwright（本机 Chromium） | 扫码登录与登录态保存最贴近原作（F38）；严格串行队列限速（N4） |
| DeepSeek | fetch 直连 OpenAI 兼容协议 | 无 SDK 依赖；错误码原样透传（F10/N7） |
| 云端队列 | PHP 单文件 + JSON 存储 | 宝塔站点免数据库，上传即用（F43） |
| 安卓提交 | HTTP Shortcuts JSON 导入配置 | 系统分享菜单直达，等价原作快捷指令体验（F45） |
| Windows 提交 | PowerShell 脚本 + 快捷方式快捷键 | 零依赖免打包（F46）；后续可选打包 exe |
| 适配器框架 | JS 模块登记式 registry | 新源 = 新目录 + 一行登记（F49），四期海外源直接受益 |
| 敏感信息 | settings/credentials 表 + API 脱敏 + 留空不覆盖 | N2 合规，与原作「留空保留已保存」行为一致 |

## spec 覆盖对照

| spec 分组 | 归属模块 |
|-----------|---------|
| A. 阅读器 F1~F12 | web/ReaderPage + routes/articles,videos,ai + ai/summary |
| B. 日报 F13~F20 | web/DailyPage + ai/daily + routes/daily + scheduler(cron) |
| C. 设置 F21~F42 | web/SettingsPage 三 Tab + collectors 三适配器 + routes/opml,queue,auth |
| D. 队列提交 F43~F46 | cloud/ ×3 PHP + queue/poller + tools/submit.ps1 + http-shortcuts 模板 |
| E. 海外扩展 F47~F49 | collectors/rss、collectors/x、registry |
| F. 配置部署 F50~F52 | config/ + tools/setup-customer.js + server/index.js |
| N1~N7 | Windows 全栈可跑、脱敏 API、单用户 Token、抖音限速、列表分页游标、主题、AI 降级 |
