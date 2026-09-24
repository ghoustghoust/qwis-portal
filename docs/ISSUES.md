# 全网情报系统 · 已知问题清单（活文档）

> 只装**现在还坏着 / 等你决定 / 等复验**的事；每条只答两个问题：**现在坏着什么、下一步是谁的什么动作**。
> 已核销（修好且验证过）一律不进本文件——历史按症状反查 `docs/archive/README.md`。编号不连续是正常的：出账的号不占位。
> 功能需求见 `docs/NEXT-DEV-REQS.md`；每条登记必须带取证命令（坑 #50）。
> 最后更新：2026-09-23（**B136 核销**：用户已轮换 PAT，cron-job 8430047 已换钥并重新启用——13:01/13:15/13:30Z 连续三轮 dispatch 成功，15 分钟心跳恢复；push-CI 同轮首绿。**BL13 核销**：三条语料规模锁按裁定③摘除——锚点分母 ≥100 / 裸文件名 ≥20 / 台账引用数 ≥ 文档数，理由=语料规模不是锁能拥有的属性（删 65 份 spec 合法塌陷 172→47、224→62 致误红），分母打印/非零下限/双向自证保留，锁落在 `tests/regression-doc-lint-rules.test.js` L3/L5 注释；**B121 复验改探针**（e2e 已按 09-23 测试口径降级为按需工具，AGENTS §3）；**交付链已重订**见 AGENTS §3。上一轮：specs 35~43 整批作废删除并留逐字反查锚点）

## 进度速览

- **待开发队列 09-22 全清**：19 条（P0×4 + P1×4 + P2×7 + P3×4）逐条交付，600/600 绿，线上 `25aa5fe` 起
- **等一次真实复验**：B10（今晚 21:30 日报）· B16/B121（下一次 weekly 跑批）· B17（下一次 weekly 日志看预筛形态）· B14（现役库读数）· B11（浏览器）· B19/B20（下一批 daily-ai）
- **等你操作**：B79 后台重勾订阅（你说自己勾）；凭据轮换一批里 AGNES key 已轮换验证，其余三处（B118/B125/B80）与 B119② 你裁定暂缓
- **等你裁决**：B81+B128 死代码三件套（复活或删，摘清单与删文件必须同批）· B125② 鉴权兜底改「缺 env 即 401」（随暂缓批一起）
- **等你裁决**：B81+B128 死代码三件套（复活或删，摘清单与删文件必须同批）· B125② 鉴权兜底改「缺 env 即 401」

## 🔴 未修 / 待开发 —— 队列已全清（09-22）

> 19 条队列（P0×4 + P1×4 + P2×7 + P3×4）逐条交付完毕，每笔带锁与证据；出账原文与交付读数逐字在 `docs/archive/debugging/2026-09-21-issues-round2-closed.md`。新发现的问题直接登记在本表。

| 序 | # | 现在坏着什么 | 下一步 | 审查 |
|---|---|---|---|---|

## 🟡 观察中（代码已落地，等一次真实复验）

| # | 代码侧已落地 | 复验动作 |
|---|---|---|
| B11 | 后台 Tab 骨架屏（锁 I11） | 你浏览器看一眼（登录门后，我不代输口令） |
| B10 | 生产 `daily.columns` 已回写默认栏目（写前备份 `docs/eval/b10-daily-columns-backup.json`，写后回读逐条一致） | 下一批日报（今晚 21:30）栏目注解应显示「新公开的课程、训练营与社群招募」等人文案，而不是关键词复述 |
| B14 | `qOne` 已修、`reading.digest` 在产出；旧库 99.94% 脏值前提随换库消失（BL10 实测现役库零污染） | 按现役库复验一次即核销 |
| B16 | 导语清洗器（第一人称一票否决）+ 放弃原因日志 | 下一次 weekly 跑批覆盖线上 `theme=null` 那期，与 B121 同批复验 |
| B19 | 「reasoning 冒充正文」已断（无正文即抛错） | 观察模型/额度侧波动（W6 族） |
| B20 | 五个写入点全走 `applyDailyQualityGate` 同一份门槛 | 下一批 daily-ai 无 <30 分条目的读数 |
| B121 | 周刊骨架三件判定 + 失败重试 + 期号按内容窗口（锁三条） | 线上现存那期是修码前历史产物 → 下一次 weekly 跑批后复验。**09-23 起 e2e 降级为按需工具（AGENTS §3），复验改只读探针**：直读 `settings['weekly.latest']` 查 theme/coverTheme/storylines 三键是否齐（不许为绿灯放宽判据） |

> 测试族观察：W9 `regression-ui-data` 偶发红（1/4，已加显式端口校验）；W16 未定性的 2 红 / 8 次全量，再复现且取到读数即升级为独立 bug。
> 处理纪律：①整文件同红 + DNS/连接类错误 → 按 `fail_env` 重跑，不许改代码/放松断言/记成已修复；②e2e 的红先分「判据错 / 读得太早 / 真坏了」；③偶发红先重定向存整段输出再复跑，红要带两侧读数；④白盒编号以 `tools/eval-whitebox.cjs` 实存号为准，拟建号标 `(拟)`。

