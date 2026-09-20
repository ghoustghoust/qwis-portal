# `lib/` — 三端唯一实现层

放被 `server/`（本地 Express）、`api/`（Vercel 读层）、`tools/collect-turso.js`（GH runner）**共同 require 的无副作用纯逻辑**。它存在的理由是 AGENTS.md §2.5 单一事实源：熔断阈值、源轴、热榜分类、早报兜底这类判定，全库只许一份实现。

判据：**只有一个端装载的文件，不该待在 `lib/`**，应该放回那个端里。

## 内容

| 内容 | 说明 |
|---|---|
| `source-axes.js` | 源四轴与建表增量 `AXES_ALTERS`；7 处装载（含 `server/db.js` 的迁移循环）。27b 把旧 `focus=1` 语义迁到这里 |
| `source-breaker.js` | 连失熔断阈值与 `shouldPauseOnFail`；坑 #35 的落点，本地/云端/runner 三端共用 |
| `hot-categories.js` | 热榜分类 `CATEGORIES` 与 `DEFAULT_CATEGORY_MAP` |
| `hot-events.js` | 热搜事件 SQL 与兜底策略（B78 那条链路的一部分） |
| `brief-guards.js` | 日报/早报取数兜底 `pickDailyReport`，防"空产物被当成功" |
| `reading-filters.js` | 「我的阅读」类型与口径过滤（spec 36） |
| `ai-relevance.js` | 内容相关性打分 |
| `text-clean.js` | 正文清洗（薄正文、编码残留） |
| `media.js` | 音视频与图片 URL 归一 |
| `cloud-site.js` | 云端站点基址与巡检常量。**注意**：`tools/audit-cloud.js` 曾连续 8 天在打已下架的 `qwis-portal` 域名（B64），改基址要同步那两处 |
| `alert-channels.js` | 报警渠道"到底有没有出口"的判据（回环地址、哨兵端口、`test-*` id 一律不算出口）。BL7 被门禁显示成绿灯之后新建 |
| `db.js` | 迁移期的异步 DB 封装，**只被 `tools/migrate-to-turso.js` 装载** → 现役链路不用它 |
| `collectors/` | ★ **零装载**。`fetcher.js`、`repo.js` 文件头自述「Serverless 兼容版本，对应 `server/services/collectors/fetcher.js`」，全仓库无人 require。它是采集语义的**第四份实现**残留，而 `tools/eval-whitebox.cjs:39` 至今把它当"三端"之一在做一致性断言（spec 42 AU-01 / AU-02）。**别再往这里加代码** |
| `time-window.js` | 「今日 / 本周」这类时间窗的**唯一口径**（B90：`setHours(0,0,0,0)` 取的是容器本地时区 0 点，线上因此错了一整天）。不变量 17 的落点；前端对端是 `web/src/beijing-date.mjs` |
| `time-caliber.js` | 上一条的**派生判据**（谁还在自己算日界），白盒 W16 与回归锁 `tests/regression-20260920b` B4 共用——同一判据在门禁和测试各写一遍就会各自漂移 |
| `daily-columns.js` | 每日早报栏目表的**唯一实现**（B10 / 不变量 15）。改栏目只改这里，四份写入器都从这里取 |
| `daily-writers.js` | 「日报有哪几个写入点」的**派生**清单（不是手写清单），白盒 W14 与其负向探针共用（坑 #58：手工清单必漏） |
| `src-spans.js` | 源码文本一次词法扫描出三视图（`code` / `masked` / 区间清单），文本型锁 I10/I13/I15 与 W14/W15 的唯一实现。**坑 #63 的地基**：判"代码里真写了这句话"必须走这里，别再用第二套剥注释正则 |
| `ai-throttle.js` | AI 调用间隔的**唯一算术** `gapMs()`：缺键 / `0` / 空串 / `NaN` / 负数 / 低于 1s 一律回落默认 4000ms。BL8 的落点——`Number(缺键)=0` 就是"无间隔硬打 15RPM 免费池"，所以判据（`tools/eval-preflight.cjs`）和产品（`api/_ai.js`）必须共用它，不许各自 `Number()` |
| `dirty-columns.js` | ⚠️ **未跟踪半成品**（`git status` 里是 `??`，不是现役文件）。意图是把 W15 的"可能被写成字面串 `'null'` 的文本列"从 DDL 派生，替掉手写 `POLLUTED = ['last_fetched_at']`；**尚未接线**，别按"已交付"引用它（虚假交付表述见 `docs/ISSUES.md` B101~B103 与追加分册①的更正） |

**不放什么**：任何 require `server/db`、Express 上下文或 `process.env` 的东西（那属于 `server/` 或 `api/`）；任何只服务单端的逻辑。

**状态**：active（`collectors/` 与 `db.js` 除外，见上）
