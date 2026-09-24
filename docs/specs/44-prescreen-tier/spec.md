# 设计 44：零额度预筛层（级3 每源配额 + 初筛改二元三问）

> 最后更新：2026-09-24（**步1 已交付**：HEAD `6c40812`，`npm test` 621/621、push-CI success、冒烟 20/20、
> 执行锁 E1~E3 真跑过生产模式；**步2 未开工**。前身 `docs/specs/23-information-overload-defense.md`，
> 本 spec 补的是 23 完全没有的一层：**进模型之前的零额度预筛**。判据文档：
> `docs/RSS高质量信息流系统设计参考文档 (1).md` §1.6 / §4。）

## 一、因果链（为什么是这一刀）

- **现象**：24h 窗口内 469 个活跃源，只有 94 个进过模型；早报 500 个坑里 **352 个是同一批高频源的"第 3 篇以后"**。
- **根因**：设计文档 §1.6 的「零模型额度预筛五级阶梯」在代码里**整层缺位**，五级该做的活全压给 Pass 1（模型）。于是两件事同时发生：
  1. 额度花在正则能做的事上 —— §1.6:33 架构纪律明令禁止（「预筛层任何一级出现模型调用即违例」）；
  2. Pass 1 被要求输出 **0-100 绝对分** —— 违反 §4:119「不给模型绝对评分任务，只给相对判断任务」，而绝对分正是校准漂移的直接来源（抽查实证：AI 在理由里写"关联度低"，分数仍给 38~55）。
- **为什么现在做**：P0-2 把 `maxTokens` 抬到 512 后初筛真在工作，但两期都撞预算截断。**截断的根因不是 512 太大，是送进模型的 500 篇里七成是重复坑位**——级3 一刀把"削减"变成额度中性的事。

## 二、实测依据（B137，全部只读探针，零 AI 消耗）

| 读数 | 值 | 取法 |
|---|---|---|
| 候选池 | 2,688 篇 / 469 源 | 谓词逐字复刻 `tools/collect-turso.js:1145`，rolling-24h |
| `LIMIT 500` 的源覆盖 | **94 源（20%）** | 同上 |
| 级3 每源≤2 作用于该 500 | 剩 **148 篇**，源覆盖 **94（一源不丢）** | JS 侧模拟 |
| 级3 + 保留 500 上限 | 覆盖可到 ~450 源，**调用量不变** | 同上 |
| commit 形垃圾流 | `openclaw` 一条源 177 篇/天；翻译候选池内 **151 条** | `tools/collect-turso.js:1946` 的 SQL **无任何源过滤** |
| filter 耗时 | 中位 3.3s / p90 7.0s（`ai.stats` 滚动 500）+ 串行间隔 4s（`lib/ai-throttle.js:4`，生产 `ai.minIntervalMs` 未设）→ 每篇墙钟 7~12s |
| 两期真耗时 | **81 / 85 分钟**（`stats.elapsedMin` 显示 8.1/8.5） | `tools/collect-turso.js:1399` 表达式 `Math.round(ms/600e2)/10` = 真值 ÷10，**是 bug**（已修，锁 P7） |
| 级1/级2 前提 | 跨源同链接「被 ≥2 源发过」= **0 组**（`articles.url` UNIQUE + `INSERT OR IGNORE` 在入库层销毁该信号）；标题近重复 ≥3 源簇仅 14 个 / 66 篇 = **1.9%** | 文档写"级2 削 30–50%"，本库不成立 |
| 黄金集失真 | `tests/fixtures/daily-golden.json` 20 条全为手写漫画式样本（"震惊！…不看后悔一辈子"），**无一条真实的"平静但跑题"负例** | 故 `tools/eval-filter.js:19` 准确率对本期改动无判别力 |
| **宽池 IO 代价（09-24 交付后直读生产实测，每档 3 次取中位）** | 2000 行轻量 **388ms / 1,042KB** ｜ 500 行轻量 215ms / 247KB ｜ 500 行旧写法 `a.*` **170ms / 3,433KB** | 抬 4 倍行数只多 ~173ms，远在 Vercel 30s/60s 预算内；而**收窄列才是省的地方**——同 500 行载荷从 3.4MB 降到 247KB（约 1/14）。本行是交付后补测，用来清"我引入了 4 倍行数"这笔账 |

