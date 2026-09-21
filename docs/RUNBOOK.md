# 全网情报系统 · 运维手册（RUNBOOK）

> 最后更新：2026-09-20（新增 **§10.9 Turso 读封锁** 排查与止血三步：症状「`/api/*` 全 500 但静态页 200、前端显示自己写的兜底文案」不是后端在施工；两条硬规矩「旧库不许删」与「换存储必须读路径 + 一次 workflow_dispatch 写路径各验一次」。来源 B118/B120）
> 上轮（09-19 夜·B101 实测加注：`cleanup` job 从未被自动触发，手动 dispatch 也选不到该 mode；09-18 代理端口统一 12000）
> 唯一现行运维文档（2026-09-04 整合自 DEPLOYMENT.md、phase9-runbook.md、批量恢复熔断源方案、源列表管理增强指南；已与当前代码核对一致，2026-09-11 复核）。
> 架构与凭据位置看根目录 `ARCHITECTURE.md`；修复历史看 `archive/docs-deprecated/A_CLASS_FIX_REPORT.md`；历史文档在 `archive/`。

## 1. 系统形态

- 单进程 Node/Express + SQLite（better-sqlite3，WAL），端口默认 3000
- 页面：`/reader/` 阅读器、`/daily/` 日报、`/hot/` 热点榜、`/admin/` 管理台（独立 bundle）
- 源类型：rss（含 wechat2rss 公众号、播客）、youtube（走官方 feed，需代理）、bilibili、douyin（Playwright，仅本地）、x（RSSHub）、hotlist（newsnow）、wechat（OPML）
- 数据：`data/app.db` + `data/backups/`；配置：`.env` + settings 表 + `config/customer-config.json`
- 云端：Vercel 读层主部署（`api/` 读 API）+ GH Actions runner 直采 Turso（方案A，详见 §10）；PHP 队列（cloud/*.php，接收手机/桌面提交链接）

## 2. 日常启停（Windows 本机）

```bat
start-all.bat          :: 一键启动（含健康检查、自动开浏览器）
restart-server.bat     :: 按 3000 端口找 PID 重启（管理员运行）
npm run build          :: 改了 web/src 后必须重建前端
```

## 3. 宝塔/服务器部署（PM2）

1. 上传代码（排除 `node_modules/ data/ .env portal/ archive/`），`npm install --production`
2. 需要抖音功能才装 Playwright：`npx playwright install chromium`（约 300MB）
3. 配 `.env`：`PORT=3000`；海外源需 `HTTPS_PROXY=http://127.0.0.1:12000`（Clash 实际端口，旧 7890 已失效；公众号/B站/抖音/AIHOT 国内源不需要代理）
   > ⚠️ **宝塔部署本身不解决海外源可达性**：能不能抓 YouTube/X 取决于服务器所在地域/出站代理，不取决于面板。国内机房服务器仍需配代理（或换海外机房）；本机之所以能抓是因为本机有代理。
   > 🔐 **API 鉴权已上线（2026-09-05，本地/云端一致）**：公开 GET 无需鉴权；写操作（POST/PUT/DELETE）需 `Authorization: Bearer <JWT>`，经 `POST /api/auth/login`（ADMIN_USER/ADMIN_PASSWORD）换取，7 天有效，签名密钥 `AUTH_SECRET`。上公网仍需确认 `.env` 已配置这三个变量。
4. `npm run build` → `npm run pm2:start` → `pm2 save` → `pm2 startup`（开机自启）
5. Nginx 反代 `http://127.0.0.1:3000`，`client_max_body_size 10m`
6. 日志：`npm run pm2:logs`；建议 `pm2 install pm2-logrotate`（50M × 7 天）
7. Node 版本：20+ 可用，推荐 24（本机实测版本；better-sqlite3 随 npm install 自动编译对应 ABI）

## 4. 云端队列（PHP，可选）

`cloud/` 下 5 个文件（_queue_lib.php、wechat-rss-queue.php、bilibili-video-queue.php、douyin-video-queue.php、token.json）传到任意 PHP 站点根目录即用；Token 即全部鉴权（token.json 勿泄露）。本地每 10min 轮询拉取并清空云端；云端等价入口 `POST /api/queue/sync`（拉 PHP 云端队列 → pending_items → 清云端，需鉴权）。安卓端配置见 `docs/ANDROID_SUBMIT_GUIDE.md`。

## 5. 熔断与恢复

- 规则：源连失 3 次自动 `enabled=0`（熔断）；恢复时 fail_count 清零
- **例外（2026-09-11）**：云端链路（api/collect.js、tools/collect-turso.js）对 `youtube` 类型阈值放宽为 10 次——YouTube 对数据中心 IP 反爬返回假 404/500，3 次会误杀活源；本地 Express 调度器仍为 3 次
- **统一解冻语义**（`store.unfreezeSource`）：enabled=1 + fail_count=0 + 清 extra.lastError/lastErrorAt，保留 intervalMin/etag
- 入口（任选）：管理台各 Tab「批量恢复」按钮 → `POST /api/sources/restore-all`（支持 `type` 过滤、`refreshImmediately`，立即刷新软上限 20）；CLI `node tools/ops-toolkit.js unfreeze [--yes]`；单源用 toggle 开关
- ⚠️ 不要再手写 SQL 清 extra——intervalMin 存在 extra 里，整体清空会让源级间隔静默回退默认值

## 6. 健康自检与报警

```powershell
npm test                      # 回归测试（通过数以实际输出为准）
node smoke-test.js            # 冒烟（跑生产库副本，零副作用）
node tools/audit-cloud.js     # 云端 19 项自检
node tools/ops-toolkit.js check    # 健康总览
node tools/ops-toolkit.js frozen   # 熔断源清单
node tools/ops-toolkit.js diagnose-bili  # B 站 WBI/Cookie 诊断
```

系统内置每 5min 采集停滞自检（启动 30min 后生效，1h 内 0 成功刷新→报警）。报警渠道（钉钉/企微/飞书/Server酱/Bark/TG/webhook）在管理台「报警管理」Tab 配置。

## 7. 数据管理

- 整库快照/恢复/按天清理：管理台「数据」Tab（快照在 `data/backups/app-*.db`，支持上传导入；恢复为八表同事务整库回滚，有二次确认）
- 保留天数：`settings.data.retentionDays`（默认 7，本地清理定时任务每 24h 执行，数据 Tab 改动即生效）。
  **本地端只清队列与本地产物，不删内容**：`articles`/`videos` 在 `lib/retention.js` 的 `local` 作用域里是 `skip`（本地库的角色是灾备副本，AGENTS §1；B102 收口，用户 09-20 决定）。
  删除/保留谓词**全库只有 `lib/retention.js` 一份**，三端（本地 / GH runner / 云端手动端点）都从它取，白盒 W17 扫"绕过它的第二份时间窗删除"。
  **如实说明覆盖面**（09-21 复核）：`api/[...slug].js` 的 `ARTICLE_CLEAN_WHERE` 与 `tools/archive-articles.js` 的"搬进 `articles_archive` 再按 id 删"**两处还没收进来**，W17 对前者按整文件记账豁免、对后者因"DELETE 里没有 `< ?` 形状"而放过（分别记在 B102 残余与 B132）。所以"扫不到红"不等于"只有一份"。
- **内容级转储与回放演练（B103，删除类改动的硬前置）**：`npm run dump:content -- --scope cloud`（增量；首轮加 `--full`）把 `articles`/`videos` 导成 gzip NDJSON 分片 + sha256 清单，落在 `data/content-dump/cloud/`（`/data/` 已 ignore）。
  核对与演练：`npm run dump:content -- --scope cloud --verify` → `npm run dump:gate -- --max-age-hours 48`（`allowed:false` 即不许执行任何删除）→ `npm run dump:content -- --scope cloud --restore --mktarget --into data/rehearse/app.db`（把云端全量放回一个空库，用来证明"删得回来"）。
  09-21 首轮实测：云端 59,832 文章 + 1,291 视频 = 161.6MB / 154 片，回放 17.6s 行数全等、抽样 12 行 × 23 列逐字段 0 不一致。⚠️ **它仍只是工具**：runner 的 `runCleanup` 还没在 DELETE 前调这道闸（接线随 B101）。
- 配置轻量迁移（仅 sources/groups/settings JSON）：管理台「公众号 RSS」Tab 底部——与整库快照用途不同，勿混淆
- 搬机：拷贝 `data/` + `.env` + `config/customer-config.json`，新机器 `npm install && npm run build && npm start`
- 云端（Vercel/Turso）语义不同：配置备份存 `settings.backup.latest`（`POST /api/backup` / `GET /api/backup/latest` / `POST /api/backup/restore`）；文件型整库快照云端不可用（`/api/data/snapshot|restore|upload` 返回 501），用配置备份替代

## 8. 源管理要点

- 添加：管理台对应 Tab 粘贴链接（自动识别类型）；源级刷新间隔在源行内编辑器设置（存 extra.intervalMin，优先于全局 settings.intervals）
- 公众号：2026-09-04 起全部走 wechat2rss 托管 RSS（375 源，分组「公众号」）；we-mp-rss 已退役；新增公众号源用 `tools/import-bestblogs-opml.js`（幂等，可重跑）或手动加 rss 源
- 热榜：`hotlist://{newsnow源id}`，公共实例失效可自建 newsnow 后改 settings `hotlist.baseUrl`（已知失效：kuaishou、36kr 全系）
- X/Twitter：配置 RSSHub 地址模板后加用户名（公共实例大多需自建授权）
- 抖音：严格串行 ≥10s 间隔（防风控）；登录态在管理台抖音 Tab 扫码（有头浏览器，存 credentials 表）

## 9. 常见问题

- **视频/B站抓不到（412/-352/-799）**：配 B站 Cookie（管理台 B站 Tab）；未配置时走合集+搜索兜底
- **源被自动暂停**：连失 3 次熔断，见 §5 恢复
- **海外源抓不到**：配代理环境变量后重启（见 §3.3）
- **GBK 页面乱码**：rss 适配器已做 charset 嗅探（gb18030/big5）；存量乱码用标题特征检测后重抓
- **端口被占**：`.env` 改 `PORT`
- **图片不显示**：微信图片走 `/api/img` 代理（SSRF 防护+7 天缓存）；wechat2rss 图片由对方 img-proxy 代理（单点依赖，已知情接受）

## 10. Vercel 主部署运维（2026-09-11 方案A 后）

定时管线全部在 GH Actions runner 内执行 `tools/collect-turso.js` 直写 Turso，
**不再**调用 Vercel 函数（Hobby 10s 限制）。无需手动干预：

```powershell
# GH Actions 定时任务（北京时间）
# 采集：每 15 分钟（UTC :07/:22/:37/:52）+ cron-job.org 双保险（jobId 8430047，每 15min POST workflow_dispatch）
#                          node tools/collect-turso.js collect
# 日报：09:03                 node tools/collect-turso.js daily          ← 非 AI 兜底批（坑 #32 / 不变量 12）
# AI 早报：21:30 主批 / 00:32 备跑   node tools/collect-turso.js daily-ai [--rolling24]
# 周刊：周五 18:03             node tools/collect-turso.js weekly
#                          node tools/generate-snapshots.js（push 回仓库）
# 清理：04:13                 node tools/collect-turso.js cleanup
#   ⚠️ 实测（2026-09-19 夜，B101）：**这个 job 从来没被自动跑过**——它的 if 只认 `github.event.schedule == '13 20 * * *'`，
#   而主力触发是 cron-job.org 的 workflow_dispatch（mode 选项里没有 cleanup）→ 每个 dispatch 批次它都是 skipped。
#   现在去 GitHub → Actions → Run workflow 也**选不到 cleanup**，要清只能手动跑上面这条命令（需 TURSO_* 环境变量）。
#   判"到底跑没跑"的硬证据：`settings['cloud.collect'].history[].mode` 里有没有 cleanup（本轮实读 168 轮 = 0 次）。
# （cron 表达式以 .github/workflows/collect.yml 为唯一事实源，本段只标北京时刻）

# 手动触发：GitHub → Actions → collect → Run workflow → 选 mode
#   ⚠️ 更正（2026-09-18）：原先写「四个 job 全跑」是错的——不带 mode 的 dispatch 只跑 collect。
#   现在 mode 可选：collect（默认）/ daily-ai-evening / daily-ai / mybrief / weekly。
#   cron-job.org 每 15min 的不带 inputs dispatch 会取默认 collect，行为不变（不变量 9）。
# 本地手动直采（读本地 .env 的 TURSO_* / HTTPS_PROXY）
node tools/collect-turso.js collect

# ⚠️ push 之后必须验部署，否则「代码修了但线上还是旧 bundle」（2026-09-18 实测连续 4 次 Error 无人发现）
git push origin main
npx vercel ls | head -6          # 最新一条必须是 ● Ready，不是 ● Error
npx vercel inspect <部署地址> --logs | grep -iE "error|Could not resolve"

# 备份端点（Vercel 函数仍可用，仅手动救急；Hobby 10s 单次仅 2 源）
curl -X POST "https://qwis-intel.vercel.app/api/collect?key=$COLLECT_KEY"
curl -X POST "https://qwis-intel.vercel.app/api/daily-generate?key=$COLLECT_KEY"

# 云端采集停滞排查 playbook：
#   1) 查采集心跳：Turso settings 表 key='cloud.collect' 的 lastRunAt（>30min 未更新即停滞），
#      或 GET /api/health/status 的 collect 字段
#   2) 看 GH Actions 日志：github.com/ghoustghoust/qwis-portal/actions → collect 工作流最近运行
#   3) 查 cron-job.org 执行历史（jobId 8430047）：外部双保险触发器是否成功 dispatch
# 查看 Vercel 部署日志
# Vercel Dashboard → Project → Deployments → Functions → Logs
```

## 10.9 Turso 读封锁：`BLOCKED: SQL read operations are forbidden`（2026-09-20 实遇，B118）

**症状**：线上 `/api/*` 全 500（`error` 里带 `BLOCKED: …reads are blocked…`），静态 HTML 仍 200，
前端于是显示自己写的兜底文案（如 `web/src/components/HotEvents.jsx` 的「热点榜服务尚未就绪」）——
**那句话不是"后端在施工"，是 500 的兜底**，别照着它去查代码。

**三步定性（都是只读，几分钟内可做完）**：

1. 打 `/api/meta`：若 500 且文案含 `BLOCKED` → 进第 2 步（不是路由问题）。
2. **绕开 Vercel 直连 Turso** 跑一条最小 `SELECT COUNT(*) FROM sources`：同样 `BLOCKED` ⇒ 封锁在
   provider 侧（账号/DB 配额），与本次部署无关；全仓 grep 该文案 0 命中可佐证不是我们的字符串。
3. 看 Turso 控制台 Quota。**本仓没有 Turso 平台 API token，配额无法程序化观测**（B119 ④）——
   这一条是"挂了几小时没人知"的直接原因，只能人工看盘。

**止血顺序（本轮实际做法）**：新建库 → 以本地灾备在线备份为基线搬 schema/十表 →
源库按 `public/data/sources.json` 快照恢复 → **凭据三处同步**（本地 `.env` / Vercel env /
GH Secrets，AGENTS §2.6）→ **必须用一次 workflow_dispatch 复验 runner 真写进新库**
（看 `settings['cloud.collect']` 心跳与 articles 增长，不能只看 `/api/meta` 变绿）。

**两条硬规矩**：
- **旧库不许删**。读封锁是配额事件，重置/升级后旧库仍可回读——本轮 `settings.weekly.archive`
  （5 期周刊归档、107,918B）只存在于旧库，是**唯一能无损补回的路径**。
- **换库后必查"哪些键来自本地副本而非云端"**：`tools/migrate-to-turso.js` 搬的是本地 settings，
  云端独有的键会静默丢失；实测口径见 `docs/ISSUES.md` B118/B119 与 `HANDOVER.md` §2.1「换库记录」。

## 11. 热点榜/日报机制速查

- 热点榜数据源：AIHOT 聚合源文章（extra.aggregator=1），分类映射六胶囊（模型/产品/行业/论文/教程/观点）
- 事件榜：近 72h 全域条目 Jaccard(≥0.4) 聚类，热度=Σ权重×24h 半衰×1.5^(信源数-1)，缓存 5min
- 日报：每天 09:03（北京时间，GH Actions runner 生成；本地为 settings daily.time 默认 08:00）
- 全文补抓：每 6h（02/08/14/20 点）补抓 <1000 字符的薄内容，限速 2s/条
