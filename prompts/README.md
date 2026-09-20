# `prompts/`

**放什么**：AI 提示词模板

**不放什么**：—

**归属端**：本地 + 云端

**状态**：active

## 内容（装载方逐个点名，别加没人 load 的模板）

| 文件 | 谁装载 | 用途 |
|---|---|---|
| `daily-analyze.md` | `api/_ai.js` | 早报条目六维深析（评分 + 摘要 + 金句 + 要点） |
| `daily-theme.md` | `api/_ai.js` | 早报「今日主题」一句话导语（清洗与否决在 `generateTheme` 里，见坑 #59 同族） |
| `filter.md` | `api/_ai.js` | 两阶段初筛（决定哪些候选值得深析） |
| `translate.md` | `api/_ai.js` | 英文标题/正文翻译主链 |
| `translate-refine.md` | `api/_ai.js` | 翻译精修（薄正文走仅标题通道，坑 #A2） |
| `translate-polish.md` | `api/_ai.js` | 译文润色（降级链 Agnes→Bing→Google 的第一档内部步骤） |
| `term-extract.md` | `tools/collect-turso.js`（经 `_ai.loadPrompt`） | 双层术语库抽取 |

**不放什么**：把提示词硬编码回 `.js` 里 —— 同一份"翻译提示词"曾有 **3~4 个事实源**（实测登记在 `docs/ISSUES.md` B111），本目录就是为收敛它而存在的；也不放与 AI 调用无关的文案。