## 🔵 等你操作（我这边做不了）

| # | 现状 | 你要做的 |
|---|---|---|
| B79 | `subscription.ids` 现为 `[]`，走 53 个星标源兜底，页面不坏；你真正的订阅集合已不可从库里恢复 | 后台重新勾选；或授权我按 `focus=1` 的 12 条写回（生产写，写前备份进 `docs/eval/`） |
| B80 | `.env.example` 有一条非占位口令随 `6be2cf8` 进了 git 历史（与现值不同；历史删不掉） | ⏸ 你 09-22 裁定：暂缓（与 B125 一批统一处理） |
| B118 | 09-20 换库已止血；旧库不许删、云端独有的 `weekly.*` 归档当时未回读 | ⏸ 你 09-22 裁定：暂缓轮换（旧库可能还要回读/回切） |
| B119 | ②配额不可观测：⏸ 你 09-22 裁定暂缓（后期可能调策略）；③公众号源：**65 个里已恢复 40**（33 个本来就有 bestblogs.dev 现役源、7 个已接线 wechat2rss.xlab.app 公共目录源），剩 25 个全库无源——**你已裁定删除**（09-22：用不了就清掉，前后端都不显示；备份在 `docs/eval/b119-wemp-sources-backup.json`，24 篇孤儿文章读层 JOIN 自然隐藏） | ③已按你裁定收尾，无后续 |
| B125 | 管理台默认口令硬编码兜底 == `.env` 现值，自 09-08 起在 `origin/main` | ⏸ 你 09-22 裁定：暂缓（等全改完统一说；仓库内无私密信息） |

## ⚪ 等你裁决

| # | 事项 | 候选 |
|---|---|---|

## 🟢 挂案（外部依赖/低优先，保持跟踪）

| # | 问题 | 状态 |
|---|---|---|
| H1 | YouTube 对数据中心 IP 反爬假 404 → 熔断反复 | 彻底解需住宅代理；现状可接受，不销 |
| H2 | 日报引擎双份实现（`api/daily-generate.js` 仅兜底 vs `[...slug].js` 内联） | 主链路在 runner，T3 系重构时收敛 |
| H3 | ~~P2-5 /api/img 无 SSRF 防护~~ 已闭合（`api/_safeimg.js` + 双端同语义锁）。余低危：P2-4 AUTH_SECRET 回退 'dev-secret' / P2-6 LIKE '%%' 慢查询 / P2-7 handleDaily UTC 日期比较 | 低危挂案 |
| H6 | B 站采集「更好的方案」调研（Cookie 主链 vs 现匿名降级） | 待调研 |
| H7 | 云端 `/api/articles` 无 `dedup=1` 分支（本地有），双端「合并同事件」行为差异 | T5 剩余重构时收敛 |
| H8 | spec30 C3「保存后前台实时预览」未做；subscription.ids 跨实例 30s 缓存窗口（人工点击不可达） | 后续小 spec |
| H11 | `weekly.archive` 每期内嵌完整 report 且 items 双份、`handleWeekly` 全量解析只投影 5 字段，函数预算 30s | 慢性 504 面，需投影/截断策略 |
| H12 | ~~`settings['weekly']` 后台可编辑但 `runWeekly` 从不读它~~ **09-23 探针：该键在现役库根本不存在**（`SELECT key FROM settings` 全表无 `weekly`；只有 `weekly.archive` 16,072B 与 `weekly.latest` 15,977B 两个独立键）。所以"可写但不生效"这条已无从谈起 | 原拍板（接进配置 + 加「改了真生效」断言，归 39/40 域）随 spec 作废失去落地文档；若周刊窗口/条数仍需可配，需重新确认后台到底写的哪个键 |
| H14 | 熔断自愈三端不一致：**本地端至今零自动恢复**（只有两个人工入口 `server/routes/health.js:92` `unfreeze-all` 与 `server/routes/restore-all.js`，无调度线）；云端 48h 流放太久（45min 熔断 vs 48h 恢复）。旧「584 源曾锁死 5~7 天 / 实测 78% 重试即成功」是 09-18 读数，**未复测**；09-23 现役库熔断中 = 11 个源 | 原方案 spec 已作废删除（锚点见本节末「specs 35~43 作废」行）；要做需重新立 spec |
| H15 | `restore-all` 全量无差别解冻，会放回真死源、污染活源计数 | 原计划「35A-F8 改按类别分批试探恢复」随 35 号 spec 作废而失效，**问题本身未修**；现有人工入口可用但知悉代价 |
| H16 | ~~系统性故障被折算成单源失败~~ **09-23 复核：云端线已交付** —— `lib/source-breaker.js#detectSystemicFailure`（双判据 :69-83）+ `tools/collect-turso.js:416-423` 抑制单源计数、`:492` 每轮检测。**残留缺口不是"没做"而是"只做了 1/3 端"**：`api/collect.js` 与 `server/services/collectors/store.js` 只调 `breakerThreshold`，都没调 `detectSystemicFailure`；白盒 **W1c 判不出这个洞**（它只验三端"引用了 source-breaker"，不验"用了同一判据全集"） | 登记为独立缺陷：三端补 `detectSystemicFailure` + W1c 判据升级（须配正向探针：喂一个"只引用不调用"的坏样本必须判红） |
| H17 | 三项 P1 修复**当初就没留下任何视觉证据**：`验证截图/P1-2_报警引擎`、`P1-7_reason修复`、`P1-13_稍后读修复` 三个目录今天仍为 0 文件（09-23 `find <目录> -type f \| wc -l` 复测均为 0）。此事实原来只写在 42 号 spec 的 quarantine 副本里 | 不许把这三项当"已验证过"引用。**未查清是"当初没截"还是"截图丢了"之前不归档**（§2.3）；取证命令见左列 `find` |

