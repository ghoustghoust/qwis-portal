# 文档改动戳（机器生成，勿手改）

> 由 `node tools/doc-stamp.cjs` 生成；规则见 `docs/DOC_GOVERNANCE.md` §2.6。
> **每格都是已提交的历史事实**，所以本表不含"生成时间"——那会让自己每次重跑都产生一条无意义 diff。
> 判定列的语义：`一致` = 头部日期 == 最近提交日；`待判` = 头部比最近提交旧，**可能是真过时，也可能那次提交只是改头注/改错字**（本表把提交主题列出来就是为了让人一眼分辨，机器不替人判）；`头部超前` = 写了尚未提交的日期（提交前出现它是正常态，已 push 仍超前才是硬伤）；`⚠` = 工作区还有未提交改动。
> 已知局限：① 本表按路径查历史，**文件改名/搬家前的历史不跟随**（`--follow` 只能逐文件跑），搬过的文档其提交史从搬家那次起算。② 本表读已提交历史，**正在提交的这一次必然不进表**（显式滞后一轮，配合 `⚠` 可见），下一轮重跑即补上。
> 未跟踪件不入表：如本地文件 `docs/HANDOVER.md` 按设计永不提交，本就没有提交史可记。

**统计**：底层文档 一致 5 · 待判 13 · 头部超前 0 · 缺头注 0　|　不要求头注 253 份　|　工作区未提交 2 份　|　总计 271 份

### 底层文档（DOC_GOVERNANCE §2.1 白名单，列最近 3 次改动）（18 份）

| 文档 | 头部声明 | 判定 | 提交史（短号 · 日期 时:分 · 主题） |
|---|---|---|---|
| AGENTS.md | 2026-09-20 | 待判 | `abc2836` 2026-09-21 20:50 feat(AGENTS §2.9 文档改动戳): doc-stamp 工具与 STAMPS.md 入账——每份 .md 的最近改动=短号·日期·提交主题,禁止手写 commit 号进文档头部(机制见 DOC_GOVERNANCE §2.6)<br>`668e254` 2026-09-19 15:31 fix(api)+test(eval): 端到端按独立对抗审查补四条硬门，并修掉它回头暴露的 B76 契约断裂<br>`84b53af` 2026-09-19 13:21 fix(前端): 端到端引擎首轮抓到两个真缺陷——后台裸 i18n key、筛选被晚到的旧响应覆盖 |
| ARCHITECTURE.md | 2026-09-19 | 待判 | `2a13808` 2026-09-20 16:32 docs(B120 收口 + B123): runner 侧证据按坑 #68 补齐，页头写死"关键词规则排序"另立一条<br>`530a5f4` 2026-09-20 07:14 docs(specs+落账): 36/37/39/40 四域小 spec 补齐（26 份）+ 叫停轮的只读取证全部落档，未 push<br>`8cb88c4` 2026-09-19 20:24 fix(web): B85 修法补全——设了上界的列还要可收缩，否则窄档裁掉行尾（自打回归） |
| docs/ANDROID_SUBMIT_GUIDE.md | 2026-09-05 | 待判 | `ef42694` 2026-09-18 23:40 docs(governance): 文档清洁轮——底层文档逆推真值 + 六类归档规范 + 门禁脚本，并立自愈/健康度 spec 框架<br>`5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| docs/CLOUD_PIPELINE_GUIDE.md | 2026-09-20 | 一致 | `2a13808` 2026-09-20 16:32 docs(B120 收口 + B123): runner 侧证据按坑 #68 补齐，页头写死"关键词规则排序"另立一条<br>`e856f6c` 2026-09-20 12:17 docs(换库收口): 登记 B118/B119 + 本轮交付链十一条状态，并把"配额是墙钟事件"落成不变量 19 与坑 #D4<br>`530a5f4` 2026-09-20 07:14 docs(specs+落账): 36/37/39/40 四域小 spec 补齐（26 份）+ 叫停轮的只读取证全部落档，未 push |
| docs/DELIVERY_VERIFICATION.md | 2026-09-18 | 待判 | `73147de` 2026-09-21 04:27 feat(B113/B110)+test(S1~S8)+坑#69: 凭据卫生收成一份共享实现，密钥扫描面从"只已跟踪"扩成两面<br>`ef42694` 2026-09-18 23:40 docs(governance): 文档清洁轮——底层文档逆推真值 + 六类归档规范 + 门禁脚本，并立自愈/健康度 spec 框架<br>`608d1fa` 2026-09-11 17:16 docs: 新增交付验证手册(生产环境验证全流程) + 索引收录 |
| docs/DEV_GUIDE.md | 2026-09-20 | 待判 | `dc0732a` 2026-09-21 20:35 docs(并行会话清洁轮入账)+编号归一: 作废路径指针/样图与 SPA 旧引用加注 ignore/轮转态记录补 09-21 节; dump-content 件编号 B128→B131、B129→B132(与 ISSUES 现行号对齐); lib/dirty-columns.js 半成品入库(未接线,README/FEATURE_MATRIX 措辞同步改实)<br>`ba585c8` 2026-09-11 18:26 docs: 真实环境逆推全库文档重整(2026-09-11 审计)<br>`45fd9ac` 2026-09-11 12:52 docs: P1-10 真根因记录(中间件死锁)+P1-15 Vercel Git 集成未连接(link:null) |
| docs/DEVELOPMENT_STANDARDS.md | 2026-09-09 | 待判 | `82a33d0` 2026-09-19 04:13 fix(ai-console): 修 B53——删 runner 里定义了没人调的 llmChat 通道，去掉 AI 设置页把接口地址截成半截域名的 slice，清 Agencs 错字（归属 39-2）<br>`ba585c8` 2026-09-11 18:26 docs: 真实环境逆推全库文档重整(2026-09-11 审计)<br>`b0c3b50` 2026-09-09 20:22 feat: 文档清洗+日报修复+AI设置集成+全面复检 (2026-09-09) |
| docs/DOC_GOVERNANCE.md | 2026-09-20 | 待判 | `e203f76` 2026-09-21 22:22 docs(文档洁净第二轮·核销轮): ISSUES 234→162 / NEXT-DEV-REQS 327→256,两刀均脚本切片+无损校验(97+76 行原文逐字可反查),新归档件 issues-round2-closed 与 nextdev-closed-rounds 双登记; lint 24 警→3 警(14 悬空/3 裸名/2 背景出处全清); test(L5/S6 判据口径修正): 三处断言与脏树耦合(真库必须还有违规才绿),改为相对锚+开火证明归 self-test,判据本体未动<br>`9262379` 2026-09-21 07:36 feat(B115②/门禁扩面收尾)+test(L5): 裸文件名判据 + `npm run lint:cites` 常驻引用台账<br>`73147de` 2026-09-21 04:27 feat(B113/B110)+test(S1~S8)+坑#69: 凭据卫生收成一份共享实现，密钥扫描面从"只已跟踪"扩成两面 |
| docs/EVAL_GUIDE.md | 2026-09-19 | 待判 | `7b80501` 2026-09-21 23:52 fix(B131/P0-2)+feat(W24)+test(SC1~SC5): lib/db.js SCHEMA 与 ALTERS 补 translated_* 三列、server/db.js 补 translation_provider(新机建库写入即抛的缺口,生产靠 runner 自愈 ALTER 掩盖);新白盒 W24 两份建表源可建列集不许分叉+ALTERS 必进 SCHEMA 本体;F2P 按 B106 规则走「回退修复点」:基线红 2/2→改后绿(docs/eval/f2p/2026-09-21-b131-manual.json)<br>`24e76bf` 2026-09-21 07:15 feat(B111/39-6)+test(PR1~PR7)+feat(W20)+坑#71: 翻译 prompt 收成 lib/ai-prompts.js 一份，三种键名归一<br>`6c9a2c7` 2026-09-21 06:20 feat(B109/B45)+test(V1~V7)+feat(W19): 报警事件表收成 lib/alert-events.js 一份，云端后台四个假开关拔掉 |
| docs/FEATURE_MATRIX.md | 2026-09-20 | 待判 | `7b80501` 2026-09-21 23:52 fix(B131/P0-2)+feat(W24)+test(SC1~SC5): lib/db.js SCHEMA 与 ALTERS 补 translated_* 三列、server/db.js 补 translation_provider(新机建库写入即抛的缺口,生产靠 runner 自愈 ALTER 掩盖);新白盒 W24 两份建表源可建列集不许分叉+ALTERS 必进 SCHEMA 本体;F2P 按 B106 规则走「回退修复点」:基线红 2/2→改后绿(docs/eval/f2p/2026-09-21-b131-manual.json)<br>`dc0732a` 2026-09-21 20:35 docs(并行会话清洁轮入账)+编号归一: 作废路径指针/样图与 SPA 旧引用加注 ignore/轮转态记录补 09-21 节; dump-content 件编号 B128→B131、B129→B132(与 ISSUES 现行号对齐); lib/dirty-columns.js 半成品入库(未接线,README/FEATURE_MATRIX 措辞同步改实)<br>`7088e30` 2026-09-21 15:05 feat(B115/⑥a 谓词并一份)+test(R5): 管理台第三份删除谓词收进 lib/retention，W17 整文件豁免同日摘掉 |
| docs/HANDOFF_PROMPT.md | 2026-09-18 | 一致 | `ef42694` 2026-09-18 23:40 docs(governance): 文档清洁轮——底层文档逆推真值 + 六类归档规范 + 门禁脚本，并立自愈/健康度 spec 框架<br>`6e8d635` 2026-09-13 03:17 docs: 09-11~12 交叉审核报告(实现逻辑/验证矩阵/bug/风险/优化) + INDEX/接手快照同步<br>`eb6c350` 2026-09-12 09:39 docs: 13-settings-write 收尾回写(ISSUES核销/总spec标完成/进度快照/changes记录) |
| docs/INDEX.md | 2026-09-20 | 待判 | `e203f76` 2026-09-21 22:22 docs(文档洁净第二轮·核销轮): ISSUES 234→162 / NEXT-DEV-REQS 327→256,两刀均脚本切片+无损校验(97+76 行原文逐字可反查),新归档件 issues-round2-closed 与 nextdev-closed-rounds 双登记; lint 24 警→3 警(14 悬空/3 裸名/2 背景出处全清); test(L5/S6 判据口径修正): 三处断言与脏树耦合(真库必须还有违规才绿),改为相对锚+开火证明归 self-test,判据本体未动<br>`dc0732a` 2026-09-21 20:35 docs(并行会话清洁轮入账)+编号归一: 作废路径指针/样图与 SPA 旧引用加注 ignore/轮转态记录补 09-21 节; dump-content 件编号 B128→B131、B129→B132(与 ISSUES 现行号对齐); lib/dirty-columns.js 半成品入库(未接线,README/FEATURE_MATRIX 措辞同步改实)<br>`c183413` 2026-09-20 17:00 docs(§4.1 补全定义): 洁净=精炼+去冗+归档；INDEX 登记两份新归档件（只提交我自己的 hunk） |
| docs/ISSUES.md | 2026-09-21 | 待判 ⚠ | `25aa5fe` 2026-09-22 22:39 feat(B119③ 公众号源修复): 实测排除公共桥/直抓/搜狗三路后,走公共 wechat2rss 目录源——恢复 40/65(33 本有 bestblogs.dev 现役源,7 接线 xlab 公共目录); 剩 25 个无源的停用标 retired 不再空转自增 fail_count; 写前全量备份 wemp 源表<br>`e213327` 2026-09-22 22:16 docs(B122 核销+三条裁定落档): AGNES key 已三处同步轮换并验证(直连 200,部署 da515be); B118/B125/B119②/B80 按你 09-22 裁定标暂缓; B119③ 公众号源实测结论落档<br>`917d8f0` 2026-09-22 19:17 feat(B21+H13/P2-7)+test(HA1~HA5): 我的早报期号归档(同日原地替换/新日 max+1/封顶30/空态不占号) + /api/mybrief/archive 公开端点 + 页头第N期与往期列表; 日报期号按北京日去重读时算,页头带期号; 本期索引查实已有(吸顶 pill 导航) |
| docs/NEXT-DEV-REQS.md | 2026-09-21 | 一致 | `e203f76` 2026-09-21 22:22 docs(文档洁净第二轮·核销轮): ISSUES 234→162 / NEXT-DEV-REQS 327→256,两刀均脚本切片+无损校验(97+76 行原文逐字可反查),新归档件 issues-round2-closed 与 nextdev-closed-rounds 双登记; lint 24 警→3 警(14 悬空/3 裸名/2 背景出处全清); test(L5/S6 判据口径修正): 三处断言与脏树耦合(真库必须还有违规才绿),改为相对锚+开火证明归 self-test,判据本体未动<br>`1bf7084` 2026-09-20 16:57 docs(§4.1 洁净=精炼+去冗+归档): ISSUES 从 471 行降到 292 行，轮次记录与证据对账外迁归档<br>`6a6e932` 2026-09-19 09:23 fix(eval): 取证器的红因分类补上 ENOENT，并修掉一个"跨行匹配造出假路径"的分类器 bug（坑 #44） |
| docs/ROADMAP-2026-09.md | 2026-09-18 | 一致 | `ef42694` 2026-09-18 23:40 docs(governance): 文档清洁轮——底层文档逆推真值 + 六类归档规范 + 门禁脚本，并立自愈/健康度 spec 框架<br>`d601202` 2026-09-12 12:06 docs: 早报体系三级产品落档(每日早报/我的早报/精选周刊) + 阅读体验修复 + 翻译多轮管线 + InfoQ语料<br>`e003216` 2026-09-12 10:39 docs: 日报设置UI可读性补充 + 管理后台UX整改提升为独立专项P2-4 |
| docs/RUNBOOK.md | 2026-09-20 | 待判 | `8e90a58` 2026-09-22 19:06 docs(B103②收口): /api/backup 只覆盖配置的语义写明——响应带 contentBackup 指路字段(内容表由内容级转储覆盖),RUNBOOK 备份段同步; 不建第二份备份面<br>`dc0732a` 2026-09-21 20:35 docs(并行会话清洁轮入账)+编号归一: 作废路径指针/样图与 SPA 旧引用加注 ignore/轮转态记录补 09-21 节; dump-content 件编号 B128→B131、B129→B132(与 ISSUES 现行号对齐); lib/dirty-columns.js 半成品入库(未接线,README/FEATURE_MATRIX 措辞同步改实)<br>`138b1c7` 2026-09-21 01:53 feat(B103/D3)+test(D1~D10): 内容级转储与删除前置闸 —— 云端第一次有"回得来"的底牌 |
| docs/X_SETUP_GUIDE.md | 2026-09-18 | 一致 | `ef42694` 2026-09-18 23:40 docs(governance): 文档清洁轮——底层文档逆推真值 + 六类归档规范 + 门禁脚本，并立自愈/健康度 spec 框架<br>`2e81cd7` 2026-09-08 22:30 feat: Vercel serverless 部署 + 全量功能重构<br>`5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| README.md | 2026-09-16 | 待判 | `ef42694` 2026-09-18 23:40 docs(governance): 文档清洁轮——底层文档逆推真值 + 六类归档规范 + 门禁脚本，并立自愈/健康度 spec 框架<br>`1f2f253` 2026-09-16 18:40 docs(screenshots): 替换用户提供的 4 张截图 + 热点榜拆为 AI精选/AI实时流/热搜事件 三栏展示<br>`88b4381` 2026-09-16 18:29 docs(readme): 重写 README + 线上生产截图更新（2026-09-16）——新增我的早报/精选周刊/热搜事件/我的阅读/管理后台早报中心/系统管理 6 张截图，功能描述同步源四轴/早报体系/AI增强等最新进展 |

