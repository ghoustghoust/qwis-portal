# 全网情报系统 · 运维手册（RUNBOOK）

> 唯一现行运维文档（2026-09-04 整合自 DEPLOYMENT.md、phase9-runbook.md、批量恢复熔断源方案、源列表管理增强指南，已与当前代码核对一致）。
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
3. 配 `.env`：`PORT=3000`；海外源需 `HTTPS_PROXY=http://127.0.0.1:7890`（公众号/B站/抖音/AIHOT 国内源不需要代理）
   > ⚠️ **宝塔部署本身不解决海外源可达性**：能不能抓 YouTube/X 取决于服务器所在地域/出站代理，不取决于面板。国内机房服务器仍需配代理（或换海外机房）；本机之所以能抓是因为本机有代理。
   > 🔐 **上公网前必须启用 API 鉴权**：当前本地 /api/* 统一放行（含上传快照/整库恢复/删源等写接口），Nginx 暴露公网前必须先启用 API_TOKEN 鉴权（middleware/auth.js 移到路由挂载前 + 前端 Bearer 注入），否则任何人可读写全库。
4. `npm run build` → `npm run pm2:start` → `pm2 save` → `pm2 startup`（开机自启）
5. Nginx 反代 `http://127.0.0.1:3000`，`client_max_body_size 10m`
6. 日志：`npm run pm2:logs`；建议 `pm2 install pm2-logrotate`（50M × 7 天）
7. Node 版本：20+ 可用，推荐 24（本机实测版本；better-sqlite3 随 npm install 自动编译对应 ABI）

## 4. 云端队列（PHP，可选）

`cloud/` 下 5 个文件（_queue_lib.php、wechat-rss-queue.php、bilibili-video-queue.php、douyin-video-queue.php、token.json）传到任意 PHP 站点根目录即用；Token 即全部鉴权（token.json 勿泄露）。本地每 10min 轮询拉取并清空云端。安卓端配置见 `docs/ANDROID_SUBMIT_GUIDE.md`。

## 5. 熔断与恢复

- 规则：源连失 3 次自动 `enabled=0`（熔断）；恢复时 fail_count 清零
- **例外（2026-09-11）**：云端链路（api/collect.js、tools/collect-turso.js）对 `youtube` 类型阈值放宽为 10 次——YouTube 对数据中心 IP 反爬返回假 404/500，3 次会误杀活源；本地 Express 调度器仍为 3 次
- **统一解冻语义**（`store.unfreezeSource`）：enabled=1 + fail_count=0 + 清 extra.lastError/lastErrorAt，保留 intervalMin/etag
- 入口（任选）：管理台各 Tab「批量恢复」按钮 → `POST /api/sources/restore-all`（支持 `type` 过滤、`refreshImmediately`，立即刷新软上限 20）；CLI `node tools/ops-toolkit.js unfreeze [--yes]`；单源用 toggle 开关
- ⚠️ 不要再手写 SQL 清 extra——intervalMin 存在 extra 里，整体清空会让源级间隔静默回退默认值

## 6. 健康自检与报警

```powershell
npm test                      # 回归测试（191 项，187 通过，2026-09-11）
node smoke-test.js            # 冒烟（跑生产库副本，零副作用）
node tools/audit-cloud.js     # 云端 19 项自检
node tools/ops-toolkit.js check    # 健康总览
node tools/ops-toolkit.js frozen   # 熔断源清单
node tools/ops-toolkit.js diagnose-bili  # B 站 WBI/Cookie 诊断
```

系统内置每 5min 采集停滞自检（启动 30min 后生效，1h 内 0 成功刷新→报警）。报警渠道（钉钉/企微/飞书/Server酱/Bark/TG/webhook）在管理台「报警管理」Tab 配置。

## 7. 数据管理

- 整库快照/恢复/按天清理：管理台「数据」Tab（快照在 `data/backups/app-*.db`，支持上传导入；恢复为八表同事务整库回滚，有二次确认）
- 保留天数：`settings.data.retentionDays`（默认 7，清理定时任务每 24h 执行，数据 Tab 改动即生效）
- 配置轻量迁移（仅 sources/groups/settings JSON）：管理台「公众号 RSS」Tab 底部——与整库快照用途不同，勿混淆
- 搬机：拷贝 `data/` + `.env` + `config/customer-config.json`，新机器 `npm install && npm run build && npm start`

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
# 采集：每 30 分钟（:07/:37）  node tools/collect-turso.js collect
# 日报：09:03                 node tools/collect-turso.js daily
# 快照：09:33                 node tools/generate-snapshots.js（push 回仓库）
# 清理：04:13                 node tools/collect-turso.js cleanup

# 手动触发：GitHub → Actions → collect → Run workflow（四个 job 全跑）
# 本地手动直采（读本地 .env 的 TURSO_* / HTTPS_PROXY）
node tools/collect-turso.js collect

# 备份端点（Vercel 函数仍可用，仅手动救急；Hobby 10s 单次仅 2 源）
curl -X POST "https://qwis-intel.vercel.app/api/collect?key=$COLLECT_KEY"
curl -X POST "https://qwis-intel.vercel.app/api/daily-generate?key=$COLLECT_KEY"

# 采集停滞排查：查 Turso settings 表 key='cloud.collect' 的 lastRunAt 心跳
# 查看 Vercel 部署日志
# Vercel Dashboard → Project → Deployments → Functions → Logs
```

## 11. 热点榜/日报机制速查

- 热点榜数据源：AIHOT 聚合源文章（extra.aggregator=1），分类映射六胶囊（模型/产品/行业/论文/教程/观点）
- 事件榜：近 72h 全域条目 Jaccard(≥0.4) 聚类，热度=Σ权重×24h 半衰×1.5^(信源数-1)，缓存 5min
- 日报：每天 09:03（北京时间，GH Actions runner 生成；本地为 settings daily.time 默认 08:00）
- 全文补抓：每 6h（02/08/14/20 点）补抓 <1000 字符的薄内容，限速 2s/条