| H18 | **生产 `settings` 表里躺着 5 个测试写入键**：`test` · `test_key` · `test_setting` · `test_setting_1` · `test_x`（09-23 全键枚举实测，`SELECT key,length(value) FROM settings` 共 32 键）。白盒 W23 现在绿，说明**当前测试不再泄漏**，但这批残留是泄漏过之后没人清 —— 与 `bl10-null-audit` 那类脏数据同族，会污染任何"按 key 前缀扫配置"的逻辑 | ①确认这 5 个键确无消费方（扫读侧 `getSetting('test`）；②一次性清理并配一条"生产 settings 不得有 test* 键"的断言。属生产写，**需授权** |

| H19 | **黄金集没有真实语料负例，`eval:filter` 的准确率对初筛改动无判别力**：`tests/fixtures/daily-golden.json` 20 条（10 好/10 坏）全是手写漫画式样本（"震惊！…不看后悔一辈子！"），而 09-24 抽查 42 篇抓到的真实漏放是"平静但跑题"那一类（预告片 38 分 / 海事 38 / 游戏快讯 38 / 政治 52 / 两党制 55）——一条都不在黄金集里。拿它验收等于让判据只测"词表是否命中我们自己写进 prompt 的词" | 把上面 5 条 + commit 形 4 条 + V2EX 生活帖 1 条真实负例补进黄金集（标题摘要逐字取自生产库，非虚构）；`node tools/eval-filter.js` 取证 |
| H20 | **跨源重复信号在入库层就被销毁，文档 §1.6 级1/级2 的前提在本库不成立**：`articles.url` UNIQUE + `saveArticles` 的 `INSERT OR IGNORE`，实测「同一 url 被 ≥2 源发过」= **0 组**（去参数后 28 组里最大一组还是 `mp.weixin.qq.com/s` 截断伪信号）；24h 候选标题近重复 ≥3 源的通稿簇仅 14 个 / 66 篇 = **1.9%**。文档写"级2 削 30–50%、削减量最大的一级"，那前提是通稿满天飞的语料 | 想做爆发检测必须先改入库层把重复"记账"（事件表或 url 计数列，动 Turso schema → 四处对齐）；取证：`SELECT url,COUNT(DISTINCT source_id) c FROM articles GROUP BY url HAVING c>1` |
| H21 | **翻译候选 SQL 没有任何源过滤**：`tools/collect-turso.js:1946` 只判「无译文 + 有 content_html + 标题英文」，不看 type、不接 `notNoiseSql`、不看正文长度。实测当前池内 1,548 条英文候选里有 **151 条**是 `fix()`/`test()`/`refactor()` 形标题（单 `openclaw` 一条源占 9.8%）。目前**只真翻过 1 篇**（源 974 共 390 篇），靠的是 P1~P4 优先级把 P7 挤掉的队列饥饿，不是制度 | 候选层加零成本规则（与级4 同一条判据，一处挡两头）；取证：复刻该 SQL 按 conventional-commit 正则计数 |
| H22 | **本地灾备端有三样能力从未移植云端，且级3 有意不跟它对齐**：`related` 同主题合并 / 破茧栏 / 正文参与栏目匹配只存在于 `server/services/ai/daily.js`（api/ 与 runner 各 0 处），与 `FEATURE_MATRIX:155`「开发完成必须当日移植云端并实测」相反。09-24 用户裁定 A：级3（策展策略）不接本地端（不在部署面，`.vercelignore` 排除 `server/`），入报门槛（安全阀）仍接——两类风险等级不共用同一个"逐个接线"的面 | 移植与否是产品决定，需单独立项；漂移由锁 `regression-prescreen.test.js` P6/P6b 盯（`.vercelignore` 一旦不再排除 server/，豁免自动判红）；取证：`grep -c related server/services/ai/daily.js api/*.js` |

