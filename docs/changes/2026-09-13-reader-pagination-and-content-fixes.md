# 变更记录：阅读器分页/翻译污染/未来时间/UI 修复（2026-09-13）

> 来源：用户实测反馈 5 项问题 → 浏览器云端实测 + Turso 直查逐一定性。
> 所有结论均有 API 实测/Turso 查询证据，非凭代码推断。
> 关联：`docs/DELIVERY-2026-09-13.md`（当日上一轮紧急修复）、`docs/AUDIT-2026-09-12.md` §5

---

## 0. 问题定性总表（先验证，后修复）

| # | 用户反馈 | 定性 | 根因 | 证据 |
|---|---|---|---|---|
| F1 | 阅读器"全部文章"滑动 ~30 条后无法继续下拉 | ✅ 属实（bug） | 云端游标值格式与列格式不匹配（详见 §1） | Turso 直查第一页 31 行；ISO 游标手打第二页返 30 条；epoch 游标返 0 条 |
| F2 | 文章《Perplexity trusts GPT-6 Astra…》时间显示 9/14（超前于今天 9/13） | ✅ 属实（bug，存量 1 条） | openrss.org 桥接源 pubDate 解析出未来值，采集端无钳制 | `published_at = 2026-09-14T00:00:00.000Z`（UTC 午夜整点，合成值特征） |
| F3 | 该文章"AI 翻译"内容是乱的 | ✅ 属实（bug，新发现） | 翻译管线轮 3 精翻直接采纳推理模型输出，思维链/指令回显未清洗 | 云端页面渲染出「用户提供了一篇…要求我从四个维度检查并改进译文…」指令文本 |
| F4 | 我的早报 / 精选周刊没有左侧菜单栏 | ✅ 属实（bug） | 两页面未挂 `IconRail`（其余四页均挂） | 浏览器实测两页均为裸 `<main>`；代码对比 DailyPage/HotPage/MyReadingPage |
| F5 | 周刊要能长久存储（一周才一份） | ✅ 属实（设计缺陷） | `saveWeekly` 硬编码 `while (archive.length > 4) archive.shift()` | `tools/collect-turso.js` saveWeekly |
| F6 | "我的早报"空态 | ✅ 属实（配置） | 云端 Turso `focus=1` 源数量为 0 → runMyBrief 写引导态 | API 实测 focus: 0 |
| F7 | 源停止工作了/文章不实时 | ⚠️ **不属实**（管线正常） | GH Actions 每 15min 全绿；热榜 27min 前、RSS 1~1.5h 内有新入库 | Actions run 315~319 全 success；`/api/meta` lastUpdated 12min 前 |
| F8 | （观感来源）视频/部分源不更新 | ⚠️ 部分属实（已知情） | YouTube 反爬假 404 → 55 源熔断、95 源报错（熔断阈值 10 是既有决策） | `/api/health/status` frozenList 全 YouTube HTTP 404 |

**另外**：本机代理实际端口为 **12000**（Clash 面板截图确认），`.env` 与文档写的 7890 已失效——`.env` 本次同步修正，文档在用户确认修复后统一更新。

---

## 1. F1 游标分页断裂（滑动上限的根因）

### 根因链
1. `api/[...slug].js handleArticles` 生成游标：`nextCursor = \`${new Date(last.published_at).getTime()/1000}|${last.id}\`` → 值形如 `1789257677|440499`。
2. 翻页条件：`COALESCE(a.published_at, a.created_at) < '1789257677'`——列存的是 ISO 文本（`2026-09-13T00:01:17.000Z`），SQLite TEXT 与数字字符串比较按**类型序+字典序**：`'2' > '1'` 恒成立 → 条件恒假 → 第二页恒 0 行。
3. 前端 `ArticleList.fetchPage` 拿到空页 → `setDone(true)` → 无限滚动停止。用户看到的就是"30 条后拉不动"。
4. `handleHot`（热点榜"全部动态"）同病同源。
5. 本地 Express `server/routes/articles.js` 用 `last.sort_key`（原生列值）**无此 bug**——正是"三份实现漂移"的又一例证（坑 #9）。

### 修复方案（`api/[...slug].js`）
- `handleArticles` / `handleHot`：nextCursor 一律发**原生列值**（`last.published_at || last.created_at`，ISO 文本），不再换算 epoch；游标比较保持文本对文本（ISO 8601 字典序=时间序，天然正确）。
- `sort=smart` 排序键是数值表达式（unixepoch+focus 加权），游标绑定改为 `Number(cursorVal)` 做数值比较，与本地端对齐。
- `handleReading` 已正确（sort_key 原生文本），不动。
- 前端无需改动（`ArticleList` 已同时兼容 `nextCursor`/`next_cursor`）。

