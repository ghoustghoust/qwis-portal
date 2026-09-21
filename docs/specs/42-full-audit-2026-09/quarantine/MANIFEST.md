# 冻结归档清单 · spec 42 目录索引机制

> 冻结时间：2026-09-20
> 原因（用户判定）：这些文件出现在开发树里**干扰了正在进行的修复轮的判断**，先整体出库、期间不提及。
> 状态：**冻结，不是作废**。机制设计仍待开发轮结束后重议。

## 一、本次移出的东西（原路径 → 归档路径）

| 原路径 | 现路径 | 说明 |
|---|---|---|
| `tools/audit-graph.cjs` | `…/quarantine/audit-graph.cjs` | 可达图 + 调度登记表地基工具 | <!-- doc-lint:ignore：左列是搬迁前旧路径，属"当时的事实" -->
| `tools/gen-dir-index.cjs` | `…/quarantine/gen-dir-index.cjs` | 目录索引看门人（只补骨架、只报待维护） | <!-- doc-lint:ignore：左列是搬迁前旧路径，属"当时的事实" -->
| `api/README.md` | `…/quarantine/api/README.md` | 以下 13 份均为**未入库**件，移出即从工作树消失 |
| `archive/README.md` | `…/quarantine/archive/README.md` | |
| `cloud/README.md` | `…/quarantine/cloud/README.md` | |
| `opml/README.md` | `…/quarantine/opml/README.md` | |
| `server/README.md` | `…/quarantine/server/README.md` | |
| `server/routes/README.md` | `…/quarantine/server/routes/README.md` | |
| `server/services/README.md` | `…/quarantine/server/services/README.md` | 机器骨架，正文未填 |
| `server/services/collectors/README.md` | `…/quarantine/server/services/collectors/README.md` | 同上 |
| `tests/README.md` | `…/quarantine/tests/README.md` | |
| `tools/README.md` | `…/quarantine/tools/README.md` | |
| `web/README.md` | `…/quarantine/web/README.md` | |
| `web/src/components/README.md` | `…/quarantine/web/src/components/README.md` | |
| `验证截图/README.md` | `…/quarantine/验证截图/README.md` | |

## 二、刻意**没有**动的东西（避免连带损伤）

| 项 | 为什么留 |
|---|---|
| `config/ lib/ memory/ prompts/ scripts/ web/src/` 六份 README | **已被提交进 git 历史**（`2a13808`）。删除会产生一次 tracked 变更、打断别人正在读的东西；且这六份内容是实测写出的，不是脚手架 |
| `server/services/scheduler/index.js` 门户同步默认关闭 | 这是用户单独批准过的**行为修复**，不是索引机制的一部分；该文件已入库 |
| `tests/regression-audit42-portal-channel.test.js` | 上面那条修复的**回归锁**（AGENTS.md §3 要求）。撤走它会让已入库的修复失去保护，故保留 |
| `docs/eval/audit/{reach,schedule,dir-index-draft}.json/.md` | 审计证据，spec 正文引用它；留在项目既定的证据位，不进工作树判断链 |
| `docs/specs/42-full-audit-2026-09/{spec.md,handoff-notice.md}` | 审计轮本体记录 |
| `AGENTS.md` §2 第 8 条、`DOC_GOVERNANCE` §2.5/§5.7 | 只做了**冻结标注**，未删除——按 AGENTS.md §2.4「作废要落档，不许静默删除」 |

## 三、还原方法

```bash
cd /d/全网情报系统
cp quarantine/audit-graph.cjs quarantine/gen-dir-index.cjs tools/
# 各 README 按上表原路径拷回（目录结构已按原样保留）
cp -r quarantine/*/  .    # 谨慎：会覆盖同名文件，先比对
```
还原前必须同时恢复 `tools/doc-lint.cjs` 的第 7 条与 `AGENTS.md` §2 的那条义务，否则工具与门禁会脱节（工具在、检查没了 = 假装有治理）。

## 四、重议时要解决的三个已知缺陷（都是本轮实测踩出来的）

1. **机器写正文 = 生成报表，不是文档**。第一版把「文件/类型/计数」当索引输出，被判定"太粗犷"。结论：正文必须人/Agent 写，机器只当看门人。
2. **逐文件点名在大目录里必然产出废话**。45 个组件逼出 45 行空描述。已加"文件数 > 20 只要求登记子目录"的阈值，但该阈值本身未经检验。
3. **证据脚本会把 README 自己当成引用者**，导致"零引用组件"漏报（第一版因此没报出 `DouyinTab`）。任何"谁引用了 X"的扫描都必须排除文档类文件，否则结论系统性偏乐观。

**冻结期间本目录内容不作为任何验收依据。**
