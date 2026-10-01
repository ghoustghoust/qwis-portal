# docs/archive/ · 已完结内容归档层

> **规则见 `docs/DOC_GOVERNANCE.md` §2.2/§2.3/§2.4**：内容验收通过后从现役位搬进这里，头部五字段依赖必填。
> **本目录只读不维护，且不作任何现状依据**——本文件里出现的每一个文件名都只回答"当年那一轮改了什么/读到多少"，不回答"现在怎么跑"。要查现在，读 `docs/` 顶层那几份活文档与 `docs/features/`。

## 目录里实际有什么

| 目录 | 装什么 | 现役对照（现在该读哪里） |
|---|---|---|
| `debugging/` | 单期修复流水、已完结变更记录、ISSUES 核销批次的原文留底 | `docs/ISSUES.md` 活跃表 |
| `feature/` | 已验收功能的交付说明与需求源头 | `docs/features/`、`docs/NEXT-DEV-REQS.md` |
| `analysis/` | 一次性分析产物（某天的名单、某轮的读数） | 无现役位；结论若仍生效早已搬进活文档 |
| `reports/` | 2026-08~09 那批审计/修复报告。**先读 `reports/⚠️阅读前必看-可信度分级.md`**：其中多份含虚构验证或互斥结论，一批描述的是已被 ADR-01/02/03 推翻的形态 | 无现役位 |
| `docs-deprecated/` | 门户时代与自建引擎时代的部署/运维/诊断手册（宝塔、PM2、Nginx、wemp 引擎、扫码登录态那几代方案） | `docs/RUNBOOK.md`、`docs/DEV_GUIDE.md`。这些方案**已被判死**，本目录只留原文供反查 |
| `tools/`、`样图/`、`测试/` | 工具的一次性产物、设计样图、测试素材 | 无现役位 |

分类里**没有** `optimization/`、`integration/`、`credentials/` 这三档（治理 §2.3 的表曾列过，实际从未建起来或已并入上面几档）。踩坑类不归档，永久累积在 `docs/pitfalls/`（换手必读）。

## 反向索引：出问题了去哪查（按症状查，不按时间查）

| 症状 / 关键词 | 先读 | 再读 |
|---|---|---|
| 阅读器分页断层、文章重复、pubDate 未来时间 | `debugging/2026-09-13-reader-pagination-and-content-fixes.md` | `docs/pitfalls/backend.md` #25 |
| 早报/周刊出现"用户要求我…/我需要找到…"这类元评论、标题被胡编 | `debugging/2026-09-14-delivery.md` §翻译管线 | `docs/pitfalls/ai.md` #26 #A2 |
| 游标分页/`since` 语义、云端 504 | `debugging/2026-09-14-delivery.md` §0.2 | `docs/pitfalls/backend.md` #25、#23 |
| 09-13~15 那批 UI/管理台/源治理改了什么 | `debugging/2026-09-14-delivery.md` | 当时的规格件已整批作废，反查走 git（锚点见 `docs/ISSUES.md` 的作废登记）；仍生效的取舍在 `docs/adr/` |
| "某一轮 AGENTS §3 十一条各自跑没跑"、洁净轮 Step0~7 读数 | `debugging/2026-09-20-round-status-records.md` | `AGENTS.md` §3、`docs/DOC_GOVERNANCE.md` §4.1 |
| 已修条目的逐条取证与 F2P 证据对账（09-19 两批） | `debugging/2026-09-19-delivery-evidence-ledger.md` | `docs/eval/f2p/*.json` |
| 「这批改动当时等谁点头」「放行清单某行后来去了哪」「哪几条被冻结了」 | `debugging/2026-09-21-release-approval-ledger.md` §二 原文 + §三 落点表 | `docs/ISSUES.md`「✅ 放行清单」指针行 |
| B27~B70 某条 09-19 的登记原话、W1~W16 观察项的原始读数、已核销行的原样措辞 | `debugging/2026-09-21-issues-closed-rows.md` §一~§九 | 对应域规格件已整批作废（反查走 git）；**spec 编号自此只作历史编号读，不得当"方案已存在"引用** |
| B102/B107~B117 等已交付行的交付读数原文、B71~B85 已修行原文、产品选择裁定表原表、BL2~BL11 已核销阻塞项原文 | `debugging/2026-09-21-issues-round2-closed.md` §三/§四/§六/§七 | `docs/ISSUES.md` 各指针行 |
| T2/T4-1/T4-2/T5 已完成需求行、T6 第 0/1/1.5 步执行原文 | `feature/2026-09-21-nextdev-closed-rounds.md` | `docs/NEXT-DEV-REQS.md` 各指针行 |

## 归档件的登记方式（**不逐篇登记**）

本目录**不再维护"已登记归档件"清单**——那份表与每件自己的五字段头注是同一件事写两处，两处就会各自过期（09-25 用户裁：归档层不逐篇登记，`docs/INDEX.md` 也只指到本目录一层，不指到篇）。

规矩收敛成三条，都在治理件里，本文件不复述细则：

1. **每份归档件自带五字段头注**（类别 / 归档自 / 关联承载处 / 状态 / 取代），出处就写在文件里——要问"这份是从哪搬来的"，读它自己，别读索引。
2. **`docs/INDEX.md` 只登记本目录**，不登记篇。
3. **现役文档不留指向本目录的逐条地址**。被搬走的内容在活文档里就地删掉，最多在文件头部写一句目录级说明（"已核销的不进本文件，反查走 git 与归档层"）。
