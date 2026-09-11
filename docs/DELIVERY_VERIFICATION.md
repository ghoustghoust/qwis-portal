# 交付验证手册 —— Vercel 生产环境验证流程

> 适用对象：任何接手本项目的 Agent / 开发者。
> 目的：在**无法直连线上环境**（GFW）或**只有本地代码**的情况下，依然能对
> `https://qwis-intel.vercel.app` 生产环境做有效验证，保证线上线下一致性。
> 撰写时间：2026-09-11（方案A 落地当日的完整实战记录）

---

## 0. 系统拓扑（验证前必须建立的脑图）

```
GitHub Actions runner ──直写──▶ Turso (libSQL, 东京) ◀──读── Vercel Serverless API ◀── 浏览器
  (采集/日报/清理, 每15min)                              (api/*.js 无缓存)
```

**三个独立系统，三处独立凭据**（改一处不同步 = 静默故障，本项目最大血泪坑）：

| 系统 | 凭据位置 | 内容 |
|---|---|---|
| 本地 | `D:\全网情报系统\.env` | `COLLECT_KEY` / `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` / `AUTH_SECRET` 等 |
| GitHub | repo → Settings → Secrets and variables → Actions | 同上三个（`COLLECT_KEY` 供备份端点；TURSO 两个供 runner 直采） |
| Vercel | 项目 qwis-intel → Settings → Environment Variables (Production) | 同上三个 + `AUTH_SECRET` / `ADMIN_*` / `AGNES_API_KEY` |

诊断/管理凭据（明文记录在 `docs/HANDOVER.md` §1.5，该文件已在 .gitignore 中）：

| 凭据 | 用途 |
|---|---|
| GitHub PAT（classic，scope: repo+workflow） | 查 Actions 运行/日志、管理 Secrets、手动 dispatch |
| Vercel CLI token | `C:\Users\17619\AppData\Roaming\xdg.data\com.vercel.cli\auth.json`（过期可运行 `vercel whoami` 自动刷新） |

---

## 1. 推送修复的标准动作（代码 → 生产）

### 1.1 Git 身份（本机首次需要）

```bash
cd /d/全网情报系统
git config user.name "ghoustghoust"
git config user.email "ghoustghoust@users.noreply.github.com"   # 仅仓库级，勿 --global
```

### 1.2 推送必须走代理（GFW 会重置 github.com 的 git 连接）

```bash
# ❌ 直接 push 会报 "Recv failure: Connection was reset"
git -c http.proxy=http://127.0.0.1:7890 pull --rebase origin main
git -c http.proxy=http://127.0.0.1:7890 push origin main
```

- **pull --rebase 是必须的**：snapshot job（每日 09:33）会自动提交快照 commit，远端经常领先本地。
- 注意 `.gitignore` 已排除 `docs/HANDOVER.md`（含明文 PAT，提交到公开仓库会被 GitHub 扫描后**自动吊销**）。

### 1.3 push 后自动发生的事

| 变更内容 | 触发 |
|---|---|
| 任意 push 到 main | Vercel 自动构建部署（`npm run build:vercel` → `web/dist`），约 1-2 分钟 |
| `.github/workflows/collect.yml` 变更 | 调度表即时重注册（但首次触发可能延迟，见 §5.4） |

---

## 2. GitHub Actions 的验证手段（Agent 可全程 API 操作）

以下 PAT 从 `docs/HANDOVER.md` §1.5 读取（勿打印到日志）。

```bash
TOKEN=<PAT>
```

### 2.1 列出最近的运行（判断定时任务是否被执行/成功）

```bash
curl -sS -H "Authorization: Bearer $TOKEN" \
  "https://api.github.com/repos/ghoustghoust/qwis-portal/actions/runs?per_page=10" \
  | python -c "
import json,sys
for r in json.load(sys.stdin)['workflow_runs']:
    print(r['created_at'], r['event'], r['status'], r['conclusion'])
"
```

**检查点**：
- `event=schedule` 的 run 应按调度表出现（当前：UTC `:07/:22/:37/:52`）
- 连续缺失 = GitHub 丢任务（2026-09-11 实测连丢 5 轮，页面冻结数小时）
- `conclusion=failure` → 进 2.2 查日志

### 2.2 读取失败 job 的完整日志（定位根因的关键）

```bash
# 先拿 job id
curl -sS -H "Authorization: Bearer $TOKEN" \
  "https://api.github.com/repos/ghoustghoust/qwis-portal/actions/runs/<RUN_ID>/jobs" \
  | python -c "import json,sys; [print(j['id'], j['name'], j['conclusion']) for j in json.load(sys.stdin)['jobs']]"

# 再拉日志（匿名访问会被 403 'Must have admin rights'，必须带 PAT）
curl -sSL -H "Authorization: Bearer $TOKEN" \
  "https://api.github.com/repos/ghoustghoust/qwis-portal/actions/jobs/<JOB_ID>/logs" | tail -50
```

