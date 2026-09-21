# `tools/` — 工具箱与门禁脚本

45 项。判"能不能删"的口径只有一条：**有没有被 workflow / npm script / PM2 / 业务代码引用**。下面按这个口径分类。

## 现役 · GH runner 采集主链路

| 内容 | 说明 |
|---|---|
| `collect-turso.js` | ★ 采集主链路。被 `.github/workflows/collect.yml` 以 7 条 cron 调起（`collect` / `translate` / `daily` / `daily-ai` / `mybrief` / `weekly`），直写 Turso。与 `server/services/collectors/`、`api/collect.js` 是同一语义的三份实现 |
| `generate-snapshots.js` | 生成 `public/data` 与 `static-data/` 兜底快照，workflow 与 npm script 都调 |
| `seed-hotlist.js`、`fix-hotlist-times.js` | 热榜数据播种与时间字段修正 |

## 现役 · 评测与门禁（都有 `npm run` 入口）

| 内容 | 说明 |
|---|---|
| `doc-lint.cjs` | 文档门禁 7 条（`lint:docs`），规则出处 `docs/DOC_GOVERNANCE.md` §5 |
| `gen-dir-index.cjs` | 目录索引看门人（§2.5）。**只补骨架、只报待维护，永不覆盖正文**；`--check` 供 doc-lint 第 7 条调用 |
| `eval-preflight.cjs` | 环境前置：代理 / **线上 commit == origin/main** / Turso / 测试隔离 / BL7-BL9 告警 |
| `eval-whitebox.cjs` | 白盒不变量 W1~W11 + `docs/eval/whitebox-baseline.json` 棘轮。**已知缺陷：`:39` 把零装载的 `lib/collectors/fetcher.js` 当"三端"之一在断言**（AU-01） |
| `eval-process-checks.cjs` | 本轮评测可信度 F1~F8（产物诚实性） |
| `eval-f2p.cjs` | 改前红 / 改后绿取证。**退出码三档语义别混**：0 通过 / 1 锁假了 / 2 未评测（坑 #41、#45） |
| `eval-e2e.cjs` | 端到端引擎（41-2）——"页面真的对用户生效"那一层的证据来源。注意 `--only`/`--fast` 跑出来的绿一律 `NOT_ACCEPTANCE` |
| `eval-content.cjs`、`eval-content/` | AI 产物内容质量（41-8），真评需 `--judge` |
| `eval-filter.js` | 评测过滤辅助 |
| `audit-graph.cjs` | spec 42 审计地基：入口可达图 + 调度登记表。**`node docs/specs/42-full-audit-2026-09/quarantine/audit-graph.cjs` 直调（隔离区现位），故意不挂 npm script**（避免与并行开发在 `package.json` 上冲突） |

## 现役 · 运维与对接

| 内容 | 说明 |
|---|---|
| `ops-toolkit.js`、`运维工具箱.bat`、`快速启动.md`、`gen_bat.py` | 无需 AI 介入的应急工具箱（WeRSS 离线那次就是靠它） |
| `setup-customer.js` | 客户化初始化，生成 `customer-config.json` |
| `archive-articles.js` | 数据生命周期归档（`npm run archive`） |
| `sync-alerts-config.js` | 报警渠道恢复——**BL7 的恢复入口，写生产，需授权** |
| `audit-cloud.js` | 云端巡检。曾连续 8 天在打已下架域名（B64），基址与 `lib/cloud-site.js` 联动 |
| `import-bestblogs-opml.js`、`http-shortcuts-template.json` | OPML 导入 / 安卓 HTTP Shortcuts 提交链路模板 |
| `backfill-avatars.cjs`、`_patch-videos.cjs` | 头像补数 / 视频字段修补 |
| `migrate-to-turso.js`、`seed-turso.js` | Turso 迁移与灌数。**历史动作，现仅备查**（两者都会读根 `.env`） |

## 已退役但通道还在

| 内容 | 说明 |
|---|---|
| `sync-portal.js` | 门户同步：`git add/commit/push` 后 `npx vercel deploy --prebuilt --prod`。**push 失败被 catch 掉仍继续部署**；目标项目已于 2026-09-19 下线 |
| `export-portal.js` | SQLite → `portal/public/data/*.json`。它的 `mkdirSync(recursive)` 会在 `portal/` 被删后**把目录重新创建出来**（AU-10） |

两者现由 `server/services/scheduler/jobs/portal.js` 触发，该 job 已改默认关闭（`settings.portal.enabled` 默认 `false`）。

## 一次性件（`_` 前缀，15 个）

`_clean-translate.cjs` `_debug-rss.cjs` `_debug-turso.cjs` `_diag-brief-history.cjs` `_diag-hot-categories.cjs` `_diag-media.cjs` `_diag-p1.cjs` `_diag-reading-count.cjs` `_diag-thin-body.cjs` `_diag-thin-body-all.cjs` `_diag-translate.cjs` `_ops-2026-09-15.cjs` `_ops-revert-podcast-interval.cjs` `_test-api.cjs` `.auth-probe.cjs`

都是某次排障留下的手改件。**`_diag-*` 与 `_ops-*` 里含直接改生产数据的操作，别顺手重跑**。约定：用完即删，或移进 `archive/tools/`。

**不放什么**：被 `server/`、`api/` require 的库（进 `lib/` 或 `server/services/`）；新的临时诊断件请放 `archive/_diag/<日期>-<主题>/` 并写明何时可删。

**状态**：active（`sync-portal.js`、`export-portal.js`、`migrate-to-turso.js`、`seed-turso.js` 及全部 `_` 前缀件属退役/一次性）
