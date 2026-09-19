# 39-2 · 死代码与假开关清除 —— 小 Spec（本轮复核：主体已完成）

> 总框架：`spec.md`（39）。状态：✅ **代码面已交付**（B51 假开关摘除、B53 死通道清除），本文件留**复核证据 + 两条残余**。
> 最后更新：2026-09-19（复核轮，逐项 grep 实测，不照抄旧结论）

## 逐项复核（原 39-2 清单 vs 当前代码）

| 原计划要摘的东西 | 现在 | 证据 |
|---|---|---|
| `ai.features` 4 个复选框 + 「x/4 已启用」（H10 假开关） | ✅ 已摘 | `grep -rn "features\|已启用" web/src/components/AiSettingsTab.jsx` → **0 命中**；只读 `settings.ai` 实际键 = `enabled,apiKey,apiBase,model`，**无 `features`** |
| `llmChat()` 无人调通道 | ✅ 已删 | 全仓 grep `llmChat` → **0 命中**（`api/` `server/` `tools/` `lib/` `web/src`） |
| AI 设置页把 apiBase `slice(0,20)` 截成半截域名 | ✅ 已删 | `grep "slice(0, *20)" web/src/components/*.jsx` → **0 命中** |
| 「Agencs」错字（含 `DEVELOPMENT_STANDARDS.md:176`） | ✅ 代码/标准文档已清；仅**历史文档**留痕 | `grep -rln Agencs` → 只有 `docs/deprecated/*` 与 `docs/ISSUES.md`（记录性引用，按 DOC_GOVERNANCE 属"作废也要落档"，不改） |
| 操作流程 4 折叠 | ⏸ **未复核到对象**：本轮没在 `AiSettingsTab.jsx` 里找到"操作流程"折叠块，可能在别的组件或已随假开关一起摘 | 待下一轮定点复核（不写"已完成"，除非指到行号） |

## 残余两件事（小，但要落地才算收口）

1. **B110 的教训进规范**：本轮我为核对配置写了个一次性探针，**只在顶层做掩码**，而 webhook 在 `config.url` 嵌套层 → 明文进了会话。规则要补：探针/脚本打印 settings 前**必须递归掩码**或复用共享 `maskDeep()`，并优先"只打印字段存在性（`hasUrl:boolean`）而不是值"。写进 `docs/DELIVERY_VERIFICATION.md`（或探针规范）时**与它的 `tests/` 锁同批**（坑 #61，否则再触发 W9 红）。
2. **复核"操作流程 4 折叠"**：给出组件与行号，或明确它已随 H10 摘除，别在拆分表里继续挂着。

## 判据（防复发型，与实现同批）

- 白盒：`settings.ai` 的键集是**枚举白名单**（`enabled,apiKey,apiBase,model,minIntervalMs,...`）——出现未登记的键即红并点名（这类"写了没人读的键"就是 H10/B51 的成因；与 `lib/dirty-columns.js` 派生思路同族：判据看代码不看说明）。
- 回归锁：`AiSettingsTab` 里不许再出现"复选框 → 无后端读点"的组合（可用"每个 label 绑定的 settings 键必须至少被 `getSetting` 读一次"的静态判据）。
