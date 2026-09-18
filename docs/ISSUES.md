# 全网情报系统 · 已知问题清单（活文档）

> 只列**当前活跃**的问题（未修复 / 观察中 / 挂案）。
> 已核销历史：`docs/deprecated/ISSUES-resolved-2026-09-14.md`（09-13~09-15 全量，含热点榜三阶段/媒体治理/精选断更根治）
> 与 `docs/deprecated/ISSUES-resolved-2026-09-13.md`（更早）。
> 功能需求类事项见 `docs/NEXT-DEV-REQS.md`。
> 最后更新：2026-09-19（20 条页面批注全量实测：活跃 B8~B58、观察 W1~W7、挂案 H1~H17；**三条 P0 见 BL7~BL9**）
> 文档清洁与归档规则见 `docs/DOC_GOVERNANCE.md`。

---

## 🔴 活跃 bug

| # | 问题 | 定性 | 去处 |
|---|------|------|------|
| B8 | 综述/文章详情无排版（加粗/重点标注丢失，纯文本渲染） | 前端渲染层（markdown 化） | T5-5 / spec 32 |
| B10 | 每日早报 AI 版仍显示关键词版栏目注解（"Codex、Claude、豆包…"） | AI 栏目 desc 未随 v2 更新 | T5-3 一并 |
| B11 | 后台 Tab 切换懒加载 chunk 冷启动卡顿（前台已做骨架屏，后台未覆盖） | 感知性能 | spec 33 |
| B12 | `npm test` 基线 4 项红：regression-bc 的 A9/A10/B15/B18 断言 `portal/api/_safeimg.js`、`portal/api/_handlers.js` 等——这些文件已在 portal 自身提交 `2e81cd7`（Vercel serverless 重构）中删除，测试未跟着重新锚定。**违反 AGENTS.md §3「必须全绿」，且 B18 一红就没人再盯云端 /api/img 的 SSRF 防护**（该风险在 H3 里是已知挂案）<!-- doc-lint:ignore：本行刻意引用已删除路径 --> | 测试锚点失效（非产品缺陷） | 待立小 spec：把 B18 重新指向 `api/[...slug].js` 真实云端读路径 |
| B13 | 生产构建自 09-17 16:38 起连续 4 次 Error：`8284f70`/`3288371` 已提交但 `web/src/components/ui/MdText.jsx` 从未入库 → rollup `Could not resolve` → **线上一直跑 09-17 之前的旧 bundle**，周刊兜底与我的早报 AI 渲染「修了但没上线」 | 已修（d7b5df4 补提交），部署已 ● Ready | 本轮 |
| B14 | `tools/collect-turso.js` 调用**从未定义的 `qOne()`**（6 处：`:648 :655 :725 :970 :971 :1216`），每处 `ReferenceError` 被上层 `try/catch` 吞成一行 runner 日志。后果：`reading.digest` 从未生成（**阅读足迹卡自上线起就没存在过**）、`daily-ai stats.videos` 恒 0、collect「少量失败」分支下同一 try 内的 `collectStalled` 停滞检测被整体跳过 | 已修（补 `qOne` + 静态回归锁），待 runner 批次产出验证。详见坑 #33 | 本轮 |
| B15 | **【2026-09-19 推翻，原判为误诊】** 原判「`articles.read_at` 被批量标已读 24855 行」是错的：真根因是 `tools/migrate-to-turso.js:250` 用 `if (typeof v === 'object') return JSON.stringify(v)` 序列化，而 **`typeof null === 'object'`** → NULL 列被写成**字面字符串 `'null'`**。实测云端：`read_at='null'` **24855 行**、真 ISO 已读仅 **287 条**（24h 内 15 条）；同批污染 `tags='null'` 24355、`reason='null'` 24799、`videos.watched_at='null'` 846。旧查询 `read_at >= datetime('now','-1 day')` 复现 24870 行，是因为 **`'null' > '2026-…'` 的文本序假象**，不是有人批量标已读。本地 `data/app.db` 干净（脏 0 行），**污染只在云端** | 一行修根因（`v === null` 分支）+ 一次性数据订正 `UPDATE articles SET read_at=NULL WHERE read_at='null'`（连带 tags/reason、`videos.watched_at`）。**这批脏值同时毒害：保留天数清理豁免（`api/[...slug].js:1958`）、未读角标（`:876/:917`）、阅读足迹（`collect-turso.js:974`）** → 只清 `read_at` 就能让 2.5 万篇回到未读并恢复回收 | 本轮已定性，待授权执行 |
| B16 | 周刊导语污染第四次复现（坑 #26）：第 2 期 `theme` 入库为「我需要找到贯穿这些文章的核心主线。」并同步进 `weekly.archive` 标签；且 `generateWeeklyMagazine` 五条 `return null` 全不出声 → coverTheme/storylines 整体为空无从判断 | 清洗器已修（句首第一人称一票否决 + 反向保护用例）+ 放弃原因已打日志；**脏数据需重跑一期周刊覆盖** | 本轮 |
| B17 | 周刊初筛预算结构性不足：本轮 2015 条候选 × `ai.minIntervalMs=4000` 串行 ≈ 2.2 小时，而 `runWeekly` 的初筛窗只有 `BUDGET_MS*0.4`=24 分钟 → 日志必出现「初筛预算截断」，周刊实际只策展了 `published_at DESC` 前缀，**不是全周内容** | 待决策：提高初筛配额 / 改为批量初筛 / 预筛降量（六维分门槛） | 需拍板 |
| B18 | 视频/播客条目的「置信度评分」与「标题翻译」无法呈现：`videos` 表实测**既无 `score` 也无 `translated_title` 列**（列清单：id,source_id,platform,title,url,vid,cover,duration,author,intro,published_at,favorite,created_at,watched_at,play_uri）。`enrichBriefTitles` 也因此结构性跳过视频（id 是 `'v'+id`，查 `articles` 永不命中） | 需决策：给 videos 建列并把视频接进翻译/深析管线（涉 schema + 三端采集语义同步 + AI 配额），或放弃这两个诉求 | 需拍板 |
| B19 | 我的早报「今日总结」线上常空：`generateTheme` 判污染后返回 null（宁缺毋滥，方向是对的），根因是 Agnes 推理模型间歇只吐 reasoning 不吐正文——与坑 #26 同源 | 已断掉"reasoning 冒充正文"（无正文即抛错）；额度/模型侧波动归 W6 继续观察 | 观察中 |
| B20 | 每日早报**完全没有分析后质量门槛**（用户标注「一两颗星是不是含金量不高」抓出）：深析契约无 `veto`，`runDailyAi` 只在初筛用 `ignore`，「重点更新」栏判据是 `source_spotlight`（看源不看分）→ 实测 `score=10`「出售 AI 工作站」reason 自陈"不适合收录至早报"仍坐最显眼大卡。另：本地灾备 `daily-ai.js analyzeBatch` 只返回 `{summary,importance,tags}` **无六维分**，与 runner 深析契约已分叉，门槛无法同口径同步 | 门槛已加（`passesDailyQualityGate`，默认 ≥30 与 `ai.filterThreshold` 同口径，可配 `ai.dailyMinScore`）；**待下一批 daily-ai 跑批生效**。长期需给模型 `veto` 出口 + 本地补六维分 | 本轮（待验证） |
| B21 | 每日早报缺「本期索引」（周刊页 T5-6 已有右侧条目索引可复用），且从别的页签切回 `/daily/` 有卡顿；期号方面 `daily_reports` 有自增 `id`（线上 `report.id=100`）但直接当"第 N 期"无意义（含非 AI 批次插入），仍应与我的早报一起走归档设计 | 索引/卡顿待查（卡顿需先定位是 chunk 冷加载还是 46 卡 + 封面重排）；期号并入 H13 一起定 | 待办 |
| B22 | 后台「源抓取成功率」颜色一直是坏的：`MonitorTab.jsx:8-11 rateColor()` 与 `:111-151` 表格用 `t-success/t-warn/t-danger` 三个类，而 `web/src/index.css` **从未定义它们**（只有 `t-text/t-muted/t-accent/t-purple`，`:73-82`）→ 三主题下文字色全继承，分档形同不存在 | 一行 CSS（三主题各定义）可修；但应与 35C 的色彩单一实现一起做，避免先补一版再收敛 | 待办（35C-F4） |
| B23 | 云端 `/api/health/source-stats` 的"成功率"是**布尔伪装**：`api/[...slug].js:1693-1704` 注释自陈「云端无 job_queue 历史」→ 实现 `rate: status==='ok'?100:0`。用户要的"成功抓取概率"目前不存在，且这个假数字比没有数字更误导 | 必须先用 35B 的滚动窗口把分母补上，再改此端点；禁止继续用 100/0 冒充概率 | 待 35B |
| B24 | 采集心跳 `settings.cloud.collect.history` 撑不起任何统计：代码注释写「7 天×24」，实测 168 条只覆盖 **25 小时**；且 `failures[]` **截断 20 条、只含失败源** → 有负样本无正样本，逐源算不出分母（`tools/collect-turso.js:489-505`） | 35B 用每源定长滚动窗口替代；顺带把注释与切片按 mode 分池订正 | 待 35B |
| B25 | 上一轮会话中断留下**未提交在途改动 4 个文件**（B8 主题 markdown 化 `DailyPage.jsx:178` + `index.css` `.md-mark/.md-code`、B11 后台 TabLoader 骨架屏、本地 `daily-ai.js isEnabled()` 改判据）。已实测 `npm run build` 通过、`npm test` 297/301 绿（4 红即 B12 既有项，非本次引入）；但 `index.css` 那处编辑把注释收尾和选择器挤成一行 `*/.rail-btn {`（CSS 仍可解析，属破口非故障） | 补一个换行 + 决定是否提交；**未提交 = 未推 = 线上没有 B8/B11** | 待用户确认（页面标注要重做） |
| B26 | **`GET /api/status` 是慢性函数超时面**（2026-09-18 深夜线上实测）：第一次 `FUNCTION_INVOCATION_TIMEOUT`（部署已 ● Ready，非部署问题），重试 200 但耗时 **26.07s**，而 Hobby 读层预算只有 30s；对照组 `/api/sources?limit=5` 8.3s、`/api/daily` 2.9s。后台监控页一打开就要它 → 用户看到的"云端挂了"多半是这个 | 待查：`/api/status` 里哪些统计是逐源扫描/无索引聚合（同 H11 教训：全量解析后只用几个投影字段）；方向是拆分"页面必需的轻状态"与"重统计按需加载" | 新发现，待立小 spec |

