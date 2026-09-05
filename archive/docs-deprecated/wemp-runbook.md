> ⚠️ **已废弃(2026-09-04)**:we-mp-rss 已退役,公众号改走 wechat2rss 托管 RSS(见 ARCHITECTURE.md §0/§8.2)。本文仅供历史参考。

# we-mp-rss 运行手册（全网情报系统 · 微信公众号源）

> 本文所有命令均为 2026-08-27 实际部署执行记录，照做即可复现。
> 环境：Windows 10/11 · Python 3.13.12（uv 独立管理）· Node v24.14.1 · 代理 127.0.0.1:7890

## 0. 架构一图流

你的微信扫码 → we-mp-rss(8001, 微信读书通道) → data/db.db (SQLite)
                     ↓ GET /feed/{feedId}.atom   （无鉴权 RSS 全文输出）
             情报系统(3000) sources 表 type=wemp
                     ↓ rssAdapter 定时抓取（现成调度器）
              articles 表 → AI 日报 / 阅读器

## 1. 安装（从零开始）

```powershell
# 1) 克隆（本机 github 直连超时，必须走代理）
git -c http.proxy=http://127.0.0.1:7890 -c https.proxy=http://127.0.0.1:7890 clone --depth 1 https://github.com/rachelos/we-mp-rss.git D:\tools\we-mp-rss
cd D:\tools\we-mp-rss

# 2) 独立 Python 3.13（uv 已装 3.13.12；不用系统默认 python）
uv python install 3.13
$py = "C:\Users\17619\AppData\Roaming\uv\python\cpython-3.13.12-windows-x86_64-none\python.exe"
& $py -m venv .venv

# 3) 依赖（走代理 + uv 并行安装）
$env:HTTPS_PROXY='http://127.0.0.1:7890'; $env:HTTP_PROXY='http://127.0.0.1:7890'
uv pip install --python .\.venv\Scripts\python.exe -r requirements.txt

# 4) 配置：复制示例；gather.model 默认已改 weread_mp（微信读书通道，个人微信即可）
Copy-Item config.example.yaml config.yaml
# config.yaml 中 gather.model: ${GATHER.MODEL:-weread_mp}

# 5) Playwright webkit 内核（本地 Chrome headless 会触发微信反爬，webkit 可绕过——项目代码注释明示）
$env:HTTPS_PROXY='http://127.0.0.1:7890'
.\.venv\Scripts\python.exe -m playwright install webkit
```

## 2. 启动 / 停止

```powershell
cd D:\tools\we-mp-rss
$env:PROXY_ENABLED='True'                      # 微信接口走代理（抓取层 requests 用）
$env:PROXY_HTTP_URL='http://127.0.0.1:7890'
$env:BROWSER_TYPE='webkit'                     # 登录浏览器用 webkit（关键反反爬开关）
$env:PORT='8001'
.\.venv\Scripts\python.exe main.py -job True -init False
# 第一次部署：把 -init False 换成 -init True（建表+初始化 admin 用户）

# 停止：直接 Ctrl+C；后台进程残留时：
$conn = netstat -ano | Select-String ':8001.*LISTENING' | Select-Object -First 1
Stop-Process -Id ($conn.Line.Trim() -split '\s+')[-1] -Force
```

启动成功标志：日志出现 `Uvicorn running on http://0.0.0.0:8001`。

## 3. 初始化登录（一次性）

1. 浏览器打开 http://127.0.0.1:8001 ，登录 admin / admin@123；
2. 进入「微信读书授权」，用微信扫一扫确认登录微信读书网页版；
3. Cookie 自动保存到 data/wx.lic 。失效后重复此步即可。

> 注意：本项目同时存在「公众平台通道」（需要公众号账号、扫码 mp.weixin.qq.com）与「微信读书通道」（个人微信）。当前配置 gather.model=weread_mp 走后者——订阅个人关注的公众号无需公众号资质。

## 4. 添加订阅 → 数据落库验证

- Web 端「订阅管理→添加」或 App 内分享文章链接给机器人的方式添加公众号；
- 添加后 feed 记录写入 SQLite：

```powershell
.\.venv\Scripts\python.exe -c "import sqlite3;c=sqlite3.connect(r'D:\tools\we-mp-rss\data\db.db');print(c.execute('select id,mp_name,status from feeds').fetchall())"
```

- 文章确认入库后，回到情报系统侧执行同步（见 §5）。

## 5. 与全网情报系统集成

已完成的集成改动（勿删）：

| 位置 | 改动 |
| --- | --- |
| server/routes/wemp.js | /api/wemp/status（健康+计数）、/api/wemp/sync（拉订阅清单→写成本地 sources(type=wemp)）；扫码代理已升级为：/api/wemp/weread/qrcode（取码）、/api/wemp/weread/qrcode.png（图片代理，no-store）、/api/wemp/weread/status（轮询）、/api/wemp/weread/complete（收尾），前端入口为设置页「公众号订阅」Tab |
| server/index.js | 挂载 /api/wemp |
| .env | WEMP_BASE_URL / WEMP_USERNAME / WEMP_PASSWORD |
| server/services/ai/daily.js | ARTICLE_SOURCE_TYPES 增加 wemp → wemp 源文章进入 AI 日报 |

日常操作（情报系统 3000 启动后）：

