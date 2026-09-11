# 2026-09-11 变更记录：方案A —— 云端采集移入 GH Actions runner 直写 Turso

> 类型：架构级修复（解决"Vercel 网页不自动更新"）
> 涉及 commit：`75e2520`（主修复）、`de51e0a`（YouTube 熔断放宽）
> 验证状态：全链路实测通过（GH Actions 4 job 全绿 + Vercel 线上数据实时刷新）

---

## 1. 问题现象

Vercel 网页（https://qwis-intel.vercel.app）内容不自动更新：本地不开机、不手动触发，页面数据就停滞。实测数据停在 2026-09-09 16:58，`/api/daily` 返回 null。

## 2. 根因链（五层）

| 层 | 根因 | 证据 |
|---|------|------|
| 直接原因 | **GitHub Secret `COLLECT_KEY` 值与 Vercel env 不一致** → 全部定时任务 403，重试 3 次 exit 1，连续失败 2 天+ | Actions 日志三次 `HTTP status: 403`；用本地 .env 的 key 手动 POST 返回 200 |
| 架构死局 | **Vercel Hobby 函数 10s 硬限** → `api/collect.js` 被迫 MAX_SOURCES=2 → 每天 ~58 源 vs 638 源 = **11 天轮完**，永远不可能实时 | HANDOVER §4.3 |
| 热榜全灭 | **newsnow API 对自定义 UA（qwis-collector/1.0）直接 403** → 29 个热榜源全灭，19 个被熔断停用 | 浏览器 UA 实测 200，旧 UA 实测 403 |
| 配置失效 | **vercel.json crons 从未生效**：① vercel.json 不做 `${VAR}` 插值（传字面量）② Vercel Cron 用 GET 而 collect.js 只收 POST → 405 | 线上实测 GET 返回 405 |
| 连锁损伤 | YouTube 对数据中心 IP 反爬返回**假 404/500**（源是活的），3 次熔断规则把 29 个 YouTube 活源永久误杀；snapshot job 缺 `contents: write` 权限 + `generate-snapshots.js` 硬读 `.env` | 频道 ID 正确、同轮部分 YouTube 源成功入库；job 日志 `ENOENT .env` |

## 3. 修复内容

### 3.1 架构变更（方案A）

```
旧链路：GH Actions cron → POST Vercel /api/collect（10s 限制，2源/次）→ Turso
新链路：GH Actions runner 内直接执行 tools/collect-turso.js → 直写 Turso
        （无 10s 限制、无冷启动、海外网络直连 YouTube/X/RSSHub、并发 6）
```

- Vercel 变为**纯读层 + 管理后台**；`api/collect.js`、`api/daily-generate.js` 保留为手动触发备份
- 本地 Express 仍是开发/灾备（抖音 Playwright 仅本地）

### 3.2 新增文件

| 文件 | 说明 |
|------|------|
| `tools/collect-turso.js` | 直采器：`collect`（默认，全量到期源，COLLECT_LIMIT=500，并发 6）/ `daily`（日报）/ `cleanup`（清理）三模式；每轮写心跳 settings `cloud.collect`；本地跑自动用 HTTPS_PROXY（undici fetch + ProxyAgent 配套，不能喂给内置 fetch） |

### 3.3 修改文件

| 文件 | 修改 |
|------|------|
| `.github/workflows/collect.yml` | 重构：采集每 30min（:07/:37）runner 直采；日报 09:03；快照 09:33；清理 04:13（均北京时间）；补 `permissions: contents: write` |
| `vercel.json` | 移除从未生效的 `crons` 块 |
| `api/collect.js` | UA 改浏览器 UA；YouTube 熔断阈值 3→10 |
| `tools/generate-snapshots.js` | `.env` 缺失时容错跳过（CI 环境由 env 注入） |
| `.gitignore` | 加入 `docs/HANDOVER.md`（含敏感凭据，防提交后 GitHub 扫描吊销 PAT） |

### 3.4 云端配置变更（非代码）

- GH Secrets 重写：`COLLECT_KEY`（修正值）、新增 `TURSO_DATABASE_URL`、`TURSO_AUTH_TOKEN`
- Turso 数据修复：复活 19 个被误熔断的热榜源 + 29 个被误熔断的 YouTube 源
- Vercel：删除老项目 `qwis-portal`（qwis-portal.vercel.app 已 404 下架）；剩余项目 `qwis-intel`（主站）、`portal`（更早期项目，待确认后删）