| H23 | **`runDaily`（裸报告）的 `stats.candidates` 是门槛后口径且从不写 `gateDropped`**，破不变量12「五份写入器 candidates 统一 = 进门槛前候选数」。不是本轮引入：`git show 6c40812^` 那一行同样缺；B20（09-19）给它接上门槛时只接了过滤、没同步 stats。生产实测指纹确认：id **67/62/59/56** 的 stats 键集恰为 `schemaVersion,candidates,articles,sections,totalItems`（无 `gateDropped`、无 `filterStats`），`candidates` = 473/497/494/493（门槛后），而同窗 AI 行 id 66/65/61 恒为 500 且带 `gateDropped=46/60/139`。影响面：统计卡与后台"每日早报"读的是同一个字段名、两种群体（09-19 独立审查统一过一次，这一份漏了） | **故意不在步1 里修**：它会让裸报告的 `candidates` 读数跳变，与级3 的效果混在同一批里就归因不清（用户 09-23「先修一个变量、观察两期」同一条理由）。修法两行：`candidates: valid.length + gateDropped` 并把 `gateDropped` 写进 stats；配一条锁（照 F5 的形状锁）。取证：`SELECT id,stats FROM daily_reports ORDER BY id DESC LIMIT 30` 看键集 |

| H24 | **`ai_failed` 冷却键是单一全局位 `ai_failed:global`（默认 120min），把两类不同的异常合并抑制**：P0-2 的「本期初筛没筛（失败率≥20% 或预算截断）」与 `_ai.js` 的「AI 通道连败≥3 次」都走 `aiFailed()` → 同一个 `coolKey`。后果实测坐实：09-23 那三期内 id65（19:18Z，`truncated=true`、失败 49/274=17.9%）与 id66（21:06Z，失败 **136/318=42.8%**）两条都满足报警条件，但 19:00~23:59Z 整个窗口 `audit_log` 里只有 **一条** `ai_failed`（22:59Z）——前一条被 120min 冷却吞掉。且 `alerts.dispatch` 的 `detail` 只存 `{event,title,sent,total}`，**报警正文不落库**，事后无法分辨那条到底是"初筛异常"还是"通道全挂" | 两个小改（都不在步1 内，避免与级3 读数混批）：① 冷却键按子因分位（`ai_failed:filter` / `ai_failed:channel`）；② `audit_log.detail` 带上正文摘要（现有 `title` 是固定 emoji 标题）。取证：`SELECT at,detail FROM audit_log WHERE action='alerts.dispatch' AND at BETWEEN '2026-09-23T19:00Z' AND '2026-09-23T23:59Z'` + `settings['alerts.cooldowns']` 的 `ai_failed:global` |
| H25 | **级3 的覆盖率天花板不是 `cap`，而是候选宽池读 `CANDIDATE_POOL_READ=2000`**：第一期生产读数（id=68，09-24 07:53Z）`prescreen={cap:2,pool:2000,poolSources:202,kept:337,keptSources:202}` —— `pool` 恰等于 2000 说明宽池读**被吃满**（同窗口全量真值 2,688 篇 / 469 源，见 `docs/eval/2026-09-24-prescreen-step1.md` §一）。2000 行里只出现 202 个源 → 配额能给的天花板 = 202×2 = 404，**500 个坑空着 163 个**，实测覆盖 94→202（2.15×）而非 spec 预估的约 450（4.8×）。副作用：`candidates` 500→337（调用量 −32.6%）是"没填满"而非"设计省下来"，同期 `truncated` 仍 true（299/337 尝试、失败率 23.4%），已不能记在候选量头上 | **09-24 已处置（用户裁定「抬」）**：宽池读 2000 → **6000**，单一取值写进 `lib/prescreen.js#CANDIDATE_POOL_READ`（依据：24h 全量 3,645 篇 / 327 源、轻量列合计仅 928 KB → 旧顾虑"宽池不能抬"只对 `content_html` 成立），runner 与两份 api 同取此数、新增锁 **P9** 钉相等（因为 `api/` 不能 require `tools/`，`.vercelignore` 排除，字面量必然有两份）。预期下一期：`pool` 不再等于常数、Σmin(n,2)=530>500 → 500 坑填满、覆盖往 327 源走、调用量回 500。**已实测兑现（同日 09:12Z，`daily_reports.id=69`，由云端 `POST /api/daily-generate` 写入）：`pool=3806`（不再顶格）、`kept=500`（坑填满）、`keptSources=313` → 覆盖 202→313（+55%）**，H25 核销。取证：`SELECT id,stats FROM daily_reports WHERE id>=68` 读 `stats.prescreen`，与 §一 的全量池真值对照 |
| H26 | **库里 96% 是一列 `articles.content_html`，而把它迁出主表的归档工具从没被排期跑过**：只读探针按表/列合计文本量（`LENGTH()`＝字符数不是字节数，中文一字 3 字节；170MB 是 Turso 压缩后的物理值，两个口径不矛盾）——`content_html` **521.6M 字符 / 34,521 行（平均 15.1k 字符/篇）= 全库文本 541.0M 的 96.4%**；第二名 `original_html` 仅 3.8M，其余各表 ≤1.2M。而 `articles_archive` 表 **0 行**：`tools/archive-articles.js`（>90 天迁出主表，谓词与 `lib/retention.js` 同一份实现、带 `--dry-run`）在 `.github/workflows/` 与 FEATURE_MATRIX 里都搜不到引用 = **工具在、链路从没跑过**，所以 articles 只增不减 —— 老库顶到 Turso 上限、新库现在 170MB 的主因就在这。读放大侧：`api/[...slug].js:142` 阅读器搜索用 `a.content_html LIKE '%q%'`（每次搜索全表扫该列，游标翻页每页再扫一次）、`:477` 空摘要兜底 `substr(content_html,1,500)`；级3 宽池读已改为不取该列（不变量 20） | **09-24 晚量化后，本条的处置建议先被自己推翻一半**：原写"归档排期 + 搜索不扫正文"两刀，实测**归档腾不出多少**——
  90 天前的文章只有 **3,029 篇 / 40.7M 字符 = 全库正文 521.6M 的 7.8%**，30 天前也只有 78.0M（15%）。
  真正的原因是**增长速率**：日均 1,875 篇 × 平均 15.1K 字符 ≈ **28M 字符/天**（一个月新增正文 ~850M 字符）。
  所以主路应改成：**① 干脆不常驻 `content_html`**（深析已实现"按 id 单取正文"，说明主链路不强依赖它在库里的常驻量）
  或入库前压缩/截断；② 归档窗口 90→30 天（配角）；③ 搜索改 FTS 或至少不扫正文列。**都不在本轮做**（用户 09-24：源与数据治理要细看，属后续开发计划）。
  **09-24 夜把这三条按实测体积杠杆排了序**（`docs/eval/2026-09-24-turso-read-amp.md` §九）：压缩才是同量级最大的一刀 —— 400 行抽样 gzip-9 实测 **5.90×** ⇒ 587 MB 正文入库前自压可落到 **≈100 MB（省 83%）**，不动源不删行；
  放行一次清理 **235 MB（41.6%）**；**而"截断到 200 KB/篇"只省 13.6%**（分布不是长尾病：<20 KB 的行占 82.1% 却只占 11.8% 字节，>300 KB 的只有 193 行）；
  **砍腹泻源在体积上仍然是 1.6%**（存量按轴实测：可见 98.3% / 排除 1.7%，行数前 12 的源占 22.9% 行、只占 1.6% 正文 —— AIHOT 三条本轮点名：热榜/精选全文=排除、日报=可见）。
  ⚠️ 压缩的连带账：会让 `content_html LIKE` 彻底不能工作（正好逼掉 §三 最贵的读放大），且写路径三份实现 + 多个读点都要同步改 ⇒ 按 spec 走，不是开关。
  **09-24 夜字节口径复测（`LENGTH(CAST(x AS BLOB))`，中文按字符会低估约 3 倍）**：`content_html` **587.0 MB / 35,446 行 = 全表文本 605 MB 的 97.0%**（与上面 96.4% 字符口径同向互证）。
  ⚠️ 但本条里「日均 1,875 篇 × 15.1K 字符 ≈ 28M 字符/天」**作废** —— 那是"全表行数 ÷ 表龄"的摊平，而新库 09-20 才重建、中途又被 cleanup 批量删过，摊平必然偏低；
  现役真值是近 24h **10,916 篇落库 / 正文 99.6 MB**，其中进阅读器的那 6,194 篇就占 98.2 MB（≈33M 字符/天）。
  推论也跟着改：**体积不是腹泻源撑的** —— 被降噪轴排除的 4,722 行只带 1.4 MB（单行 0.3 KB vs 全文源单行 15.9 KB）。
  现状底稿：`docs/eval/2026-09-24-source-diagnosis.md`；本轮全量读数：`docs/eval/2026-09-24-turso-read-amp.md` §一二。取证：`docs/eval/2026-09-24-prescreen-step1.md` §十五；`SELECT COUNT(*) FROM articles_archive`、`grep -rn archive-articles .github/workflows`（无命中） |