## 三、范围

### 步1 —— 级3 每源配额进候选层

- 唯一实现**拟新增**（本 spec 批准后才会创建）`lib/prescreen.js`，导出纯函数 `applySourceQuota(rows, {cap, limit})`：按池内既有顺序（时间序）对每源取前 `cap` 篇，再截 `limit`。**不写进 SQL**——三端方言不同（libsql / better-sqlite3），且窗口函数写三遍必漂（AGENTS §1 三端语义 + 坑 #59）。代价：候选查询 LIMIT 从 500 抬到 2000（轻量列、不取 `content_html`，与 `tools/collect-turso.js:872` 同形）。
- `cap` 取 `settings['prescreen.perSourceCap']`，默认 2；缺键/坏值回 2 并出声（同 `lib/brief-guards.js#dailyMinScoreOf` 口径）。选篇信号本期只做「最新」。
- 小源（日更 ≤cap）天然全额通过，不需例外分支。
- 接入**部署面四处**（行号为 09-24 交付时读数）：`tools/collect-turso.js:1157`（daily-ai 主链）、
  `tools/collect-turso.js:1720`（09:03 裸报告 `runDaily`）、`api/daily-generate.js:121`、`api/[...slug].js:713`（读层内联兜底）。
- **本地灾备端 `server/services/ai/daily.js` 有意不接**（用户 09-24 裁定 A）：它不在部署面（`.vercelignore` 排除
  `server/`，注释「已由 api/ 替代」），且功能集早已分叉（`related` 同主题合并 / 破茧栏 / 正文参与栏目匹配都没有云端版）。
  入报门槛（安全阀）仍必须接——**安全阀与策展策略不共用同一个「逐个接线」的面**。
  该豁免由锁 `regression-prescreen.test.js` P6b 盯前提：`.vercelignore` 一旦不再排除 `server/`，豁免自动判红。

### 步2 —— 词表代码化 + Pass 1 改二元三问

- 新增 `lib/filter-rules.js`：纯函数 `ruleReject({title, summary, sourceUrl})` → `{hit, why}`。承接三类**零判断**判据：① `prompts/filter.md:18` 的强制压分负例词表（从 prompt 搬进代码）；② commit / changelog 形标题与 `github.com/*/commits/*` 流；③ 纯链接列表薄正文。命中即**不发模型**（这才叫级4 零 token）。
- `prompts/filter.md` 重写为 §4.1② 的**二元三问**（是否原创信息增量 / 是否纯复述已知新闻 / 是否有硬伤），不再要 0-100 分。
- **返回契约保持不变**：`filterArticle` 仍回 `{score, ignore, reason, failed}`；`ignore` 由三问合成，`score` 降为派生占位值。这是**有意的兼容层**——一次护住 `tests/regression-filter-observe.test.js:102`（F5 落库形状）与 `tests/regression-ai-infra.test.js:142`（脏 JSON 兜底），不当历史包袱删。
- 同步 `lib/ai-prompts.js` 里 `EMBEDDED.filter` 那份兜底文本，否则复现 B51/H10「后台改了主链路不生效」。
- 四个调用点一起过：`tools/collect-turso.js:617`（quickscore）、`tools/collect-turso.js:905`（周刊）、`tools/collect-turso.js:1156`（日报）、`tools/eval-filter.js:19`。

## 四、边界（明确不做）

