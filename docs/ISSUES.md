# 全网情报系统 · 已知问题清单（活文档）

> 只列**当前活跃**的问题。已修复问题的完整历史在 `docs/changes/archive/`（变更记录）与
> `docs/deprecated/ISSUES-resolved-2026-09-13.md`（旧清单存档），本文件不再保留已核销条目。
> 功能需求类事项不在本文件，见 `docs/NEXT-DEV-REQS.md`（T3 系列）。
> 最后更新：2026-09-13 晚（大清洗：11 项 P0 + 16 项 P1/P2 已核销条目全部拧出归档）

---

## ✅ 2026-09-14 上午（28 完成批：精选=AI 评分内容流，commits 2176cae/f3b1964）

| 项 | 内容 | 线上验证 |
|---|---|---|
| 根本级修复 | **六维评分此前只存日报/周报快照 JSON、从未回写 articles.score**——热点榜精选/权威加权/score_min 全部无米下锅（"精选只有知乎"的真正根因） | persistScores 管线回写（含 reason）+ 历史回填 89 条 + reason 补写 |
| featured 重定义 | 非热榜 score≥60（AI 评分内容流，时间序）+ 热榜高热度分列随后 | **61 条自有源评分内容**（82/80/78/76 分，财经杂志/HN/虎嗅/Datawhale）✅ |
| Top5 卡 | 页首「当前热点」跨源事件 Top5（点击进完整榜单）+ featured 搜索框 | 部署 ✅ |

## ✅ 2026-09-14 早上复核（用户反馈"还是只有知乎热榜"）

浏览器逐 Tab 实测（强刷后）：
- **全部动态 ✅ 已修复生效**：200 条混排——知乎/微博/金十 + 第一财经/Hugging Face/The Verge/Reddit 等自有源
- 精选 ✅：自有源 ≥70 分置顶（当前深析覆盖少，随积累增多）
- 用户看到"只有知乎热榜"= **浏览器旧缓存**（部署前的旧 bundle/数据）→ Ctrl+F5 即可
- 经验：前端发版后引导用户强刷；考虑 index.html 加版本号提示（T5-11 一并）

## ✅ 2026-09-14 凌晨修复（28 热点榜重设计数据层，commits 88042ce/4322909/e89cf52/835f2d0）

| 项 | 修复 | 线上验证 |
|---|---|---|
| 根因 | handleHot 两 tab 硬编码 `s.type='hotlist'`——自有源六维内容从不进热点榜；featured score>10000 是热榜热度量级 | tab=all 现 200 条 33 来源（自有源+热榜混排）✅ |
| 重写 | tab=all=全部源 7 天；featured=自有源≥70 分置顶（分列排序防热度压制）+热榜高热度；hotlist 子视图保留；分类=标题/摘要/tags 关键词组（六分类命中 108-928）；q/source/cursor 沿用；SELECT 补 reason | featured 首条自有源 72 分+reason ✅；分类「模型」200 条 ✅；搜索 165 条 ✅ |
| 对抗 | score 列 19780 条文本 'null'（TEXT vs 数字恒真，坑 #25 同族第二次）→ CAST(a.score AS REAL) 防御 + 数据清 NULL | 精选不再混入空分条目 ✅ |
| 前端 | 分类 pills 两 tab 全传参；时间线卡有推荐理由即展示 | 部署 ✅ |

## ✅ 2026-09-14 深夜修复（34-misc-fixes，commit ca2d91a）

| # | 修复 | 验证 |
|---|---|---|
| B5 | /api/alerts/config 回传 recentLog | 线上 29 条历史可见 ✅ |
| B6 | RSS 条目链接为 YouTube 跳过不入文章流（三处采集同步） | 下轮采集生效，OpenAI 类空文章不再新增 |
| B7 | 周刊封面「第 N 期——主题」+ prompt 放宽 4-12 字可读短语 | 页面显示"第 2 期——失控的智能" ✅；第 3 期起主题更可读 |
| B9 | 已退役 wemp 源 switch 禁用 + 换源引导 | 部署即生效 |
| B12 | 本周概览 60s 模块缓存（切页秒开） | 部署即生效 |
| T5-9 | 我的阅读真实性核查结论：读行为真实（9/13 十五条真实点击落库）；24855 条空串 read_at 为历史批量产物（计入历史存档，语义一致不修） | SQL 抽样落档 |