### 回归测试
`tests/regression-cloud-cursor.test.js`：起真实 express app + 内存库，断言 ①第一页 31→30 截断且 nextCursor 非空 ②带返回的游标请求第二页必须返回**不同且更旧**的 30 条 ③游标追到底 done。防"实现式测试"空转（坑 #18：驱动真实路由）。

---

## 2. F2 未来时间 published_at（三处采集实现同步修）

### 根因
"OpenAI" 源（id=16，type=rss，`openrss.org/feed/openai.com`）是网页转 RSS 桥接，其 pubDate 解析出 `2026-09-14T00:00:00.000Z`（页面日期+零点整点合成）。采集端 `saveArticles` 无未来值钳制，直接入库 → 排序霸榜"刚刚"+ 前端显示 9/14。

### 修复方案（三处同步，坑 #9 义务）
统一规则：**`published_at` 晚于当前时间 5 分钟以上 → 钳制为入库时刻 now**。
- `tools/collect-turso.js`（云端主链路）：`saveArticles` 入库前钳制
- `api/collect.js`（Vercel 手动备份）：同规则
- `server/services/collectors/repo.js`（本地）：同规则
- 存量修复：`UPDATE articles SET published_at = created_at WHERE published_at > now`（当前命中 1 条，即该文）

### 回归测试
fixtures 里加未来 pubDate 用例，断言入库后 `published_at <= now`。

---

## 3. F3 翻译管线思维链污染（轮 3 精翻输出未清洗）

### 根因
`api/_ai.js refineWithGlossary / refinePass` 成功时直接返回 `r.reply`。agnes-2.5-flash 是推理模型（坑 #24），会把指令复述+四维分析混入输出（本次实测样本：`用户提供了一篇英文原文和中文译文草稿，要求我从四个维度检查并改进译文，输出最终稿：…原文：…译文：## 文章…`）。18-daily-ai 已修过同类问题（generateTheme 导语思维链剥离），翻译链漏配同样的清洗。

### 修复方案（`api/_ai.js`）
新增 `sanitizeTranslationReply(reply, draft)`：
1. **提取**：若回复含 `译文：`/`最终稿：`/`## 译文` 等标记 → 取最后一个标记之后的内容；
2. **拒绝**：思维链式回复（`isThinkingLikeReply`：元任务起始话术/编号加粗分析结构/`**Role:**` 字段三类特征）→ **回退上一轮草稿**；
3. 应用点：`refineWithGlossary` 与 `refinePass` 的成功分支 + `translatePipeline` 轮 1 输出兜底 + 标题提取护栏。

**⏩ 二轮强化（上线后线上复测发现漏网形态）**：首轮清洗只覆盖中文指令回显，英文思维链
`Here's a thinking process: 1. **Analyze User Input:** …` 整段入库且首行被当标题。追加：
- `translateText` L1：思维链输出**视为本次失败** → 自动降级 Bing/Google 机翻（保证永不入库）；
- `isThinkingLikeReply` 独立导出供标题提取护栏复用；
- 测试 F3-5（思维链识别）/F3-6（正常英文开头译文不误伤）。
> 教训：推理模型的污染形态不止一种，清洗规则必须「标记提取 → 思维链拒绝 → 机翻降级」三层兜底，
> 且验收必须包含**真实模型输出**的线上复测，单测 fixture 过了≠线上干净。

### 存量修复
扫描 `translated_content` 命中污染特征（`要求我%改进译文`/`译文草稿`/`四个维度检查` 等）→ 置 NULL 重新入队翻译；本次实测命中含 #353996。

### 回归测试
单测：污染样本（指令回显+分析+译文标记）→ 清洗后等于纯译文；纯译文输入 → 原样通过；无标记纯分析 → 回退草稿。

---

## 4. F4 早报/周刊页面导航（`web/src`）

- `MyBriefPage.jsx` / `WeeklyPage.jsx` 根节点加 `<IconRail />`（import 自 `../main.jsx`），与 DailyPage/HotPage/MyReadingPage 完全同构。
- 不加完整 Sidebar（与daily/hot/reading 一致的窄图标栏是既定信息架构）。

---

## 5. F5 周刊长久存储（`tools/collect-turso.js` saveWeekly）

- 删除 `while (archive.length > 4) archive.shift();` → 归档无上限（一周一期，JSON 体积 ~20 条/期，可长期累积）。
- `weekly.latest` + `weekly.archive` 均存 settings 表；已核实 `runCleanup` 只删热榜旧文章，**不触碰 settings** → 无清理风险。
- 归档查询端点 `GET /api/weekly?issue=N` 已存在，前端 `/weekly/` 已有归档入口，删上限即生效。

---

## 6. F6 我的早报订阅源（测试用配置）

云端 `focus=0` 导致 runMyBrief 永远写引导态。为使「先生成今天的早报」可执行：
- 在云端 Turso 标记 ~8 个高质量活跃源 `focus=1`（AI/科技/公众号/财经各取代表，全部 enabled 且近期有更新）。
- 这是 v1 临时语义（T2-1 订阅模型上线后切换 `subscription.ids`），用户可随时在管理台「源库」Tab 改。

