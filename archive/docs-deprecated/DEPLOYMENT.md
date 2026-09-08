# 部署文档（DEPLOYMENT）

全网情报系统 = 本地 Node 服务（三页面 Web）+ 云端 PHP 队列（接收手机/桌面提交的链接）+ 提交端配置（安卓 HTTP Shortcuts / Windows 提交工具）。

- 本地服务：`server/`（Express + SQLite），页面地址 `/reader/`（阅读器）、`/daily/`（日报）、`/wechat/`（订阅设置）
- 云端队列：`cloud/` 下 4 个 PHP 文件 + `token.json`，上传到任意 PHP 站点根目录即用
- 数据：全部在本地 `data/app.db`（SQLite 单文件）+ `data/backups/`

---

## 一、Windows 本地部署（全新机器）

### 1. 安装 Node.js

安装 Node.js 20 或更高版本（LTS）：https://nodejs.org/

验证：

```powershell
node -v   # 应 >= v20
npm -v
```

### 2. 安装依赖

在项目根目录执行：

```powershell
npm install
```

首次安装会编译 better-sqlite3 并下载 Playwright 浏览器（抖音功能需要）。如 Playwright 浏览器未自动下载：

```powershell
npx playwright install chromium
```

### 3. 填写客户化配置

编辑 `config/customer-config.json`（字段说明见文件内 `_comment`）：

| 字段 | 说明 |
|------|------|
| `opmlUrl` | 公众号 OPML 订阅地址（如「今天看啥」提供），可留空后在设置页填 |
| `cloudBaseUrl` | 云端队列域名（宝塔 PHP 站点根地址，不带结尾斜杠），如 `https://api.example.com` |
| `apiToken` | 云端队列 Token；留空则由 setup 自动生成 48 位随机值 |
| `deepseekKey` | DeepSeek API Key；留空则 AI 功能整体关闭（其余功能正常） |
| `bilibiliCookie` | B站 Cookie；留空也能订阅，配了才能在详情页解析直链内嵌播放 |
| `douyinLoginMode` | `qrcode`（扫码，推荐）/ `cookie` |
| `intervals` | 刷新间隔：opml/rss 单位小时，bilibili/douyin/queue 单位分钟 |
| `generateClients` | 是否生成安卓/Windows 提交端配置 |

### 4. 一键初始化

```powershell
npm run setup:customer
```

该脚本会：生成 `.env`（含 Token）→ 初始化 `data/app.db` 并写入 settings → 生成 `cloud/token.json` → 生成 `data/http-shortcuts.json`（安卓导入配置）→ 生成 `tools/submit-config.json` 与桌面快捷方式 `submit.lnk`（Ctrl+Alt+Q 提交剪贴板链接）。

### 5. 构建前端并启动

```powershell
npm run build
npm start
```

### 6. 访问三页面

| 页面 | 地址 |
|------|------|
| 阅读器 | http://localhost:3000/reader/ |
| 每日情报日报 | http://localhost:3000/daily/ |
| 订阅源设置 | http://localhost:3000/wechat/ |

验证（PowerShell）：

```powershell
curl.exe -s -o NUL -w "%{http_code}" http://localhost:3000/reader/    # 200
curl.exe -s -o NUL -w "%{http_code}" http://localhost:3000/daily/     # 200
curl.exe -s -o NUL -w "%{http_code}" http://localhost:3000/wechat/    # 200
```

改端口：在 `.env` 中加 `PORT=3100`。

---

## 二、Linux 服务器部署（宝塔面板 + PM2）

适用于将系统部署到一台 Linux 服务器，实现无人值守自动采集。与 Windows 本地部署共用同一份代码，区别在于进程管理（PM2 守护代替 bat 启动）和反向代理（Nginx 代替直连 :3000）。

### 1. 宝塔面板安装软件

在宝塔面板「软件商店」安装：

| 软件 | 版本要求 | 用途 |
|------|----------|------|
| Node.js 管理器 | Node 20+ | 运行 Express 服务 |
| Nginx | 任意 | 反向代理 + SSL |
| PM2 管理器 | 最新 | 进程守护（Node.js 管理器自带） |
| PHP | 7.4+（可选） | 云端队列 PHP 站点（同服务器时） |