## 🆕 本轮 20 条页面批注实测新增（2026-09-19，B27~B58）

> 全部为**只读实测 + 线上 SQL/端点取证**后的判定；每条只留一行症状，根因与改法在对应域 spec（详情唯一去处，避免两处腐烂）。
> 用户批注 20 条 → 拆出 32 个可执行缺陷（一条批注常常牵出多个根因）。

### 域 A · 阅读器与「我的阅读」口径 → `docs/specs/36-reading-semantics/spec.md`

| # | 症状（一句） |
|---|---|
| B27 | 「未知日期」：云端 `/api/reading` 快路径漏 `AS date` 别名（`api/[...slug].js:1134-1141`），前端把字符串 `'unknown'` 按降序排到最前 |
| B28 | 文章/播客/视频筛选无效：`tabCond` 未加括号被 OR 吞（`:1173`）；同一响应 counts 走另一条 SQL → 数字与列表互相打脸；本地实现正确＝三端漂移 |
| B29 | 类型口径三处错：播客=`s.type='douyin'`（云端 0 篇）、文章类型表用死值 `'wechat'` 漏掉 881 篇 `wemp`、视频只认 `favorite=1`（线上 0）→ 恒空 |
| B30 | 云端无任何 `UPDATE videos SET watched_at` 路径 → 视频/播客观看足迹永久丢失（只有本地 `server/routes/videos.js:81` 有） |
| B31 | 阅读器卡顿：`sort=smart` 表达式无索引（实测 11.4/13.6/15.3s）+ 列表无虚拟化、`web/src` 零 `memo()` + 每点开一篇文章重拉 545KB sources 重渲侧栏 |
| B32 | 「已读」口径：`GET /api/articles/:id` 即置 `read_at`（点开＝读完），且详情缓存命中不发请求 → 足迹不可信 |