---

## 7. 验收流程（严格按 AGENTS.md §2）

1. `npm test` 全绿（含新增回归测试）
2. `npm run build:vercel` 无错
3. `git push origin main` + **`git ls-remote` 确认远端 SHA**（09-13 事故新规）
4. 云端实测：浏览器实测阅读器滑过 30 条继续加载、热点榜翻页、早报/周刊导航可见、#353996 重译干净、时间显示正常
5. 本轮验证任务：focus 标记 → `daily-ai`（含我的早报）→ `weekly`（本周首期）→ `eval-filter` 黄金集 → translate 线上直调
6. 用户确认修复成功 → 全量文档同步（FEATURE_MATRIX/ISSUES/HANDOVER/ARCHITECTURE 坑表/本文档收尾）+ 文章归档（`npm run archive`）

## 8. 遗留与不在本轮范围

- YouTube 55 源熔断：反爬假 404，阈值 10 是既有决策；彻底解需住宅代理 RSSHub（P1-14 挂案）
- smart 排序本地端数值游标的同型隐患：本轮顺手绑定 Number 对齐（低风险）
- 代理端口 7890→12000 的文档修订：随用户确认后的全量文档同步执行

---

## 9. 验证任务执行记录（AI 配额恢复后，2026-09-13 下午）

| 任务 | 结果 | 证据 |
|---|---|---|
| AI 配额 | ✅ 恢复（期间 05:17~06:02 再次超限触发 ai_failed 报警，~06:13 自愈） | Agnes 直连 200 |
| daily-ai 全量 | ✅ 3 栏 27 条（深析 43 篇后预算截断，部分降级）；今晚 00:32 定时任务会以完整预算重跑 | collect-turso daily-ai 日志 |
| 我的早报（今天） | ✅ 先标 8 个 focus 订阅源（The Verge/HN/量子位/36氪/财联社/第一财经/新华社/半导体行业观察，用户可在源库改）→ 生成 top3/featured7/rest N，飞书推送 1/1 成功；导语三轮均被推理模型污染 → 已强化 generateTheme（形状校验+一票否决+null 语义），污染导语清空不渲染 | /mybrief/ 页面 + 飞书 |
| 精选周刊（本周首期） | ⚠️ 第 1 期已生成落库（20 条，归档 1 期，页面正常含降级标注），但为**降级版**（按热度排序）——深析阶段 Agnes 二度超限连败 3 次触发降级链。首跑 `Fatal: terminated`（2000 行×content_html 一次拉取超 libsql HTTP 限制）已修复。**周五 18:03 定时任务会生成完整 AI 版第 2 期**；如需重出干净的 AI 版第 1 期，清空 `weekly.latest`+`weekly.archive` 后在配额窗口内重跑 `node tools/collect-turso.js weekly` | weekly-run2.log + /weekly/ 页面 |
| eval-filter 黄金集 | ⚠️ **本轮结果无效**：20 条全部 50 分（=「解析失败放行」兜底分），配额高压下模型输出不可解析。**需在配额空闲窗口重跑**（建议明早 08:00 前，避开 00:32 daily-ai 与 15min translate 的配额占用） | eval-filter 输出 |
| translate 线上直调 | ✅ POST /api/articles/353996/translate 通；重译产物干净（英文思维链形态已在二轮强化中堵住） | API 实测 |

## 10. ⚠️ 本轮意外事故：npm test 清空线上订阅配置（已修复）

**cloud 回归测试直接打真实 Turso 是既定模式，但 `regression-cloud-settings` 测 9 的
`focusSourceIds` 全量替换语义会 `UPDATE sources SET focus=CASE...ELSE 0 END` 写整表，
旧"恢复"只复位 2 个测试 id → 跑一次测试 = 清空用户全部 focus 订阅源。**
本轮实测撞上（04:42 审计日志 `daily.settings {"keys":["focusSourceIds"]}`）。
修复：测试前快照全部 focus=1 源，finally 中用同一条 CASE 语句精确还原；
验证 = 测试前后 focus=1 集合断言一致。
**教训：凡"全量替换/整表 UPDATE"语义的测试，恢复逻辑必须覆盖同 Zoo 的全部行，不能只测自己摸过的行。**

## 11. 运维能力增量

- `node tools/collect-turso.js mybrief`：手动重生成我的早报（独立分析订阅源窗口 ~30 篇，约 15-20 min，不必跑 90 min 的 daily-ai 全管线）
- weekly/daily-ai 大窗口查询一律不带 content_html，深析按 id 单取（libsql HTTP 大 payload 会被掐断）
- 本机代理实际端口 12000（Clash 面板），`.env` HTTPS_PROXY 已改；git 已配置 `http.proxy=127.0.0.1:12000`
