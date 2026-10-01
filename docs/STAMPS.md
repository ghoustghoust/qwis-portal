# 文档改动戳（机器生成，勿手改）

> 由 `node tools/doc-stamp.cjs` 生成；规则见 `docs/DOC_GOVERNANCE.md` §2.6。
> **每格都是已提交的历史事实**，所以本表不含"生成时间"——那会让自己每次重跑都产生一条无意义 diff。
> 判定列的语义：`一致` = 头部日期 == 最近提交日；`待判` = 头部比最近提交旧，**可能是真过时，也可能那次提交只是改头注/改错字**（本表把提交主题列出来就是为了让人一眼分辨，机器不替人判）；`头部超前` = 写了尚未提交的日期（提交前出现它是正常态，已 push 仍超前才是硬伤）；`⚠` = 工作区还有未提交改动。
> 已知局限：① 本表按路径查历史，**文件改名/搬家前的历史不跟随**（`--follow` 只能逐文件跑），搬过的文档其提交史从搬家那次起算。② 本表读已提交历史，**正在提交的这一次必然不进表**（显式滞后一轮，配合 `⚠` 可见），下一轮重跑即补上。
> 未跟踪件不入表：如本地文件 `docs/HANDOVER.md` 按设计永不提交，本就没有提交史可记。

**统计**：底层文档 一致 11 · 待判 2 · 头部超前 1 · 缺头注 0　|　不要求头注 139 份　|　工作区未提交 109 份　|　总计 153 份

### 底层文档（DOC_GOVERNANCE §2.1 白名单，列最近 3 次改动）（14 份）