### 域 B · 后台信息架构与功能隔离 → `docs/specs/38-admin-ia-refactor/spec.md`

| # | 症状 |
|---|---|
| B33 | 源库组合视图无搜索框；四轴编辑入口割裂在 5 处（`reader_visible`/`muted` 只能批量改）；组卡「订阅」无计数、无退订分支、无「仅已订阅」筛选 |
| B34 | **spotlight 双写冲突**：`DailySettingsTab.jsx:96` → `PUT /api/settings/daily` 全量替换 spotlight，会清掉非 wechat/rss/x/bili/douyin/youtube 类型的重点源 |
| B35 | 后台 header 内层 `max-w-[1100px]` 与内容区 1160/960 两套容器 → 左缘永久错位 54~70px（用户"看着别扭"的定量根因） |
| B36 | 全后台无 sticky/浮动保存条；保存语义三种并存（即时写 / 底部统一 / 分散多按钮）；无 dirty 未保存提示 |
| B37 | 调频与 failover 用 `window.prompt`/`confirm`；Tab 态纯 `useState` 无 URL 深链，刷新回源库 |
| B38 | 请求瀑布：`/api/settings` 同页被调两次、`/api/settings/daily` 120KB/4.6s、热点页拉 `/api/sources?type=rss` **451KB/4.3s** 只为挑一个 AIHOT 源 |

