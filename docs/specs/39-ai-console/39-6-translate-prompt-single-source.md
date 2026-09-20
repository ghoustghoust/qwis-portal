# 39-6 · 翻译管线：prompt 有三个事实源 —— 小 Spec

> 总框架：`spec.md`（39）。状态：✅ **09-21 已交付**（阻塞级 ⑤ 批最后一条，用户整表批准后随批做；交付记录与本文件的偏差逐条写在文末）。
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

## 交付记录（2026-09-21，B111 / 阻塞级 ⑤）

改动点四条的实际落点（与本文件原写法有偏差的地方如实标出）：

1. ✅ `lib/ai-prompts.js` —— 优先级 `settings['ai.prompt.<name>']` → `prompts/<name>.md` → 内嵌兜底，
   兜底只这一份。**偏差**：原计划写"`loadPrompt(name, {overrideFromSettings:true})`"，实现改成
   `promptText(name, {override})` 由调用方把覆盖值取来 —— 因为三端的 settings 层取法不同
   （libsql 异步 / better-sqlite3 同步），在 lib 里写死取法就等于把异步驱动塞进本地端。
   顺序仍然只定义一次，这是本条真正要钉的东西。
2. ✅ `api/_ai.js`、`server/routes/ai.js`、`server/services/ai/translate-skill.js` 全改调它，
   各自的常量与 `getSetting` 分支删掉（`api/_ai.js` 里 `EMBEDDED_PROMPTS` 7 条整体外迁，
   顺带删掉该文件已无人用的 `fs`/`path` 两个 require）。
   **runner 不是"改调"而是"删掉"**：`TRANSLATE_DEFAULT_PROMPT` 全文件只有声明处一处命中，
   它从来没人读 —— 与本地精翻那份 `diff` 实测**字对字相同**（更正现状表 #1 的"三处来源"：
   逐字数完是 5 份，读数与逐份字节数记在 `docs/ISSUES.md` B111 行）。
3. ✅ 键名定标 `ai.prompt.<name>` + 名称白名单 `PROMPT_NAMES`（8 个：原 7 个 + `translate-skill`）。
   **新增的这个名字是本包原来没预见的**：精翻模块那份与主链那份文案不同，收口不是"挑一份赢"，
   而是**两个名字各自的默认**（`prompts/translate-skill.md` 新建），第三个变体（现状表 #1 的
   `server/routes/ai.js` 那份更短的）作废、改吃主链的 `translate`。
   两端 settings 里今天**没有任何一条 prompt 覆盖键**（实测），所以换键零迁移、零存量行为变更。
4. ◐ 界面侧：精翻模块的编辑器写的键与它读的键已经同一个（PR5 是这一条的行为锁），
   但"编辑器要不要在主链上也开一个入口"没决定，也没上线新入口 —— 原改动点第 4 条只算做完了一半。

判据与验收：

- **AC1** ✅ 行为锁 = PR4（同一条落库覆盖键喂 `api/_ai.js#loadPrompt`，写前取到 `prompts/translate.md`、
  写后立刻变，并且旧键 `prompt.<name>` 再写进去也不生效）+ PR5（本地端 set/get/reset 同一个键）。
  云端与 runner 共用 `_ai.loadPrompt`，所以 PR4 一条覆盖两端 + runner。
- **AC2/AC3** ✅ 白盒 **W20 已实装**（号位不再挂「拟」）：判据 `findPromptViolations` 与锁 PR1~PR3 同一份；
  负向样本"塞进去必红并点名行号"、反向样本"注释里的同句 / 短 UI 文案 / 非翻译家族 prompt 不许误红"。
  **判据第一版是恒绿的**（`masked` 当集合遍历 → 拿到逐字符 → `continue` → 永远 0 命中，坑 #71），
  是"先对已知坏样本跑一次红"这步把它救回来的：接线前先跑，读数是 4 个文件 6 处。
- **AC4** ✅ `autoTranslate` 一个字都没动（撤销项照办；现状表 #5 的实测继续有效）。
- **AC5** F2P 按 B106 规则出证（锁文件是本轮新建的，基线由引入提交反查），证据路径补在 `docs/ISSUES.md` B111 行。
- 未做：**端到端 UI 复验**（后台精翻页要登录态，不代你输口令）；`DEFAULT_SUMMARY_PROMPT`（摘要那份）
  仍是内嵌单份、无副本所以 W20 不判它 —— 留作本包后续，不算已收口。