## 4. 新调度节奏

| 内容 | 频率 | 备注 |
|------|------|------|
| 热榜（29 源） | 每 30 分钟 | 准实时 |
| RSS/公众号/YouTube/X | 每源 8h（每天 3 轮） | 到期驱动 |
| 日报 | 每天 09:03（北京） | runner 内生成 |
| 静态快照 | 每天 09:33（北京） | push 回仓库 public/data/ + static-data/ |
| 清理 | 每天 04:13（北京） | 删 7 天前热榜 |
| GH Actions 排队延迟 | +5~20min | 免费服务特性，实际间隔 30~50min |

## 5. 验证数据

| 验证 | 结果 |
|------|------|
| 本地全量采集 | 419 成功 / 新增 3273 篇 / 117s；二轮 136 成功 / 1986 篇 / 38s |
| runner 直采（dispatch 实测） | 35 到期源 / 新增 100 篇 / 13.7s；二轮 59 源 / 899 篇 / 15.5s |
| 日报 | `/api/daily` 恢复：500 候选 → 3 栏目 27 条 |
| Vercel 读 API | 无缓存（Age: 0），Turso 写入即页面可见 |
| 心跳 | settings `cloud.collect` = `{"mode":..., "lastRunAt":..., "stats":...}` |

## 6. 遗留事项

1. **YouTube 间歇性失败**（反爬掷骰）：阈值已放宽至 10，每 30min 重试，大部分源能在若干轮内采到；彻底解决需住宅代理 RSSHub 或本地补采
2. **B站 wbi 签名未移植**（纯 crypto，可在 runner 跑，现仅 1 源）
3. **抖音**仍需本地 Playwright（架构限制）
4. **报警引擎不在云端链路**：采集停滞目前只能靠 GH Actions 失败邮件；心跳已埋点（`cloud.collect`），可接报警
5. **安全收尾**：HANDOVER.md §1.5 的 GitHub PAT 待稳定后轮换吊销
6. **预存测试失败 4 项**（非本次引入，详见 ISSUES.md P2-9）

## 7. 排障速查

```bash
# 看采集心跳：查 Turso settings 表 key='cloud.collect'（含 lastRunAt + stats）

# 手动在 runner 跑采集
# GitHub → Actions → collect → Run workflow

# 本地手动直采（用本地 .env 的 TURSO_*/HTTPS_PROXY）
node tools/collect-turso.js collect
node tools/collect-turso.js translate   # 手动翻译一批英文文章
```

---

## 8. 当日追加（2026-09-11 下午）

| 追加项 | 内容 |
|--------|------|
| P1-10 登录修复 | 真根因 = `requireAuth` 未豁免 POST /api/auth/login（中间件死锁，与密码值无关）；已修 + Vercel env 凭据同步为本地 .env 值 |
| /api/* 504 | articles 表补 `idx_articles_created` + `idx_articles_pubco` 表达式索引（43s→0.1s） |
| P1-15 Git 集成 | Vercel 项目此前 `link: null` 从未自动部署；已安装 GitHub App + API 连接，push 即部署 |
| AI 翻译上云 | `tools/collect-turso.js translate` 模式（移植 translate-skill.js 语义），每轮采集后自动翻译英文文章；Turso 补 `translated_title`/`translated_content` 列；GH Secret 新增 `AGNES_API_KEY`。**注意：现有 Agnes key 绑 IP 地区（仅本地代理可用，云机房 401），云端翻译需用户提供 DeepSeek key 后启用**（双供应商回退链已内置，配 DEEPSEEK_API_KEY 即自动生效）。决策：不借用 starhub 的 key，情报系统独立配置 |

### 8.1 GitHub App 授权步骤（备查）

1. 打开 https://github.com/apps/vercel → Install/Configure → 选 ghoustghoust → 授权 qwis-portal 仓库
2. API 连接（已执行）：`POST /v9/projects/{id}/link?teamId=...` body `{type:'github', repo:'ghoustghoust/qwis-portal', repoId:1350719205}`
3. 验证：push 任意 commit → Vercel Deployments 出现对应 SHA 的新部署