### 域 C · 三报产物 / 期号 / 归档 → `docs/specs/40-brief-center-products/spec.md`

| # | 症状 |
|---|---|
| B39 | 生成历史标题写「近 7 天」实为 `ORDER BY id DESC LIMIT 7`（27 行真窗只露 7 行）；不投影 `schemaVersion`、类型列硬编码「每日早报」→ 裸关键词版也显示绿色「正常」 |
| B40 | 周刊归档 107,918B/5 期只投影 6 字段（`coverTheme`/`storylines`/`editorNote` 全丢，最新最好两期反而显示「—」）；期号=`archive.length+1` → 同窗口重跑即算新期（4 期共用同一日期范围） |
| B41 | 我的早报「订阅」名不副实：线上 `subscription.ids=[]`，实际靠 54 个 ☆ 重点源兜底（`lib/source-axes.js:46-48`） |
| B42 | Domain 篇数配额只裁订阅池，探索位完全绕过（`collect-turso.js:1377`）；且键是主标签不是域名 → 命名误导 |
| B43 | 飞书推送链路"读得到开关但推不出去"：`dispatch` 对所有 enabled 渠道广播（真因见 B44） |

### 域 D · 报警与可观测 → `docs/specs/37-alerts-observability/spec.md`

| # | 症状 |
|---|---|
| **B44** | **P0：云端报警自 09-17 起彻底无出口**——`settings.alerts.channels` 只剩 `{id:'test-ch',name:'TEST',url:undefined,enabled:true}`、silence 残留 `sourceId:777777`（该值只存在于 `tests/regression-cloud-alerts.test.js:81-83`）；audit 最近三条真实事件 `sent:0/total:1`。踩坑 #13「云端测试直打生产库」再次成真，这次打死链路 |
| B45 | 云端 `alerts.eventMeta` 实测为空对象，而前端渲染 4 个不存在的事件名（`fuse/stall/queue/error`）→ 事件勾选全不生效、日志徽章显示原始 key |
| B46 | 报警只有 7 类事件且 payload 无结构化字段（缺源 id/参数/堆栈/代码位置/建议动作/自愈态）；`ai.stats` 实测 261 条失败**无任何端点暴露**；GH Actions 失败面零集成；本地多一个 `source_slow` → 三端事件表已分叉 |
| B47 | 任务队列面板恒 0：后端返 `qs.overall.*`、前端读 `qs.pending`（`MonitorTab.jsx:50`），线上真实 pending=177；两端 `job_queue` 均无写入方（本地最后一条 09-13，主链路早已移 runner）→ 该面板应下线 |
| B48 | `AlertsTab.jsx:591` 把全角括号写成 JSX 文本子节点 `\uff08…\uff09`，JSX 文本不解析转义 → 报警日志渲染出字面 `\uff08fetch failed\uff09` |

### 域 E · AI 能力台 → `docs/specs/39-ai-console/spec.md`

