# 云端实时信息流 · 交付文档（下一个 Agent 必读）

> **这份文档的目的**：让任何接手的 Agent 在改代码之前，先理解"网页数据为什么会自动更新"，
> 避免改功能时把采集/调度链路碰断而又不自知（本系统已经因此静默停摆过 2 天）。
> 最后更新：2026-09-11（方案A 落地日）

---

## 0. 阅读优先级（按顺序读，再动手）

| 优先级 | 文档 | 为什么先读它 |
|---|---|---|
| **P0 必读** | **本文档** | 实时链路的完整地图 + 不可破坏的不变量 |
| **P0 必读** | `docs/changes/2026-09-11-runner-direct-collect.md` | 上一次"不更新"事故的完整根因链——所有坑都在里面 |
| **P1 必读** | `ARCHITECTURE.md` §0/§1/§3/§5 | 架构决策与 22 条血泪坑（§5 每条都对应过一次线上事故） |
| **P2 建议** | `docs/RUNBOOK.md` §10 | 云端运维操作手册 |
| **P2 建议** | `docs/ISSUES.md` | 当前未解决问题的活清单 |
| **P3 参考** | `docs/HANDOVER.md` | 凭据速查（⚠️ 含密钥，本地文件，已 gitignore，**永远不要提交**） |

---

## 1. 一张图看懂实时链路

```
┌─────────────────────────────────────────────────────────────┐
│ GitHub Actions（.github/workflows/collect.yml）              │
│                                                             │
│  每 30min :07/:37 ──► node tools/collect-turso.js collect   │
│  每天 09:03        ──► node tools/collect-turso.js daily    │
│  每天 09:33        ──► node tools/generate-snapshots.js     │
│  每天 04:13        ──► node tools/collect-turso.js cleanup  │
│                          （时间均为北京时间）                  │
└──────────────────────────┬──────────────────────────────────┘
                           │ @libsql/client 直写（不经任何 Vercel 函数）
                           ▼
                  ┌─────────────────┐
                  │  Turso（东京）   │  ← 唯一云数据源
                  └────────┬────────┘
                           │ 读（无缓存，写入即所见）
                           ▼
              qwis-intel.vercel.app（Vercel 读层）
              api/[...slug].js → 前端页面
```

**关键认知**：Vercel 函数**不参与**定时采集。Vercel 只是读层。数据新不新，取决于
GH Actions → Turso 这条链，和 Vercel 部署本身无关。

## 2. 不可破坏的不变量（动了就会"不更新"）

改任何代码前对照此表。违反任意一条 = 信息流停摆，且**没有任何报警**：

1. **三处密钥必须一致**：`COLLECT_KEY` / `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`
   同时存在于 ① 本地 `.env` ② Vercel 项目 env ③ GitHub repo Secrets。
   改一边不改其余 → 静默 403/失败（2026-09-11 事故直接原因）。
2. **采集必须带浏览器 UA**：newsnow 热榜 API 对自定义 UA 一律 403。
   UA 字符串在 `tools/collect-turso.js` 和 `api/collect.js` 各一份，改要同步。
3. **熔断阈值**：youtube=10（反爬假 404/500 会误杀活源），其他类型=3。
   不要把 youtube 改回 3。
4. **`tools/collect-turso.js` 不许依赖 `server/db.js`（better-sqlite3）**：
   runner 上 `npm ci --ignore-scripts` 不编译原生模块。脚本必须只用
   `@libsql/client` + `rss-parser` + 全局 `fetch`（+可选 undici）。
5. **workflow 必须保留 `permissions: contents: write`**：snapshot job 要 push 快照 commit。
6. **vercel.json 不要加回 `crons` 块**：Vercel Cron 用 GET 且不插值 `${VAR}`，
   与只收 POST 的 collect.js 天然不兼容（历史上写了等于没写）。定时任务只走 GH Actions。
7. **进程退出**：脚本末尾用 `process.exitCode = 0` 自然退出，不要 `process.exit(0)`
   （Windows 上触发 libuv UV_HANDLE_CLOSING 断言 → exit 127）。
8. **本地代理**：`HTTPS_PROXY` 存在时必须用 undici 包自带的 `fetch` + `ProxyAgent`
   配套使用，不能把外部 undici 的 Agent 喂给 Node 内置 fetch（符号不兼容，全部 fetch failed）。

