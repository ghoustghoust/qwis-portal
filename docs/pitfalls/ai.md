# 坑 · AI 管线（ai）

### #8 日报出库安检
- 症状：乱码标题/风控错误页混进早报。
- 规则：入库前 hasMojibake（西里尔字符/锟斤拷检测）+ isErrorPageItem（"参数错误/访问频繁"类短标题）双检，daily.js 与 collect-turso.js 两处实现都要有。

### #24 settings 覆盖 env 的配置链，"环境异常"先查 settings 残留（2026-09-11 误诊订正）
- 症状：Agnes key 云端 401，曾误诊为"key 绑 IP"。
- 真根因：Turso `settings.ai` 残留 `{apiBase: deepseek 域名, key: 空}`，settings 优先级高于 env → 拿 Agnes key 打 DeepSeek 域名。
- 叠加：agnes-2.5-flash 是**推理模型**，max_tokens 太小被 reasoning 烧光返回空 content（已改 64/512 + reasoning_content 兜底）。
- 规则：①改 env 永远修不好 settings 覆盖的问题，先 `SELECT value FROM settings WHERE key='ai'`；②Vercel env 与文档要实测核对，不能信纸面；③推理模型 max_tokens 给足。

### #26 推理模型输出必须三层清洗，验收必含真实输出复测（2026-09-13）
- 症状：三个独立场景（翻译/每日导语/我的早报导语）先后把思维链当产物入库。实测形态：①中文指令复述（"用户提供了一篇…要求我从四个维度…"）②英文 "Here's a thinking process: 1. **Analyze User Input:**" ③第一人称元思考（"我想到一个更好的方式来组织这个叙事"）。
- 规则：**标记提取（译文：/最终稿：）→ 思维链/元任务拒绝（回退上一轮草稿或 null）→ 机器兜底（翻译降级 Bing/Google）**；导语类全污染返回 null 不渲染，绝不回退污染行；正则打补丁是打地鼠，验收必须包含真实模型输出的线上复测。
- 实现：api/_ai.js `sanitizeTranslationReply` / `isThinkingLikeReply` / `generateTheme`（回归：regression-20260913 F3 系列、regression-daily-ai 3b）。
- **2026-09-18 第四次复现（打地鼠预言成真）**：周刊第 2 期把「我需要找到贯穿这些文章的核心主线。」当成主题词入库，并同步写进 `weekly.archive` 标签。旧否决表列了 `我想/我觉得/我会/我来/让我…` 和元任务的「需要我」——**词序相反的「我需要」两头都不沾**，既没被 `isAnalysis` 也没被一票否决拦下。
  - 更正规则（不再动宾列举动词）：**导语必须陈述内容，凡句首为第一人称（`^(我|我们|咱|本人)`）一票否决**；只按句首判，避免误杀「AI 行业的自我定位」这类含"我"的内容陈述（回归用例含该反向保护）。
  - 同轮修：`generateWeeklyMagazine` 有 5 条 `return null` 全都不出声，导致线上 storylines/coverTheme 整体为空却查不到是哪条守卫拒的——**静默 null 等于不可证伪**，每条放弃路径现在都打原因。
  - **上游真根因（第 3 次跑周刊才定位，前两次都在下游加正则捞）**：`_rawChat` 旧写法把正文与 `reasoning_content` 用「或」串联返回。推理模型偶尔只吐思考不吐正文时，思维链就成了"AI 的回答"——杂志结构那条日志的 `The user wants me to organize 20 items…` 与导语那条 `19-20: 日本加息对全球资金影响。` 全是这么来的。**已改为无正文即抛错**（`aiChat` 记 ok:false），回归锁 `regression-20260918` 第 5 项。
  - 教训：同一污染形态反复出现时，先怀疑"回答"这个字段的来源是否可信，而不是继续给清洗器加词表；`maxTokens` 不是本次原因（同 prompt 同 3200 配额实测能稳定出 JSON，属间歇性）。
  - 回归锁：`regression-daily-ai` 3c。

