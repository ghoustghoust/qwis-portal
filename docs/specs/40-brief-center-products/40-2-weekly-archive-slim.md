# 40-2 · 周刊归档：瘦身 + 列表投影 + 详情接回 —— 小 Spec

> 总框架：`spec.md`（40，G4）。状态：**待批准，未动工**（读路径改动，不写生产数据）。
> 最后更新：2026-09-19（本轮实测：结构、体积、期数、字段层级全部重测）

## 现状（实测，含对 总 spec 一处表述的精化）

| 事实 | 证据 |
|---|---|
| `settings['weekly.archive']` = **107,918 字节 / 5 期**；`weekly.latest` = 32,155 字节 | 只读实测（`length(value)`） |
| 每期顶层键固定为 `issue, dateStart, dateEnd, theme, count, report`；**正文全在 `report.*` 里** | 探针逐期打印键集 |
| 第 4/5 期 `report` 有 **12 键、storylines 3~4 条、`coverTheme` 与 `editorNote` 齐**；第 1 期只有 **7 键、storylines 0**（早期结构不同） | 逐期实测 |
| 列表侧只投影 6 个字段（`issue/dateStart/dateEnd/theme/count/degraded`），**且每次请求都全量解析 107KB** | `api/[...slug].js:1727-1728` |
| 前端归档区只渲染期次行 + 一个删除按钮（`api.del('/api/weekly/archive/{issue}')`），**没有"打开某期"**：全仓 `web/src/components/*.jsx` 里搜不到 `?issue=` 调用 | `BriefCenterTab.jsx:53/141-146` + grep |
| `count` 与 `report.storylines[].items` 重复内嵌 → 体积主要来自"items 存两遍" | 结构实测（同 H11 型：解析 107KB 只换 6 字段） |

> 订正：`docs/specs/40` 背景里"数据在库里（`coverTheme`/`editorNote`/`storylines` 齐全）"**成立，但位置在 `report.*` 之下**，不在期顶层——第一版探针按期顶层读，全部读成 `false`，是探针错不是数据缺（记此防再错，见记忆"探针要读对层级"）。

## 目标

G4a 列表接口轻：`GET /api/brief/history` 里 `weekly` 段只带摘要 + `storylineCount`，**不在读层解析整块归档**。
G4b 详情走已有的 `/api/weekly?issue=N`（后端能力在，前端没接）→ 归档行点开得见第 4/5 期的封面主题、编者按与分线。
G4c 存储瘦身：`weekly.archive` 不再内嵌每线 `items` 全量（改为存 id 列表或指回 `report`，详情端点负责展开）。

## 改动点（批准后才写）

1. 新建一份"归档条目 → 列表投影"的函数（`lib/brief-guards.js` 里，与历史投影同一处），后端各端点共用；删掉 `handleBriefHistory` 里的内联 `map`。
2. `/api/brief/history` 的 `weekly` 段改为读**预投影**（新键 `weekly.index`，由 runner 生成周刊时一并写；老数据缺 `index` 时**必须显式标 `stale:true`**，不许静默回退全量解析——那是 H11 复发的口子）。
3. 前端归档行接 `GET /api/weekly?issue=N`（只读，无新端点）。
4. 瘦身在 40-3（期号语义）之后做，避免"改存储结构 + 改期号规则"两件事互相掩盖。

## 判据与验收

- AC1 `GET /api/brief/history` 响应体 **< 20KB**（当前含 5 期摘要虽已裁，但服务端解析量要单独测：加一条"解析字节数"观测，断言 < 10KB 而不是 107KB）。
- AC2 第 4/5 期在界面上能看到 `coverTheme` 与非零 storylines 数；第 1 期（无 storylines）显示"结构较早，仅存主题"，**不许显示成"数据缺失"或空白**。
- AC3 兼容性锁：喂一条只有 7 键的旧期 + 一条 12 键的新期，投影函数都不得抛错，且 `stale` 标记只在缺 `index` 时出现。
- AC4 端到端：归档行数 == 响应 `weekly.length`，点开详情后 URL/期号一致（`eval-e2e` 后台剧本，仍属"需登录态未验收"的那一块，要显式声明）。

## 边界

- 不改周刊策展算法与初筛预算（B17 另案）。
- 不在本包删任何一期归档（清理属 40-3/40-8，需授权）。