## 3. 改代码时的检查清单

- [ ] 改了采集语义（过滤/清洗/去重/熔断/UA）？→ **四处同步检查**：
      `server/services/collectors/*`（本地）、`api/collect.js`（Vercel 备份）、
      `tools/collect-turso.js`（云端主链路）。三者是独立实现，会漂移。
- [ ] 改了日报逻辑？→ 同步检查 `server/services/ai/daily.js`、
      `api/daily-generate.js`、`tools/collect-turso.js` 的 `runDaily()`、`api/[...slug].js` 的 getOrGenerate 兜底。
- [ ] 改了 Turso schema？→ 四处采集实现 + `tools/generate-snapshots.js` + `api/[...slug].js` 全部要对齐。
- [ ] 改了 workflow 的 cron？→ 注意 GH Actions 是 **UTC**，且整点拥挤，用错峰分钟（:07/:37 风格）。
- [ ] 改完必须跑：`npm test`（187/191 为基线，4 项预存失败见 ISSUES P2-9，不许新增失败）。
- [ ] 涉及云端的改动 → 部署后跑一次 `workflow_dispatch` 验证 4 个 job 全绿（见 §4）。

## 4. 验证管线是否活着（30 秒自检）

```bash
# ① 看 GH Actions 最近运行（全绿 = 正常）
#    https://github.com/ghoustghoust/qwis-portal/actions

# ② 看采集心跳（Turso settings 表，每轮采集都写）
#    key = 'cloud.collect'，value 里有 lastRunAt 和 stats
#    lastRunAt 距现在 > 1 小时 = 链路断了

# ③ 看线上最新数据时间（需代理）
curl "https://qwis-intel.vercel.app/api/articles?limit=1&sort=new&include_hot=1"
#    created_at 应在 1 小时内

# ④ 手动触发一轮完整管线
#    GitHub → Actions → collect → Run workflow（四个 job 全跑）
```

## 5. 故障决策树

```
网页数据不更新
  ├─ /api/articles 最新 created_at 是旧的？
  │    ├─ 是 → 采集链断：查 GH Actions 是否全红
  │    │    ├─ 403 → Secrets 值错了（不变量 1）
  │    │    ├─ 热榜 403 → UA 被改回去了（不变量 2）
  │    │    └─ 其他 → 看 job 日志里 collect-turso.js 的输出
  │    └─ 否 → 数据是新的但页面旧 → 前端/缓存问题，与采集无关
  ├─ 日报没生成 → 查 daily-report job 日志；窗口是"前一天 00:00 ~ 当天 06:00 北京"
  ├─ 某源不更新 → 查 sources 表 enabled/fail_count/extra.lastError；youtube 间歇失败属正常（反爬掷骰）
  └─ GH Actions 绿但数据旧 → 查心跳 settings cloud.collect 的 stats 字段
```

## 6. 当前能力边界（别再做"为什么不行"的无功排查）

| 能力 | 状态 | 原因 |
|------|------|------|
| 热榜 30min 准实时 | ✅ | runner 直采 |
| 公众号/RSS 每天 3 轮 | ✅ | 到期驱动 |
| YouTube/X | ⚠️ 间歇 | Google 反爬数据中心 IP，掷骰成功；阈值已放宽 |
| B站 | ❌ 云端不采 | wbi 签名未移植（纯 crypto，可移植 runner） |
| 抖音 | ❌ 云端不采 | 需 Playwright 登录态，仅本地 |
| 页面内自动刷新 | ❌ | 前端无轮询/SSE（数据层是实时的，重新打开/切页即最新） |
| 采集停滞报警 | ❌ | 报警引擎只在本地；心跳已埋点待接 |

## 7. 关键文件速查

| 文件 | 角色 |
|------|------|
| `tools/collect-turso.js` | **云端采集主链路**（collect/daily/cleanup 三模式） |
| `.github/workflows/collect.yml` | 定时调度定义（全部北京时间见注释） |
| `api/collect.js` / `api/daily-generate.js` | Vercel 手动备份端点（Hobby 10s 限 2 源，仅救急） |
| `api/[...slug].js` | 读 API（含日报 getOrGenerate 兜底） |
| `tools/generate-snapshots.js` | 静态快照导出（首屏兜底 public/data/） |
| `vercel.json` | 仅 rewrites/headers/functions，**无 crons** |
