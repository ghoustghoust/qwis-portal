> ⚠️ **已废弃(2026-09-04)**:we-mp-rss 已退役,公众号改走 wechat2rss 托管 RSS(见 ARCHITECTURE.md §0/§8.2)。本文仅供历史参考。

# we-mp-rss 集成系统 · AI 交接与校验手册

> **文档目的**：任何 AI（或人）接手此系统时，按本文校验每一环节的真实状态，理解已知的根因与边界，并做出正确决策。所有命令均在本机（Windows，主机名 DOOM）实测通过。
> **最后更新**：2026-08-28 10:50 · 由 AutoClaw agent 维护

---

## 1. 系统架构真值（先读这个）

```
┌─────────────────────────────────────────────────────────────────┐
│  微信公众平台 (mp.weixin.qq.com)                                  │
│  授权账号「6号柠檬」个人号，Token 到期 2026-08-31 18:35            │
│  ⚠ 当前状态：文章列表接口被微信限频 (200013)，搜索接口正常          │
└──────────────────────┬──────────────────────────────────────────┘
                       │ Cookie+Token（存于 Redis werss:token:data）
┌──────────────────────▼──────────────────────────────────────────┐
│  we-mp-rss v1.5.3 — http://127.0.0.1:8001                       │
│  路径 D:\tools\we-mp-rss · Python 3.13.12 (uv venv) · FastAPI    │
│  SQLite: D:\tools\we-mp-rss\data\db.db（12 表）                  │
│  登录: admin / admin@123 · API 文档: /api/docs（141 端点）        │
│  无鉴权 RSS 输出: GET /feed/{feedId}.atom?limit=N                │
└──────────────────────┬──────────────────────────────────────────┘
                       │ atom feed（无鉴权）
┌──────────────────────▼──────────────────────────────────────────┐
│  全网情报系统 — http://127.0.0.1:3000                            │
│  路径 D:\全网情报系统 · Node v24.14.1（必须，见 §6 陷阱N1）        │
│  SQLite: D:\全网情报系统\data\app.db（1562+ articles）            │
│  集成接口: /api/wemp/status · /api/wemp/sync · /api/wemp/weread… │
│  wemp 适配器: server/services/collectors/wemp/index.js           │
│  AI 日报源类型已含 'wemp'（services/ai/daily.js:29）              │
└─────────────────────────────────────────────────────────────────┘
```

**关键文件索引**

| 文件 | 作用 |
| --- | --- |
| `D:\tools\we-mp-rss\config.yaml` | we-mp-rss 配置（gather.model=free_publish 当前值） |
| `D:\tools\we-mp-rss\data\.secret_key` | JWT 密钥，重启服务必须显式注入为环境变量 SECRET_KEY |
| `D:\全网情报系统\server\routes\wemp.js` | 情报系统侧桥接 API |
| `D:\全网情报系统\server\services\collectors\wemp\index.js` | wemp 适配器（转发 rssAdapter） |
| `D:\全网情报系统\tools\wemp-smoke.js` | 冒烟测试（node 运行） |
| `D:\全网情报系统\tools\wemp-limit-probe.py` | 5 源限频探测脚本（python 运行） |
| `D:\全网情报系统\tools\wemp-mint-token.py` | admin JWT 铸币 + verify 校验 |
| `D:\tools\we-mp-rss\STATUS.md` | 昨日状态快照（部分信息已过时，以本文为准） |

---

## 2. 快速校验程序（按序执行，每步有通过判据）

### V1. 双服务存活

```powershell
# 命令
Invoke-WebRequest http://127.0.0.1:8001/ -UseBasicParsing -TimeoutSec 8   # 期望 200
Invoke-WebRequest http://127.0.0.1:3000/ -UseBasicParsing -TimeoutSec 8   # 期望 200
```
- 通过：两个都 200
- 失败处理：见 §5 启动命令

### V2. we-mp-rss 数据完整性

```powershell
& D:\tools\we-mp-rss\.venv\Scripts\python.exe -c "import sqlite3; c=sqlite3.connect(r'D:\tools\we-mp-rss\data\db.db'); print('feeds:', c.execute('select count(*) from feeds').fetchone()[0]); print('articles:', c.execute('select count(*) from articles').fetchone()[0])"
```
- 通过（2026-08-28 基线）：feeds=6（5 个真号+1 个精选占位）、articles>=1
- articles 恒为 1 且 §V5 限频已解除 → 抓取环节有新问题，查 we-mp-rss 服务日志