| 文档 | 头部声明 | 判定 | 提交史（短号 · 日期 时:分 · 主题） |
|---|---|---|---|
| AGENTS.md | 2026-09-26 | 头部超前 ⚠ | `2be039d` 2026-09-25 18:47 docs(模块地图改三层 + 有效性判定清单): 地图按「域>模块>子模块」重建并挂有效性指针；新增 DOC_VALIDITY_LEDGER 承载条目级裁决<br>`1128d72` 2026-09-23 20:30 docs(交付链重订+B136+BL13 核销): ①AGENTS §3 用户重订——eval 各命令降级按需工具(自评卷+未稳立锁=门禁分不出世界变了与作弊),新链=npm test→push→ci+Actions→云端实测→冒烟→对抗审查→文档同步,锁纪律三条(diff 带 why/红了报用户三选一/不许自消);EVAL_GUIDE+FEATURE_MATRIX+CLOUD_PIPELINE 同步暂缓头注 ②ISSUES:B136 cron-job 8430047 死 PAT 连跪 09-20 起停用(全天 2 轮/370 源到期),BL13 核销出账,B121 复验改探针 ③FEATURE_MATRIX §1.5 测试 604→609+如实更正 0 红误记,push-CI 缺口核销 ④ARCHITECTURE §3.6 双保险暂按一档读 ⑤INDEX 登记 RSS 设计文档(1)与交接文档,交接文档补三个裁定与交付进展 ⑥STAMPS 刷新;lint:docs 0 错 2 警 EXIT=0<br>`aab5f4e` 2026-09-23 19:56 docs(specs 35~43 整批作废)+chore(死引用清理): 用户裁定删除 65 份(前朝剑不斩本朝官,锚点 tree 065e1632 落 ISSUES);12 处源码/文档同步(原 spec 引用改指 ISSUES 锚点,DOC_GOVERNANCE §2.2 补整批作废三前置,ARCHITECTURE §1 清理加注被 09-23 实测推翻改写,FEATURE_MATRIX 544→604);登记 RSS 设计文档(1)(权威版)与 09-23 交接文档 |
| ARCHITECTURE.md | 2026-09-27 | 待判 ⚠ | `12c8a6f` 2026-09-29 23:41 docs(README 去 11 条死图引用, 快照与专栏叫法一名一物, 删 09-25 交接件)<br>`a840704` 2026-09-29 16:51 docs(ADR-24 建件 + 三条规矩归位开发规范, 需求队列只留需求)<br>`759a669` 2026-09-29 10:30 docs(用户两裁落地: ADR-23 建件 + 域名定性进治理, 两条已裁账离开待表) |
| docs/CLOUD_PIPELINE_GUIDE.md | 2026-09-28 | 一致 ⚠ | `3f2adc0` 2026-09-28 20:19 docs(波1 链路指南重写: 324行→225行, 行号锚与一次性读数清零, 决策改挂 ADR 号)<br>`076aaf2` 2026-09-27 21:41 docs(判定台账退役前置: 已判决结论全部归位活文档, 地图 21 个 V 号改内联): 台账先提交保全, 下一步删<br>`2be8690` 2026-09-25 14:10 docs(按 09-25 裁决清除过去文档): 作废即删 + 摘掉全部归档指针 + 订正 17 处与实现相反的陈述 |
| docs/DELIVERY_VERIFICATION.md | 2026-09-18 | 待判 | `12c8a6f` 2026-09-29 23:41 docs(README 去 11 条死图引用, 快照与专栏叫法一名一物, 删 09-25 交接件)<br>`d5dee49` 2026-09-29 10:44 docs(波3 大半收口: 运维手册重排 171→132 行, 交付手册删实战案例节, 评测指南摘门禁语气)<br>`73147de` 2026-09-21 04:27 feat(B113/B110)+test(S1~S8)+坑#69: 凭据卫生收成一份共享实现，密钥扫描面从"只已跟踪"扩成两面 |
| docs/DEV_GUIDE.md | 2026-09-29 | 一致 ⚠ | `d6f591a` 2026-09-29 11:06 docs(波4: 开发规范摘掉自相矛盾的双实现条款, 上手指南收成"去哪份文档", 地图欠账挂号 T3-8)<br>`076aaf2` 2026-09-27 21:41 docs(判定台账退役前置: 已判决结论全部归位活文档, 地图 21 个 V 号改内联): 台账先提交保全, 下一步删<br>`2be039d` 2026-09-25 18:47 docs(模块地图改三层 + 有效性判定清单): 地图按「域>模块>子模块」重建并挂有效性指针；新增 DOC_VALIDITY_LEDGER 承载条目级裁决 |
| docs/DEVELOPMENT_STANDARDS.md | 2026-09-29 | 一致 ⚠ | `a840704` 2026-09-29 16:51 docs(ADR-24 建件 + 三条规矩归位开发规范, 需求队列只留需求)<br>`d6f591a` 2026-09-29 11:06 docs(波4: 开发规范摘掉自相矛盾的双实现条款, 上手指南收成"去哪份文档", 地图欠账挂号 T3-8)<br>`076aaf2` 2026-09-27 21:41 docs(判定台账退役前置: 已判决结论全部归位活文档, 地图 21 个 V 号改内联): 台账先提交保全, 下一步删 |
| docs/DOC_GOVERNANCE.md | 2026-09-30 | 一致 ⚠ | `928d57c` 2026-09-30 15:12 docs(ADR-24 之后收尾: 判据统一成"不要行号与函数名", 文本与门禁同批改)<br>`a58691d` 2026-09-29 15:19 docs(评测指南按口径层重写 46.5KB→约12KB): 铲掉对 tools/tests 源码的复读<br>`759a669` 2026-09-29 10:30 docs(用户两裁落地: ADR-23 建件 + 域名定性进治理, 两条已裁账离开待表) |
| docs/EVAL_GUIDE.md | 2026-09-29 | 一致 ⚠ | `12c8a6f` 2026-09-29 23:41 docs(README 去 11 条死图引用, 快照与专栏叫法一名一物, 删 09-25 交接件)<br>`93256fc` 2026-09-29 15:21 docs(评测指南措辞让门禁别再咬自己): 取证那条改成不报读数的写法<br>`a58691d` 2026-09-29 15:19 docs(评测指南按口径层重写 46.5KB→约12KB): 铲掉对 tools/tests 源码的复读 |
| docs/FEATURE_MATRIX.md | 2026-09-30 | 一致 ⚠ | `928d57c` 2026-09-30 15:12 docs(ADR-24 之后收尾: 判据统一成"不要行号与函数名", 文本与门禁同批改)<br>`7ebead7` 2026-09-30 13:31 docs(T3-8 履行完: 按域合并的四份功能文档建成, 地图待建行归零)<br>`12c8a6f` 2026-09-29 23:41 docs(README 去 11 条死图引用, 快照与专栏叫法一名一物, 删 09-25 交接件) |
| docs/INDEX.md | 2026-09-30 | 一致 ⚠ | `928d57c` 2026-09-30 15:12 docs(ADR-24 之后收尾: 判据统一成"不要行号与函数名", 文本与门禁同批改)<br>`7ebead7` 2026-09-30 13:31 docs(T3-8 履行完: 按域合并的四份功能文档建成, 地图待建行归零)<br>`12c8a6f` 2026-09-29 23:41 docs(README 去 11 条死图引用, 快照与专栏叫法一名一物, 删 09-25 交接件) |
| docs/ISSUES.md | 2026-09-30 | 一致 ⚠ | `928d57c` 2026-09-30 15:12 docs(ADR-24 之后收尾: 判据统一成"不要行号与函数名", 文本与门禁同批改)<br>`7ebead7` 2026-09-30 13:31 docs(T3-8 履行完: 按域合并的四份功能文档建成, 地图待建行归零)<br>`12c8a6f` 2026-09-29 23:41 docs(README 去 11 条死图引用, 快照与专栏叫法一名一物, 删 09-25 交接件) |
| docs/NEXT-DEV-REQS.md | 2026-09-30 | 一致 | `928d57c` 2026-09-30 15:12 docs(ADR-24 之后收尾: 判据统一成"不要行号与函数名", 文本与门禁同批改)<br>`7ebead7` 2026-09-30 13:31 docs(T3-8 履行完: 按域合并的四份功能文档建成, 地图待建行归零)<br>`12c8a6f` 2026-09-29 23:41 docs(README 去 11 条死图引用, 快照与专栏叫法一名一物, 删 09-25 交接件) |
| docs/RUNBOOK.md | 2026-09-30 | 一致 | `928d57c` 2026-09-30 15:12 docs(ADR-24 之后收尾: 判据统一成"不要行号与函数名", 文本与门禁同批改)<br>`7ebead7` 2026-09-30 13:31 docs(T3-8 履行完: 按域合并的四份功能文档建成, 地图待建行归零)<br>`12c8a6f` 2026-09-29 23:41 docs(README 去 11 条死图引用, 快照与专栏叫法一名一物, 删 09-25 交接件) |
| README.md | 2026-09-29 | 一致 ⚠ | `12c8a6f` 2026-09-29 23:41 docs(README 去 11 条死图引用, 快照与专栏叫法一名一物, 删 09-25 交接件)<br>`ef42694` 2026-09-18 23:40 docs(governance): 文档清洁轮——底层文档逆推真值 + 六类归档规范 + 门禁脚本，并立自愈/健康度 spec 框架<br>`1f2f253` 2026-09-16 18:40 docs(screenshots): 替换用户提供的 4 张截图 + 热点榜拆为 AI精选/AI实时流/热搜事件 三栏展示 |