### 其余受管文档（列最近 2 次）（253 份）

| 文档 | 头部声明 | 判定 | 提交史（短号 · 日期 时:分 · 主题） |
|---|---|---|---|
| .cluster/expert-playbook.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/analysis/_doc_merge_analysis.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/analysis/2026-09-15-thin-body-sources.md | — | 不要求头注 | `e92572b` 2026-09-15 20:03 ops(sources): A 类死 feed 删除 10 源 + YouTube 误写 articles 存量迁 videos + 播客桥接源降频 3 天（65 源）+ 普查报告与执行记录落档 |
| archive/docs-deprecated/A_CLASS_FIX_REPORT.md | — | 不要求头注 | `2e81cd7` 2026-09-08 22:30 feat: Vercel serverless 部署 + 全量功能重构 |
| archive/docs-deprecated/AC12-acceptance-template.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/docs-deprecated/DAILY_SETTINGS_MIGRATION.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/docs-deprecated/DEPLOYMENT.md | — | 不要求头注 | `2e81cd7` 2026-09-08 22:30 feat: Vercel serverless 部署 + 全量功能重构<br>`5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/docs-deprecated/EMERGENCY_RECOVERY_GUIDE.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/docs-deprecated/FINAL_DIAGNOSIS_AND_FIX_REPORT.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/docs-deprecated/OBSERVATION-GUIDE.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/docs-deprecated/P0-P2-fix-verification-report.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/docs-deprecated/P3-搁置-多语言支持.md | — | 不要求头注 | `2e81cd7` 2026-09-08 22:30 feat: Vercel serverless 部署 + 全量功能重构 |
| archive/docs-deprecated/P3-搁置-性能基准测试.md | — | 不要求头注 | `2e81cd7` 2026-09-08 22:30 feat: Vercel serverless 部署 + 全量功能重构 |
| archive/docs-deprecated/phase9-runbook.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/docs-deprecated/SOURCE_ERROR_DIAGNOSIS_REPORT.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/docs-deprecated/TIPS-DAILY-TAB-BLANK-PAGE.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/docs-deprecated/wemp-ai-handoff.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/docs-deprecated/WEMP-INTEGRATION-SOLUTION.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/docs-deprecated/wemp-progress-report-summary.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/docs-deprecated/wemp-runbook.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/docs-deprecated/微信公众号接入与热榜方案.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/docs-deprecated/微信方案备选对比.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/docs-deprecated/批量恢复熔断源 - 一键故障恢复方案.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/docs-deprecated/源列表管理增强 - 功能实施指南.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/docs-deprecated/源列表管理增强 - 实施总结报告.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/docs-deprecated/源错误熔断与批量操作修复完整指南.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/docs-deprecated/源错误熔断修复 - 完整补丁与验证指南.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/reports/⚠️阅读前必看-可信度分级.md | — | 不要求头注 | `2e81cd7` 2026-09-08 22:30 feat: Vercel serverless 部署 + 全量功能重构<br>`5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/reports/ARCHITECTURE_AUDIT_REPORT.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/reports/DATA_LIFECYCLE_AUDIT_REPORT.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/reports/DATA_TAB_FIX_REPORT.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/reports/DATA_TAB_FIX_SUMMARY.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/reports/FINAL_FIX_REPORT.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/reports/FINAL_VERIFICATION_SUMMARY.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/reports/FIX_RECORD_UNIFIED.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/reports/P0-P2-FINAL-REPORT.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/reports/REFRESH_MECHANISM_AUDIT.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/reports/RESTART_DIAGNOSIS_REPORT.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/reports/SEARCH_AND_DAILY_AUDIT_REPORT.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/reports/SMOKE_TEST_REPORT.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/reports/SOURCE_ERROR_AUDIT_REPORT.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/reports/WE_MP_RSS_LEAK_REPORT.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/reports/WEMP_SAMPLING_AUDIT.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/reports/WEMP_SUBSCRIPTION_FIX.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/reports/紧急修复报告.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/specs/checklist-phase6.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/specs/checklist-phase7.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/specs/checklist-phase8.md | — | 不要求头注 | `2e81cd7` 2026-09-08 22:30 feat: Vercel serverless 部署 + 全量功能重构 |
| archive/specs/checklist.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/specs/plan-phase6.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/specs/plan-phase7.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/specs/plan.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/specs/spec-phase6.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/specs/spec-phase7.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/specs/spec-phase8.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/specs/spec.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/specs/task-phase6.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/specs/task-phase7.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| archive/specs/task.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| config/README.md | — | 不要求头注 | `2a13808` 2026-09-20 16:32 docs(B120 收口 + B123): runner 侧证据按坑 #68 补齐，页头写死"关键词规则排序"另立一条 |
| docs/archive/debugging/2026-09-13-reader-pagination-and-content-fixes.md | — | 不要求头注 | `ef42694` 2026-09-18 23:40 docs(governance): 文档清洁轮——底层文档逆推真值 + 六类归档规范 + 门禁脚本，并立自愈/健康度 spec 框架 |
| docs/archive/debugging/2026-09-14-delivery.md | — | 不要求头注 | `ef42694` 2026-09-18 23:40 docs(governance): 文档清洁轮——底层文档逆推真值 + 六类归档规范 + 门禁脚本，并立自愈/健康度 spec 框架 |
| docs/archive/debugging/2026-09-19-delivery-evidence-ledger.md | — | 不要求头注 | `1bf7084` 2026-09-20 16:57 docs(§4.1 洁净=精炼+去冗+归档): ISSUES 从 471 行降到 292 行，轮次记录与证据对账外迁归档 |
| docs/archive/debugging/2026-09-20-round-status-records.md | — | 不要求头注 | `e203f76` 2026-09-21 22:22 docs(文档洁净第二轮·核销轮): ISSUES 234→162 / NEXT-DEV-REQS 327→256,两刀均脚本切片+无损校验(97+76 行原文逐字可反查),新归档件 issues-round2-closed 与 nextdev-closed-rounds 双登记; lint 24 警→3 警(14 悬空/3 裸名/2 背景出处全清); test(L5/S6 判据口径修正): 三处断言与脏树耦合(真库必须还有违规才绿),改为相对锚+开火证明归 self-test,判据本体未动<br>`dc0732a` 2026-09-21 20:35 docs(并行会话清洁轮入账)+编号归一: 作废路径指针/样图与 SPA 旧引用加注 ignore/轮转态记录补 09-21 节; dump-content 件编号 B128→B131、B129→B132(与 ISSUES 现行号对齐); lib/dirty-columns.js 半成品入库(未接线,README/FEATURE_MATRIX 措辞同步改实) |
| docs/archive/debugging/2026-09-21-issues-closed-rows.md | — | 不要求头注 | `6c9a2c7` 2026-09-21 06:20 feat(B109/B45)+test(V1~V7)+feat(W19): 报警事件表收成 lib/alert-events.js 一份，云端后台四个假开关拔掉<br>`138b1c7` 2026-09-21 01:53 feat(B103/D3)+test(D1~D10): 内容级转储与删除前置闸 —— 云端第一次有"回得来"的底牌 |
| docs/archive/debugging/2026-09-21-issues-round2-closed.md | — | 不要求头注 ⚠ | `25aa5fe` 2026-09-22 22:39 feat(B119③ 公众号源修复): 实测排除公共桥/直抓/搜狗三路后,走公共 wechat2rss 目录源——恢复 40/65(33 本有 bestblogs.dev 现役源,7 接线 xlab 公共目录); 剩 25 个无源的停用标 retired 不再空转自增 fail_count; 写前全量备份 wemp 源表<br>`e213327` 2026-09-22 22:16 docs(B122 核销+三条裁定落档): AGNES key 已三处同步轮换并验证(直连 200,部署 da515be); B118/B125/B119②/B80 按你 09-22 裁定标暂缓; B119③ 公众号源实测结论落档 |
| docs/archive/debugging/2026-09-21-release-approval-ledger.md | — | 不要求头注 | `0a1c567` 2026-09-21 04:16 docs(放行台账 §三 #12): 勾掉已交付的 W9/B127/B124，只留 B115② 与 lint:cites 两条待做<br>`2dd6808` 2026-09-21 03:03 feat(门禁扩面)+test(L1~L4): doc-lint 加 5 条判据并给它做双向自证 —— 编号撞号那条是本轮自己咬出来的 |
| docs/archive/feature/2026-09-21-nextdev-closed-rounds.md | — | 不要求头注 | `e203f76` 2026-09-21 22:22 docs(文档洁净第二轮·核销轮): ISSUES 234→162 / NEXT-DEV-REQS 327→256,两刀均脚本切片+无损校验(97+76 行原文逐字可反查),新归档件 issues-round2-closed 与 nextdev-closed-rounds 双登记; lint 24 警→3 警(14 悬空/3 裸名/2 背景出处全清); test(L5/S6 判据口径修正): 三处断言与脏树耦合(真库必须还有违规才绿),改为相对锚+开火证明归 self-test,判据本体未动 |
| docs/archive/README.md | — | 不要求头注 | `d452d52` 2026-09-21 22:47 docs(ISSUES 结构重排,用户口径): 已核销/已归档一律撤出正文——ISSUES 162→97 行,正文只剩『进度速览 + 未修/观察/等你操作/待裁决/挂案/阻塞』六段,每条只答现在坏着什么与下一步;撤出与改写行原文逐字进 round2 归档件 §九(无损校验过); test(G8 判据口径): B71~B83 登记面从单文件扩为 活文档+归档层调试件,查无某号仍红(追溯不断)<br>`e203f76` 2026-09-21 22:22 docs(文档洁净第二轮·核销轮): ISSUES 234→162 / NEXT-DEV-REQS 327→256,两刀均脚本切片+无损校验(97+76 行原文逐字可反查),新归档件 issues-round2-closed 与 nextdev-closed-rounds 双登记; lint 24 警→3 警(14 悬空/3 裸名/2 背景出处全清); test(L5/S6 判据口径修正): 三处断言与脏树耦合(真库必须还有违规才绿),改为相对锚+开火证明归 self-test,判据本体未动 |
| docs/BESTBLOGS_BORROW.md | 2026-09-18 | 不要求头注 | `ef42694` 2026-09-18 23:40 docs(governance): 文档清洁轮——底层文档逆推真值 + 六类归档规范 + 门禁脚本，并立自愈/健康度 spec 框架<br>`1750845` 2026-09-11 21:54 docs: BestBlogs 调研借鉴清单(10项范式映射进总spec) |
| docs/changes/2026-09-11-runner-direct-collect.md | — | 不要求头注 | `146352b` 2026-09-11 15:46 docs: AI 上云状态更正——Agnes key 云端 401(IP 绑定),待 DEEPSEEK_API_KEY 启用;不借 starhub,独立配置<br>`57dec47` 2026-09-11 13:17 feat(ai): 翻译上云 —— collect-turso.js 新增 translate 模式,每轮采集后自动翻译英文文章 |
| docs/changes/archive/2026-09-11-settings-write.md | — | 不要求头注 | `60901a4` 2026-09-13 18:01 docs: 文档大整理——归档制/大清洗/T3 需求定稿（2026-09-13 晚） |
| docs/changes/archive/2026-09-12-cloud-alerts.md | — | 不要求头注 | `60901a4` 2026-09-13 18:01 docs: 文档大整理——归档制/大清洗/T3 需求定稿（2026-09-13 晚） |
| docs/changes/archive/2026-09-12-my-brief.md | — | 不要求头注 | `60901a4` 2026-09-13 18:01 docs: 文档大整理——归档制/大清洗/T3 需求定稿（2026-09-13 晚） |
| docs/changes/archive/2026-09-12-sources-write.md | — | 不要求头注 | `60901a4` 2026-09-13 18:01 docs: 文档大整理——归档制/大清洗/T3 需求定稿（2026-09-13 晚） |
| docs/changes/archive/2026-09-13-delivery-emergency-fixes.md | — | 不要求头注 | `60901a4` 2026-09-13 18:01 docs: 文档大整理——归档制/大清洗/T3 需求定稿（2026-09-13 晚） |
| docs/deprecated/01-部署架构决策.md | — | 不要求头注 | `b0c3b50` 2026-09-09 20:22 feat: 文档清洗+日报修复+AI设置集成+全面复检 (2026-09-09) |
| docs/deprecated/02-不做云端采集决策.md | — | 不要求头注 | `b0c3b50` 2026-09-09 20:22 feat: 文档清洗+日报修复+AI设置集成+全面复检 (2026-09-09) |
| docs/deprecated/04-不做Vercel前端决策.md | — | 不要求头注 | `b0c3b50` 2026-09-09 20:22 feat: 文档清洗+日报修复+AI设置集成+全面复检 (2026-09-09) |
| docs/deprecated/1.CODE_REVIEW_2026-09-05.md | — | 不要求头注 | `b0c3b50` 2026-09-09 20:22 feat: 文档清洗+日报修复+AI设置集成+全面复检 (2026-09-09) |
| docs/deprecated/AGENTS-generic-template.md | — | 不要求头注 | `ba585c8` 2026-09-11 18:26 docs: 真实环境逆推全库文档重整(2026-09-11 审计) |
| docs/deprecated/AUDIT-2026-09-12.md | — | 不要求头注 | `10a9556` 2026-09-15 01:43 docs: 文档大清洗——ISSUES 只留活跃/观察/挂案（242→50 行），09-13~09-15 完成批全量归档 deprecated/ISSUES-resolved-2026-09-14.md（原文一字未删）；REFACTOR_GUIDE/AUDIT-2026-09-12 入 deprecated；INDEX/NEXT-DEV-REQS 头部同步最新状态 |
| docs/deprecated/HEARTBEAT.md | — | 不要求头注 | `ba585c8` 2026-09-11 18:26 docs: 真实环境逆推全库文档重整(2026-09-11 审计) |
| docs/deprecated/IDENTITY.md | — | 不要求头注 | `b0c3b50` 2026-09-09 20:22 feat: 文档清洗+日报修复+AI设置集成+全面复检 (2026-09-09) |
| docs/deprecated/ISSUES-resolved-2026-09-13.md | 2026-09-11 | 不要求头注 | `60901a4` 2026-09-13 18:01 docs: 文档大整理——归档制/大清洗/T3 需求定稿（2026-09-13 晚） |
| docs/deprecated/ISSUES-resolved-2026-09-14.md | — | 不要求头注 | `10a9556` 2026-09-15 01:43 docs: 文档大清洗——ISSUES 只留活跃/观察/挂案（242→50 行），09-13~09-15 完成批全量归档 deprecated/ISSUES-resolved-2026-09-14.md（原文一字未删）；REFACTOR_GUIDE/AUDIT-2026-09-12 入 deprecated；INDEX/NEXT-DEV-REQS 头部同步最新状态 |
| docs/deprecated/MODULE_STATUS.md | 2026-09-11 | 不要求头注 | `ba585c8` 2026-09-11 18:26 docs: 真实环境逆推全库文档重整(2026-09-11 审计) |
| docs/deprecated/PHASE6_REVIEW_REPORT.md | — | 不要求头注 | `b0c3b50` 2026-09-09 20:22 feat: 文档清洗+日报修复+AI设置集成+全面复检 (2026-09-09) |
| docs/deprecated/PROJECT_STATUS.md | 2026-09-11 | 不要求头注 | `ba585c8` 2026-09-11 18:26 docs: 真实环境逆推全库文档重整(2026-09-11 审计) |
| docs/deprecated/REFACTOR_GUIDE.md | — | 不要求头注 | `10a9556` 2026-09-15 01:43 docs: 文档大清洗——ISSUES 只留活跃/观察/挂案（242→50 行），09-13~09-15 完成批全量归档 deprecated/ISSUES-resolved-2026-09-14.md（原文一字未删）；REFACTOR_GUIDE/AUDIT-2026-09-12 入 deprecated；INDEX/NEXT-DEV-REQS 头部同步最新状态 |
| docs/deprecated/REPOWIKI_AUDIT_2026-09-06.md | — | 不要求头注 | `b0c3b50` 2026-09-09 20:22 feat: 文档清洗+日报修复+AI设置集成+全面复检 (2026-09-09) |
| docs/deprecated/SOUL.md | — | 不要求头注 | `b0c3b50` 2026-09-09 20:22 feat: 文档清洗+日报修复+AI设置集成+全面复检 (2026-09-09) |
| docs/deprecated/TOOLS.md | — | 不要求头注 | `ba585c8` 2026-09-11 18:26 docs: 真实环境逆推全库文档重整(2026-09-11 审计) |
| docs/deprecated/USER.md | — | 不要求头注 | `b0c3b50` 2026-09-09 20:22 feat: 文档清洗+日报修复+AI设置集成+全面复检 (2026-09-09) |
| docs/deprecated/VERCEL_MIGRATION.md | — | 不要求头注 | `b0c3b50` 2026-09-09 20:22 feat: 文档清洗+日报修复+AI设置集成+全面复检 (2026-09-09) |
| docs/eval/bl10-null-audit-20260921.md | — | 不要求头注 | `16a957d` 2026-09-21 01:56 docs(B101 拦一下)+docs(BL10 复核): 待删量按现役库重算是 50,636 条（84.6%），不是旧库那 10,733<br>`138b1c7` 2026-09-21 01:53 feat(B103/D3)+test(D1~D10): 内容级转储与删除前置闸 —— 云端第一次有"回得来"的底牌 |
| docs/eval/citation-audit-20260919.md | — | 不要求头注 | `a08b77c` 2026-09-20 07:50 docs(锚点审计): 第 4 轮只读复核——254 条 file:line 引用扫出 5 条烂锚，登记 B115 |
| docs/features/collectors.md | 2026-09-05 | 不要求头注 | `ba585c8` 2026-09-11 18:26 docs: 真实环境逆推全库文档重整(2026-09-11 审计)<br>`2e81cd7` 2026-09-08 22:30 feat: Vercel serverless 部署 + 全量功能重构 |
| docs/features/daily-report.md | 2026-09-05 | 不要求头注 | `ba585c8` 2026-09-11 18:26 docs: 真实环境逆推全库文档重整(2026-09-11 审计)<br>`2e81cd7` 2026-09-08 22:30 feat: Vercel serverless 部署 + 全量功能重构 |
| docs/features/events-alerts.md | 2026-09-05 | 不要求头注 | `ba585c8` 2026-09-11 18:26 docs: 真实环境逆推全库文档重整(2026-09-11 审计)<br>`2e81cd7` 2026-09-08 22:30 feat: Vercel serverless 部署 + 全量功能重构 |
| docs/features/my-reading.md | 2026-09-06 | 不要求头注 | `ba585c8` 2026-09-11 18:26 docs: 真实环境逆推全库文档重整(2026-09-11 审计)<br>`2e81cd7` 2026-09-08 22:30 feat: Vercel serverless 部署 + 全量功能重构 |
| docs/features/scheduler.md | 2026-09-05 | 不要求头注 | `ba585c8` 2026-09-11 18:26 docs: 真实环境逆推全库文档重整(2026-09-11 审计)<br>`2e81cd7` 2026-09-08 22:30 feat: Vercel serverless 部署 + 全量功能重构 |
| docs/features/source-library-autoclassify.md | 2026-09-06 | 不要求头注 | `ba585c8` 2026-09-11 18:26 docs: 真实环境逆推全库文档重整(2026-09-11 审计)<br>`2e81cd7` 2026-09-08 22:30 feat: Vercel serverless 部署 + 全量功能重构 |
| docs/features/task-queue.md | 2026-09-05 | 不要求头注 | `ba585c8` 2026-09-11 18:26 docs: 真实环境逆推全库文档重整(2026-09-11 审计)<br>`2e81cd7` 2026-09-08 22:30 feat: Vercel serverless 部署 + 全量功能重构 |
| docs/pitfalls/ai.md | — | 不要求头注 | `7764ccf` 2026-09-18 22:21 fix(daily): 每日早报补上分析后质量门槛——AI 判「不适合收录」的低分条目不再上榜<br>`3abd831` 2026-09-18 19:55 fix(ai): 无正文即抛错——_rawChat 不再把 reasoning_content 冒充成 AI 回复 |
| docs/pitfalls/backend.md | — | 不要求头注 | `01f2a2b` 2026-09-21 13:27 feat(B101/观测+强制闸)+test(CO1~CO5)+坑#72: 待删量落成每日读数，删除闸接成 DELETE 前的强制路径<br>`4e5441c` 2026-09-21 06:53 fix(B112 判据)+test(Q4)+坑#70 补充: 档位类型判据别用带回溯的负向 lookahead |
| docs/pitfalls/collection.md | — | 不要求头注 | `ca42cd5` 2026-09-19 06:31 feat(selfheal): 落 35A-F6 那条判据——系统性故障不再折算成单源失败（代理挂掉不再集体熔断）<br>`ef42694` 2026-09-18 23:40 docs(governance): 文档清洁轮——底层文档逆推真值 + 六类归档规范 + 门禁脚本，并立自愈/健康度 spec 框架 |
| docs/pitfalls/deployment.md | — | 不要求头注 | `e856f6c` 2026-09-20 12:17 docs(换库收口): 登记 B118/B119 + 本轮交付链十一条状态，并把"配额是墙钟事件"落成不变量 19 与坑 #D4<br>`a1b12ce` 2026-09-19 05:11 fix(eval): 把「线上到底在跑哪个 commit」变成一次 curl 可查的事实，并记 BL12 Vercel 自动部署停摆 |
| docs/pitfalls/frontend.md | — | 不要求头注 | `bc1e4e4` 2026-09-19 20:07 test(regression): B83 收口——最后四份"直打生产 Turso"的测试搬到本地文件库<br>`a1d9c3b` 2026-09-13 19:44 docs: 踩坑库独立成档 + T4 追加需求 + 三份新 spec + 原定目标存续盘点 |
| docs/pitfalls/README.md | 2026-09-18 | 不要求头注 | `2826591` 2026-09-19 10:25 fix(eval): 按独立对抗性审查修掉取证器"会自己说谎"的三条路径，并补齐固定交付链<br>`6a6e932` 2026-09-19 09:23 fix(eval): 取证器的红因分类补上 ENOENT，并修掉一个"跨行匹配造出假路径"的分类器 bug（坑 #44） |
| docs/pitfalls/testing.md | — | 不要求头注 | `24e76bf` 2026-09-21 07:15 feat(B111/39-6)+test(PR1~PR7)+feat(W20)+坑#71: 翻译 prompt 收成 lib/ai-prompts.js 一份，三种键名归一<br>`73147de` 2026-09-21 04:27 feat(B113/B110)+test(S1~S8)+坑#69: 凭据卫生收成一份共享实现，密钥扫描面从"只已跟踪"扩成两面 |
| docs/specs/03-公众号走托管RSS决策.md | — | 不要求头注 | `2e81cd7` 2026-09-08 22:30 feat: Vercel serverless 部署 + 全量功能重构 |
| docs/specs/05-任务队列选型决策.md | — | 不要求头注 | `2e81cd7` 2026-09-08 22:30 feat: Vercel serverless 部署 + 全量功能重构 |
| docs/specs/09-source-library-autoclassify/checklist.md | — | 不要求头注 | `2e81cd7` 2026-09-08 22:30 feat: Vercel serverless 部署 + 全量功能重构 |
| docs/specs/09-source-library-autoclassify/plan.md | — | 不要求头注 | `e203f76` 2026-09-21 22:22 docs(文档洁净第二轮·核销轮): ISSUES 234→162 / NEXT-DEV-REQS 327→256,两刀均脚本切片+无损校验(97+76 行原文逐字可反查),新归档件 issues-round2-closed 与 nextdev-closed-rounds 双登记; lint 24 警→3 警(14 悬空/3 裸名/2 背景出处全清); test(L5/S6 判据口径修正): 三处断言与脏树耦合(真库必须还有违规才绿),改为相对锚+开火证明归 self-test,判据本体未动<br>`2e81cd7` 2026-09-08 22:30 feat: Vercel serverless 部署 + 全量功能重构 |
| docs/specs/09-source-library-autoclassify/spec.md | — | 不要求头注 | `2e81cd7` 2026-09-08 22:30 feat: Vercel serverless 部署 + 全量功能重构 |
| docs/specs/09-source-library-autoclassify/task.md | — | 不要求头注 | `e203f76` 2026-09-21 22:22 docs(文档洁净第二轮·核销轮): ISSUES 234→162 / NEXT-DEV-REQS 327→256,两刀均脚本切片+无损校验(97+76 行原文逐字可反查),新归档件 issues-round2-closed 与 nextdev-closed-rounds 双登记; lint 24 警→3 警(14 悬空/3 裸名/2 背景出处全清); test(L5/S6 判据口径修正): 三处断言与脏树耦合(真库必须还有违规才绿),改为相对锚+开火证明归 self-test,判据本体未动<br>`a08b77c` 2026-09-20 07:50 docs(锚点审计): 第 4 轮只读复核——254 条 file:line 引用扫出 5 条烂锚，登记 B115 |
| docs/specs/10-my-reading/spec.md | — | 不要求头注 | `dc0732a` 2026-09-21 20:35 docs(并行会话清洁轮入账)+编号归一: 作废路径指针/样图与 SPA 旧引用加注 ignore/轮转态记录补 09-21 节; dump-content 件编号 B128→B131、B129→B132(与 ISSUES 现行号对齐); lib/dirty-columns.js 半成品入库(未接线,README/FEATURE_MATRIX 措辞同步改实)<br>`2e81cd7` 2026-09-08 22:30 feat: Vercel serverless 部署 + 全量功能重构 |
| docs/specs/11-advanced-filter-views/checklist.md | — | 不要求头注 | `2e81cd7` 2026-09-08 22:30 feat: Vercel serverless 部署 + 全量功能重构 |
| docs/specs/11-advanced-filter-views/plan.md | — | 不要求头注 | `2e81cd7` 2026-09-08 22:30 feat: Vercel serverless 部署 + 全量功能重构 |
| docs/specs/11-advanced-filter-views/spec.md | — | 不要求头注 | `2e81cd7` 2026-09-08 22:30 feat: Vercel serverless 部署 + 全量功能重构 |
| docs/specs/11-advanced-filter-views/task.md | — | 不要求头注 | `2e81cd7` 2026-09-08 22:30 feat: Vercel serverless 部署 + 全量功能重构 |
| docs/specs/12-roadmap-2026/spec.md | — | 不要求头注 | `e0365b2` 2026-09-12 13:38 feat(translate): 17-translate 翻译链完整上云<br>`180a30f` 2026-09-12 12:57 feat(ai): 16-ai-infra AI 基础设施 |
| docs/specs/13-settings-write/checklist.md | — | 不要求头注 | `2b66b76` 2026-09-12 09:27 feat(settings): 13-settings-write 设置写API上云 |
| docs/specs/13-settings-write/plan.md | — | 不要求头注 | `2b66b76` 2026-09-12 09:27 feat(settings): 13-settings-write 设置写API上云 |
| docs/specs/13-settings-write/spec.md | — | 不要求头注 | `2b66b76` 2026-09-12 09:27 feat(settings): 13-settings-write 设置写API上云 |
| docs/specs/13-settings-write/task.md | — | 不要求头注 | `2b66b76` 2026-09-12 09:27 feat(settings): 13-settings-write 设置写API上云 |
| docs/specs/14-sources-write/checklist.md | — | 不要求头注 | `6baa0c8` 2026-09-12 09:56 feat(sources): 14-sources-write 源写API上云 |
| docs/specs/14-sources-write/plan.md | — | 不要求头注 | `dc0732a` 2026-09-21 20:35 docs(并行会话清洁轮入账)+编号归一: 作废路径指针/样图与 SPA 旧引用加注 ignore/轮转态记录补 09-21 节; dump-content 件编号 B128→B131、B129→B132(与 ISSUES 现行号对齐); lib/dirty-columns.js 半成品入库(未接线,README/FEATURE_MATRIX 措辞同步改实)<br>`6baa0c8` 2026-09-12 09:56 feat(sources): 14-sources-write 源写API上云 |
| docs/specs/14-sources-write/spec.md | — | 不要求头注 | `6baa0c8` 2026-09-12 09:56 feat(sources): 14-sources-write 源写API上云 |
| docs/specs/14-sources-write/task.md | — | 不要求头注 | `dc0732a` 2026-09-21 20:35 docs(并行会话清洁轮入账)+编号归一: 作废路径指针/样图与 SPA 旧引用加注 ignore/轮转态记录补 09-21 节; dump-content 件编号 B128→B131、B129→B132(与 ISSUES 现行号对齐); lib/dirty-columns.js 半成品入库(未接线,README/FEATURE_MATRIX 措辞同步改实)<br>`6baa0c8` 2026-09-12 09:56 feat(sources): 14-sources-write 源写API上云 |
| docs/specs/15-cloud-alerts/checklist.md | — | 不要求头注 | `2d790c1` 2026-09-12 10:20 fix(admin): 日报设置Tab崩溃(loading初始false首帧穿透) + 管理后台UX整改需求落档 |
| docs/specs/15-cloud-alerts/plan.md | — | 不要求头注 | `2d790c1` 2026-09-12 10:20 fix(admin): 日报设置Tab崩溃(loading初始false首帧穿透) + 管理后台UX整改需求落档 |
| docs/specs/15-cloud-alerts/spec.md | — | 不要求头注 | `2d790c1` 2026-09-12 10:20 fix(admin): 日报设置Tab崩溃(loading初始false首帧穿透) + 管理后台UX整改需求落档 |
| docs/specs/15-cloud-alerts/task.md | — | 不要求头注 | `2d790c1` 2026-09-12 10:20 fix(admin): 日报设置Tab崩溃(loading初始false首帧穿透) + 管理后台UX整改需求落档 |
| docs/specs/16-ai-infra/checklist.md | — | 不要求头注 | `180a30f` 2026-09-12 12:57 feat(ai): 16-ai-infra AI 基础设施 |
| docs/specs/16-ai-infra/plan.md | — | 不要求头注 | `d601202` 2026-09-12 12:06 docs: 早报体系三级产品落档(每日早报/我的早报/精选周刊) + 阅读体验修复 + 翻译多轮管线 + InfoQ语料 |
| docs/specs/16-ai-infra/spec.md | — | 不要求头注 | `180b325` 2026-09-12 11:05 docs(16): 术语库升级——借鉴 bilingual_term_extractor 加自动生长管线(提取→质量过滤→归一化→沉淀) |
| docs/specs/16-ai-infra/task.md | — | 不要求头注 | `180a30f` 2026-09-12 12:57 feat(ai): 16-ai-infra AI 基础设施 |
| docs/specs/17-translate/checklist.md | — | 不要求头注 | `e0365b2` 2026-09-12 13:38 feat(translate): 17-translate 翻译链完整上云 |
| docs/specs/17-translate/plan.md | — | 不要求头注 | `e0365b2` 2026-09-12 13:38 feat(translate): 17-translate 翻译链完整上云 |
| docs/specs/17-translate/spec.md | — | 不要求头注 | `e0365b2` 2026-09-12 13:38 feat(translate): 17-translate 翻译链完整上云 |
| docs/specs/17-translate/task.md | — | 不要求头注 | `e0365b2` 2026-09-12 13:38 feat(translate): 17-translate 翻译链完整上云 |
| docs/specs/18-daily-ai-v2/checklist.md | — | 不要求头注 | `c1c5847` 2026-09-13 00:17 feat(daily): 18-daily-ai-v2 AI 策展早报 |
| docs/specs/18-daily-ai-v2/plan.md | — | 不要求头注 | `c1c5847` 2026-09-13 00:17 feat(daily): 18-daily-ai-v2 AI 策展早报 |
| docs/specs/18-daily-ai-v2/spec.md | — | 不要求头注 | `c1c5847` 2026-09-13 00:17 feat(daily): 18-daily-ai-v2 AI 策展早报 |
| docs/specs/18-daily-ai-v2/task.md | — | 不要求头注 | `7fc66bc` 2026-09-20 13:20 docs(B120/B121 收口): 交付链十一条按真实退出码逐条更新，端到端验收轮 9/10 的读数与证据一并入账<br>`c1c5847` 2026-09-13 00:17 feat(daily): 18-daily-ai-v2 AI 策展早报 |
| docs/specs/19-my-brief/checklist.md | — | 不要求头注 | `2aedc6c` 2026-09-13 01:21 feat(mybrief): 19-my-brief 我的早报 |
| docs/specs/19-my-brief/plan.md | — | 不要求头注 | `dc0732a` 2026-09-21 20:35 docs(并行会话清洁轮入账)+编号归一: 作废路径指针/样图与 SPA 旧引用加注 ignore/轮转态记录补 09-21 节; dump-content 件编号 B128→B131、B129→B132(与 ISSUES 现行号对齐); lib/dirty-columns.js 半成品入库(未接线,README/FEATURE_MATRIX 措辞同步改实)<br>`2aedc6c` 2026-09-13 01:21 feat(mybrief): 19-my-brief 我的早报 |
| docs/specs/19-my-brief/spec.md | — | 不要求头注 | `2aedc6c` 2026-09-13 01:21 feat(mybrief): 19-my-brief 我的早报 |
| docs/specs/19-my-brief/task.md | — | 不要求头注 | `dc0732a` 2026-09-21 20:35 docs(并行会话清洁轮入账)+编号归一: 作废路径指针/样图与 SPA 旧引用加注 ignore/轮转态记录补 09-21 节; dump-content 件编号 B128→B131、B129→B132(与 ISSUES 现行号对齐); lib/dirty-columns.js 半成品入库(未接线,README/FEATURE_MATRIX 措辞同步改实)<br>`2aedc6c` 2026-09-13 01:21 feat(mybrief): 19-my-brief 我的早报 |
| docs/specs/20-weekly-picks/checklist.md | — | 不要求头注 | `6dd4175` 2026-09-13 02:47 feat(weekly): 20-weekly-picks 精选周刊 |
| docs/specs/20-weekly-picks/plan.md | — | 不要求头注 | `6dd4175` 2026-09-13 02:47 feat(weekly): 20-weekly-picks 精选周刊 |
| docs/specs/20-weekly-picks/spec.md | — | 不要求头注 | `6dd4175` 2026-09-13 02:47 feat(weekly): 20-weekly-picks 精选周刊 |
| docs/specs/20-weekly-picks/task.md | — | 不要求头注 | `6dd4175` 2026-09-13 02:47 feat(weekly): 20-weekly-picks 精选周刊 |
| docs/specs/21-bilibili-runner/checklist.md | — | 不要求头注 | `9c61695` 2026-09-13 03:10 feat(bilibili): 21-bilibili-runner B站采集移植 runner |
| docs/specs/21-bilibili-runner/plan.md | — | 不要求头注 | `9c61695` 2026-09-13 03:10 feat(bilibili): 21-bilibili-runner B站采集移植 runner |
| docs/specs/21-bilibili-runner/spec.md | — | 不要求头注 | `9c61695` 2026-09-13 03:10 feat(bilibili): 21-bilibili-runner B站采集移植 runner |
| docs/specs/21-bilibili-runner/task.md | — | 不要求头注 | `9c61695` 2026-09-13 03:10 feat(bilibili): 21-bilibili-runner B站采集移植 runner |
| docs/specs/22-rss-first-collection-decision.md | — | 不要求头注 | `a1d9c3b` 2026-09-13 19:44 docs: 踩坑库独立成档 + T4 追加需求 + 三份新 spec + 原定目标存续盘点 |
| docs/specs/23-information-overload-defense.md | — | 不要求头注 | `a1d9c3b` 2026-09-13 19:44 docs: 踩坑库独立成档 + T4 追加需求 + 三份新 spec + 原定目标存续盘点 |
| docs/specs/24-weekly-v2-magazine.md | — | 不要求头注 | `a1d9c3b` 2026-09-13 19:44 docs: 踩坑库独立成档 + T4 追加需求 + 三份新 spec + 原定目标存续盘点 |
| docs/specs/25-hot-redesign.md | — | 不要求头注 | `7765593` 2026-09-14 16:53 docs: 热点榜三阶段+补丁全量落档（ISSUES 傍晚批次/DELIVERY 三阶段行/NEXT-DEV-REQS T5-16/specs 25 补-8~11；HANDOVER 为本地 gitignore 文件已同步本地）<br>`1b2dc96` 2026-09-14 14:54 docs: 热点榜三阶段补丁落档（精选口径/来源下拉/分类收拢/译文标题/热度降序/AI 分组收紧） |
| docs/specs/26-platform-ia-refactor.md | — | 不要求头注 | `f7ed253` 2026-09-15 16:21 docs(T5-2): 文档同步——FEATURE_MATRIX 阅读器/后台矩阵 + NEXT-DEV-REQS T5-2/8/10 核销 + ARCHITECTURE 决策12（四轴模型）+ specs 26/27/27b/29/30 状态 + HANDOVER API 清单 + 坑#17 落档 + DELIVERY 09-15 轮 + ISSUES 挂案 H7/H8 + 测试基线 278<br>`1af8583` 2026-09-14 01:52 docs: specs/26 v2.1——源四轴语义模型（拆开 focus 四职：上架/收录/订阅/重点/屏蔽）+ 源库=精卫填海工具职责重定义 + 27b 迁移小spec |
| docs/specs/27-reader-today/spec.md | — | 不要求头注 | `f7ed253` 2026-09-15 16:21 docs(T5-2): 文档同步——FEATURE_MATRIX 阅读器/后台矩阵 + NEXT-DEV-REQS T5-2/8/10 核销 + ARCHITECTURE 决策12（四轴模型）+ specs 26/27/27b/29/30 状态 + HANDOVER API 清单 + 坑#17 落档 + DELIVERY 09-15 轮 + ISSUES 挂案 H7/H8 + 测试基线 278<br>`ca2d91a` 2026-09-14 02:13 fix(misc): 34-misc-fixes 首批六修 + specs/27~34 草案文件夹（含图片声明） |
| docs/specs/27b-source-axes/spec.md | — | 不要求头注 | `f7ed253` 2026-09-15 16:21 docs(T5-2): 文档同步——FEATURE_MATRIX 阅读器/后台矩阵 + NEXT-DEV-REQS T5-2/8/10 核销 + ARCHITECTURE 决策12（四轴模型）+ specs 26/27/27b/29/30 状态 + HANDOVER API 清单 + 坑#17 落档 + DELIVERY 09-15 轮 + ISSUES 挂案 H7/H8 + 测试基线 278<br>`ca2d91a` 2026-09-14 02:13 fix(misc): 34-misc-fixes 首批六修 + specs/27~34 草案文件夹（含图片声明） |
| docs/specs/28-hot-redesign/spec.md | — | 不要求头注 | `ca2d91a` 2026-09-14 02:13 fix(misc): 34-misc-fixes 首批六修 + specs/27~34 草案文件夹（含图片声明） |
| docs/specs/29-source-groups/spec.md | — | 不要求头注 | `f7ed253` 2026-09-15 16:21 docs(T5-2): 文档同步——FEATURE_MATRIX 阅读器/后台矩阵 + NEXT-DEV-REQS T5-2/8/10 核销 + ARCHITECTURE 决策12（四轴模型）+ specs 26/27/27b/29/30 状态 + HANDOVER API 清单 + 坑#17 落档 + DELIVERY 09-15 轮 + ISSUES 挂案 H7/H8 + 测试基线 278<br>`ca2d91a` 2026-09-14 02:13 fix(misc): 34-misc-fixes 首批六修 + specs/27~34 草案文件夹（含图片声明） |
| docs/specs/30-admin-consolidation/spec.md | — | 不要求头注 | `f7ed253` 2026-09-15 16:21 docs(T5-2): 文档同步——FEATURE_MATRIX 阅读器/后台矩阵 + NEXT-DEV-REQS T5-2/8/10 核销 + ARCHITECTURE 决策12（四轴模型）+ specs 26/27/27b/29/30 状态 + HANDOVER API 清单 + 坑#17 落档 + DELIVERY 09-15 轮 + ISSUES 挂案 H7/H8 + 测试基线 278<br>`ca2d91a` 2026-09-14 02:13 fix(misc): 34-misc-fixes 首批六修 + specs/27~34 草案文件夹（含图片声明） |
| docs/specs/31-media-playback/spec.md | — | 不要求头注 | `26775d4` 2026-09-14 22:39 docs: 媒体治理/中英对照/quickscore/源运营落档（specs/31 核销 + T5-4 完成 + HANDOVER videos v2 + DELIVERY 补三轮）<br>`ca2d91a` 2026-09-14 02:13 fix(misc): 34-misc-fixes 首批六修 + specs/27~34 草案文件夹（含图片声明） |
| docs/specs/32-content-typography/spec.md | — | 不要求头注 | `ca2d91a` 2026-09-14 02:13 fix(misc): 34-misc-fixes 首批六修 + specs/27~34 草案文件夹（含图片声明） |
| docs/specs/33-misc-fixes/spec.md | — | 不要求头注 | `ca2d91a` 2026-09-14 02:13 fix(misc): 34-misc-fixes 首批六修 + specs/27~34 草案文件夹（含图片声明） |
| docs/specs/34-misc-fixes/spec.md | — | 不要求头注 | `ca2d91a` 2026-09-14 02:13 fix(misc): 34-misc-fixes 首批六修 + specs/27~34 草案文件夹（含图片声明） |
| docs/specs/35-selfheal-admin-console/35a-selfheal-engine.md | 2026-09-18 | 不要求头注 | `ef42694` 2026-09-18 23:40 docs(governance): 文档清洁轮——底层文档逆推真值 + 六类归档规范 + 门禁脚本，并立自愈/健康度 spec 框架 |
| docs/specs/35-selfheal-admin-console/35b-source-health-data.md | 2026-09-18 | 不要求头注 | `ef42694` 2026-09-18 23:40 docs(governance): 文档清洁轮——底层文档逆推真值 + 六类归档规范 + 门禁脚本，并立自愈/健康度 spec 框架 |
| docs/specs/35-selfheal-admin-console/35c-health-frontend.md | 2026-09-18 | 不要求头注 | `ef42694` 2026-09-18 23:40 docs(governance): 文档清洁轮——底层文档逆推真值 + 六类归档规范 + 门禁脚本，并立自愈/健康度 spec 框架 |
| docs/specs/35-selfheal-admin-console/35d-admin-ia-refactor.md | 2026-09-18 | 不要求头注 | `5fa0361` 2026-09-19 01:14 docs(issues): 20 条页面批注全量实测落账——B27~B58 + 三条 P0，并立 36~41 六个域的总 spec<br>`ef42694` 2026-09-18 23:40 docs(governance): 文档清洁轮——底层文档逆推真值 + 六类归档规范 + 门禁脚本，并立自愈/健康度 spec 框架 |
| docs/specs/35-selfheal-admin-console/spec.md | 2026-09-18 | 不要求头注 | `ef42694` 2026-09-18 23:40 docs(governance): 文档清洁轮——底层文档逆推真值 + 六类归档规范 + 门禁脚本，并立自愈/健康度 spec 框架 |
| docs/specs/36-reading-semantics/36-4-cloud-video-watchback.md | 2026-09-19 | 不要求头注 | `e203f76` 2026-09-21 22:22 docs(文档洁净第二轮·核销轮): ISSUES 234→162 / NEXT-DEV-REQS 327→256,两刀均脚本切片+无损校验(97+76 行原文逐字可反查),新归档件 issues-round2-closed 与 nextdev-closed-rounds 双登记; lint 24 警→3 警(14 悬空/3 裸名/2 背景出处全清); test(L5/S6 判据口径修正): 三处断言与脏树耦合(真库必须还有违规才绿),改为相对锚+开火证明归 self-test,判据本体未动<br>`9fca3ec` 2026-09-20 07:18 docs(自洽): 白盒新判据编号统一登记（EVAL_GUIDE §4.2）+ ISSUES 顶部汇总「待放行清单」 |
| docs/specs/36-reading-semantics/36-5-read-semantics-browse-vs-done.md | 2026-09-19 | 不要求头注 | `530a5f4` 2026-09-20 07:14 docs(specs+落账): 36/37/39/40 四域小 spec 补齐（26 份）+ 叫停轮的只读取证全部落档，未 push |
| docs/specs/36-reading-semantics/36-6-reader-performance.md | 2026-09-19 | 不要求头注 | `530a5f4` 2026-09-20 07:14 docs(specs+落账): 36/37/39/40 四域小 spec 补齐（26 份）+ 叫停轮的只读取证全部落档，未 push |
| docs/specs/36-reading-semantics/36-7-source-spread-and-dedup.md | 2026-09-21 | 不要求头注 | `99ba793` 2026-09-21 05:22 feat(B107)+test(N1~N9)+feat(W18): 噪声判定收成 lib/noise.js 一份（50 处命中→0），「我的阅读」两端默认排噪声<br>`530a5f4` 2026-09-20 07:14 docs(specs+落账): 36/37/39/40 四域小 spec 补齐（26 份）+ 叫停轮的只读取证全部落档，未 push |
| docs/specs/36-reading-semantics/spec.md | 2026-09-19 | 不要求头注 | `530a5f4` 2026-09-20 07:14 docs(specs+落账): 36/37/39/40 四域小 spec 补齐（26 份）+ 叫停轮的只读取证全部落档，未 push<br>`482f76c` 2026-09-19 14:26 test(eval): 端到端引擎按实测修掉 4 类假红来源，验收轮 9/9×3 全绿；同步 B71~B75/W11~W13 与坑 #46~#49 |
| docs/specs/37-alerts-observability/37-1-p0-alert-path-restore.md | 2026-09-19 | 不要求头注 | `5e3eacb` 2026-09-20 07:59 docs(spec 背景层): 第 5 轮只读复核——父 spec 的 8 处过期实测前提，登记 B116 并加作废/收窄表<br>`530a5f4` 2026-09-20 07:14 docs(specs+落账): 36/37/39/40 四域小 spec 补齐（26 份）+ 叫停轮的只读取证全部落档，未 push |
| docs/specs/37-alerts-observability/37-2-alert-event-model-unify.md | 2026-09-21 | 不要求头注 | `4a52576` 2026-09-21 06:22 docs(B109 验收入账): 线上 /api/alerts/config 读数 + F2P 证据（V1~V7 改前红 7/7）<br>`6c9a2c7` 2026-09-21 06:20 feat(B109/B45)+test(V1~V7)+feat(W19): 报警事件表收成 lib/alert-events.js 一份，云端后台四个假开关拔掉 |
| docs/specs/37-alerts-observability/37-3-structured-alert-payload.md | 2026-09-19 | 不要求头注 | `e203f76` 2026-09-21 22:22 docs(文档洁净第二轮·核销轮): ISSUES 234→162 / NEXT-DEV-REQS 327→256,两刀均脚本切片+无损校验(97+76 行原文逐字可反查),新归档件 issues-round2-closed 与 nextdev-closed-rounds 双登记; lint 24 警→3 警(14 悬空/3 裸名/2 背景出处全清); test(L5/S6 判据口径修正): 三处断言与脏树耦合(真库必须还有违规才绿),改为相对锚+开火证明归 self-test,判据本体未动<br>`530a5f4` 2026-09-20 07:14 docs(specs+落账): 36/37/39/40 四域小 spec 补齐（26 份）+ 叫停轮的只读取证全部落档，未 push |
| docs/specs/37-alerts-observability/37-4-coverage-heartbeats.md | 2026-09-19 | 不要求头注 | `530a5f4` 2026-09-20 07:14 docs(specs+落账): 36/37/39/40 四域小 spec 补齐（26 份）+ 叫停轮的只读取证全部落档，未 push |
| docs/specs/37-alerts-observability/37-5-ci-observability.md | 2026-09-19 | 不要求头注 | `530a5f4` 2026-09-20 07:14 docs(specs+落账): 36/37/39/40 四域小 spec 补齐（26 份）+ 叫停轮的只读取证全部落档，未 push |
| docs/specs/37-alerts-observability/37-6-alerts-console-data.md | 2026-09-19 | 不要求头注 | `530a5f4` 2026-09-20 07:14 docs(specs+落账): 36/37/39/40 四域小 spec 补齐（26 份）+ 叫停轮的只读取证全部落档，未 push |
| docs/specs/37-alerts-observability/37-7-monitor-panel-fixes.md | 2026-09-19 | 不要求头注 | `530a5f4` 2026-09-20 07:14 docs(specs+落账): 36/37/39/40 四域小 spec 补齐（26 份）+ 叫停轮的只读取证全部落档，未 push |
| docs/specs/37-alerts-observability/spec.md | 2026-09-19 | 不要求头注 | `5e3eacb` 2026-09-20 07:59 docs(spec 背景层): 第 5 轮只读复核——父 spec 的 8 处过期实测前提，登记 B116 并加作废/收窄表<br>`530a5f4` 2026-09-20 07:14 docs(specs+落账): 36/37/39/40 四域小 spec 补齐（26 份）+ 叫停轮的只读取证全部落档，未 push |
| docs/specs/38-admin-ia-refactor/38-a-shell-navigation.md | 2026-09-19 | 不要求头注 | `482f76c` 2026-09-19 14:26 test(eval): 端到端引擎按实测修掉 4 类假红来源，验收轮 9/9×3 全绿；同步 B71~B75/W11~W13 与坑 #46~#49<br>`48299a8` 2026-09-19 08:29 docs(spec 38): 补齐管理后台 8 个板块的 mew-spec 小 spec，并把「板块 A~H」与「工作包 38-1~6」两套编号的关系定死 |
| docs/specs/38-admin-ia-refactor/38-b-admin-home.md | 2026-09-19 | 不要求头注 | `48299a8` 2026-09-19 08:29 docs(spec 38): 补齐管理后台 8 个板块的 mew-spec 小 spec，并把「板块 A~H」与「工作包 38-1~6」两套编号的关系定死 |
| docs/specs/38-admin-ia-refactor/38-c-source-library.md | 2026-09-19 | 不要求头注 | `48299a8` 2026-09-19 08:29 docs(spec 38): 补齐管理后台 8 个板块的 mew-spec 小 spec，并把「板块 A~H」与「工作包 38-1~6」两套编号的关系定死 |
| docs/specs/38-admin-ia-refactor/38-d-brief-center.md | 2026-09-19 | 不要求头注 | `48299a8` 2026-09-19 08:29 docs(spec 38): 补齐管理后台 8 个板块的 mew-spec 小 spec，并把「板块 A~H」与「工作包 38-1~6」两套编号的关系定死 |
| docs/specs/38-admin-ia-refactor/38-e-ai-console.md | 2026-09-19 | 不要求头注 | `48299a8` 2026-09-19 08:29 docs(spec 38): 补齐管理后台 8 个板块的 mew-spec 小 spec，并把「板块 A~H」与「工作包 38-1~6」两套编号的关系定死 |
| docs/specs/38-admin-ia-refactor/38-f-system-data.md | 2026-09-19 | 不要求头注 | `48299a8` 2026-09-19 08:29 docs(spec 38): 补齐管理后台 8 个板块的 mew-spec 小 spec，并把「板块 A~H」与「工作包 38-1~6」两套编号的关系定死 |
| docs/specs/38-admin-ia-refactor/38-g-monitor-alerts-console.md | 2026-09-19 | 不要求头注 | `48299a8` 2026-09-19 08:29 docs(spec 38): 补齐管理后台 8 个板块的 mew-spec 小 spec，并把「板块 A~H」与「工作包 38-1~6」两套编号的关系定死 |
| docs/specs/38-admin-ia-refactor/38-h-hot-curation-board.md | 2026-09-19 | 不要求头注 | `48299a8` 2026-09-19 08:29 docs(spec 38): 补齐管理后台 8 个板块的 mew-spec 小 spec，并把「板块 A~H」与「工作包 38-1~6」两套编号的关系定死 |
| docs/specs/38-admin-ia-refactor/spec.md | 2026-09-19 | 不要求头注 | `e203f76` 2026-09-21 22:22 docs(文档洁净第二轮·核销轮): ISSUES 234→162 / NEXT-DEV-REQS 327→256,两刀均脚本切片+无损校验(97+76 行原文逐字可反查),新归档件 issues-round2-closed 与 nextdev-closed-rounds 双登记; lint 24 警→3 警(14 悬空/3 裸名/2 背景出处全清); test(L5/S6 判据口径修正): 三处断言与脏树耦合(真库必须还有违规才绿),改为相对锚+开火证明归 self-test,判据本体未动<br>`df208cd` 2026-09-19 19:15 docs(issues,specs): 登记 B84/B85 两条批注缺陷，并把 38 域 spec 标为已批准（09-19 用户点头） |
| docs/specs/39-ai-console/39-1-ai-config-write-guard.md | 2026-09-19 | 不要求头注 | `3f48831` 2026-09-19 09:34 docs(spec 39-1): 出 AI 配置写回守卫的小 spec，并记下 B68「裁决改了但实现只改一半」 |
| docs/specs/39-ai-console/39-2-dead-code-audit.md | 2026-09-19 | 不要求头注 | `530a5f4` 2026-09-20 07:14 docs(specs+落账): 36/37/39/40 四域小 spec 补齐（26 份）+ 叫停轮的只读取证全部落档，未 push |
| docs/specs/39-ai-console/39-3-models-and-ping.md | 2026-09-19 | 不要求头注 | `e203f76` 2026-09-21 22:22 docs(文档洁净第二轮·核销轮): ISSUES 234→162 / NEXT-DEV-REQS 327→256,两刀均脚本切片+无损校验(97+76 行原文逐字可反查),新归档件 issues-round2-closed 与 nextdev-closed-rounds 双登记; lint 24 警→3 警(14 悬空/3 裸名/2 背景出处全清); test(L5/S6 判据口径修正): 三处断言与脏树耦合(真库必须还有违规才绿),改为相对锚+开火证明归 self-test,判据本体未动<br>`530a5f4` 2026-09-20 07:14 docs(specs+落账): 36/37/39/40 四域小 spec 补齐（26 份）+ 叫停轮的只读取证全部落档，未 push |
| docs/specs/39-ai-console/39-4-ai-run-console.md | 2026-09-19 | 不要求头注 | `530a5f4` 2026-09-20 07:14 docs(specs+落账): 36/37/39/40 四域小 spec 补齐（26 份）+ 叫停轮的只读取证全部落档，未 push |
| docs/specs/39-ai-console/39-5-real-control-points.md | 2026-09-19 | 不要求头注 | `530a5f4` 2026-09-20 07:14 docs(specs+落账): 36/37/39/40 四域小 spec 补齐（26 份）+ 叫停轮的只读取证全部落档，未 push |
| docs/specs/39-ai-console/39-6-translate-prompt-single-source.md | 2026-09-19 | 不要求头注 | `24e76bf` 2026-09-21 07:15 feat(B111/39-6)+test(PR1~PR7)+feat(W20)+坑#71: 翻译 prompt 收成 lib/ai-prompts.js 一份，三种键名归一<br>`530a5f4` 2026-09-20 07:14 docs(specs+落账): 36/37/39/40 四域小 spec 补齐（26 份）+ 叫停轮的只读取证全部落档，未 push |
| docs/specs/39-ai-console/39-7-non-ai-feature-rename.md | 2026-09-19 | 不要求头注 | `530a5f4` 2026-09-20 07:14 docs(specs+落账): 36/37/39/40 四域小 spec 补齐（26 份）+ 叫停轮的只读取证全部落档，未 push |
| docs/specs/39-ai-console/spec.md | 2026-09-19 | 不要求头注 | `530a5f4` 2026-09-20 07:14 docs(specs+落账): 36/37/39/40 四域小 spec 补齐（26 份）+ 叫停轮的只读取证全部落档，未 push<br>`3f48831` 2026-09-19 09:34 docs(spec 39-1): 出 AI 配置写回守卫的小 spec，并记下 B68「裁决改了但实现只改一半」 |
| docs/specs/40-brief-center-products/40-1-brief-history-audit.md | 2026-09-19 | 不要求头注 | `467d10c` 2026-09-21 06:43 fix(B112)+test(Q1~Q5)+坑#70: 日报档位字段写入侧统一为整数常量，判据并进 W14<br>`530a5f4` 2026-09-20 07:14 docs(specs+落账): 36/37/39/40 四域小 spec 补齐（26 份）+ 叫停轮的只读取证全部落档，未 push |
| docs/specs/40-brief-center-products/40-2-weekly-archive-slim.md | 2026-09-19 | 不要求头注 | `530a5f4` 2026-09-20 07:14 docs(specs+落账): 36/37/39/40 四域小 spec 补齐（26 份）+ 叫停轮的只读取证全部落档，未 push |
| docs/specs/40-brief-center-products/40-3-issue-window-dedup.md | 2026-09-19 | 不要求头注 | `e203f76` 2026-09-21 22:22 docs(文档洁净第二轮·核销轮): ISSUES 234→162 / NEXT-DEV-REQS 327→256,两刀均脚本切片+无损校验(97+76 行原文逐字可反查),新归档件 issues-round2-closed 与 nextdev-closed-rounds 双登记; lint 24 警→3 警(14 悬空/3 裸名/2 背景出处全清); test(L5/S6 判据口径修正): 三处断言与脏树耦合(真库必须还有违规才绿),改为相对锚+开火证明归 self-test,判据本体未动<br>`530a5f4` 2026-09-20 07:14 docs(specs+落账): 36/37/39/40 四域小 spec 补齐（26 份）+ 叫停轮的只读取证全部落档，未 push |
| docs/specs/40-brief-center-products/40-4-mybrief-issues-archive.md | 2026-09-19 | 不要求头注 | `e203f76` 2026-09-21 22:22 docs(文档洁净第二轮·核销轮): ISSUES 234→162 / NEXT-DEV-REQS 327→256,两刀均脚本切片+无损校验(97+76 行原文逐字可反查),新归档件 issues-round2-closed 与 nextdev-closed-rounds 双登记; lint 24 警→3 警(14 悬空/3 裸名/2 背景出处全清); test(L5/S6 判据口径修正): 三处断言与脏树耦合(真库必须还有违规才绿),改为相对锚+开火证明归 self-test,判据本体未动<br>`530a5f4` 2026-09-20 07:14 docs(specs+落账): 36/37/39/40 四域小 spec 补齐（26 份）+ 叫停轮的只读取证全部落档，未 push |
| docs/specs/40-brief-center-products/40-5-subscription-axis-naming.md | 2026-09-19 | 不要求头注 | `530a5f4` 2026-09-20 07:14 docs(specs+落账): 36/37/39/40 四域小 spec 补齐（26 份）+ 叫停轮的只读取证全部落档，未 push |
| docs/specs/40-brief-center-products/40-6-domain-quotas.md | 2026-09-19 | 不要求头注 | `e203f76` 2026-09-21 22:22 docs(文档洁净第二轮·核销轮): ISSUES 234→162 / NEXT-DEV-REQS 327→256,两刀均脚本切片+无损校验(97+76 行原文逐字可反查),新归档件 issues-round2-closed 与 nextdev-closed-rounds 双登记; lint 24 警→3 警(14 悬空/3 裸名/2 背景出处全清); test(L5/S6 判据口径修正): 三处断言与脏树耦合(真库必须还有违规才绿),改为相对锚+开火证明归 self-test,判据本体未动<br>`530a5f4` 2026-09-20 07:14 docs(specs+落账): 36/37/39/40 四域小 spec 补齐（26 份）+ 叫停轮的只读取证全部落档，未 push |
| docs/specs/40-brief-center-products/40-7-columns-vs-ai-domains.md | 2026-09-19 | 不要求头注 | `530a5f4` 2026-09-20 07:14 docs(specs+落账): 36/37/39/40 四域小 spec 补齐（26 份）+ 叫停轮的只读取证全部落档，未 push |
| docs/specs/40-brief-center-products/40-8-dirty-data-correction.md | 2026-09-19 | 不要求头注 | `467d10c` 2026-09-21 06:43 fix(B112)+test(Q1~Q5)+坑#70: 日报档位字段写入侧统一为整数常量，判据并进 W14<br>`530a5f4` 2026-09-20 07:14 docs(specs+落账): 36/37/39/40 四域小 spec 补齐（26 份）+ 叫停轮的只读取证全部落档，未 push |
| docs/specs/40-brief-center-products/spec.md | 2026-09-19 | 不要求头注 | `5e3eacb` 2026-09-20 07:59 docs(spec 背景层): 第 5 轮只读复核——父 spec 的 8 处过期实测前提，登记 B116 并加作废/收窄表<br>`530a5f4` 2026-09-20 07:14 docs(specs+落账): 36/37/39/40 四域小 spec 补齐（26 份）+ 叫停轮的只读取证全部落档，未 push |
| docs/specs/41-e2e-whitebox-eval/41-7-process-binary-checks.md | 2026-09-19 | 不要求头注 | `5aa8118` 2026-09-19 03:41 fix(reading): 修 B60/B61——同一分类判定全库 6 份手写副本收敛为 1 份，白盒新增 W10 判重 |
| docs/specs/41-e2e-whitebox-eval/coverage-matrix-20260919.md | — | 不要求头注 | `d5a66a4` 2026-09-20 07:23 docs(评测覆盖): 手工核对的 e2e 功能格矩阵（39 格 ✅3/◐8/⛔28），并撤销对 knownGaps 的过度解读 |
| docs/specs/41-e2e-whitebox-eval/spec.md | 2026-09-19 | 不要求头注 | `912c13e` 2026-09-20 07:40 docs(取证对账): 新登记 B114——文档里的 F2P 红/绿条数与证据 JSON 不符，改为逐份证据对账表<br>`d5a66a4` 2026-09-20 07:23 docs(评测覆盖): 手工核对的 e2e 功能格矩阵（39 格 ✅3/◐8/⛔28），并撤销对 knownGaps 的过度解读 |
| docs/specs/42-full-audit-2026-09/handoff-notice.md | 2026-09-19 | 不要求头注 | `f6cd1e4` 2026-09-21 20:39 docs(spec42 冻结入账)+test(AU-2): 全量审计轮按用户 09-21 否决冻结,spec/handoff-notice/quarantine(可达图与目录索引工具、13 份目录 README)与 _diag 取证件入库存档;门户通道默认关的回归锁正式入库 |
| docs/specs/42-full-audit-2026-09/quarantine/api/README.md | — | 不要求头注 | `f6cd1e4` 2026-09-21 20:39 docs(spec42 冻结入账)+test(AU-2): 全量审计轮按用户 09-21 否决冻结,spec/handoff-notice/quarantine(可达图与目录索引工具、13 份目录 README)与 _diag 取证件入库存档;门户通道默认关的回归锁正式入库 |
| docs/specs/42-full-audit-2026-09/quarantine/archive/README.md | — | 不要求头注 | `f6cd1e4` 2026-09-21 20:39 docs(spec42 冻结入账)+test(AU-2): 全量审计轮按用户 09-21 否决冻结,spec/handoff-notice/quarantine(可达图与目录索引工具、13 份目录 README)与 _diag 取证件入库存档;门户通道默认关的回归锁正式入库 |
| docs/specs/42-full-audit-2026-09/quarantine/cloud/README.md | — | 不要求头注 | `f6cd1e4` 2026-09-21 20:39 docs(spec42 冻结入账)+test(AU-2): 全量审计轮按用户 09-21 否决冻结,spec/handoff-notice/quarantine(可达图与目录索引工具、13 份目录 README)与 _diag 取证件入库存档;门户通道默认关的回归锁正式入库 |
| docs/specs/42-full-audit-2026-09/quarantine/MANIFEST.md | — | 不要求头注 | `e203f76` 2026-09-21 22:22 docs(文档洁净第二轮·核销轮): ISSUES 234→162 / NEXT-DEV-REQS 327→256,两刀均脚本切片+无损校验(97+76 行原文逐字可反查),新归档件 issues-round2-closed 与 nextdev-closed-rounds 双登记; lint 24 警→3 警(14 悬空/3 裸名/2 背景出处全清); test(L5/S6 判据口径修正): 三处断言与脏树耦合(真库必须还有违规才绿),改为相对锚+开火证明归 self-test,判据本体未动<br>`f6cd1e4` 2026-09-21 20:39 docs(spec42 冻结入账)+test(AU-2): 全量审计轮按用户 09-21 否决冻结,spec/handoff-notice/quarantine(可达图与目录索引工具、13 份目录 README)与 _diag 取证件入库存档;门户通道默认关的回归锁正式入库 |
| docs/specs/42-full-audit-2026-09/quarantine/opml/README.md | — | 不要求头注 | `f6cd1e4` 2026-09-21 20:39 docs(spec42 冻结入账)+test(AU-2): 全量审计轮按用户 09-21 否决冻结,spec/handoff-notice/quarantine(可达图与目录索引工具、13 份目录 README)与 _diag 取证件入库存档;门户通道默认关的回归锁正式入库 |
| docs/specs/42-full-audit-2026-09/quarantine/server/README.md | — | 不要求头注 | `e203f76` 2026-09-21 22:22 docs(文档洁净第二轮·核销轮): ISSUES 234→162 / NEXT-DEV-REQS 327→256,两刀均脚本切片+无损校验(97+76 行原文逐字可反查),新归档件 issues-round2-closed 与 nextdev-closed-rounds 双登记; lint 24 警→3 警(14 悬空/3 裸名/2 背景出处全清); test(L5/S6 判据口径修正): 三处断言与脏树耦合(真库必须还有违规才绿),改为相对锚+开火证明归 self-test,判据本体未动<br>`f6cd1e4` 2026-09-21 20:39 docs(spec42 冻结入账)+test(AU-2): 全量审计轮按用户 09-21 否决冻结,spec/handoff-notice/quarantine(可达图与目录索引工具、13 份目录 README)与 _diag 取证件入库存档;门户通道默认关的回归锁正式入库 |
| docs/specs/42-full-audit-2026-09/quarantine/server/routes/README.md | — | 不要求头注 | `f6cd1e4` 2026-09-21 20:39 docs(spec42 冻结入账)+test(AU-2): 全量审计轮按用户 09-21 否决冻结,spec/handoff-notice/quarantine(可达图与目录索引工具、13 份目录 README)与 _diag 取证件入库存档;门户通道默认关的回归锁正式入库 |
| docs/specs/42-full-audit-2026-09/quarantine/server/services/collectors/README.md | — | 不要求头注 | `e203f76` 2026-09-21 22:22 docs(文档洁净第二轮·核销轮): ISSUES 234→162 / NEXT-DEV-REQS 327→256,两刀均脚本切片+无损校验(97+76 行原文逐字可反查),新归档件 issues-round2-closed 与 nextdev-closed-rounds 双登记; lint 24 警→3 警(14 悬空/3 裸名/2 背景出处全清); test(L5/S6 判据口径修正): 三处断言与脏树耦合(真库必须还有违规才绿),改为相对锚+开火证明归 self-test,判据本体未动<br>`f6cd1e4` 2026-09-21 20:39 docs(spec42 冻结入账)+test(AU-2): 全量审计轮按用户 09-21 否决冻结,spec/handoff-notice/quarantine(可达图与目录索引工具、13 份目录 README)与 _diag 取证件入库存档;门户通道默认关的回归锁正式入库 |
| docs/specs/42-full-audit-2026-09/quarantine/server/services/README.md | — | 不要求头注 | `e203f76` 2026-09-21 22:22 docs(文档洁净第二轮·核销轮): ISSUES 234→162 / NEXT-DEV-REQS 327→256,两刀均脚本切片+无损校验(97+76 行原文逐字可反查),新归档件 issues-round2-closed 与 nextdev-closed-rounds 双登记; lint 24 警→3 警(14 悬空/3 裸名/2 背景出处全清); test(L5/S6 判据口径修正): 三处断言与脏树耦合(真库必须还有违规才绿),改为相对锚+开火证明归 self-test,判据本体未动<br>`f6cd1e4` 2026-09-21 20:39 docs(spec42 冻结入账)+test(AU-2): 全量审计轮按用户 09-21 否决冻结,spec/handoff-notice/quarantine(可达图与目录索引工具、13 份目录 README)与 _diag 取证件入库存档;门户通道默认关的回归锁正式入库 |
| docs/specs/42-full-audit-2026-09/quarantine/tests/README.md | — | 不要求头注 | `f6cd1e4` 2026-09-21 20:39 docs(spec42 冻结入账)+test(AU-2): 全量审计轮按用户 09-21 否决冻结,spec/handoff-notice/quarantine(可达图与目录索引工具、13 份目录 README)与 _diag 取证件入库存档;门户通道默认关的回归锁正式入库 |
| docs/specs/42-full-audit-2026-09/quarantine/tools/README.md | — | 不要求头注 | `e203f76` 2026-09-21 22:22 docs(文档洁净第二轮·核销轮): ISSUES 234→162 / NEXT-DEV-REQS 327→256,两刀均脚本切片+无损校验(97+76 行原文逐字可反查),新归档件 issues-round2-closed 与 nextdev-closed-rounds 双登记; lint 24 警→3 警(14 悬空/3 裸名/2 背景出处全清); test(L5/S6 判据口径修正): 三处断言与脏树耦合(真库必须还有违规才绿),改为相对锚+开火证明归 self-test,判据本体未动<br>`f6cd1e4` 2026-09-21 20:39 docs(spec42 冻结入账)+test(AU-2): 全量审计轮按用户 09-21 否决冻结,spec/handoff-notice/quarantine(可达图与目录索引工具、13 份目录 README)与 _diag 取证件入库存档;门户通道默认关的回归锁正式入库 |
| docs/specs/42-full-audit-2026-09/quarantine/web/README.md | — | 不要求头注 | `f6cd1e4` 2026-09-21 20:39 docs(spec42 冻结入账)+test(AU-2): 全量审计轮按用户 09-21 否决冻结,spec/handoff-notice/quarantine(可达图与目录索引工具、13 份目录 README)与 _diag 取证件入库存档;门户通道默认关的回归锁正式入库 |
| docs/specs/42-full-audit-2026-09/quarantine/web/src/components/README.md | — | 不要求头注 | `f6cd1e4` 2026-09-21 20:39 docs(spec42 冻结入账)+test(AU-2): 全量审计轮按用户 09-21 否决冻结,spec/handoff-notice/quarantine(可达图与目录索引工具、13 份目录 README)与 _diag 取证件入库存档;门户通道默认关的回归锁正式入库 |
| docs/specs/42-full-audit-2026-09/spec.md | — | 不要求头注 | `e203f76` 2026-09-21 22:22 docs(文档洁净第二轮·核销轮): ISSUES 234→162 / NEXT-DEV-REQS 327→256,两刀均脚本切片+无损校验(97+76 行原文逐字可反查),新归档件 issues-round2-closed 与 nextdev-closed-rounds 双登记; lint 24 警→3 警(14 悬空/3 裸名/2 背景出处全清); test(L5/S6 判据口径修正): 三处断言与脏树耦合(真库必须还有违规才绿),改为相对锚+开火证明归 self-test,判据本体未动<br>`2dd6808` 2026-09-21 03:03 feat(门禁扩面)+test(L1~L4): doc-lint 加 5 条判据并给它做双向自证 —— 编号撞号那条是本轮自己咬出来的 |
| docs/specs/43-collect-retention-safety/spec.md | — | 不要求头注 | `e203f76` 2026-09-21 22:22 docs(文档洁净第二轮·核销轮): ISSUES 234→162 / NEXT-DEV-REQS 327→256,两刀均脚本切片+无损校验(97+76 行原文逐字可反查),新归档件 issues-round2-closed 与 nextdev-closed-rounds 双登记; lint 24 警→3 警(14 悬空/3 裸名/2 背景出处全清); test(L5/S6 判据口径修正): 三处断言与脏树耦合(真库必须还有违规才绿),改为相对锚+开火证明归 self-test,判据本体未动<br>`dc0732a` 2026-09-21 20:35 docs(并行会话清洁轮入账)+编号归一: 作废路径指针/样图与 SPA 旧引用加注 ignore/轮转态记录补 09-21 节; dump-content 件编号 B128→B131、B129→B132(与 ISSUES 现行号对齐); lib/dirty-columns.js 半成品入库(未接线,README/FEATURE_MATRIX 措辞同步改实) |
| docs/specs/P1-12-401-handling-fix.md | — | 不要求头注 | `fb3bc95` 2026-09-09 21:24 fix(P0-1,P0-3,P0-7,P1-12): 阅读沉淀页数据+热点榜筛选+全部已读+401处理 |
| lib/README.md | — | 不要求头注 | `dc0732a` 2026-09-21 20:35 docs(并行会话清洁轮入账)+编号归一: 作废路径指针/样图与 SPA 旧引用加注 ignore/轮转态记录补 09-21 节; dump-content 件编号 B128→B131、B129→B132(与 ISSUES 现行号对齐); lib/dirty-columns.js 半成品入库(未接线,README/FEATURE_MATRIX 措辞同步改实)<br>`5695874` 2026-09-20 23:08 fix(#65 之后第 3 条)+test(B102): 删除/保留谓词收进 lib/retention.js 一份，本地不再删内容 |
| memory/2026-09-02.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| memory/README.md | — | 不要求头注 | `2a13808` 2026-09-20 16:32 docs(B120 收口 + B123): runner 侧证据按坑 #68 补齐，页头写死"关键词规则排序"另立一条 |
| opml/BestBlogs_RSS_Doc.md | — | 不要求头注 | `4d7fc7c` 2026-09-21 20:50 chore(资产入账): opml/ 18 份订阅源清单(DEV_GUIDE/HANDOVER/NEXT-DEV-REQS 与 spec 09 已引用)与 archive/样图 两个设计参考目录(周报页面设计/热点榜)入库,消除工作区悬浮件 |
| prompts/daily-analyze.md | — | 不要求头注 | `c1c5847` 2026-09-13 00:17 feat(daily): 18-daily-ai-v2 AI 策展早报 |
| prompts/daily-theme.md | — | 不要求头注 | `c1c5847` 2026-09-13 00:17 feat(daily): 18-daily-ai-v2 AI 策展早报 |
| prompts/filter.md | — | 不要求头注 | `9a287ae` 2026-09-13 23:14 feat(defense): T4-2 R4 七层防御入报——L3 配额/L4 广告降权/L5 权威加权+低曝光保护位/L6 MMR（阻塞清单第 5 批续，specs/23 L2-L6 完成）<br>`180a30f` 2026-09-12 12:57 feat(ai): 16-ai-infra AI 基础设施 |
| prompts/README.md | — | 不要求头注 | `24e76bf` 2026-09-21 07:15 feat(B111/39-6)+test(PR1~PR7)+feat(W20)+坑#71: 翻译 prompt 收成 lib/ai-prompts.js 一份，三种键名归一<br>`2a13808` 2026-09-20 16:32 docs(B120 收口 + B123): runner 侧证据按坑 #68 补齐，页头写死"关键词规则排序"另立一条 |
| prompts/term-extract.md | — | 不要求头注 | `180a30f` 2026-09-12 12:57 feat(ai): 16-ai-infra AI 基础设施 |
| prompts/translate-polish.md | — | 不要求头注 | `e0365b2` 2026-09-12 13:38 feat(translate): 17-translate 翻译链完整上云 |
| prompts/translate-refine.md | — | 不要求头注 | `e0365b2` 2026-09-12 13:38 feat(translate): 17-translate 翻译链完整上云 |
| prompts/translate-skill.md | — | 不要求头注 | `24e76bf` 2026-09-21 07:15 feat(B111/39-6)+test(PR1~PR7)+feat(W20)+坑#71: 翻译 prompt 收成 lib/ai-prompts.js 一份，三种键名归一 |
| prompts/translate.md | — | 不要求头注 | `180a30f` 2026-09-12 12:57 feat(ai): 16-ai-infra AI 基础设施 |
| scripts/README.md | — | 不要求头注 | `2a13808` 2026-09-20 16:32 docs(B120 收口 + B123): runner 侧证据按坑 #68 补齐，页头写死"关键词规则排序"另立一条 |
| tools/快速启动.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| web/src/README.md | — | 不要求头注 | `2a13808` 2026-09-20 16:32 docs(B120 收口 + B123): runner 侧证据按坑 #68 补齐，页头写死"关键词规则排序"另立一条 |