| 不做 | 为什么 |
|---|---|
| 级2 SimHash 指纹合并 | 实测可削面 1.9%，前提不成立；且要做必须先改入库层把重复"记账"（动 Turso schema，四处对齐），独立决策 |
| 级5 主题分组当闸 | 现成 `lib/ai-relevance.js` 词表只判出 26/146 相关（Al Jazeera/Phys.org/HN 全被判不相关）——当闸即误杀 |
| 抬 `BUDGET_MS` / 调 gap | 等步1+2 的实测读数再判；同批动会把"谁起的作用"混在一起（与你 09-23「先修字数上限、观察两期再动级3」同一条理由） |
| L5a / L5b（P0-3 评分-分配隔离） | 独立一条，不混批 |
| 周刊链路 | 窗口 7 天、语义不同，级3 是否适用单独拍 |
| 预筛层引入任何模型/embedding 调用 | §1.6:33 架构纪律 |

## 五、验收（按 AGENTS §3 新链，外加本改动特有读数）

1. `npm test` 全绿。新增回归锁：`applySourceQuota` 三例（小源全额 / 大源截到 cap / cap 后源覆盖不降）+ `ruleReject` **双向自证**（喂 commit 形标题、纯 `Comments` 薄正文、导购词必须挡；喂本期真实入报条目必须不挡——防判据恒真/恒假）。每条锁的 diff 带"为什么"，指向用户本轮裁决「初筛的职责是削减，不是理解」。
2. 一次性只读探针直读生产真值，出**改前红/改后绿**对照：源覆盖 94 → ≥400；AI 调用篇数 ≤500；`filterStats.truncated` 是否消失；每篇中位耗时。产物落 `docs/eval/`。
3. 顺带修 `elapsedMin` 的 ÷10（一行）——否则第 2 条的耗时读数不可信。
4. 云端实测：`/api/meta` 的 commit == `origin/main` 后 `workflow_dispatch mode=daily-ai-evening` 跑一期，读 `daily_reports.stats.filterStats` 才算证据。
5. 真实语料复抽（同窗口等距 42 篇真跑，逐条看剔除/放行/理由）。**不以黄金集准确率为判据**；另把本次抽查抓到的真实负例（预告片 38 分 / 海事 38 / 游戏快讯 38 / 政治 52 / 两党制 55 / commit 4 条 / 咖啡机 1 条）补进黄金集，记一条独立改动。
6. `node smoke-test.js`、`npm run lint:docs`、`node tools/doc-stamp.cjs`。

## 六、必须同步的文档（漏一条即违反 §2.3/§2.4）

- `docs/specs/23-information-overload-defense.md`：L4「补强：在 filterArticle prompt 中显式列负例」是**被本 spec 取代的旧决策** → 头部加「已作废 + 日期 + 指向本 spec」，禁止静默删除；L2/L3 的状态标记按本期实测更正（L3 已实现但只管版面、L2 的信号被 `url` UNIQUE 销毁）。
- `docs/ISSUES.md`：登记 B137（`elapsedMin` ÷10、黄金集失真、级1/级2 前提不成立、翻译候选无源过滤、commit 流真身=OPML 导入源 974）。
- `docs/FEATURE_MATRIX.md`、`docs/CLOUD_PIPELINE_GUIDE.md`（候选池语义变了＝链路变更）、`ARCHITECTURE.md` 坑区、`docs/changes/2026-09-23-rss-pipeline-discussion-handoff.md` §五/§六 三处更正。

## 七、禁止

- 禁止只改 runner 一份就算完：候选语义三端各一份，AGENTS §1。
- 禁止把 `cap` 值写死进三处 SQL。
- 禁止用改锁的方式消红（锁红了 → 报给你三选一）。
- 禁止在预筛层引入模型调用，包括"临时用一次 embedding"。

## 八、待你拍板（三项，一次一项）

1. **`cap` 默认值与来源**：settings 键默认 2（我的建议，可后台调）／还是先写死常量 2 不给后台口子？
2. **`score` 兼容层留不留**：保持 `{score,ignore,...}` 契约（护两条现存锁）／还是直接改成三问形状并同步改锁（锁的"为什么"就是你本轮那句"初筛是削减不是理解"）？
3. **步1 与步2 同批还是分两批**：同批省一轮交付链，但读数混在一起分不清是谁的作用；分两批则步1 单独就能回答"截断是否消失"。我倾向分两批，按你 09-23 那条"先修一个变量、观察两期"的口径。
