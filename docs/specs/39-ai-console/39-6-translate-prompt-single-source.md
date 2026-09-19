# 39-6 · 翻译管线：prompt 有三个事实源 —— 小 Spec

> 总框架：`spec.md`（39）。状态：**待批准，未动工**。本包本轮新查出的问题最实在（见现状表 #1~#3）。
> 最后更新：2026-09-19（复核轮，逐项 grep 实测）

## 现状（实测）

| # | 事实 | 证据 |
|---|---|---|
| 1 | **同一份"翻译提示词"有三处来源**：<br>① 本地：`getSetting('ai.prompt.translate')`，兜底 `DEFAULT_TRANSLATE_PROMPT`<br>② 云端：`api/_ai.js:181 renderTranslatePrompt(...)` ← 读文件 `prompts/translate.md`（映射见 `:275-279`，另有 `translate-refine.md` / `translate-polish.md`）<br>③ runner：`tools/collect-turso.js:1618` 内嵌字符串常量 `TRANSLATE_DEFAULT_PROMPT` | grep 实测 |
| 2 | `api/_ai.js:283` 自带注释「Vercel 部署可能不含 prompts/ 文件 → 内嵌兜底（与 prompts/ 同步义务）」→ **文件 + 内嵌兜底本身就是两份**，再叠加 runner 常量与 settings 键 = 最多 **4 份**同义文本 | 读码 |
| 3 | runner 明明**能用**同一套文件加载（`tools/collect-turso.js:1709` 就调了 `_ai.loadPrompt('term-extract')`），却在翻译这条路径上用手写常量 → 不是能力缺失，是**没收口** | 读码 |
| 4 | 键名不统一：settings 侧是 `ai.prompt.translate` / `ai.prompt.summary`（`server/routes/ai.js:72/108`），**云端与 runner 都不读这两个键** → 后台将来若开"编辑 prompt"，改完只对本地生效，主链路（runner 直写 Turso）照旧 | grep `ai.prompt` 仅 2 命中，均在 server/ |
| 5 | `autoTranslate` **不是死键**：`server/services/ai/translate-skill.js:164/184` 读它、`web/src/components/TranslateSkillTab.jsx:83-85` 写它（`PUT /api/ai/translate/config`）。**原 39-6 拆分表里"autoTranslate 死键清理"这一条不成立**，已按实测撤销 | 本轮 grep |
| 6 | 线上还有 `settings['ai.glossary']` = **92,961 字节**（术语库），只在 `api/_ai.js:181` 的 `glossaryNote` 路径用 | 只读实测 |

## 目标

G1 一个 prompt 键 → **一个加载函数**，三端（本地/云端/runner）引用同一份，且 settings 覆盖文件、文件覆盖内嵌常量的优先级**写死一次**。
G2 后台"编辑 prompt"要么真正影响主链路，要么**不要出现在界面上**（假开关家族：H10/B51 的教训，AGENTS §2 里的"假开关摘除"裁决）。

## 改动点（批准后才写）

1. 新建 `lib/ai-prompts.js`：`loadPrompt(name, {overrideFromSettings:true})` —— 顺序 `settings['ai.prompt.'+name]` → `prompts/<name>.md` → 内嵌兜底；**内嵌兜底只留一份**（放这个文件里，不在 `api/` 与 `tools/` 各留一份）。
2. `api/_ai.js`、`tools/collect-turso.js`、`server/routes/ai.js` 全部改调它，删掉各自的常量与 `getSetting` 分支。
3. 键名定标：统一 `ai.prompt.<name>`，并在 `prompts/README.md`（若建）或 39 总 spec 里列**名称白名单**（`translate / translate-refine / translate-polish / term-extract / daily-analyze / daily-theme / filter`），白名单外即红。
4. 界面上"翻译 prompt"编辑器只有在**主链路真的读它**之后才上线；上线时改动要落 `ai.prompt.translate` 并带审计（BL9 同一套）。

## 判据与验收

- **AC1（行为锁，不是文本比对）**：写一条 settings 覆盖值，**三条链路都要受影响**——本地直接调；云端/runner 在同库同代码路径下调；断言"改前输出的 system prompt 与改后不同"。这条是防"改了没人读"的唯一硬证据。
- **AC2 白盒（拟 W20）**：从字符串字面量派生扫描"翻译 system prompt 形态"（如「你是一位资深科技翻译专家」开头）在 `api/` `tools/` `server/` `lib/` 出现 **≥2 份即红**并点名；判据纪律同坑 #58/#59/#63（剥注释、只认字符串字面量、排除自身与 `tools/_` 探针）。
- **AC3 负向自证**：把内嵌兜底复制进 `tools/collect-turso.js` → W20 必须红；只在注释里写这句话 → 不许红。
- **AC4 撤销项**：`autoTranslate` 相关代码**不许当死键删**（现状表 #5 已证它活着）；若将来要删，必须先证明三个读写点都不再需要。
- **AC5 F2P**：按 B106 构造规则出证。

## 边界

- 不改翻译策略（多轮精翻/优先级窗见 `docs/pitfalls/ai.md` 坑 #A2 与 09-16 事故记录）。
- 不在本包动术语库结构（`ai.glossary` 92KB 的体积治理另案：它同样落在"心跳/设置膨胀"这一族，见 spec 35B 对 `cloud.collect` 做过的瘦身）。
