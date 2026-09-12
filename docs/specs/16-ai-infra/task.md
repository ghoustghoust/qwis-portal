# AI 基础设施（16-ai-infra）Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `api/_ai.js` | 统一 AI 通道（限流串行/重试/降级链/术语库/初筛器/prompt 加载/统计） |
| 新建 | `prompts/translate.md`、`prompts/filter.md`、`prompts/term-extract.md` | prompt 文件化 |
| 修改 | `api/[...slug].js` | aiChatCloud 改调 _ai.aiChat（收敛双实现） |
| 修改 | `tools/collect-turso.js` | translate 模式改走 _ai（通道+降级链+术语注入） |
| 新建 | `tests/regression-ai-infra.test.js` | 回归测试 |
| 修改 | docs（HANDOVER/FEATURE_MATRIX/changes） | 文档同步 |

## T1: prompts/ 三个文件

**文件：** `prompts/translate.md`、`prompts/filter.md`、`prompts/term-extract.md`
**依赖：** 无
**步骤：**
1. translate.md：现 TRANSLATE_DEFAULT_PROMPT 内容 + `{{glossary}}` 占位 + 「只输出译文，不输出思考过程」约束（Agnes 推理模型会带思考叙述——已实测）
2. filter.md：初筛 prompt（标题+来源+200字摘要 → JSON {score, ignore, reason}；阈值语义、营销减分、深度加分——抄 BestBlogs 加减分结构）
3. term-extract.md：从译文中提取术语对 → JSON [{en, zh, domain, confidence}]

**验证：** 文件存在且含占位/输出契约说明

## T2: api/_ai.js 统一通道

**文件：** `api/_ai.js`（新建）
**依赖：** T1
**步骤：**
1. 串行限流：进程内 promise 链 + 上次调用间隔 ≥4s（settings `ai.rpmInterval` 可配）
2. `aiChat(messages, {kind, maxTokens=512, temperature, timeoutMs, model})`：供应商链（Agnes→DeepSeek）+ 429/5xx 退避重试 ×3 + content 空回退 reasoning_content + 写 ai.stats（≤500 滚动）+ 连续失败 ≥3 → _alerts.aiFailed
3. `translateText(text, opts)`：Agnes → Bing（免费端点）→ Google gtx 端点，逐级降级，每级记 stats
4. `loadGlossary()` / `growGlossary(pairs)`：归一化查重（小写+单复数粗归一），locked 条目不可覆盖
5. `filterArticle(meta)`：loadPrompt('filter') + aiChat(kind='filter', maxTokens=128) → 解析 JSON {score, ignore, reason}，阈值 settings['ai.filterThreshold']||30
6. `loadPrompt(name)`：settings[`prompt.${name}`] 优先 → repo prompts/ 文件
7. `aiStats()`：聚合 24h 调用数/失败数/平均耗时/分供应商

**验证：** `node --check api/_ai.js` + T6 用例

## T3: [...slug].js 收敛

**文件：** `api/[...slug].js`
**依赖：** T2
**步骤：**
1. aiChatCloud 内部改调 `_ai.aiChat`（保留函数签名，handleAiPing/handleAiChat 不动）
2. 删除文件内重复的供应商链逻辑（aiProviderChain 标记 deprecated 注释或直接移除内联实现）

**验证：** 云端 ai/ping 实测仍通（部署后）

## T4: collect-turso.js 翻译模式接通道

**文件：** `tools/collect-turso.js`
**依赖：** T2
**步骤：**
1. translate 模式的 llmChat 调用改为 `_ai.translateText`（自动获得限流/降级链/术语注入）
2. 翻译完成后调用 `growGlossary`（用 term-extract prompt 提取本篇术语对）
3. 保留现有增量选择器（translated_title IS NULL）

**验证：** 本地小批次跑 translate（2 篇）日志可见降级链与术语沉淀

## T5: 回归测试

**文件：** `tests/regression-ai-infra.test.js`
**依赖：** T2-T4
**步骤：**
1. 用例：① 限流串行（并发 5 次调用，时间间隔均 ≥4s，用假 provider 桩）② 429 退避重试 ③ 降级链 Agnes 失败走 Bing 桩 ④ 术语注入（glossary 命中进 prompt） ⑤ growGlossary 查重+occurrenceCount 累计+locked 不覆盖 ⑥ filterArticle 解析健壮（脏 JSON 兜底） ⑦ loadPrompt 覆盖优先级 ⑧ ai.stats 滚动 ≤500
2. provider 全部打桩（不真调 Agnes），仅 1 个真实 ping 用例

**验证：** `node --test tests/regression-ai-infra.test.js` 全绿

## T6: 文档 + 线上验收

**步骤：**
1. HANDOVER/FEATURE_MATRIX/changes 同步
2. push → READY → 线上 ai/ping + ai/chat 实测 → runner 下一轮 translate 观察日志

## 执行顺序

```
T1 → T2 → T3 → T4 → T5 → T6
```