## 🔴 活跃 bug（2026-09-14 用户验收新增，定性见 docs/NEXT-DEV-REQS.md T5）

| # | 问题 | 定性 |
|---|---|---|
| B5 | 管理台报警记录显示"暂无"但飞书有报警——云端 recentLog 有 29 条在 settings alerts，/api/alerts/config 未回传 | 端点字段缺失（小修） |
| B6 | OpenAI feed 混入 YouTube shorts 条目被当文章抓（如 GPT-6 Astra，url=youtube.com/shorts，正文空） | 采集分类缺失（feed 条目链接是 YouTube → 判 video 或跳过） |
| B7 | 周刊封面主题压缩到看不懂（"失控的智能"）——生成 prompt 需「第N期——主题」可读格式 | prompt 问题 |
| B8 | 综述/文章详情无排版（加粗/重点标注丢失，纯文本渲染） | 前端渲染层（markdown 化） |
| B9 | 已退役 wemp 源开关可开但永远无法采集（引擎已退役）——需引导换 RSS 源或明示禁用 | UX + 数据语义 |
| B10 | 每日早报 AI 版仍显示关键词版栏目注解（"Codex、Claude、豆包…"） | AI 栏目 desc 未更新 |
| B11 | 多页面切换懒加载 chunk + 冷启动导致"加载半天" | 感知性能（骨架屏已做前台，后台 Tab 未覆盖） |
| B12 | 本周概览每次切页回来重新拉取（api 缓存随组件卸载失效） | 前端缓存策略 |

## 🔴 活跃 bug

> B1-B4 已于 2026-09-13 晚修复并云端实测（commit d8b0347/8860be4/fce6edb/4ec3e47），详见文末修复记录。


| # | 问题 | 根因（已定性） | 修复方案 | 预估 |
|---|------|------|------|------|
| B1 | **每日早报"今日主题"显示 `2。`**（/daily/，2026-09-13 14:03 生成） | 当轮 generateTheme 被推理模型污染（当时日志"主题: 2"）。代码侧已三层加固（形状校验+元文本一票否决+null 语义，commit `1019280`），但 daily_reports #84 的存量 stats.theme 仍是脏值 | 一条 UPDATE 清空 #84 的 theme（与 mybrief 同处理）；今晚 00:32 定时管线会以干净代码重新生成 | 5 分钟 |
| B2 | **每日早报统计卡「候选内容 / 公众号文章 / 视频」显示 —** | daily-ai 管线写 stats 只含 `filterStats/sections/totalItems`，缺前端 StatCards 契约的 `candidates/articles/videos` 三键（老关键词管线也只写了前两个） | runDailyAi 组装 stats 时补齐三键（候选数已有 filterStats.candidates；公众号/视频数在候选查询时按 type 分计），连带给老管线补 videos | 30 分钟 |
| B3 | **页面切换严重卡顿**（阅读器/我的阅读/热点榜，每次加载几秒+） | 实测（2026-09-13 16:xx，代理链路）：`/api/reading?tab=all` **11.2s**、`/api/status` **6.1s**、`/api/hot?tab=all` 2.5s、`/api/articles` 1.8s。reading 的 UNION ALL 全表聚合 + status 的 overview 多组 COUNT 在 4.3 万行上反复扫描 | 见 `docs/NEXT-DEV-REQS.md` T3-3（查询优化+表达式索引+轻量缓存，目标 P95<2s） | 半天 |
| B4 | **阅读器"近7天入早报·来源榜"永远「本期暂无」** | 原 P3-5：handleStatus 不返回 `dailyItemCount/dailyTopSources`，OverviewRail 无数据可渲染（用户期望：头像+xx源+入榜次数） | 见 `docs/NEXT-DEV-REQS.md` T3-4（从 daily_reports 最近 7 天 sections 聚合来源计数） | 1-2 小时 |

## 🟡 挂案（外部依赖/低优先，保持跟踪）

