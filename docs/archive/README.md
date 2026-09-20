# docs/archive/ · 已完结内容归档层

> **规则见 `docs/DOC_GOVERNANCE.md` §2.3/§2.4**：内容验收通过后从现役位搬进这里，头部五字段依赖必填，现役位留一行指针。
> 本目录**只读不维护**。要查"这个问题当年是怎么修的/哪次事故改的"，从下面的反向索引进。

## 分类目录

| 目录 | 类别 | 现役位（对照） |
|---|---|---|
| `feature/` | 功能（已验收交付、需求源头） | `docs/features/`、`docs/NEXT-DEV-REQS.md` |
| `optimization/` | 优化（性能/感知/配额/成本，含实测数据） | `docs/ISSUES.md` 观察中 |
| `debugging/` | 调试（单期修复流水、已完结变更记录、ISSUES 核销批次） | `docs/ISSUES.md` 活跃表 |
| `integration/` | 对接（已停用/被替换的第三方链路方案） | `docs/ANDROID_SUBMIT_GUIDE.md`、`docs/X_SETUP_GUIDE.md`、`docs/features/collectors.md` |
| `credentials/` | 密钥管理（轮换史、位置矩阵、失效事件；**禁明文**） | `docs/HANDOVER.md` §1.5 |

踩坑类不归档，永久累积在 `docs/pitfalls/`（换手必读）。

## 反向索引：出问题了去哪查（按症状查，不按时间查）

| 症状 / 关键词 | 先读 | 再读 |
|---|---|---|
| 阅读器分页断层、文章重复、pubDate 未来时间 | `debugging/2026-09-13-reader-pagination-and-content-fixes.md` | `docs/pitfalls/backend.md` #31 |
| 早报/周刊出现"用户要求我…/我需要找到…"这类元评论、标题被胡编 | `debugging/2026-09-14-delivery.md` §翻译管线 | `docs/pitfalls/ai.md` #26 #A2 |
| 游标分页/`since` 语义、云端 504 | `debugging/2026-09-14-delivery.md` §0.2 | `docs/pitfalls/backend.md` #31 #33 |
| 09-13~15 那批 UI/管理台/源治理改了什么 | `debugging/2026-09-14-delivery.md` | `docs/specs/25`、`docs/specs/26` |
| "某一轮 AGENTS §3 十一条各自跑没跑"、洁净轮 Step0~7 读数 | `debugging/2026-09-20-round-status-records.md` | `AGENTS.md` §3、`docs/DOC_GOVERNANCE.md` §4.1 |
| 已修条目的逐条取证与 F2P 证据对账（09-19 两批） | `debugging/2026-09-19-delivery-evidence-ledger.md` | `docs/eval/f2p/*.json` |
| 更早批次（09-11 settings 写、09-12 报警/我的早报/源写） | `docs/changes/archive/` | `docs/specs/13~16` |
| ISSUES 已核销历史 | `docs/deprecated/ISSUES-resolved-2026-09-13.md`、`-09-14.md` | — |

## 已登记归档件

| 文件 | 类别 | 归档自 | 日期 |
|---|---|---|---|
| `debugging/2026-09-13-reader-pagination-and-content-fixes.md` | 调试 | `docs/changes/` 同名文件 | 2026-09-18 |
| `debugging/2026-09-14-delivery.md` | 调试 | `docs/DELIVERY-2026-09-14.md` | 2026-09-18 |
| `debugging/2026-09-19-delivery-evidence-ledger.md` | 调试 | `docs/ISSUES.md`「B8~B26 本轮处置」+「本轮已修（证据对账）」 | 2026-09-20 |
| `debugging/2026-09-20-round-status-records.md` | 调试 | `docs/ISSUES.md` 三节轮次状态表（交付链×2 + 洁净轮记录） | 2026-09-20 |

> 新增归档件必须同时：①本表加一行；②`docs/INDEX.md` 指向本目录；③原现役位留指针。漏任一项，`tools/doc-lint.cjs` 会报。