### #A1 Agnes 免费池配额规律（2026-09-13 实测）
- 持续 ~15 RPM 调用 45-60 分钟即耗尽（HTTP 429/60s 超时），约 50 分钟自愈；期间 `_consecFail>=3` 触发 ai_failed 报警（属预期）。
- 规则：大批量 AI 任务（daily-ai/weekly/eval-filter）串行排期、避开叠加；生成窗口 > 翻译（T4 调度优先级需求）；eval-filter 之类验证选配额空闲窗跑。

### #A2 薄正文 + 推理模型多轮精翻 = 元评论/胡编标题入库（2026-09-15）
- 症状：早报/我的早报出现「用户要求我作为术语校对专家…」「我已收到您的翻译请求…」当标题；「评论：0」胡编标题进我的早报 TOP3；金句栏「原文引用待提取」占位符。
- 根因：①桥接源（hnrss 等）正文只有 Article/Comments 链接列表（~300 字符纯文本）——多轮精翻在这种输入上让推理模型复述任务指令或幻觉标题，sanitizeTranslationReply 的中文起手式表没覆盖「用户要求/我已收到」；②深析 analyzeArticle 对薄正文产出占位金句且原样入库；③翻译优先级的 id 表只用于排序、候选拔牙在「最近 5000 条」扫描窗——日报条目跌出窗口后 P1=0，「早报优先」形同虚设。
- 规则：纯文本 <400 字符走仅标题单轮通道（不进多轮精翻/术语生长）；入库前终极闸（起手式/超长/空拒收）；深析占位话术清洗置空；**优先级 id 必须直接补入候选池**（不依赖扫描窗命中）。
- 回归锁：tests/regression-20260913.test.js F3-7/F3-8。

### #32 后写的降级/兜底产物覆盖先写的 AI 产物——落库要守卫、读取要按档位而非按时间（2026-09-18）
- 症状：每日早报只剩「栏目+标题+RSS 摘要」，六维评分/推荐理由/要点/金句/主题全景全体消失；精选周刊整页空白（`weekly.latest` 25 条裸 item、`degraded:true`、`theme:null`）。用户报「AI 功能被删了」——**实际没有任何代码删除 AI 功能，AI 平台也一直正常**（`POST /api/ai/ping` 实测回 `连通成功`）。
- 真根因（两条独立链，同一形态）：
  ① **每日早报被遮蔽**：`collect.yml` 有三个 job 写 `daily_reports`——`daily-ai-evening`（北京 21:30，`schemaVersion:2`）、`daily-ai`（00:32 备跑）、`daily-report`（北京 09:03，**非 AI**，`window_hours:30`，无 theme/themes/六维）。读层 `handleDaily` 是 `ORDER BY generated_at DESC LIMIT 1` → **最后写的非 AI 批必赢**，每天早上读者拿到的都是裸报。线上 `/api/brief/history` 实锤：id99（AI，theme 有值）被次日 id100（裸，`elapsedMin:null`）顶掉。读层 `getOrGenerate` 内联兜底是第二个裸写入者。
  ② **周刊空覆盖**：`saveWeekly` 无条件 `INSERT OR REPLACE weekly.latest`，无最小条数守卫；`weekly` job 每周只此一次且 `if: github.event.schedule` **排除 workflow_dispatch**（掉一次 run 就整周断更且无法补跑）；失败报警条件只认 `MODE==='daily'`，`daily-ai`/`weekly` 全灭时**一条报警都没有**。