| # | 问题 | 状态 |
|---|------|------|
| H1 | YouTube 反爬假 404 → 55 源熔断（阈值 10 已放宽） | 挂案：彻底解需住宅代理 RSSHub；熔断源每周由 cleanup 批次汇总提醒 |
| H2 | P2-1 日报引擎双份实现（api/daily-generate.js vs [...slug].js 内联） | 挂案：getOrGenerate 仅兜底用，主链路在 runner；T3-1 早报 v3 重构时一并收敛 |
| H3 | P2-4 AUTH_SECRET 回退 'dev-secret' / P2-5 /api/img 无 SSRF 防护 / P2-6 LIKE '%%' 慢查询 / P2-7 handleDaily UTC 日期比较 | 低危挂案（Vercel 网络隔离+量级小），随 T3-3 性能项顺手处理 |
| H4 | P1-9 "实时流"Tab 缺失 | 待设计（与 T3-1 主题全景可能合并形态） |
| H5 | xgo.ing 桥接的 219 个 X 推主源可用性未知 | 已导入（2026-09-13），观察 48h 抓取成功率；失败率过高则换 RSSHub 路由 |
| H6 | B站采集"更好的方案"调研（Cookie 主链 vs 现匿名降级） | 用户提出，见 NEXT-DEV-REQS T3-6 |

---

## 已核销条目去向

- **2026-09-09 ~ 09-12 的 P0-1~P0-11、P1-1~P1-16、P2-2/P2-8/P2-9/P2-10、P3 系列**：全部修复并云端实测，完整清单与修复记录见 `docs/deprecated/ISSUES-resolved-2026-09-13.md`。
- 专项分析（源自动刷新/调度冲突/双端差异矩阵）已随方案A落地失效，一并存档于上述文件。

---

## 修复记录（2026-09-14 凌晨四，队列收尾：行为画像+骨架屏，commit 2728e44）

| 项 | 内容 | 验证 |
|---|---|---|
| T3-1 R5 | 行为画像：buildInterestProfile（近 30 天 近读×2/稍后读×1 → 标签权重 Top12）→ runMyBrief 排序加权（命中 Top5 每标签 +8 上限 +24）+ Domain 篇数配额（主标签上限，超配移出）；早报中心画像标签云（★=参与加权）+ 配额编辑器（次日凌晨生效） | 端点结构实测 + 空态渲染 ✅；画像今晚 21:30 首次产出 |
| T3-3 R4 | reading 骨架屏：Skeleton 组件（行/卡）替换 Hot/MyReading/VideoGrid/ArticleList/MyBrief 五处"加载中…" | 浏览器实测 animate-pulse 出现、文字态移除 ✅ |
| R7 修 | 干净样本长度 <200 低于守卫 → 加长测试样本（守卫语义正确，测试样本问题） | 266 全绿 |

## 修复记录（2026-09-14 凌晨三，对抗审查第 5 项修复：commit 3669cb3）

