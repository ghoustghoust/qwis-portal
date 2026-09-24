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
| H25 | **级3 的覆盖率天花板不是 `cap`，而是候选宽池读 `CANDIDATE_POOL_READ=2000`**：第一期生产读数（id=68，09-24 07:53Z）`prescreen={cap:2,pool:2000,poolSources:202,kept:337,keptSources:202}` —— `pool` 恰等于 2000 说明宽池读**被吃满**（同窗口全量真值 2,688 篇 / 469 源，见 `docs/eval/2026-09-24-prescreen-step1.md` §一）。2000 行里只出现 202 个源 → 配额能给的天花板 = 202×2 = 404，**500 个坑空着 163 个**，实测覆盖 94→202（2.15×）而非 spec 预估的约 450（4.8×）。副作用：`candidates` 500→337（调用量 −32.6%）是"没填满"而非"设计省下来"，同期 `truncated` 仍 true（299/337 尝试、失败率 23.4%），已不能记在候选量头上 | **待拍板第 4 项**（`docs/specs/44-prescreen-tier/spec.md` §九）：抬宽池读到窗口全量（只改一个常量，代价是多拉 ~690 行轻量列）或明说"覆盖率由读多少行决定"。取证：`SELECT id,stats FROM daily_reports WHERE id>=68` 读 `stats.prescreen`，与 §一 的全量池真值对照 |

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

## ⛔ 阻塞项（不先清掉，后面改动无法判断「是不是我改坏的」）

| # | 阻塞 | 为什么阻塞 | 清法 |
|---|---|---|---|
| BL9 | `settings.ai` 仍可被后台写回（09-11 全链路 401 停摆 2 天的合法复发通道） | 裁决仍有效：保留可写 + 强制审计 + 变更告警 + 写后探测失败即回滚 | 原承接实施的小 spec 已作废（39-1/39-3，见本节末作废行）——四条各自落到哪一步需重新对代码核，不许按"已在做"读 |
| BL12 | Vercel 构建偶发长卡 `Initializing` 的历史问题 | **09-22 复测降级**：近三次生产构建 20~26s 全正常（vercel ls 实测），症状不再复现；「线上 commit == origin/main」判据继续兜底。不销号，转观察：再出现分钟级排队时回来查 Vercel 配额 |