| # | 症状 |
|---|---|
| **B49** | **P0：线上 `ai.minIntervalMs=0`**（runner 默认 4000ms 的限速保护被清零）→ 允许无间隔硬打 Agnes 免费池，正是坑 #A1「45-60 分钟耗尽配额」的触发器 |
| **B50** | **P0：AI 能力页「保存配置」把 `settings.ai.{enabled,apiKey,apiBase,model}` 写回线上**，与 `CLOUD_PIPELINE_GUIDE.md:179` 声明的「云端 AI 配置 env-only、settings.ai 已清空」直接冲突；当前 apiKey 与 env 恰好同值所以没炸，但改一次 Base URL 就是 09-11 全链路 401 停摆 2 天的合法复现路径（坑 #24） |
| B51 | 4 个功能开关 + 操作流程 4 折叠 + 「x/4 已启用」全为死代码（`settings.ai.features` 线上不存在，界面显示硬编码默认）；而「摘要」「栏目分类」「事件关联」实为**非 AI 规则实现**却挂着 AI 开关＝虚假宣传 |
| B52 | 翻译 Skill 恒「加载中」：前端请求 `GET /api/ai/translate/config`，云端路由表只有 config/ping/chat → 实测 404 被 catch，而 `if (!config) return 加载中` 挡在渲染前，错误文案永不可达；即便本地打开也写错键（`translate.prompt` vs 真链路 `prompt.translate`） |
| B53 | 零碎死码与错字：`collect-turso.js:1636 llmChat()` 定义后零调用；API 地址被 `AiSettingsTab.jsx:252 .slice(0,20)` 截成 `apihub.agnes-ai.com/`；「Agencs」应为 Agnes（`DEVELOPMENT_STANDARDS.md:176` 同错） |

### 域 F · 数据与运维小刺（多数当天可修）

| # | 症状 |
|---|---|
| B54 | 内容清理「保留天数」改了不保存：只在清理成功后 PUT，且 `previewTotal===0` 时按钮禁用（`DataTab.jsx:236/349`）→ 光改数字永不落库 |
| B55 | 后台清理与 runner 清理 WHERE 口径分叉：`COALESCE(published_at,created_at)` vs 仅 `published_at` |
| B56 | 快照区无云端分支：按钮照常可点、靠 501 toast，「暂无快照」文案误导（实为「不能有」） |
| B57 | 热点榜回填端点只存在于本地 Express（`server/routes/hot.js:59`）→ 后台整块死；且本地回 `{ok,progress}` 而前端读 `d.status`，进度条即便本地也永不渲染 |
| B58 | 热点榜分类表显示前端硬编码 `DEFAULT_MAP`，6 行里 4 行与线上 `settings.hot.categories` 不符；AIHOT「专属刷新间隔」只改 `find(isAggregator)` 命中的第一个源，3 个 aihot 源里 id27 永远改不到 |

## 🟡 观察中（有明确验证时间点）

| # | 事项 | 观察点 |
|---|------|------|
| W1 | quickscore 即时补分 + 21:30 晚间主批（09-15 已补 AGNES_API_KEY，cd66f52） | 今晚 21:30 批次应产出六维评分；精选白天应持续有当日内容 |
| W2 | 主题全景综述 prompt 修复（09-14 修） | 今晚 21:30 批次综述不再出现"评语"元评论 |
| W3 | 日报/我的早报「视频与播客」栏（09-14 加） | 今晚批次起应出现媒体栏且可播放 |
| W4 | 翻译插队 60 篇热点英文文章（09-14 晚入队） | 事件榜/精选英文条目陆续转中文 |
| W5 | 翻译管线系统性修复（09-15：薄正文仅标题通道/清洗器补起手式/占位金句清洗/优先级=早报>我的早报>周刊>热点榜+id 直接补候选池；34+2 篇污染回炉重翻） | 今晚 21:30 主批+后续 translate 轮次：早报类条目中文标题无元评论/无胡编标题/金句无占位符 |
| W6 | 2026-09-18 早报/周刊 AI 守卫（`lib/brief-guards.js` 不变量 12 + 周刊 <4 条不发布 + mybrief 补刷 reading.digest + 报警覆盖面扩 daily-ai/weekly/mybrief + dispatch `inputs.mode` 补跑口） | **①已实测通过（09-18 23:00）**：线上 `GET /api/daily` 返回 `report.id=99`、`generated_at 2026-09-17T21:14Z`（AI 批），北京 09:03 的裸报 id100 不再遮蔽；2.9s 响应正常。②③④（mybrief 带 digest / 周刊不足 4 条保留上期 / 21:30 晚间批产出）仍待验证 |
| W7 | B20 每日早报质量门槛（`passesDailyQualityGate`，已推 `7764ccf`）+ B14 `qOne` 修复（runner 侧）——**两者都只是"已提交"，都还没有跑批证据** | 下一批 `daily-ai`（北京 21:30 / 00:32）：①`/api/daily` 不再出现 `score<30` 条目（实测 09-18 那批有 score=10/22 各一条）；②`reading.digest` 生成、`stats.videos` 不再恒 0、collect「少量失败」分支的停滞检测不再被跳过 |

## 🟢 挂案（外部依赖/低优先，保持跟踪）