### 2.3 手动触发一轮（验证修复是否生效，不用等定时）

```bash
curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/ghoustghoust/qwis-portal/actions/workflows/345928986/dispatches" \
  -d '{"ref":"main"}'
# 返回 204 即成功；然后回到 2.1 轮询新 run 的 conclusion
```

### 2.4 管理 Secrets（改密钥值，API 需要 libsodium sealed-box 加密）

现成脚本：`C:\Users\17619\.cache\qwis-diag\sec\set-secrets.js`
（依赖已装在该目录：libsodium-wrappers；从本地 `.env` 读取值，不回显明文）

```bash
cd /c/Users/17619/.cache/qwis-diag/sec && node set-secrets.js <PAT>
# 输出形如：COLLECT_KEY: HTTP 204（更新）/ 201（新建）
```

---

## 3. Vercel 生产端的验证手段

### 3.1 网络前提（中国大陆本机必读）

```bash
# vercel.app 被 GFW 阻断，必须走代理：
export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890
# Windows Git Bash 的 curl(schannel) 走代理时必报 CRYPT_E_REVOCATION_OFFLINE，
# 必须加 --ssl-no-revoke：
curl -sS --ssl-no-revoke --max-time 60 "https://qwis-intel.vercel.app/api/status"
```

### 3.2 关键检查点（按怀疑对象逐层验证）

| 层 | 命令 | 健康标志 |
|---|---|---|
| 读 API 活性 | `GET /api/status` | 200 + `overview.enabledSources` 有值（注意冷启动可能要 10-15s，别误判超时） |
| 数据新鲜度 | `GET /api/articles?limit=3&sort=new&include_hot=1` | `created_at`（入库时间）在 30 分钟内 |
| 阅读器视图 | `GET /api/articles?limit=3&sort=new`（不带 include_hot） | `published_at`（**发布时间**，≠入库时间，会比 created_at 旧，属正常） |
| 日报 | `GET /api/daily` | `report.generated_at` 是今天（曾为 null = 日报链断） |
| 备份采集端点 | `POST /api/collect?key=<COLLECT_KEY>` | 200 + `stats`；403 = 密钥不一致 |
| API 缓存 | `curl -sSI .../api/articles` | 应为 `max-age=0` + `X-Vercel-Cache: MISS`（API 无缓存，慢=库没新数据，不是缓存） |
| 快照文件 | `GET /data/articles.json` | `generated_at` 日期（每日 09:33 由 snapshot job 更新，仅兜底首屏，页面不依赖它刷新） |

### 3.3 页面显示时间的解读（避免误判）

前端列表按 **`published_at`（源站发布时间）** 排序显示。判断系统是否在干活要看 Turso 里的
`created_at`（入库时间，见 §4）。「页面最新文章是 11:20 发布」不等于「系统 11:20 后没运行」。

### 3.4 Vercel 项目管理（删项目/查部署）

CLI token 过期时先刷新：`vercel whoami`（CLI 会自动用 refreshToken 换新 token 写回 auth.json）。
REST 调用（token 从 auth.json 的 `token` 字段读，勿打印）：

```bash
VTOKEN=<从 auth.json 读>
TEAM=team_lhuQMlsXgwYC93FSnBSfYxnx
curl -sS --ssl-no-revoke -H "Authorization: Bearer $VTOKEN" "https://api.vercel.com/v9/projects?teamId=$TEAM"   # 列项目
curl -sS --ssl-no-revoke -X DELETE -H "Authorization: Bearer $VTOKEN" "https://api.vercel.com/v9/projects/<name>?teamId=$TEAM"  # 删项目
# 删除后边缘缓存可能残留 200 约 20 秒，之后变 404
```

---

## 4. Turso 数据库直连验证（最终的真相来源）

API 可疑时，直接查库。模式（从 `.env` 读连接串，天然免代理——libsql 走 HTTPS 到东京）：

```bash
cd /d/全网情报系统 && node -e "
const {createClient}=require('@libsql/client');const fs=require('fs');
for(const l of fs.readFileSync('.env','utf8').split(/\r?\n/)){const m=/^([A-Z_]+)=(.+)\$/.exec(l.trim()); if(m&&!process.env[m[1]])process.env[m[1]]=m[2].trim();}
const db=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN});
(async()=>{
  let r=await db.execute(\"SELECT MAX(created_at) m, COUNT(*) c FROM articles WHERE created_at > datetime('now','-2 hours')\");
  console.log('近2小时入库:', r.rows[0].c, '| 最新:', r.rows[0].m);
  r=await db.execute(\"SELECT value FROM settings WHERE key='cloud.collect'\");
  console.log('采集心跳:', r.rows[0] && r.rows[0].value);   // lastRunAt + 每轮统计
  db.close(); process.exitCode=0;   // 勿用 process.exit()，见 §5.6
})();"
```