| 项 | 内容 | 验证 |
|---|---|---|
| 对抗5 | 第 2 期编辑综述卡渲染出模型复述的任务结构（"1. **Analyze User Input:** - **Role:**…"，1600 字越拼越长入库）→ 抽出 generateWeeklyEditorNote：整段结构化一票否决（围栏/编号开头/**Role:** 字段）+ isMeta 扩充 + 硬上限 800 字 | 回归 R7（桩注入）+ 数据修复重试生成 570 字干净综述（写回 latest+archive）+ 浏览器截图实测 ✅ |

## 修复记录（2026-09-14 凌晨二，第 6 批 周刊 v2 杂志版：commit cbe6b5b）

| 项 | 内容 | 验证 |
|---|---|---|
| 管线 | generateWeeklyMagazine 两次 AI 调用（storylines JSON：封面主题词+3-5 观点式主线+条目编号越界过滤；编辑长综述 500-700 字+分析行拒绝）→ report.coverTheme/editorNote/storylines | 本地实测：克制的力量/3 主线/506 字综述 ✅ |
| 对抗1 | 长 JSON 被 maxTokens 截断（推理模型 reasoning 先烧 token，实测复现 reply 638 字符截断）→ 3200/2600 | 重试成功 |
| 对抗2 | itemNumbers 越界/非数组/主线 <2 条 → 逐层过滤，空则回退旧版视图 | 代码守卫 |
| 前端 | 封面头（coverTheme 大字）+ 编辑综述卡 + 主线分节（编号+叙事+条目卡）+ 注脚；无 storylines 旧期号自动回退分主题视图 | 部署后 issue-1 走旧视图无回归 |
| 注意 | 推理模型长结构化输出必须给足 maxTokens（≥3000），验收必须包含真实长输出场景 | 坑 #26 增补案例 |

## 修复记录（2026-09-14 凌晨，第 5 批续 T4-2 R4 七层防御：commit 9a287ae）

| 层 | 内容 | 验证 |
|---|---|---|
| L4 | filter prompt 强制压分负例（标题党/广告导购/荐股拉人头/八卦/内容农场 → ≤15 且 ignore） | prompts/filter.md + EMBEDDED 同步 |
| L5a | 权威加权：近 30 天源级高分率 → authority∈[0.8,1.2] 乘入 totalScore | 今晚 21:30 首跑 |
| L5b | 低曝光保护位：14 天未入报且 ≥75 分源保底 2 名额（插重点更新第 2 位） | 同上 |
| L3 | 单源单日入报 ≤3（跨栏计数）+ 全局 ≤36 | 组装层硬约束 |
| L6 | MMR 探索位：补充阅读精确 10 条（订阅余量+探索 0.7·相关性−0.3·最大相似）；强度滑杆 low/mid/high → 早报中心可调（回读实测 ✅） | 线上 |
| 语义 | specs/23 L2 事件聚合 = dedupItems（既有）+ 主题全景（上批）覆盖 | — |

## 修复记录（2026-09-13 深夜四，第 5 批 T4-2 源治理：commit 9c4f21e/99caab6）

| 项 | 内容 | 验证 |
|---|---|---|
| T4-2 R2 | failover：同 failoverGroup 只采主源（备源跳过省重复抓取），主失败顺序试备源（≤10 组） | 部署后首条心跳 total=110 全流程正常 |
| T4-2 R1 | 查重合并：POST /api/sources/dedupe（dryRun/apply；URL 归一/同名同域两组规则；保留 启用>fail低>id老；mergedInto 标记且自动恢复跳过）+ 源库「查重合并」按钮 | 线上 dryRun 实测 14 组重复（Business Insider 等），未授权 401 |
| T4-2 R3 | 频率自适应：cleanup 对 autoInterval===true 的源按近 14 天出文频率调 intervalMin（60/120/240/720 四档） | 明晨 04:13 首跑（当前无源开启，批量源可按需打开） |
| 对抗 | 心跳历史瘦身（failures 内嵌全 source 行会膨胀数 MB → 只留 id/name/type/errMsg） | smoke 20/20 |
| 观察 | 首条心跳：110 源中 36 失败（25 个热榜 HTTP 500 为瞬时 + 新导入源若干 404/403 + xgo.ing 400）——T3-5 观察继续 | collect-history |

## 修复记录（2026-09-13 深夜三，第 4 批 T3-2：commit 243a23e）

| 项 | 内容 | 验证 |
|---|---|---|
| T3-2 R1 | 早报中心 Tab：生成历史表（7 天三报+足迹）、推送开关（settings PUT/GET 补 mybrief/weekly 分区）、周刊归档删除（DELETE /api/weekly/archive/:issue 专用端点+审计）、手动生成命令 | 浏览器实测完整渲染 ✅ |
| T3-2 R2 | 心跳追加式（168 条）+ /api/health/collect-history + MonitorTab 折线图（SVG 双线）+ DataTab conic-gradient 饼图 + AlertsTab 时间线视觉 | 端点授权/结构实测 ✅，折线图心跳积累 ~1h 后出图 |
| 对抗 | brief/history 未授权 401 ✅；DELETE 不存在期 404 ✅；PUT mybrief 回读 ✅；archive 独立键写回会清库 → 专用端点（代码评审发现） | 实测 |

## 修复记录（2026-09-13 深夜二，第 3 批次批：commit 4aa76d2）

| 项 | 内容 | 验证 |
|---|---|---|
| T3-1 R0c | 主题全景：标题 Jaccard 聚类 + AI 命名/四类视角/综述 → stats.themes/mybrief.themes → ThemePanorama 组件（Daily/MyBrief 页） | 今晚 21:30 首跑出真实主题 |
| T4-3 | 视频入报：daily-ai +20、weekly +15（id 'v' 前缀防冲突，kind=video 前端外链）；播客源本为 RSS 形态已在管线 | 回归无泄漏/无冲突 |
| T3-1 R7 | 阅读足迹：buildReadingDigest（24h 已读/稍后读/Top5 来源）→ reading.digest → /api/mybrief → MyBriefPage 足迹卡 | 今晚 21:30 首跑 |
| 对抗自查 | 视频 id 三处命名空间（used/QuickStudy/featured）；digest 失败不阻断；旧数据缺键优雅隐藏 | 部署实测无回归 |

## 修复记录（2026-09-13 深夜，第 3 批首批 + 对抗性审查）

| 项 | 内容 | 证据 |
|---|---|---|
| 对抗1 | reading type=video 泄漏文章 → 快路径加 type/tab 白名单 | 回归 R1 + 线上 0 泄漏 |
| 对抗2 | reading q=搜索返回空（OR 分支参数少绑）→ 分支独立绑定 | 回归 R2 + 线上 30 条 |
| 对抗3 | OPML 导出被 JSON 序列化 → raw 约定 | 回归 R5 + 线上纯 XML |
| 对抗4 | 大清理会删周刊归档引用文章 → saveWeekly 打 featured=1 + 存量 20 篇补标 | 明晨 04:13 清理后周刊详情可开 |
| T3-1 R0 | 晚间生成 cron 21:30（rolling24）+ briefWindow 二态 | collect.yml + 代码 |
| T3-1 R0b | translate 生成保护窗（18:30-03:30+周五 15-21） | 本地实测让路日志 |
| T3-1 R4 | 补充阅读固定 10 条 + 非订阅源 ≥70 分补足（explore 徽章） | 代码 + 下一轮 21:30 可见 |
| T3-1 R8 | 周报 AI 总结注脚 → /weekly/ 页脚 | 周五 18:03 第 2 期可见 |
| 验收 | smoke 20/20；npm test 265/265（+6 回归 regression-20260913b） | 本地 |

## 修复记录（2026-09-13 晚，阻塞清单第 0/1/2 批）

| # | 修复 | 实测证据 |
|---|---|---|
| B1 | daily_reports #84 主题"2。"清空（json_set theme=null）；管线侧三层加固已在前批 | /api/daily theme=null ✅ |
| B2 | runDailyAi stats 补 candidates/articles/videos（videos=窗口内 videos 表新增） | 下一轮 00:32 生成后统计卡齐全 |
| B3 | 读层性能：status=overview 正连接（104ms）+四组合一；reading=两段式快路径（表达式覆盖索引+窄查询 221ms+按 id 取 31 行 120ms）；hot 时间窗参数化；补 8 个索引（Turso/server/db.js/runner 三处同步） | 线上热态：status 0.77s（原 6.1s/15s）、reading 1.5-2.8s（原 11-14s）、hot 1.0-2.3s、articles 1.1-2.5s；冷启动首轮仍 15-27s（Vercel 冷启动，另一议题） |
| B4 | handleStatus overview 补 dailyItemCount/dailyTopSources（近 7 天 daily_reports sections JS 聚合+头像回查） | 浏览器实测右栏渲染头像+来源+次数 ✅ |
| Q1 | IconRail EN 按钮移除 | 浏览器实测 ✅ |
| Q2 | GET /api/opml/export（公开 GET，标准 OPML 2.0 按分组嵌套）+ 源库导出按钮 | curl 200 + 结构正确 ✅ |
| Q3 | 库体积显示 sizeNote（Turso 云库口径说明） | 部署即生效 |
| Q4 | runner cleanup 默认 7 天保留清理（豁免已读/稍后读/精选；视频播客永不清）+ 云端 /api/data/cleanup 同语义 | 明晨 04:13 首跑观察 |
| Q5/Q6 | 源库：新建文件夹按钮、行内删除源（级联确认）、☆表头补语义 | 部署即生效（浏览器可验） |
| Q7 | 熔断源自动恢复：冻结 48h 自动重启（resumeCount，3 次后冷却 7 天），freeze 落 frozenAt | 明晨 04:13 首跑观察（92 个 YouTube 冻结源将被自动重试） |
| 顺手 | classify.buildOpmlCategoryMap 只读 bestblogs_*.opml（扁平 opml 污染分类映射，测试实锤修复） | tests 259 全绿 |