| # | 问题 | 状态 |
|---|------|------|
| H1 | YouTube 对数据中心 IP 反爬假 404 → 熔断反复（139 源 41 启用；熔断源由 cleanup 批次自动恢复） | 挂案：彻底解需住宅代理；现状可接受 |
| H2 | 日报引擎双份实现（api/daily-generate.js 仅兜底 vs [...slug].js 内联） | 挂案：主链路在 runner，T3 系重构时收敛 |
| H3 | P2-4 AUTH_SECRET 回退 'dev-secret' / P2-5 /api/img 无 SSRF 防护 / P2-6 LIKE '%%' 慢查询 / P2-7 handleDaily UTC 日期比较 | 低危挂案（Vercel 网络隔离+量级小） |
| H6 | B站采集"更好的方案"调研（Cookie 主链 vs 现匿名降级） | 用户提出，待调研 |
| H7 | 云端 /api/articles 无 dedup=1 分支（本地有，pre-existing 漂移）：今日视图成默认落地路径后，双端「合并同事件」行为差异被放大 | 挂案：T5 剩余重构时收敛（2026-09-15 对抗审查记录） |
| H8 | spec30 C3「保存后前台关键数字实时预览」未做（对照卡为生效配置静态摘要，验收②只要求对照卡）；subscription.ids 跨 serverless 实例 30s 缓存窗口（人工点击速度下不可达） | 挂案：后续小 spec（2026-09-15 对抗审查 P3） |
| H9 | **`.gitmodules` 缺失**：`portal` 在索引里是 gitlink（`160000`，pin `1f2f253`）但仓库无 `.gitmodules` → clone 后 portal 为空目录、`git submodule update` 无法解析；Vercel 构建日志已报 `Warning: Failed to fetch one or more git submodules`。另 portal 是**另一个独立 Vercel 项目**（`prj_LTaPscWw…`，名 `portal`）长期落后根树，双站漂移 | 挂案：需决策「补 .gitmodules」还是「停掉 portal 部署/收编为普通目录」（2026-09-18 审查记录） |
| H10 | `settings.ai.features`（translate/summary/classify/analyze）是**假开关**：`AiSettingsTab` 有 4 个复选框 +「x/4 完成度」，`api/_ai.js` 与 `collect-turso.js` 零引用。线上回显 `classify:false/analyze:false` 会被误判成「AI 被关了」 | 挂案：要么接进生成链路，要么从 UI 摘除（2026-09-18 排查中踩到） |
| H11 | `weekly.archive` 每期内嵌完整 report、items 又在 `storylines[].items` 重复一份，`:878` 明确不截断；`handleWeekly` 每次请求全量解析后只投影 5 个字段，而 `[...slug]` 函数预算只有 30s | 挂案：慢性 504 面，需加投影/截断策略 |
| H12 | `settings['weekly']` 在后台可编辑（`/api/settings` merge + 周刊设置卡片），但 `runWeekly` 从不读它——窗口/条数全硬编码（`collect-turso.js:765-766`、`:844`） | 挂案：改了无效，需接配置或撤 UI |
| H13 | 我的早报**没有期号也没有归档**：`runMyBrief` 落库的 `mybrief.latest` 只有 `date/generatedAt/theme/keywords/sections/themes/degraded`，无 `issue`，且全库不存在 `mybrief.archive`（单键覆盖写，历史期直接丢失）。用户 2026-09-18 标注「我的早报也该有期号」。周刊有期号是因为 `saveWeekly` 从 `weekly.archive` 末位 +1 | 挂案：要期号必须先有归档（否则期号会随覆盖写重置）；属功能设计，需单独立项 |
| H14 | **熔断后不靠人点这件事，三端行为完全不同**（2026-09-18 应用户「你去测」做的只读实测）：本地端 `store.js:31-38` 只置 `enabled=0`，**零自动恢复路径**，实测 584 个源锁死 5~7 天（其中 458 个 `lastErrorAt` 全落在 09-13T03 同一小时、错误一律 `fetch failed`＝一次代理故障批量熔断）；云端 `collect-turso.js:697-720` 有自动恢复且真在工作（一轮 cleanup 恢复 66 个），但要等 **48h 起**（第 4 次起 7 天）而熔断只需 **45min**（3 连跪 × 15min）→ 实测 195/210 源"恢复后又坏"、间隔中位 6.2h，`frozenAt` 精确聚集在每天 cleanup 那一小时。抽样 23 个熔断源真发重试：**18 个（78%）立刻成功**（6 个 YouTube 假 404 / 3 个 xgo 桥 400 / 2 个 403 / 1 个我方解析器 bug） | 用户判断方向成立（"没坏、过一会重试就能上"＝78% 量化成立），归因需修正：云端不是"没有自愈"而是"自愈被 48h 流放 + 不看错误性质 + 本地端根本没实现"。方案见 `docs/specs/35-selfheal-admin-console/35a-selfheal-engine.md`，**待批准未动工** |
| H15 | `restore-all`（`api/[...slug].js:1606-1627`）是**全量无差别解冻**：按 `fail_count>=3 AND enabled=0` 一把梭，不试探、不排除 `mergedInto/retired`（cleanup 反而排除，`collect-turso.js:705`），`unfreezeStmt`（`:1596-1604`）也不清 `frozenAt/resumeCount` → 死源被反复放回、活源计数被污染 | 挂案：35A-F8 里改成"按类别分批试探恢复"；期间人工批量入口仍可用，但要知道它会把真死源也放回 |
| H16 | **系统性故障被折算成单源失败**：出口/代理/RSSHub 桥挂一次，本轮全部到期源 `fail_count++`，于是"我们的网络抖一下"变成"几百个源坏了"（H14 的 458 源批量熔断就是这么来的）。现有 `postRunAlerts` 已有"批量失败聚合报警"（`collect-turso.js:638-648`）但**只改报警形态，不改熔断判定** | 挂案：35A-F6 要求失败率超阈值即判基础设施故障、本轮不计入单源；这条优先级应排在 H14 其余项之前（它是唯一会一次性打瘫全库的） |
| H17 | 文档治理债（本轮实测清点）：`docs/specs/` 里 10/12/27~34 共 **11 个 spec 只有 spec.md，无 plan/task/checklist**，而 `INDEX` 长期声称"四件套"；`HANDOVER.md`/`HANDOFF_PROMPT.md` 曾各自内嵌进度快照（已清，见 `DOC_GOVERNANCE` §4.5 与本次改动）；`portal/` 仍带一份过时 `docs/` 副本（关联 H9） | 已立规则未补历史：`docs/DOC_GOVERNANCE.md`（清洁 SOP + 六类归档 + 门禁）＋ `tools/doc-lint.cjs` 自检（**该脚本本轮未实现，列在阻塞项 BL6**）。历史四件套不补，只在 INDEX 如实标注"只有 spec.md" |