- 规则：**凡「多写者 + 单读者取最新」的产物表，落库必须带质量档位（schemaVersion），读层必须按档位优先而非按时间优先**；生成器落库前必须有最小内容量守卫（宁可不发布，也不用空/降级产物覆盖上一期好内容）；低频一次性批次（周刊）必须同时具备 ①dispatch 补跑口 ②失败报警，否则等于没有兜底。
- 实现：守卫唯一实现 `lib/brief-guards.js`（`pickDailyReport` / `canPublishWeekly`，runner 与读层共用）。接入点：`api/[...slug].js handleDaily`、`server/services/ai/daily.js getLatest`、`tools/collect-turso.js saveWeekly`（+ runWeekly 前置省 AI 配额）。
- 回归锁：`tests/regression-brief-guards.test.js`（含用线上真实 id99/100 时间戳构造的事故复现用例）。
- 顺带排掉的假线索：`settings.ai.features.{classify,analyze}` 在后台 `AiSettingsTab` 有 4 个复选框和「x/4 完成度」，但 `api/_ai.js` 与 `collect-turso.js` **零引用**——纯装饰开关，线上回显 `classify:false / analyze:false` 极易被误判成「AI 被关了」。见 `docs/ISSUES.md` 挂案。

### #34 深析没有否决权：AI 把「不适合收录」写进 reason，组装阶段从不读它（2026-09-18 用户标注抓出）
- 症状：每日早报大量 1～2 星条目，用户直接问「一两颗星是不是含金量不高」。线上 `/api/daily` 实锤两条：
  `score=22`「最后召集：Disrupt 志愿者申请即将截止」（reason 自陈"信息量少，内容仅为一句话重复"）、
  `score=10`「出售 AI 工作站——有人有兴趣到意大利北部提货吗？」（reason 明写**"不适合收录至早报"**）。
- 根因（三个叠加点，缺一不可）：
  ① `analyzeArticle` 的返回契约是 `{scores,totalScore,reason,summary,quote,points,tags}`——**没有 `ignore`/`veto` 字段**，深析在结构上没有否决权；
  ② `runDailyAi` 只在初筛 `:1035` 用 `f.ignore`，深析后 `:1056 analyzed.push({...a, ...r})` 无条件收录；
  ③ 「重点更新」栏的判据是 `a.source_spotlight`（**源**有没有被标重点），完全不看分，且排在最前、还走大卡——于是最显眼的栏反而是**门槛最低**的栏。
- 反直觉数据：当次 46 条里分数中位数只有 **38**、最高 **72**，`≥40` 会砍掉 26 条。所以**不能**凭感觉拍一个高门槛，否则早报直接空掉。
- 规则：
  ① **门槛取 30，不取新数**——与初筛 `ai.filterThreshold` 默认值同口径，消除"初筛说 30 分以下不收、深析打完分还能塞回来"的自相矛盾；可配 `ai.dailyMinScore`。
  ② 门槛必须放在 **L5 权威加权之后**判定，保证"用户看到的星数"就是"被判定过的那个分"（加权系数 0.8–1.2，前后差最多 20 分）。
  ③ 无 AI 评分的条目（视频/播客——`videos` 表实测根本没有 `score` 列；以及降级关键词版）**必须豁免**，否则整栏消失。
  ④ 长期解不是继续调绝对分，而是**给模型一个说"不"的合法出口**：`analyzeArticle` 加 `veto` 字段 + `prompts/daily-analyze.md` 写清什么情况该 veto。绝对分在推理模型上不稳（本批中位 38），相对判定才可靠。
- 实现：`lib/brief-guards.js passesDailyQualityGate()`；接入 `tools/collect-turso.js runDailyAi` L5 之后。
- 回归锁：`tests/regression-brief-guards.test.js` 8/9/10（用线上真实 22/10 分构造）。
- 契约核对：`tests/columns.test.js:111`「spotlight 源两条全收」**没有被本次推翻**——它跑的是本地 `server/services/ai/daily.js` 的无 AI 降级路径，条目 `score` 为 `undefined`，正好落在门槛的「未评分豁免」分支里（实测该用例仍绿）。
- **门槛没有同步到本地 `daily.js`，是刻意的，不是漏掉**：本地 `server/services/ai/daily-ai.js` 的 `analyzeBatch` 返回契约只有 `{summary, importance, tags}`（`:38`），**压根没有六维分**，加门槛就是个永不生效的空操作。真正的缺口是本地灾备与 runner 深析契约早已分叉（见 ISSUES B20），要同步得先让本地也产出六维分。