### V3. RSS 输出链路

```powershell
Invoke-WebRequest 'http://127.0.0.1:8001/feed/MP_WXS_2394260794.atom?limit=5' -UseBasicParsing
```
- 通过：HTTP 200，Content 含 `<feed` 与 `上海警方通报`
- 注意：feed 的 `<entry>` 数量取决于该源 articles 表行数，当前中国新闻社仅 1 条验证文章

### V4. 情报系统桥接

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/wemp/status -TimeoutSec 40
```
- 通过：`ok=true, remote.reachable=true, remote.totalFeeds=6, localSources>=1`
- `remote.reachable=false` → we-mp-rss 没起来，或 admin 密码被改而 .env 未同步

### V5. 微信限频状态（核心变量！）

```powershell
& D:\tools\we-mp-rss\.venv\Scripts\python.exe D:\全网情报系统\tools\wemp-limit-probe.py
# 直连微信（不依赖代理）。成功输出形如「量子位: ret=200013 (freq control)」
```
- **判读**：
  - `ret=200013` → 微信仍限频（等待，见 §3）
  - `ret=0` 且列出文章 → **限频已解除**，执行 §4 解锁流程
- 该脚本同时探 5 个源，输出 `可用源: N/5`

### V6. admin JWT 有效性

```powershell
& D:\tools\we-mp-rss\.venv\Scripts\python.exe D:\全网情报系统\tools\wemp-mint-token.py
```
- 通过：输出 `VERIFY: {"code":0,...}` 且 `TOKEN_SAVED: ...wemp_admin_token.txt`
- 失败 HTTP 401 → 服务进程的 SECRET_KEY 与磁盘文件不一致。修复：重启 we-mp-rss 时注入
  `$env:SECRET_KEY = (Get-Content D:\tools\we-mp-rss\data\.secret_key -Raw).Trim()`

---

## 3. 根因分析：为什么没有文章（截至最后实测）

- 登录态本身**完全正常**：searchbiz 搜索接口 ret=0、账号设置页 ret=0、Cookie 13 个关键字段齐全
- **唯独「文章列表」类接口**（appmsgpublish/publish/appmsg）全部返回 `200013 freq control`
- free_publish 端点返回 404 HTML——该接口要求认证号有「已发表」记录，此个人号无权限
- 限频从 2026-08-27 18:35 扫码后持续至今（>16h），远超常规 1h 冷却 → 判断为**新号+无发文记录+高频触发**导致的长周期观察
- **此状态无法从客户端解除**，只能等待微信放行，或更换凭据（见 §7 决策点）

---

## 4. 限频解除后的解锁流程（AI 可自主执行）

当 §V5 显示 `ret=0`：

1. 逐源触发抓取（token 用 V6 铸造）：
   `GET http://127.0.0.1:8001/api/v1/wx/mps/update/{fid}?start_page=0&end_page=1`
   fid 对照：量子位=MP_WXS_3236757533 · 程序员鱼皮=MP_WXS_3254735000 · 小林coding=MP_WXS_3518034885 · 数字生命卡兹克=MP_WXS_3223096120 · 苍何=MP_WXS_3585152880
   （接口为后台线程模式，立即返回 200；落库约 1-2 分钟后完成）
2. 等待 120 秒后复查 V2，articles 应显著增长
3. 同步到情报系统：`POST http://127.0.0.1:3000/api/wemp/sync`（返回 `{"ok":true,"feeds":N,"added":M}`）
4. 触发一次抓取验证：运行 `D:\全网情报系统\tools\wemp-smoke.js`（需 Node 24）
5. 向用户汇报：解禁 + 各源新文章数 + 情报系统已同步

注意频率纪律：对微信接口的调用间隔 ≥60s，每源每轮只调 1 次 update，避免再触发限频。

---

## 5. 服务启动命令（关机/重启后必读）

```powershell
# we-mp-rss（SECRET_KEY 必须显式注入，否则已发 token 全失效）
cd D:\tools\we-mp-rss
$env:SECRET_KEY = (Get-Content D:\tools\we-mp-rss\data\.secret_key -Raw).Trim()
$env:PROXY_ENABLED='True'; $env:PROXY_HTTP_URL='http://127.0.0.1:7890'
$env:BROWSER_TYPE='webkit'; $env:PORT='8001'
.\.venv\Scripts\python.exe main.py -job True -init False

# 全网情报系统（必须 Node 24，见 N1）
cd D:\全网情报系统
Start-Process 'C:\Program Files\nodejs\node.exe' -ArgumentList 'server/index.js' -WorkingDirectory 'D:\全网情报系统' -WindowStyle Hidden
```