**关键检查点**：
- `created_at` 最新值与当前时间的差 = 真实的采集停滞时长
- `settings.cloud.collect` 心跳：每轮采集/日报/清理都会写，含 `lastRunAt` 和 stats
- `sources` 表 `enabled=0 AND fail_count>=阈值` = 被熔断的源（YouTube 阈值 10，其他 3）

---

## 5. 网络限制与坑位速查（全部实战踩过）

| # | 现象 | 根因 | 解法 |
|---|---|---|---|
| 5.1 | `curl vercel.app` 连接超时 | GFW 阻断 | `export https_proxy=http://127.0.0.1:7890` |
| 5.2 | 走代理后报 `CRYPT_E_REVOCATION_OFFLINE` | Windows schannel 吊销检查 | curl 加 `--ssl-no-revoke` |
| 5.3 | `git push` 报 Connection reset | GFW 干扰 git HTTPS | `git -c http.proxy=http://127.0.0.1:7890 push` |
| 5.4 | GH Actions schedule 整批缺失 | GitHub 高负载丢定时任务（无告警） | 调度加密到 15min 对冲 + 每日人工/Agent 抽查 §2.1；彻底方案是 cron-job.org 等外部触发器 POST dispatch API（§2.3） |
| 5.5 | GH API 拉日志 403 "admin rights" | 日志接口必须鉴权 | 带 PAT（§2.2） |
| 5.6 | Node 脚本 exit 127 + libuv 断言 `UV_HANDLE_CLOSING` | 连接未关时 `process.exit()` | 先 `db.close()` 再 `process.exitCode=0` 自然退出 |
| 5.7 | 外部 undici `ProxyAgent` 喂内置 fetch 一律 "fetch failed" | dispatcher 符号不兼容 | 用 undici 包自带的 `fetch` 配对（见 `tools/collect-turso.js`） |
| 5.8 | newsnow 热榜 403 | 自定义 UA 被封 | 采集必须用浏览器 UA |
| 5.9 | YouTube feed 404/500 但频道活着 | Google 对数据中心 IP 反爬返回假 404/500 | 间歇性掷骰；熔断阈值已放宽到 10，勿见 404 就删源 |
| 5.10 | Vercel CLI token "invalidToken" | token 过期（auth.json 里 expiresAt） | 跑一次 `vercel whoami` 自动刷新 |

---

## 6. 标准验证剧本（修复上线后按序执行）

1. **本地**：`node --check <改动文件>` + 相关脚本本地跑通（采集类脚本可直接对 Turso 跑，限 `COLLECT_LIMIT=15` 小批量先试）
2. **推送**：`git -c http.proxy=... pull --rebase` → `push`（§1.2）
3. **触发**：dispatch API 手动跑一轮（§2.3），轮询到 `conclusion=success`
4. **日志**：确认 job 输出里的统计行（如 `采集完成: 成功 N / 新增 M 篇`）
5. **库验**：§4 查 `created_at` 新鲜度 + 心跳
6. **端验**：§3.2 全套端点（带代理 + `--ssl-no-revoke`）
7. **页面**：浏览器开 `https://qwis-intel.vercel.app/reader/`（本机需挂代理），强刷 Ctrl+F5
8. **文档**：改动若涉及架构/凭据/坑，同步 `ARCHITECTURE.md`、`docs/HANDOVER.md`、本文档

---

## 7. 2026-09-11 实战案例（本文档的出处）

| 时间(UTC) | 动作 | 验证方式 |
|---|---|---|
| ~01:40 | 诊断「页面不更新」：GH runs 全部 failure → 读 job 日志 → `POST /api/collect` 403 | §2.1/§2.2/§3.2 |
| 01:55 | 重写 3 个 Secrets → dispatch → 4 job 3 绿 1 败（snapshot 读 .env 崩） | §2.3/§2.4 |
| 02:04 | 本地跑通 `tools/collect-turso.js`（先 15 源小批量，再全量 500） | §6.1 |
| 02:44 | push 75e2520 → dispatch → 4/4 全绿 → 端验 created_at 实时 | §6.2-6.6 |
| 08:05 | 发现 schedule 连丢 5 轮 → 调度加密 15min → push ca5b3c4 | §2.1 对比 |
| 08:12 | RSS 重采间隔 480→60min + 重置 609 源 → dispatch 验证 499/500 成功 | §2.3 + §4 |
