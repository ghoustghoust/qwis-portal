# `api/` — Vercel 读层（serverless）

8 个文件。线上 `https://qwis-intel.vercel.app` 由**本仓库根树**构建（实测：`/api/meta` 回传的 commit 等于本地 HEAD）。旧的 `portal` Vercel 项目已于 2026-09-19 下线，与本目录无关。

## 内容

| 内容 | 说明 |
|---|---|
| `[...slug].js` | 唯一对外函数，约 2.8k 行，承接全部 `/api/*`。`vercel.json` 给它 `maxDuration: 30` |
| `_ai.js` | 被 catch-all require 的私有模块（AI 摘要/翻译）。**下划线前缀 = 不对外成路由**，这是本目录的约定 |
| `_alerts.js` | 同上：报警引擎 |
| `_bilibili.js` | 同上：B 站侧 |
| `_classify.js` | 同上：分类 |
| `_safeimg.js` | 同上：图片代理与 SSRF 防护 |
| `collect.js` | 独立函数，`maxDuration: 60`，由 `rewrites` 精确放行 `/api/collect`（标记源到期，真采集在 runner） |
| `daily-generate.js` | 独立函数，`maxDuration: 60`，`/api/daily-generate` |

## 改这里必须同步的两处

采集语义有**三份实现**：本目录的 `collect.js`、`server/services/collectors/`（本地）、`tools/collect-turso.js`（runner）。改过滤/清洗/熔断/去重/UA/间隔任一处，三处都要查（AGENTS.md §1）。

## 门禁

- **函数面有白名单锁**：`tests/regression-aclass.test.js` 的 A10 断言 `api/` 的函数面必须等于白名单——新增文件不同步白名单会直接红。
- 60 秒超时是硬约束：富文本补抓之类长任务不许放进来（历史事故见记忆「Vercel Serverless 富文本抓取超时」）。

**不放什么**：需要无头浏览器的采集（抖音/B 站只在本地端）；写文件的逻辑；任何没登记进 `docs/FEATURE_MATRIX.md` 的新端点。

**状态**：active