### 其余受管文档（列最近 2 次）（139 份）

| 文档 | 头部声明 | 判定 | 提交史（短号 · 日期 时:分 · 主题） |
|---|---|---|---|
| .cluster/expert-playbook.md | — | 不要求头注 | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| config/README.md | — | 不要求头注 | `2a13808` 2026-09-20 16:32 docs(B120 收口 + B123): runner 侧证据按坑 #68 补齐，页头写死"关键词规则排序"另立一条 |
| docs/adr/01-部署方向.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/adr/02-采集只在服务端做.md | — | 不要求头注 ⚠ | `03fd77a` 2026-09-28 20:04 docs(波0 收口: ADR-17~22 建件 + 五件补边界, 台账残留指针摘净)<br>`4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/adr/03-公众号走托管RSS.md | — | 不要求头注 ⚠ | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/adr/04-云端API收在一个函数.md | — | 不要求头注 | `03fd77a` 2026-09-28 20:04 docs(波0 收口: ADR-17~22 建件 + 五件补边界, 台账残留指针摘净)<br>`4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/adr/05-不做读路径兜底.md | — | 不要求头注 | `03fd77a` 2026-09-28 20:04 docs(波0 收口: ADR-17~22 建件 + 五件补边界, 台账残留指针摘净)<br>`4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/adr/06-前端刷新走轮询.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/adr/07-批量操作走单条SQL.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/adr/08-源状态拆多轴.md | — | 不要求头注 ⚠ | `a840704` 2026-09-29 16:51 docs(ADR-24 建件 + 三条规矩归位开发规范, 需求队列只留需求)<br>`4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/adr/09-进模型前按源限量.md | — | 不要求头注 | `a840704` 2026-09-29 16:51 docs(ADR-24 建件 + 三条规矩归位开发规范, 需求队列只留需求)<br>`4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/adr/10-三套队列不并成一套.md | — | 不要求头注 ⚠ | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/adr/11-不做多用户与权限分级.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/adr/12-凭据一套口径.md | — | 不要求头注 | `03fd77a` 2026-09-28 20:04 docs(波0 收口: ADR-17~22 建件 + 五件补边界, 台账残留指针摘净)<br>`4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/adr/13-采集触发双档换可靠性.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/adr/14-三端共享语义不共享进程.md | — | 不要求头注 ⚠ | `03fd77a` 2026-09-28 20:04 docs(波0 收口: ADR-17~22 建件 + 五件补边界, 台账残留指针摘净)<br>`4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/adr/15-AI评分口径.md | — | 不要求头注 ⚠ | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/adr/16-探索位不改订阅集合.md | — | 不要求头注 ⚠ | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/adr/17-不做云数据同步.md | — | 不要求头注 | `03fd77a` 2026-09-28 20:04 docs(波0 收口: ADR-17~22 建件 + 五件补边界, 台账残留指针摘净) |
| docs/adr/18-定时只走GH-Actions.md | — | 不要求头注 | `03fd77a` 2026-09-28 20:04 docs(波0 收口: ADR-17~22 建件 + 五件补边界, 台账残留指针摘净) |
| docs/adr/19-不引入工作流编排平台.md | — | 不要求头注 | `03fd77a` 2026-09-28 20:04 docs(波0 收口: ADR-17~22 建件 + 五件补边界, 台账残留指针摘净) |
| docs/adr/20-不引入搜索引擎栈.md | — | 不要求头注 | `03fd77a` 2026-09-28 20:04 docs(波0 收口: ADR-17~22 建件 + 五件补边界, 台账残留指针摘净) |
| docs/adr/21-runner依赖只许纯JS.md | — | 不要求头注 | `03fd77a` 2026-09-28 20:04 docs(波0 收口: ADR-17~22 建件 + 五件补边界, 台账残留指针摘净) |
| docs/adr/22-不做清理总开关.md | — | 不要求头注 ⚠ | `03fd77a` 2026-09-28 20:04 docs(波0 收口: ADR-17~22 建件 + 五件补边界, 台账残留指针摘净) |
| docs/adr/23-兴趣画像不作可改项.md | — | 不要求头注 | `759a669` 2026-09-29 10:30 docs(用户两裁落地: ADR-23 建件 + 域名定性进治理, 两条已裁账离开待表) |
| docs/adr/24-策展四目标不可拆.md | — | 不要求头注 | `a840704` 2026-09-29 16:51 docs(ADR-24 建件 + 三条规矩归位开发规范, 需求队列只留需求) |
| docs/archive/analysis/_doc_merge_analysis.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/analysis/2026-09-15-thin-body-sources.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/debugging/2026-09-13-reader-pagination-and-content-fixes.md | — | 不要求头注 | `ef42694` 2026-09-18 23:40 docs(governance): 文档清洁轮——底层文档逆推真值 + 六类归档规范 + 门禁脚本，并立自愈/健康度 spec 框架 |
| docs/archive/debugging/2026-09-14-delivery.md | — | 不要求头注 | `ef42694` 2026-09-18 23:40 docs(governance): 文档清洁轮——底层文档逆推真值 + 六类归档规范 + 门禁脚本，并立自愈/健康度 spec 框架 |
| docs/archive/debugging/2026-09-19-delivery-evidence-ledger.md | — | 不要求头注 | `1bf7084` 2026-09-20 16:57 docs(§4.1 洁净=精炼+去冗+归档): ISSUES 从 471 行降到 292 行，轮次记录与证据对账外迁归档 |
| docs/archive/debugging/2026-09-20-round-status-records.md | — | 不要求头注 | `e203f76` 2026-09-21 22:22 docs(文档洁净第二轮·核销轮): ISSUES 234→162 / NEXT-DEV-REQS 327→256,两刀均脚本切片+无损校验(97+76 行原文逐字可反查),新归档件 issues-round2-closed 与 nextdev-closed-rounds 双登记; lint 24 警→3 警(14 悬空/3 裸名/2 背景出处全清); test(L5/S6 判据口径修正): 三处断言与脏树耦合(真库必须还有违规才绿),改为相对锚+开火证明归 self-test,判据本体未动<br>`dc0732a` 2026-09-21 20:35 docs(并行会话清洁轮入账)+编号归一: 作废路径指针/样图与 SPA 旧引用加注 ignore/轮转态记录补 09-21 节; dump-content 件编号 B128→B131、B129→B132(与 ISSUES 现行号对齐); lib/dirty-columns.js 半成品入库(未接线,README/FEATURE_MATRIX 措辞同步改实) |
| docs/archive/debugging/2026-09-21-issues-closed-rows.md | — | 不要求头注 | `6c9a2c7` 2026-09-21 06:20 feat(B109/B45)+test(V1~V7)+feat(W19): 报警事件表收成 lib/alert-events.js 一份，云端后台四个假开关拔掉<br>`138b1c7` 2026-09-21 01:53 feat(B103/D3)+test(D1~D10): 内容级转储与删除前置闸 —— 云端第一次有"回得来"的底牌 |
| docs/archive/debugging/2026-09-21-issues-round2-closed.md | — | 不要求头注 | `3f89a08` 2026-09-22 23:31 docs(BL7 核销+BL12 降级入账): 补锁与复测读数落档<br>`8ecd798` 2026-09-22 23:27 docs(B81/B128 核销入账): ISSUES 出队（该行引用已删文件曾致 doc-lint 1 错）; 602/602 绿 |
| docs/archive/debugging/2026-09-21-release-approval-ledger.md | — | 不要求头注 | `0a1c567` 2026-09-21 04:16 docs(放行台账 §三 #12): 勾掉已交付的 W9/B127/B124，只留 B115② 与 lint:cites 两条待做<br>`2dd6808` 2026-09-21 03:03 feat(门禁扩面)+test(L1~L4): doc-lint 加 5 条判据并给它做双向自证 —— 编号撞号那条是本轮自己咬出来的 |
| docs/archive/docs-deprecated/A_CLASS_FIX_REPORT.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/docs-deprecated/AC12-acceptance-template.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/docs-deprecated/DAILY_SETTINGS_MIGRATION.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/docs-deprecated/DEPLOYMENT.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/docs-deprecated/EMERGENCY_RECOVERY_GUIDE.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/docs-deprecated/FINAL_DIAGNOSIS_AND_FIX_REPORT.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/docs-deprecated/OBSERVATION-GUIDE.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/docs-deprecated/P0-P2-fix-verification-report.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/docs-deprecated/P3-搁置-多语言支持.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/docs-deprecated/P3-搁置-性能基准测试.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/docs-deprecated/phase9-runbook.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/docs-deprecated/SOURCE_ERROR_DIAGNOSIS_REPORT.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/docs-deprecated/TIPS-DAILY-TAB-BLANK-PAGE.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/docs-deprecated/wemp-ai-handoff.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/docs-deprecated/WEMP-INTEGRATION-SOLUTION.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/docs-deprecated/wemp-progress-report-summary.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/docs-deprecated/wemp-runbook.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/docs-deprecated/微信公众号接入与热榜方案.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/docs-deprecated/微信方案备选对比.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/docs-deprecated/批量恢复熔断源 - 一键故障恢复方案.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/docs-deprecated/源列表管理增强 - 功能实施指南.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/docs-deprecated/源列表管理增强 - 实施总结报告.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/docs-deprecated/源错误熔断与批量操作修复完整指南.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/docs-deprecated/源错误熔断修复 - 完整补丁与验证指南.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/feature/2026-09-21-nextdev-closed-rounds.md | — | 不要求头注 | `e203f76` 2026-09-21 22:22 docs(文档洁净第二轮·核销轮): ISSUES 234→162 / NEXT-DEV-REQS 327→256,两刀均脚本切片+无损校验(97+76 行原文逐字可反查),新归档件 issues-round2-closed 与 nextdev-closed-rounds 双登记; lint 24 警→3 警(14 悬空/3 裸名/2 背景出处全清); test(L5/S6 判据口径修正): 三处断言与脏树耦合(真库必须还有违规才绿),改为相对锚+开火证明归 self-test,判据本体未动 |
| docs/archive/README.md | — | 不要求头注 ⚠ | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决<br>`2be8690` 2026-09-25 14:10 docs(按 09-25 裁决清除过去文档): 作废即删 + 摘掉全部归档指针 + 订正 17 处与实现相反的陈述 |
| docs/archive/reports/⚠️阅读前必看-可信度分级.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/reports/ARCHITECTURE_AUDIT_REPORT.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/reports/DATA_LIFECYCLE_AUDIT_REPORT.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/reports/DATA_TAB_FIX_REPORT.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/reports/DATA_TAB_FIX_SUMMARY.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/reports/FINAL_FIX_REPORT.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/reports/FINAL_VERIFICATION_SUMMARY.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/reports/FIX_RECORD_UNIFIED.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/reports/P0-P2-FINAL-REPORT.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/reports/REFRESH_MECHANISM_AUDIT.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/reports/RESTART_DIAGNOSIS_REPORT.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/reports/SEARCH_AND_DAILY_AUDIT_REPORT.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/reports/SMOKE_TEST_REPORT.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/reports/SOURCE_ERROR_AUDIT_REPORT.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/reports/WE_MP_RSS_LEAK_REPORT.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/reports/WEMP_SAMPLING_AUDIT.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/reports/WEMP_SUBSCRIPTION_FIX.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/reports/紧急修复报告.md | — | 不要求头注 | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/specs/checklist-phase6.md | — | 不要求头注 ⚠ | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/specs/checklist-phase7.md | — | 不要求头注 ⚠ | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/specs/checklist-phase8.md | — | 不要求头注 ⚠ | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/specs/checklist.md | — | 不要求头注 ⚠ | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/specs/plan-phase6.md | — | 不要求头注 ⚠ | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/specs/plan-phase7.md | — | 不要求头注 ⚠ | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/specs/plan.md | — | 不要求头注 ⚠ | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/specs/spec-phase6.md | — | 不要求头注 ⚠ | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/specs/spec-phase7.md | — | 不要求头注 ⚠ | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/specs/spec-phase8.md | — | 不要求头注 ⚠ | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/specs/spec.md | — | 不要求头注 ⚠ | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/specs/task-phase6.md | — | 不要求头注 ⚠ | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/specs/task-phase7.md | — | 不要求头注 ⚠ | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/archive/specs/task.md | — | 不要求头注 ⚠ | `4c944fe` 2026-09-27 23:47 chore(收路径搬迁的 git 残局: archive→docs/archive 认成 712 个改名, 陈旧 submodule 摘净): 用户 09-27 裁决 |
| docs/eval/2026-09-24-boundaries.md | — | 不要求头注 | `bdda6c4` 2026-09-29 22:47 docs(台账 H43 自相矛盾修正 + 两处指向已删交接件的死指针)<br>`a88c665` 2026-09-25 04:31 docs(第五轮复审核销): "8% 触发率"是无效分母，按点位算 AI 批 96% 在跑；导语第一条真归因恰恰是 ai_failed |
| docs/eval/2026-09-24-prescreen-labels.md | — | 不要求头注 | `05fd6b8` 2026-09-25 00:06 feat(三臂行为回测给出"是否采用"的数) + 独立审查推翻本轮 3 条说法后逐条改写<br>`cc6f372` 2026-09-24 22:36 docs(行为正样本回测·判据清单改判): 形态类规则误砍 0/246 该上,长度类规则误砍 40.2%/9.8% 直接否决 |
| docs/eval/2026-09-24-prescreen-step1.md | 2026-09-24 | 不要求头注 | `7d23658` 2026-09-24 22:14 docs(H27 成因量化 + 配额键读侧生产实测): schedule 投递率≈12%,AI 批与 collect 挤同一队列=病根<br>`e2a4fc1` 2026-09-24 21:15 test(读层内联生成器执行锁 I1~I3): mock req/res 跑整个 catch-all handler,file: 临时库,零生产写 |
| docs/eval/2026-09-24-source-diagnosis.md | — | 不要求头注 | `12c8a6f` 2026-09-29 23:41 docs(README 去 11 条死图引用, 快照与专栏叫法一名一物, 删 09-25 交接件)<br>`54fe1c3` 2026-09-25 12:35 docs(按四条规范重排本轮改动过的文档): 叙述主轴改成「用户改设置→数据流向→结果」，台账退化成索引，新建两份模块文档 |
| docs/eval/2026-09-24-turso-read-amp.md | — | 不要求头注 | `54fe1c3` 2026-09-25 12:35 docs(按四条规范重排本轮改动过的文档): 叙述主轴改成「用户改设置→数据流向→结果」，台账退化成索引，新建两份模块文档<br>`a96a8e3` 2026-09-25 07:11 feat(H35 补归因·H36/H37/H38/H39 登记): filterStats.failWhy 九类落库，并拆掉一句我拿来当隔离依据的假话 |
| docs/eval/2026-09-25-delivery-readouts.md | — | 不要求头注 | `2be8690` 2026-09-25 14:10 docs(按 09-25 裁决清除过去文档): 作废即删 + 摘掉全部归档指针 + 订正 17 处与实现相反的陈述 |
| docs/eval/bl10-null-audit-20260921.md | — | 不要求头注 | `16a957d` 2026-09-21 01:56 docs(B101 拦一下)+docs(BL10 复核): 待删量按现役库重算是 50,636 条（84.6%），不是旧库那 10,733<br>`138b1c7` 2026-09-21 01:53 feat(B103/D3)+test(D1~D10): 内容级转储与删除前置闸 —— 云端第一次有"回得来"的底牌 |
| docs/eval/citation-audit-20260919.md | — | 不要求头注 | `a08b77c` 2026-09-20 07:50 docs(锚点审计): 第 4 轮只读复核——254 条 file:line 引用扫出 5 条烂锚，登记 B115 |
| docs/features/collectors.md | 2026-09-25 | 不要求头注 | `076aaf2` 2026-09-27 21:41 docs(判定台账退役前置: 已判决结论全部归位活文档, 地图 21 个 V 号改内联): 台账先提交保全, 下一步删<br>`2be8690` 2026-09-25 14:10 docs(按 09-25 裁决清除过去文档): 作废即删 + 摘掉全部归档指针 + 订正 17 处与实现相反的陈述 |
| docs/features/daily-report.md | — | 不要求头注 | `54fe1c3` 2026-09-25 12:35 docs(按四条规范重排本轮改动过的文档): 叙述主轴改成「用户改设置→数据流向→结果」，台账退化成索引，新建两份模块文档<br>`ba585c8` 2026-09-11 18:26 docs: 真实环境逆推全库文档重整(2026-09-11 审计) |
| docs/features/deploy-and-ci.md | — | 不要求头注 | `7ebead7` 2026-09-30 13:31 docs(T3-8 履行完: 按域合并的四份功能文档建成, 地图待建行归零) |
| docs/features/events-alerts.md | 2026-09-25 | 不要求头注 | `12c8a6f` 2026-09-29 23:41 docs(README 去 11 条死图引用, 快照与专栏叫法一名一物, 删 09-25 交接件)<br>`2be8690` 2026-09-25 14:10 docs(按 09-25 裁决清除过去文档): 作废即删 + 摘掉全部归档指针 + 订正 17 处与实现相反的陈述 |
| docs/features/hot-and-weekly.md | — | 不要求头注 | `7ebead7` 2026-09-30 13:31 docs(T3-8 履行完: 按域合并的四份功能文档建成, 地图待建行归零) |
| docs/features/my-brief.md | — | 不要求头注 | `7ebead7` 2026-09-30 13:31 docs(T3-8 履行完: 按域合并的四份功能文档建成, 地图待建行归零) |
| docs/features/my-reading.md | 2026-09-25 | 不要求头注 ⚠ | `a9ed8e4` 2026-09-27 21:43 docs(判定台账退役: 删除 DOC_VALIDITY_LEDGER): 已判决的结论已在 076aaf2 全部归位活文档, 未判决的按用户 09-27 裁决不迁、直接删<br>`076aaf2` 2026-09-27 21:41 docs(判定台账退役前置: 已判决结论全部归位活文档, 地图 21 个 V 号改内联): 台账先提交保全, 下一步删 |
| docs/features/scheduler.md | 2026-09-05 | 不要求头注 | `12c8a6f` 2026-09-29 23:41 docs(README 去 11 条死图引用, 快照与专栏叫法一名一物, 删 09-25 交接件)<br>`2be8690` 2026-09-25 14:10 docs(按 09-25 裁决清除过去文档): 作废即删 + 摘掉全部归档指针 + 订正 17 处与实现相反的陈述 |
| docs/features/settings-plane.md | — | 不要求头注 ⚠ | `7ebead7` 2026-09-30 13:31 docs(T3-8 履行完: 按域合并的四份功能文档建成, 地图待建行归零) |
| docs/features/source-library-autoclassify.md | 2026-09-25 | 不要求头注 | `2be8690` 2026-09-25 14:10 docs(按 09-25 裁决清除过去文档): 作废即删 + 摘掉全部归档指针 + 订正 17 处与实现相反的陈述<br>`ba585c8` 2026-09-11 18:26 docs: 真实环境逆推全库文档重整(2026-09-11 审计) |
| docs/features/task-queue.md | 2026-09-05 | 不要求头注 | `2be8690` 2026-09-25 14:10 docs(按 09-25 裁决清除过去文档): 作废即删 + 摘掉全部归档指针 + 订正 17 处与实现相反的陈述<br>`ba585c8` 2026-09-11 18:26 docs: 真实环境逆推全库文档重整(2026-09-11 审计) |
| docs/features/test-harness.md | — | 不要求头注 | `54fe1c3` 2026-09-25 12:35 docs(按四条规范重排本轮改动过的文档): 叙述主轴改成「用户改设置→数据流向→结果」，台账退化成索引，新建两份模块文档 |
| docs/pitfalls/ai.md | — | 不要求头注 | `928d57c` 2026-09-30 15:12 docs(ADR-24 之后收尾: 判据统一成"不要行号与函数名", 文本与门禁同批改)<br>`7764ccf` 2026-09-18 22:21 fix(daily): 每日早报补上分析后质量门槛——AI 判「不适合收录」的低分条目不再上榜 |
| docs/pitfalls/backend.md | — | 不要求头注 ⚠ | `928d57c` 2026-09-30 15:12 docs(ADR-24 之后收尾: 判据统一成"不要行号与函数名", 文本与门禁同批改)<br>`01f2a2b` 2026-09-21 13:27 feat(B101/观测+强制闸)+test(CO1~CO5)+坑#72: 待删量落成每日读数，删除闸接成 DELETE 前的强制路径 |
| docs/pitfalls/collection.md | — | 不要求头注 ⚠ | `928d57c` 2026-09-30 15:12 docs(ADR-24 之后收尾: 判据统一成"不要行号与函数名", 文本与门禁同批改)<br>`2be8690` 2026-09-25 14:10 docs(按 09-25 裁决清除过去文档): 作废即删 + 摘掉全部归档指针 + 订正 17 处与实现相反的陈述 |
| docs/pitfalls/deployment.md | — | 不要求头注 | `12c8a6f` 2026-09-29 23:41 docs(README 去 11 条死图引用, 快照与专栏叫法一名一物, 删 09-25 交接件)<br>`e856f6c` 2026-09-20 12:17 docs(换库收口): 登记 B118/B119 + 本轮交付链十一条状态，并把"配额是墙钟事件"落成不变量 19 与坑 #D4 |
| docs/pitfalls/frontend.md | — | 不要求头注 | `bc1e4e4` 2026-09-19 20:07 test(regression): B83 收口——最后四份"直打生产 Turso"的测试搬到本地文件库<br>`a1d9c3b` 2026-09-13 19:44 docs: 踩坑库独立成档 + T4 追加需求 + 三份新 spec + 原定目标存续盘点 |
| docs/pitfalls/README.md | 2026-09-18 | 不要求头注 | `12c8a6f` 2026-09-29 23:41 docs(README 去 11 条死图引用, 快照与专栏叫法一名一物, 删 09-25 交接件)<br>`2826591` 2026-09-19 10:25 fix(eval): 按独立对抗性审查修掉取证器"会自己说谎"的三条路径，并补齐固定交付链 |
| docs/pitfalls/testing.md | — | 不要求头注 | `928d57c` 2026-09-30 15:12 docs(ADR-24 之后收尾: 判据统一成"不要行号与函数名", 文本与门禁同批改)<br>`12c8a6f` 2026-09-29 23:41 docs(README 去 11 条死图引用, 快照与专栏叫法一名一物, 删 09-25 交接件) |
| docs/research/README.md | — | 不要求头注 ⚠ | `076aaf2` 2026-09-27 21:41 docs(判定台账退役前置: 已判决结论全部归位活文档, 地图 21 个 V 号改内联): 台账先提交保全, 下一步删 |
| docs/research/RSS信息流策展设计参考.md | 2026-09-23 | 不要求头注 | `076aaf2` 2026-09-27 21:41 docs(判定台账退役前置: 已判决结论全部归位活文档, 地图 21 个 V 号改内联): 台账先提交保全, 下一步删 |
| docs/ROADMAP-2026-09.md | — | 不要求头注 ⚠ | `ef42694` 2026-09-18 23:40 docs(governance): 文档清洁轮——底层文档逆推真值 + 六类归档规范 + 门禁脚本，并立自愈/健康度 spec 框架<br>`d601202` 2026-09-12 12:06 docs: 早报体系三级产品落档(每日早报/我的早报/精选周刊) + 阅读体验修复 + 翻译多轮管线 + InfoQ语料 |
| lib/README.md | — | 不要求头注 | `dc0732a` 2026-09-21 20:35 docs(并行会话清洁轮入账)+编号归一: 作废路径指针/样图与 SPA 旧引用加注 ignore/轮转态记录补 09-21 节; dump-content 件编号 B128→B131、B129→B132(与 ISSUES 现行号对齐); lib/dirty-columns.js 半成品入库(未接线,README/FEATURE_MATRIX 措辞同步改实)<br>`5695874` 2026-09-20 23:08 fix(#65 之后第 3 条)+test(B102): 删除/保留谓词收进 lib/retention.js 一份，本地不再删内容 |
| memory/2026-09-02.md | — | 不要求头注 ⚠ | `5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| memory/README.md | — | 不要求头注 ⚠ | `2a13808` 2026-09-20 16:32 docs(B120 收口 + B123): runner 侧证据按坑 #68 补齐，页头写死"关键词规则排序"另立一条 |
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
| scripts/README.md | — | 不要求头注 ⚠ | `2a13808` 2026-09-20 16:32 docs(B120 收口 + B123): runner 侧证据按坑 #68 补齐，页头写死"关键词规则排序"另立一条 |
| tools/快速启动.md | — | 不要求头注 | `076aaf2` 2026-09-27 21:41 docs(判定台账退役前置: 已判决结论全部归位活文档, 地图 21 个 V 号改内联): 台账先提交保全, 下一步删<br>`5062475` 2026-09-05 11:52 初始提交：全网情报系统 (QWIS) 完整代码库 |
| web/src/README.md | — | 不要求头注 | `12c8a6f` 2026-09-29 23:41 docs(README 去 11 条死图引用, 快照与专栏叫法一名一物, 删 09-25 交接件)<br>`2be8690` 2026-09-25 14:10 docs(按 09-25 裁决清除过去文档): 作废即删 + 摘掉全部归档指针 + 订正 17 处与实现相反的陈述 |