### specs 35~43 作废（09-23 整批删除 · 逐字反查锚点） <!-- doc-lint:ignore -->
> 用户裁定：这批是上一版排期的产物，「不能用前朝的剑斩本朝的官」，当前系统的问题需**重新列举**，故连带目录一起清除。作废的**不是需求本身**，是它们携带的优先级表、✅⏸ 状态标记与 09-13~09-21 的实测读数 —— 后者已被 09-22 的约 20 个交付提交与 09-20 换库双重推翻。
>
> **删除物**：`docs/specs/` 下 35-selfheal-admin-console · 36-reading-semantics · 37-alerts-observability · 38-admin-ia-refactor · 39-ai-console · 40-brief-center-products · 41-e2e-whitebox-eval · 42-full-audit-2026-09 · 43-collect-retention-safety，共 **65 个已跟踪文件**（git 全部跟踪，工作树删除前干净）。
>
> **逐字反查 / 还原命令**（锚点 = 删除前 `docs/specs` 的 tree sha `065e1632`，父提交 `3f89a08`）：
> - 看单个文件原文：`git show 065e1632:docs/specs/43-collect-retention-safety/spec.md` <!-- doc-lint:ignore -->
> - 整批还原：`git restore --source=065e1632 -- docs/specs/` <!-- doc-lint:ignore -->
> - 列全部被删路径：`git diff --cached --name-only --diff-filter=D`（提交后改用 `git show --stat <本轮提交>`）
>
> **保留未删**：`docs/specs/03`、`05`、`09`~`34`、`22`~`26` 等决策与更早期 spec —— 本轮只清 35~43；是否连 09~34 一起清，待用户另行裁定。
>
> **本表内所有指向 35~43 的行号引用（如「35A-F6」「39-1/39-3」「40-8」「41-2」）自此失去落地文档**，只作历史编号读，不能再当"方案已存在"引用。

