# `prompts/`

**放什么**：AI 提示词模板

**不放什么**：—

**归属端**：本地 + 云端

**状态**：active

## 内容（装载方逐个点名，别加没人 load 的模板）

| 文件 | 谁装载 | 用途 |
|---|---|---|
| `daily-analyze.md` | `api/_ai.js`（经 `lib/ai-prompts.js`） | 早报条目六维深析（评分 + 摘要 + 金句 + 要点） |
| `daily-theme.md` | `api/_ai.js`（同上） | 早报「今日主题」一句话导语（清洗与否决在 `generateTheme` 里，见坑 #59 同族） |
| `filter.md` | `api/_ai.js`（同上） | 两阶段初筛（决定哪些候选值得深析） |
| `translate.md` | `api/_ai.js`（同上）→ 云端、runner、本地 `POST /api/ai/translate` 三端共用的主链 | 英文标题/正文翻译 |
| `translate-refine.md` | `api/_ai.js`（同上） | 翻译精修（薄正文走仅标题通道，坑 #A2） |
| `translate-polish.md` | `api/_ai.js`（同上） | 译文润色（降级链 Agnes→Bing→Google 的第一档内部步骤） |
| `translate-skill.md` | `server/services/ai/translate-skill.js`（经 `lib/ai-prompts.js`，键 `ai.prompt.translate-skill`） | 本地精翻模块那份七条要求（09-21 从 `DEFAULT_PROMPT` 内嵌常量搬进来，B111） |
| `term-extract.md` | `tools/collect-turso.js`（经 `_ai.loadPrompt`） | 双层术语库抽取 |

**装载路径只有一条**：`lib/ai-prompts.js` 定优先级 `settings['ai.prompt.<name>']` → 本目录文件 → 该文件里的内嵌兜底
（兜底也**只有那一份**，收口前它在 `api/_ai.js` 里另存了 7 条）。新增 prompt 必须同时
①在本表挂号 ②进 `lib/ai-prompts.js#PROMPT_NAMES` —— 白名单外由白盒 **W20** 判红，
`tests/regression-ai-prompts.test.js` PR7 还反向判"有文件没人 load / 有名字没文件"。
标题行（`# …`）会随文件一起进 prompt —— 模型侧实测吃得住（`translate.md` 一直这么上线）。

**不放什么**：把提示词硬编码回 `.js` 里 —— 同一份"翻译提示词"曾有 **5 个事实源**（实测登记在 `docs/ISSUES.md` B111），本目录就是为收敛它而存在的；也不放与 AI 调用无关的文案。