### 2. 上传项目

通过宝塔文件管理器或 scp/rsync 上传项目到服务器（如 `/www/wwwroot/qwis/`）。排除以下目录：

```
node_modules/    # 服务器上 npm install 重新生成
data/            # 运行后自动生成（或从本地迁移时单独拷贝）
.env             # 敏感配置，单独处理
portal/          # Vercel 项目，服务器不需要
analysis/        # 分析截图，运行不需要
```

### 3. 安装依赖

```bash
cd /www/wwwroot/qwis
npm install --production
# 如果需要抖音功能（Playwright 浏览器 ~300MB）：
npx playwright install chromium
# 如果不需要抖音功能，跳过上面这行即可
```

### 4. 配置 .env

在宝塔文件管理器中创建 `/www/wwwroot/qwis/.env`：

```env
PORT=3000

# 如果需要访问海外源（YouTube/X/海外 RSS），配置代理：
HTTPS_PROXY=http://127.0.0.1:7890
HTTP_PROXY=http://127.0.0.1:7890
NO_PROXY=localhost,127.0.0.1,api.deepseek.com,mmbiz.qpic.cn,qpic.cn,wx.qlogo.cn,newsnow.busiyi.world

# 云端队列（PHP 队列在同服务器或独立域名）
CLOUD_BASE_URL=https://api.example.com
API_TOKEN=你的Token

# we-mp-rss 公众号采集引擎
WEMP_BASE_URL=http://127.0.0.1:8001
WEMP_USERNAME=admin
WEMP_PASSWORD=你的密码
```

> 代理说明：公众号/B站/抖音/AIHOT 等国内源不需要代理。只有 YouTube/X/海外 RSS 需要。如不需要海外源，删除代理相关行即可。

### 5. 一键初始化

```bash
npm run setup:customer
```

脚本会自动检测 Linux + PM2 环境并给出服务器部署指引。生成的 `ecosystem.config.js` 使用相对路径（`__dirname`），无需修改。

### 6. 构建前端

```bash
npm run build
```

### 7. PM2 启动与开机自启

```bash
# 启动（PM2 守护，崩溃自动重启）
npm run pm2:start

# 保存进程列表
pm2 save

# 生成 systemd 开机自启单元
pm2 startup
# 按提示执行输出的命令（通常是一行 sudo env PATH=... 的命令）
```

验证：

```bash
pm2 status                    # 应看到 qwis-server online
curl http://localhost:3000/api/status  # 应返回 JSON
```

### 8. Nginx 反向代理

宝塔面板 → 网站 → 添加站点：

- 域名：如 `qwis.example.com`（已解析到服务器 IP）
- PHP 版本：纯静态
- 申请 SSL 证书（Let's Encrypt 免费证书）

站点设置 → 反向代理 → 添加：

```nginx
目标URL: http://127.0.0.1:3000
发送域名: $host
```

或在站点配置文件中手动添加：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 10m;
}
```

验证：浏览器访问 `https://qwis.example.com/reader/` 应看到阅读器页面。

### 9. 日志查看与故障排查

```bash
# 实时日志
npm run pm2:logs

# 查看错误日志
pm2 logs qwis-server --err --lines 50

# 重启服务
npm run pm2:restart

# 查看进程状态与内存占用
pm2 status
```

### 10. 数据备份与升级

```bash
# 数据备份（整库快照，推荐加入 crontab 每天自动执行）
crontab -e
# 添加：0 3 * * * cp /www/wwwroot/qwis/data/app.db /www/wwwroot/qwis/data/backups/app-$(date +\%Y\%m\%d).db

# 代码升级
rsync -avz --exclude node_modules --exclude data --exclude .env /本地路径/ root@服务器:/www/wwwroot/qwis/
cd /www/wwwroot/qwis && npm install --production && npm run build
npm run pm2:restart
```

### 11. we-mp-rss 公众号引擎（可选）