| H27 | **AI 早报的自动触发在生产上没兑现——晚间主批 4 天里自己跑过 0 次**：`collect.yml:108` 的 `daily-ai-evening` 门是 `github.event.schedule == '30 13 * * *'`（北京 21:30），`daily-ai` 门是 `'32 16 * * *'`。逐个 job 核最近 8 个 `event=schedule` 的 run（09-20 21:27 → 09-23 16:50）：**`daily-ai-evening` 8/8 全 skipped，`daily-ai` 只有 1/8 success（09-21 20:29）**；同期 collect/snapshot/daily-report/cleanup 的门都正常开（说明不是权限、不是表达式写错，是那两条 cron 的 schedule 事件本身没按点位到达/被归属到别的串）。旁证：库里现存 AI 行的落库时刻（UTC 14:17 / 15:51 / 19:14 / 20:23 / 21:06 / 22:00）**对不上任何一个点位**，且 09-19 及以前 AI 版 **0 天**（只有关键词版），09-20 起才有人工 dispatch 的痕迹 → **"每天都有早报"这件事实际是人工在维持，不是链路在跑**。成因**基本锁定（量化与实测对上，两个候选已排除一个）**：collect.yml 里 7 条 cron 中 collect 独占 4 条（每 15min → 96 次/日），
每日应触发 ≈100 次，而 09-15~09-24 实测 `event=schedule` 的 run 只有 **11~13 次/日 → 投递率 ≈12%**；
按此投递率，单点位的 AI 批期望命中 **0.12 次/日 ≈ 8 天才轮到 1 次**，与实测"`daily-ai` 1/8 success"**完全吻合**。
已排除：`concurrency` 组（collect.yml 里根本没有 `concurrency:` 块，不是被自己取消）；也不是权限或表达式写错（同流 collect/snapshot/daily-report/cleanup 的门照样开）。
未排除：延迟后 `github.event.schedule` 归属到别的 cron 串 —— 不影响结论：**AI 批与 collect 挤同一个 schedule 队列就是病根**。⚠️ **本轮把 `BUDGET_MS` 抬到 300min、job 超时抬到 330min，会让候选①的"上一次还在跑就丢"更常发生**——这条必须与 H27 一起观察，不能只当收益看 | **待拍板三选一（都可回退，均不在本轮做）**：(a) **拆独立 workflow 文件**放 AI 批（自己的 schedule 队列，不再与 collect 抢）→ 顺带能验证机制；(b) **外部 dispatch**（已证明可靠：近 6 天每 15min 的 `workflow_dispatch` actor=ghoustghoust，全 success）加一条 13:30Z 打 `mode=daily-ai-evening`；(c) **到点自检补跑**：collect job 尾部读 `settings` 心跳，发现今日 AI 批缺失就补一次 dispatch。取证：`GET /actions/runs?event=schedule` + 逐 run `GET /actions/runs/{id}/jobs`；`SELECT id,generated_at,json_extract(stats,'$.schemaVersion') FROM daily_reports` |
| H27-补 | **09-24 17:10Z 两条新样本把 H27 的机制钉得更死：不是"抢队列"，是 `github.event.schedule` 串等值这道门本身会开错 job**。逐 run 读 jobs（只读 API）：`run 35964359306`（event=schedule，created **06:24:47Z**）里 **只有 `snapshot` 跑了**，`collect / daily-report / daily-ai / daily-ai-evening / cleanup / weekly / mybrief` 全 skipped —— 而 `snapshot` 的门是 `github.event.schedule == '33 1 * * *'`（01:33Z）：**06:24Z 到达的事件被归属成了那条凌晨的串**（要么是一条 01:33 事件迟到 5h 才落地，要么归属错版，两种都致命）。对照组 `run 35963578415`（06:14:52Z）归属正确（跑 collect，:07 线迟到约 7 分钟）。⇒ 15 分钟线基本能到（迟到几分钟），**每日一根的线要么不来、要么来了挂到别的串上**；这也解释"同流 collect/snapshot 的门照样开"——它们开着，但**开在错误的时刻** | **修法结论收紧**：AI 批的门**不许依赖 `github.event.schedule` 串等值**。两条都可行、都可回退：(a) **一个 workflow 文件只留一条 cron**（等值判断天然唯一，串不可能挂错）；(b) **搭在已证明 100% 可靠的 `workflow_dispatch` 通道上**，在步骤内按**北京时间窗**判"该不该跑"+"库里今日有没有 AI 行"，跑过写 claim 键挡重（幂等自检）。(a) 是纯搬迁零新逻辑，(b) 才真正免疫 schedule 丢失。**仍等你选**，与 H29/H30 不冲突 |
| H28 | **两个"在决策路径上、却没人能改"的配置键**：系统性清点（部署面 `getSetting` 全集 36 个键 → 逐个查有无 `setSetting` 写点）得出：**`ai.minIntervalMs`**（AI 节流间隔，`lib/ai-throttle.js` 缺省 4000ms）与 **`ai.filterThreshold`**（初筛剔除门槛，现 30）在部署面**零写点** —— `PUT /api/settings` 对 `ai` 段整体返回 400（09-11 全链路 401 事故后的 env-only 裁决），而库里也没有这两行 → 实际永远取代码缺省。影响面正是当前的两个议题：**"压 gap 换时间"在云端目前调不动**（只能改 Vercel 环境变量或直改库），步2 唯一的人为阈值也不可配。同类还有 `mybrief.interestProfile`（个性化早报的兴趣画像，读、无人写 = 那功能的一半没接线）、`translate`、`reading.digest`、`hot.categories` | **不是"每个键加一个格子"**：真要补的是**"运维键 vs 人可配键"的显式分类**（清单与判据见 `docs/eval/2026-09-24-source-diagnosis.md` §六，含 7 个"机器自写、别做格子"与 5 个"另有端点、别误报"的对照组）。本轮只登记；`ai` 段要不要为这两个点开例外，属 09-11 裁决的续篇，得你定（原裁决不许后台写 `settings.ai` 是为防污染，不是为禁止调参）。取证：`grep -rhoE "getSetting\('[a-zA-Z0-9._]+'" api lib tools | sort -u` 对照 `grep -rn "setSetting('ai\." api/`（无命中） |
| H29 | **删除闸把"可删的东西"永久锁在库里：跑到的那一次被挡下、删 0 条，而 48h 凭证 TTL 与"满 7 天才可删"是两条对不上的时钟 → 库"只涨不删"，这是老库撞配额的上游**：`settings['retention.pending']`（runner 每批刷新的当前值，只读回读）→ `闸 allowed=false / via=credential / 原因："转储凭证已过期：70.2h > 上限 48h"`；历史逐日：09-21 true(待删 0) → 09-22 true(6) → 09-23 **false(8,562)** → 09-24 **false(9,462)**。机制不是 bug 而是**安全阀的设计缺口**：`lib/content-dump.js#deleteGateAny` 两条腿 —— ① runner 本地盘的转储目录（GH runner 是临时文件系统，**这条腿结构性永不成立**）② 库内凭证 `settings['retention.dumpCredential']`，由**本地人工**跑 `npm run dump:content -- --scope cloud` 写入、**TTL 48h**（`GATE_MAX_AGE_H`）→ 人工动作一旦断，48h 后系统必然进入"只涨不删"，且**没有任何报警**（只有日志与这条读数）。
  **执行证据（09-24 夜补，此前"每天照跑一条不删"是无证据断言）**：读唯一能证它的 `settings['cloud.collect'].history` → 23h 窗口（09-23T16:52Z→09-24T15:32Z，168 条）里 cleanup 只出现 **1 次**，那一次 stats = `deleted:0 / blocked:"delete-gate" / pendingDeleted:8,525 / gateReason:"转储凭证已过期：54.1h > 48h"` ⇒ "被挡所以没删"是**实测**，而"跑得够不够勤"归 H27 那条 12% 定时投递。凭证签发时刻由 54.1h 反推 = 09-21T16:50Z → 闸实际在 **09-23T17:00Z 前后**才关上（本条此前写"09-22 起恒挡"，与自己的逐日历史矛盾，已改）。
  **真正的结构缺陷是两条时钟对不上**：一行文章要**满 7 天**才可删，而凭证只在**人工 dump 之后 48h** 内有效 —— 实测正好演示：闸开着的那 48h 里待删只有 6 行，等 09-23 待删跳到 8,525 行时凭证已过期。人工节奏不可能稳定覆盖"每一行的第 7 天生日"。代价已量化：待删 9,472 行 / **正文 235.2 MB = 全表正文的 41.6%**，7 天前的豁免行只占 8.9 MB；另有过半空闲页 453.1 MB（09-20 那次批量删留下的洞，不 VACUUM 不还空间）。**为什么它是配额的上游（口径已按 09-24 夜对抗审查收紧）**：Turso 计量三维度 rows read / rows written / storage，**任一维越限都以 `BLOCKED` 失败** —— 所以 09-20 那句 `SQL read operations are forbidden`（B118）**推不出"先撞的是行读"**（被禁的动词标识不了越限的维度；且本仓无平台 token，哪一维先超限**不可观测**，B119 ④ 不变）。能确定的只有方向：**行读单价与存储都随"只涨不删"同向上涨**，闸是两者的共同上游。按免费档演算（保守下界，Developer 档 ×5）：现役 35,446 行 ⇒ 5 亿行/月 ≈ **14,100 次全扫/月（≈470 次/日）**；本轮实测三个 UI 入口都在付这个价 —— 精选栏（线上真语句实测 `SCAN a` 裸全表 + 排序器装 WHERE 命中的 712 行；去掉 `CAST` 后计划改用 `idx_articles_score`，但排序器只是变小没消失 ⇒ **不许写成"去 CAST 就修好"**）、正文搜索 `content_html LIKE`（最坏 587 MB/次）、`/api/daily`（`daily_reports` 零索引，一次搬 573 KB；⚠️ `LIMIT 20` 是 `pickDailyReport` 要"看遍 30h 每期"的载体，**目前够用但只剩 2.4× 余量** —— 哪天单日生成数超 20，AI 版就会掉出窗口被裸版顶掉，即 B112 那族 bug 复活） | **登记 + 三条待拍板，本轮一律不做**（删除与 VACUUM 都是破坏性/长事务）：① **两条报警接进现成报警引擎**："闸挡住 > 24h" **与** "当日没有 cleanup 心跳"（09-24 审查补：只报"挡住"会漏掉"根本没跑到"这一支，而 23h 窗口里它只出现 1 次）（纯增益、零副作用，直接对上 B118"挂了几小时没人知"）；② 续期路径二选一：(a) 本机定时跑 `dump:content`（本机不总开，仍会漏）／(b) 承认"转储腿"在 runner 永不成立，改由 runner 自己按天写**可核验的小清单凭证**进 `settings`（manifest 摘要+行数+id 区间，正文不外搬），TTL 绑"最近一次成功采集"而非人工；③ 三个 UI 读放大各自独立可回退（去掉 `CAST(score)`／搜索不扫正文列或上 FTS5（**先实测 libsql·Turso 支不支持**）／早报详情按档位取一份 + 补 `generated_at` 索引）。**不许顺手做**：为省空间砍全文源（§二已证体积就是"我们想读的那批源"产生的）。全量读数与探针记账：`docs/eval/2026-09-24-turso-read-amp.md` |