---

## 6. 已知陷阱清单（AI 必读，防重复踩坑）

| # | 陷阱 | 正确姿势 |
| --- | --- | --- |
| N1 | 情报系统用 Node 22 启动即崩（better-sqlite3 ABI=137） | 只用 `C:\Program Files\nodejs\node.exe`（v24.14.1） |
| N2 | we-mp-rss 重启不注入 SECRET_KEY → 全部登录态失效 | 启动前 `$env:SECRET_KEY=(Get-Content ...\.secret_key -Raw).Trim()` |
| N3 | 本地 Chrome headless 触发微信反爬（QR 超时） | 环境变量 `BROWSER_TYPE=webkit`（项目代码注释明示的官方绕法） |
| N4 | playwright 采集模式有 asyncio 事件循环 bug（`Cannot run the event loop`） | gather.model 不要设为 playwright，用 free_publish/web |
| N5 | `process kill` 只杀会话外壳，uvicorn 子进程成孤儿占住 8001 | 用 netstat 找 LISTENING pid 再 Stop-Process，并清理 headless chrome 残留 |
| N6 | 系统默认 python 是 autoclaw 内置（无 venv 模块） | venv 用 uv 安装的 3.13：`C:\Users\17619\AppData\Roaming\uv\python\cpython-3.13.12-...\python.exe` |
| N7 | `driver/wx.py` 登录浏览器未继承代理（上游 bug，已本地修补） | 补丁已打（3 处 PlaywrightController 调用传 proxy_url）；升级上游后需重打 |
| N8 | `/mps` POST 添加订阅时 mp_id 需 base64 编码的 biz 值（服务端会 b64decode） | 传 `MjM5NDI2MDc5NA==` 这类值，不要传 MP_WXS_ 前缀形式 |
| N9 | update 接口为同步阻塞 1-2 分钟（已改后台线程模式，立即返回） | 若还原上游版本，前端将再次必然超时（axios 100s 上限） |
| N10 | 代理 127.0.0.1:7890 可能离线；mp.weixin.qq.com 直连可用 | 微信请求直连即可，github/npm 等才需要代理 |

---

## 7. 当前唯一未决问题与决策点

**问题**：微信对授权号的文章列表接口持续限频（>16h），自动文章抓取无法工作。其它环节 100% 正常。

| 选项 | 成本 | 见效 | 说明 |
| --- | --- | --- | --- |
| A. 继续等 | 0 | 不确定 | 已有定时探测任务（每日 10/13/16/19/22 点），解禁自动抓取+同步+汇报 |
| B. 换微信号重新扫码 | 0 | 扫码后立即验证 | we-mp-rss 支持多账号；有发文记录的老号成功率显著更高 |
| C. 付费托管 wechat2rss.xlab.app | 按源年付 | 当天 | 导出 OPML 配置到情报系统 `opml.url` 即可，与自建并行不冲突 |

**AI 决策规则**：若限频持续超过 72 小时，主动向用户建议选项 B 或 C，不要继续无意义等待。

---

## 8. 与上游仓库的本地差异（升级前必读）

仓库：https://github.com/rachelos/we-mp-rss（本地 clone 于 D:\tools\we-mp-rss，depth=1）

| 文件 | 本地修改 |
| --- | --- |
| `driver/wx.py` | __init__ 增加 browser_proxy_url 属性；3 处 PlaywrightController() 传入 proxy_url（N7） |
| `apis/mps.py` | update_mps 的同步抓取改为后台线程（N9），并新增 _bg_error 收集 |
| `config.yaml` | gather.model 默认值改 free_publish（上游是 web） |

若执行 `git pull`，上述三处可能冲突，需人工合并。

---

## 9. 环境基线（2026-08-28 实测）

- OS: Windows 10.0.26200 (x64)，主机 DOOM
- Python: 3.13.12（uv 管理，venv 在 D:\tools\we-mp-rss\.venv）
- Node: 系统 v22.22.0（ABI 127，情报系统不可用）/ Program Files v24.14.1（ABI 137，必须用它）
- 代理: 127.0.0.1:7890（Clash 类，可能离线；mp.weixin 直连不受影响）
- we-mp-rss 内置 Redis: 127.0.0.1:6379（凭据缓存 werss:token:data / werss:key_store:cookies）