## ⛔ 阻塞项与优化方向（2026-09-18 文档清洁轮）

### 阻塞项（不先清掉，后面任何改动都无法判断"是不是我改坏的"）

| # | 阻塞 | 为什么阻塞 | 清法 |
|---|---|---|---|
| BL1 | B12 测试基线 4 项红（`npm test` 实测 297/301 绿，红的是 regression-bc 的 A9/A10/B15/B18，锚点指向已删除的 `portal/api/_safeimg.js`、`_handlers.js`）<!-- doc-lint:ignore：刻意引用已删路径 --> | 自愈要改三端语义，基线红着就没有"新增失败"的判据；且 B18 一红没人盯云端 `/api/img` 的 SSRF | 小 spec：重新锚定到 `api/[...slug].js` 真实云端读路径（**违反 AGENTS §3，属最高优先的"清障"活**） |
| BL2 | B14 `qOne()` 修复只提交了 `1d135f4`，**没有一个真实 runner 批次产出证据** | 35A 的恢复判定要读源状态行，同族静默 ReferenceError 未闭环 | 等 W7 观察期，看下一批 collect/daily-ai 日志 |
| BL3 | 采集尝试流水不存在（B23 假成功率 + B24 心跳只 25h 且无正样本） | 「每源成功抓取概率」现在**物理上算不出来**，35C 只能继续显示假数字 | 35B（滚动窗口，不建新表） |
| BL4 | H9 portal gitlink 无 `.gitmodules` | 三端语义收敛时极易误改 `portal/` 副本；Vercel 构建已报 submodule 警告 | 拍板：补 `.gitmodules` or 停 portal 部署/收编为普通目录 |
| ~~BL5~~ | 并入 BL10（原判「谁在批量标已读」是误诊，真因是 `'null'` 字符串污染，见 B15 订正） | — | 见 BL10 |
| BL6 | ~~`tools/doc-lint.cjs` 尚未实现~~ **已实现**（六条门禁：头注/悬空/INDEX 登记/归档头注/超长/明文密钥；已接 `npm run lint:docs`） | 文档清洁此前只能人工核对，下次必烂回去 | 已闭合；待接进 CI 与 AGENTS §3 验收清单（下轮） |
| **BL7** | **P0 云端报警链路无出口**（B44：渠道被回归测试写坏成 `url:undefined` 的 TEST，09-17 起 `sent:0`） | 系统正在"哑火"：熔断/停滞/AI 失败全都不再通知，与自愈改造互为前提（没有可观测就没有可信自愈） | **2026-09-19 用户决定：先不写生产，等 spec 41 评测就位后再做** → 恢复动作与"改前必红"证据一起出；期间任何故障无人通知属**已知风险** |
| **BL8** | **P0 `ai.minIntervalMs=0`**（B49） | 无间隔硬打 Agnes 免费池 → 45-60 分钟耗尽配额（坑 #A1），早报/周刊/翻译互相抢额度 | 同上：延后到 41 就位；**但"防再犯"的代码侧（测试隔离 + 写路径守卫）不写生产，可先行**（待批准） |
| **BL9** | **P0 `settings.ai` 仍可被后台写回**（B50），与旧 env-only 声明冲突 | 09-11 全链路 401 停摆 2 天的合法复发通道 | **已裁决（2026-09-19）：保留可写 + 强制审计 + 变更告警 + 写后连通探测失败即回滚**；不变量表述已在 `CLOUD_PIPELINE_GUIDE.md` §6.1 作废落档。实施在 39-1/39-3 |
| BL10 | `'null'` 字符串污染 2.5 万行（B15 订正） | 毒害保留清理豁免、未读角标、阅读足迹三处口径；不先清则任何"未读/已读"统计与自动回收都不可信 | 延后（同 BL7/BL8）：一行修根因 + 一次性 `UPDATE`，与 40-8 脏数据订正合并做，需授权 |
| BL11 | 端到端/白盒评测流程尚未建立 | 用户新增验收要求；没有它，32 个新缺陷的修复无法自证"真的修好了" | 见 `docs/specs/41-e2e-whitebox-eval/spec.md` |