| H30 | **早报的「主题导语 / 主题全景」在 94% 的期里根本没产出，而且三条失败出口都不留痕**：只读探针数库里 AI 档（`schemaVersion>=2`）16 期 → **theme 缺失 15 期（94%）**，`themes` 主题全景 **14/16 期是 0 簇**；而 `api/_ai.js#generateTheme` 的三条 `return null`（`!r.ok` / 每行都被污染判据否决 / 挑出的那句被一票否决）**既不写日志也不入库**，runner 那侧的 `.catch()` 只在**抛错**时才出声 ⇒ 事后完全分不清"模型没答"与"我们自己把答案判死了"。这正是 FEATURE_MATRIX 里挂着 ✅（18-daily-ai-v2 / T3-1 R0c）而读者侧长期缺功能的形态 | **本轮只做了"看得见"这一半**（零产品行为改动）：`generateTheme` 拆出 `generateThemeDetailed` + 纯函数 `pickThemeReply`，日报写入器在 theme 为空时把 **`stats.themeSkip = { why, err?, detail?, lines? }`** 落库，契约收录，锁 **T1~T4**（`tests/regression-theme-observe.test.js`）钉"三态可区分 + 旧字符串契约不坏 + runner 必须落归因"。⚠️ 顺带记一次判据自打：新加的派生锁 **P12 第一版看不见条件展开**（`...(cond ? {} : { themeSkip: … })`），是它自己的坏样本自证把这层漏网暴露出来的（已修：圆括号当透明、只取分支对象第一层）。**下一刀等你拍**：为什么 94% 无导语 —— 是 `ai_failed`（配额/超时/模型换名）还是 `all_lines_rejected`（判据过严，例如行长 >120 与"必须只谈内容"这对约束把正常答案打回）？**跑一期 AI 批就有 `themeSkip.why` 就能定**；在那之前不许先动阈值。另：`themes` 0 簇的阈值（Jaccard≥0.45 且簇≥2）同样未测"改前改后各能出几簇"，也不许先动。取证：`tools/_probe-ai-feature-presence.cjs`（只读） |

| # | 阻塞 | 为什么阻塞 | 清法 |
|---|---|---|---|
| BL9 | `settings.ai` 仍可被后台写回（09-11 全链路 401 停摆 2 天的合法复发通道） | 裁决仍有效：保留可写 + 强制审计 + 变更告警 + 写后探测失败即回滚 | 原承接实施的小 spec 已作废（39-1/39-3，见本节末作废行）——四条各自落到哪一步需重新对代码核，不许按"已在做"读 |
| BL12 | Vercel 构建偶发长卡 `Initializing` 的历史问题 | **09-22 复测降级**：近三次生产构建 20~26s 全正常（vercel ls 实测），症状不再复现；「线上 commit == origin/main」判据继续兜底。不销号，转观察：再出现分钟级排队时回来查 Vercel 配额 |