如果需要公众号采集功能，需要在服务器上部署 we-mp-rss（Python/FastAPI）。可通过 PM2 管理：

在 `ecosystem.config.js` 的 `apps` 数组中追加：

```javascript
{
  name: 'we-mp-rss',
  script: 'main.py',
  cwd: '/www/tools/we-mp-rss',
  interpreter: 'python3',
  autorestart: true,
  env: { PORT: '8001' },
  error_file: '/www/wwwroot/qwis/data/logs/wemp-error.log',
  out_file: '/www/wwwroot/qwis/data/logs/wemp-out.log',
}
```

### 12. 日志轮转（防磁盘爆满）

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M    # 单文件最大 50MB
pm2 set pm2-logrotate:retain 7         # 保留 7 天
pm2 set pm2-logrotate:compress true    # 旧日志压缩
```

### 13. 健康自检

系统内置每 5 分钟健康自检（启动 30 分钟后生效）：检查最近 1 小时内是否有源成功刷新。如果采集停滞，会通过已配置的报警渠道（钉钉/Server酱/飞书等）发送通知。无需额外配置，配合报警渠道使用即可。

---

## 三、云端队列部署（宝塔 PHP 站点）

云端只需一个支持 PHP 的静态站点（无需数据库、无需 composer）。文件存储，Token 鉴权。

### 1. 建站

宝塔面板 → 网站 → 添加站点：

- 域名：如 `api.example.com`（已解析到服务器）
- PHP 版本：7.4+（任意主流版本，纯文件操作）
- 数据库：不需要
- 建议配置 SSL 证书（Token 走 HTTPS 传输）

### 2. 上传文件

将本项目 `cloud/` 目录下 **5 个文件** 上传到站点根目录（如 `/www/wwwroot/api.example.com/`）：

```
_queue_lib.php               # 公共库（Token 校验 + flock 文件锁存储）
wechat-rss-queue.php         # 公众号文章队列
bilibili-video-queue.php     # B站队列
douyin-video-queue.php       # 抖音队列
token.json                   # {"token":"..."} —— setup:customer 自动生成，必须与本地 .env 的 API_TOKEN 一致
```

权限建议：文件 644，目录 755；站点运行用户（www）对根目录可写（队列 JSON 会就地生成 `wechat-queue.json` 等）。

> 安全提示：`token.json` 切勿泄露、切勿提交到公开仓库。Token 即全部鉴权（单用户系统，N3）。

### 3. 验证（curl 全流程）

假设域名为 `https://api.example.com`，Token 为 `<TOKEN>`：

```powershell
# 错误 Token → 403 {"ok":false,"error":"bad token"}
curl.exe "https://api.example.com/wechat-rss-queue.php?token=wrong"

# push 一条公众号链接
curl.exe -X POST "https://api.example.com/wechat-rss-queue.php" -H "Content-Type: application/json" -d "{\"token\":\"<TOKEN>\",\"url\":\"https://mp.weixin.qq.com/s/xxx\",\"name\":\"测试\"}"

# pull → {"ok":true,"count":1,"items":[...]}
curl.exe "https://api.example.com/wechat-rss-queue.php?token=<TOKEN>&action=pull"

# clear → {"ok":true}，再 pull 应 count=0
curl.exe "https://api.example.com/wechat-rss-queue.php?token=<TOKEN>&action=clear"
```

三个端点结构一致，仅队列名与链接类型校验不同（wechat 仅收 `mp.weixin.qq.com` 链接；bilibili 收 B站链接/uid；douyin 收抖音链接/sec_uid）。

### 4. 本地对接

`config/customer-config.json` 的 `cloudBaseUrl` 填站点根地址（不带结尾斜杠），重新执行 `npm run setup:customer`；或在设置页各 Tab 的「队列 API」折叠区填地址与 Token。本地默认每 10 分钟轮询拉取，拉取后立即清空云端（失败重试只在本机追踪）。

---

## 四、安卓提交配置

`npm run setup:customer` 会生成 `data/http-shortcuts.json`（已填入域名与 Token）。安装与使用步骤见：

**[docs/ANDROID_SUBMIT_GUIDE.md](../../docs/ANDROID_SUBMIT_GUIDE.md)**