```powershell
# 同步 we-mp-rss 订阅 → 本地 sources
Invoke-RestMethod -Method Post http://127.0.0.1:3000/api/wemp/sync

# 查看集成状态
Invoke-RestMethod http://127.0.0.1:3000/api/wemp/status

# 冒烟测试
node D:\全网情报系统\tools\wemp-smoke.js
```

之后情报系统的 due 调度器会按 rss 间隔自动抓每个 wemp 源的 atom（请求即触发 we-mp-rss 增量采集，因为 /feed/{id}.atom 的 is_update=True 默认开）。

### 情报系统启动（注意 Node 版本！）

```powershell
# 必须用 Node 24（better-sqlite3 ABI=137）；系统 PATH 里 v22 会崩
Start-Process 'C:\Program Files\nodejs\node.exe' -ArgumentList 'server/index.js' -WorkingDirectory 'D:\全网情报系统'
```

## 6. 数据备份

```powershell
# 冷备份：停止服务后拷贝整个 data 目录
Copy-Item D:\tools\we-mp-rss\data D:\backup\wemp-data-20260827 -Recurse

# 热备份（仅 db）：WAL 模式下 db.db-wal / db.db-shm 需一并复制才完整
Copy-Item D:\tools\we-mp-rss\data\db.db D:\backup\
Copy-Item D:\tools\we-mp-rss\data\db.db-wal D:\backup\
Copy-Item D:\tools\we-mp-rss\data\db.db-shm D:\backup\
```

配置文件 config.yaml 与密钥 data\.secret_key 一并纳入备份（丢失 secret_key 则已发 token 全部失效）。

## 7. 常见问题排查

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| 二维码图片 404 | 二维码未生成成功（登录流程失败） | 看服务日志；公众平台通道超时 → 加 BROWSER_TYPE=webkit 重启 |
| 「二维码加载超时」 | 本地 Chrome headless 触发微信反爬 | 设置 $env:BROWSER_TYPE='webkit' 后重启（官方注释推荐方案） |
| 抓取接口报网络错误 | 微信接口直连超时 | $env:PROXY_ENABLED='True'; $env:PROXY_HTTP_URL='http://127.0.0.1:7890' |
| 端口 10048 占用 | 上一个进程未退干净 | 见 §2 停止命令；检查 chrome/webkit headless 残留进程 |
| Could not validate credentials | token 过期/缺失 | 重新调用 /api/v1/wx/auth/login 取 token |
| 微信读书 Cookie 失效 | wr_skey 有有效期 | 回 Web 界面重新扫码（§3） |
| 情报系统 better-sqlite3 报 ABI 错误 | 用了 Node 22 | 用 C:\Program Files\nodejs\node.exe（v24）启动 |
| feeds 表有记录但不抓 | source 行未同步到情报系统 | 调 POST /api/wemp/sync |

## 8. 当前实测基线（2026-08-27）

- we-mp-rss v1.5.3 · :8001 LISTENING · openapi paths=141 · 内置 Redis(6379) 正常
- 数据库 12 张表；admin 用户初始化完成并跨重启持久（两次重启验证一致）
- 情报系统 :3000 LISTENING（Node v24.14.1）· /api/wemp/status → remote.reachable=true
- /api/wemp/weread/qrcode 系列端点经 tests/wemp-routes.test.js 覆盖（50 项全绿）
- 待你扫码完成后：feeds → sync → articles 链路即为全自动

## 9. 边界与合规提醒

- core/wx/model/ 多通道（free_publish/playwright/app/web/api/weread_mp）均可通过 GATHER.MODEL 环境变量切换；
- 源码含自定义 LICENSE（NOASSERTION）：个人自用没问题，对外提供服务前先读 LICENSE；
- 抓取内容请保持个人阅读用途，不要二次分发全文。
## 10. 2026-08-27 端到端实测补充（绕过扫码的验证通道 + 正式适配器）

- 添加订阅的可用接口形态（Body(...) 标量需 JSON）：

```powershell
POST http://127.0.0.1:8001/api/v1/wx/mps
Content-Type: application/json
Authorization: Bearer <token>

{"mp_name":"中国新闻社","mp_id":"MjM5NDI2MDc5NA==","avatar":"","mp_intro":"..."}
```

> mp_id 是公众号 biz 的 base64。接口内部 `base64.b64decode(mp_id)` 后拼出 `MP_WXS_2394260794` 这种 feed id。

- **wemp 现已是情报系统的一等适配器**：`server/services/collectors/wemp/index.js`（转发 rssAdapter 抓 atom），registry 登记位已加入。重启不再报「未知订阅源类型」。
- 首条端到端记录（可直接复查）：
  - we-mp-rss feeds: `MP_WXS_2394260794 / 中国新闻社 / status=1`
  - we-mp-rss articles: 1 条（上海警方通报…, has_content=1）
  - `/feed/MP_WXS_2394260794.atom` → HTTP 200，含 entry/标题/原文链接
  - 情报系统 sync → `sources(id=28, type=wemp)` 写入；手动 fetchSource → 「fetch OK {"articles":1}」
  - 双侧服务各自强制重启后：feed 内容、source 行（status=ok）、文章计数全部保留
- 微信读书扫码仍是"让抓取自动化"的前提（auto_add_to_shelf + cover 增量）；未扫码时用上面的手工 add_mp + 公开文章解析也能建源，但新文章不会自动被抓取。