### 需用户拍板（不拍板无法排期，均属"改变行为或加列"的决策）

B17 周刊初筛预算结构性不足 · B18 `videos` 表无 `score`/`translated_title` 列（视频评分与翻译二选一或都做）· H12 `settings['weekly']` 改了不生效 · H13 我的早报期号+归档（→ 40-4）· H1 是否给 YouTube 上住宅代理 · `38` 的 D1~D5 后台边界（沿用 `35d` 清单）。
**已裁决不再待批**：H10/`settings.ai.features` 假开关 → 摘除（B51，39-2）；BL9 AI 配置写入口 → 保留可写 + 审计 + 告警（`CLOUD_PIPELINE_GUIDE.md` §6.1）；B15 → 改判为 `'null'` 污染（BL10）。

### 优化方向（非阻塞，按性价比排序）

1. **先做 H16**（系统性故障不折算成单源失败）：一条判据（本轮失败率 >30% 或错误指纹高度同源 → 本轮不计失败），挡住"一次代理挂＝全库 458 源熔断且永不恢复"。这是当前唯一能一次性打瘫全库的缺陷。
2. **本地端补自动恢复**（H14 本地线）：纯增量，不动云端语义；顺带把历史锁死的 584 源按类别分批试探恢复一次。
3. **冷却按错误类别分级 + 解冻前探活**（35A-F3/F4）：把 48h 流放换成分钟级退避；`parser-defect` 一律不熔断（是我们的 bug，锁源＝藏问题）。
4. **35B 数据窗口 → 35C 彩色百分比**（顺手修 B22，把 `RateBadge` 三处调用点一次收敛）。
5. 早报体感尾巴：B21 本期索引与页签切回卡顿、B8/B11 在途改动（B25）落定、B20 门槛跑批验证（W7）。
6. **35D 管理后台大重构放最后**（默认最低优先级）：等 1~4 的行为与数据语义稳定后再动布局，先让用户拍板 D1~D5。

## 已关闭挂案（本轮核销）

- ~~H4 实时流 Tab 缺失~~ → 已实现（热点榜「AI 信息实时流」，2026-09-14）
- ~~H5 xgo.ing 桥接 X 源可用性观察~~ → 观察期满：127 启用 X 源全部 status=ok（2026-09-15 实测），关闭