链路：安卓分享菜单 → HTTP Shortcuts → 确认弹窗 → POST 云端队列 → 本地 10 分钟内自动拉取入库。

Windows 桌面端：复制链接后按 **Ctrl+Alt+Q**（桌面 `submit.lnk` 调 `tools/submit.ps1`），弹确认框后提交到对应队列。

---

## 五、测试与验证

```powershell
npm test                    # 关键单测：日报栏目规则 / B站抖音链接识别 / 云端队列协议（便携 PHP 起真实服务）
node tools/perf-check.js    # 性能验证：灌 1000 视频 + 5000 文章，实测 API 耗时 + 虚拟滚动（Playwright）
node tools/recovery-check.js # 异常恢复验证：断网自动暂停 / 重启恢复 pending / 恢复联网自动继续
```

以上测试全部使用独立临时数据库与临时端口，不触碰 `data/app.db`。

---

## 六、数据备份与搬机

- 备份：设置页「数据备份」区一键备份，生成 `data/backups/subscriptions-yyyymmdd-hhmmss.json`（订阅源/分组/设置）
- 搬机：整目录拷贝（或至少 `data/` + `.env` + `config/customer-config.json`），新机器上 `npm install && npm run build && npm start`
- 敏感信息（Token / DeepSeek Key / Cookie）只存在于本地 `.env`、`data/app.db`、`cloud/token.json`，不会出现在日志与接口响应中（N2）

---

## 七、常见问题（FAQ）

### 1. AI 速览/日报报 `DeepSeek API HTTP 402`

DeepSeek 账户余额不足。到 https://platform.deepseek.com/ 充值后重试即可。Key 未配置或调用失败时系统整体降级为关键词规则排序，阅读器与日报其余功能不受影响（N7）。

### 2. B站视频列表抓不到 / 提示风控（412、-352、-799）

- 未配 Cookie 时系统会自动申请匿名 buvid 并走「合集 + 搜索」兜底链路，一般仍可抓到；
- 配置有效 B站 Cookie（设置页 B站 Tab，浏览器 F12 从 bilibili.com 请求头复制完整 Cookie）可显著提高成功率并解锁详情页直链内嵌播放；
- Cookie 失效（B站登录过期）时按同上方式重新复制粘贴保存即可，无需重启。

### 3. RSSHub 实例选择（X/Twitter 订阅）

- 公共实例（如 `https://rsshub.app`）对 X 路由大多需要自建授权，不稳；推荐自建 RSSHub（Docker 一行起）或使用提供 X 路由的第三方 RSS 服务；
- 在设置页配置 RSSHub 地址模板（如 `https://你的实例/twitter/user/{name}`）后，添加 X 用户名即可订阅；
- 该链路依赖第三方服务可用性，属预期边界（spec「不做的事」）。

### 4. 抖音登录与抓取

- 首次使用：设置页抖音 Tab → 扫码登录 → 本机浏览器打开抖音登录页 → 手机抖音扫码 → 检测到登录态自动关窗并保存；
- 登录态保存在本地 `data/app.db`（credentials 表），过期后状态卡显示未登录，重新扫码即可；
- 抖音刷新严格串行，任意两次主页访问间隔 ≥10 秒（防风控，N4），抓取慢属正常现象。

### 5. 海外源（YouTube / X / 官网博客）抓不到

本机需要能访问外网（代理）。Node 进程默认不走系统代理，需设置环境变量后启动：

```powershell
$env:HTTPS_PROXY="http://127.0.0.1:7890"   # 按实际代理端口
npm start
```

公众号 / B站 / 抖音源不依赖外网，无需代理。

### 6. 源被「自动暂停」

某源连续抓取失败 3 次会被自动暂停（开关置为停用，状态卡可见原因）。排查原因（断网 / Cookie 失效 / 源地址变更）后，在设置页重新打开该源开关即可恢复，失败计数自动清零。

### 7. 端口被占用

`.env` 中修改 `PORT`，或在启动前临时指定：

```powershell
$env:PORT=3100; npm start
```
