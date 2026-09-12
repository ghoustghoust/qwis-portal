# AI 基础设施（16-ai-infra）Spec

## 背景

Agnes 云端已修复可用（2026-09-11），翻译已在 runner 真实运转。但要支撑「翻译链（17）+ AI 日报 v2（18）」，缺少公共基础设施：Agnes 免费池实测 20 RPM 且无并发能力，任何并发调用都会被限流打爆；翻译需要术语一致性；日报需要便宜的初筛来省配额。

已有的：增量翻译选择器（`translated_title IS NULL`）、translate 模式、ai_failed 报警（15 项）、供应商链（Agnes→DeepSeek）。

需求澄清结论：**无开放问题**。降级链已获用户明确（Agnes→Bing→Google）；术语库初版为空表+后台可编辑；谷歌/必应走免费端点仅作兜底。

## 目标

- 所有 AI 调用统一经过一个串行限流通道，永不触发 Agnes 限流
- 翻译术语一致性（领域词汇固定译法）
- 日报候选初筛成本降到 1/5 以下（两阶段过滤）

## 功能需求

- **F1**：AI 调用统一通道 `aiChat()`：全系统（翻译/摘要/评分/对话）唯一入口；串行 + 限速（默认 12 次/分钟，可配）；429/5xx 指数退避重试（1s→2s→4s，最多 3 次）；推理模型 max_tokens 默认给足（≥512）；失败计入统计并联动 ai_failed 报警（15 项已有入口）
- **F2**：术语对照库（双层 + 自动生长）：
  - **全局静态表** `settings['ai.glossary']`（[{en, zh, domain?, note?, occurrenceCount?}]，后台可编辑），翻译/摘要 prompt 构造时注入命中术语
  - **每篇即时识别**（BestBlogs 范式）：翻译流程先让模型列术语→对照全局表→冲突以全局表为准
  - **自动生长**（借鉴 [bilingual_term_extractor](https://github.com/wang-h/bilingual_term_extractor) 四阶段管线）：译中提取的新术语对 → 质量过滤（置信度阈值，低质丢弃）→ 归一化（英文小写/单复数归一，提升命中率）→ 沉淀回全局库并累计 occurrenceCount；高频术语自动浮现，后台可审可改
- **F3**：两阶段初筛器 `filterArticle()`：输入标题+来源+200 字摘要（不传全文），输出 0-100 分 + 理由 + ignore 标记；阈值默认 30 可配；供 18-daily-ai-v2 使用
- **F4**：翻译降级链：Agnes 失败 → Bing 免费端点 → Google 免费端点；每级失败记录并落入统计；仅翻译场景启用（评分/摘要不降级到机器翻译）
- **F5**：prompt 文件化：`prompts/` 目录（translate.md / filter.md / daily-score.md 等），runner 与 Vercel 函数均可读；`settings` 里的自定义 prompt 优先于文件（向后兼容现有 translate.prompt）
- **F6**：AI 调用统计：`settings['ai.stats']` 滚动记录（24h 调用数/失败数/平均耗时），供监控板块展示与停滞报警

## 非功能需求

- N1：runner 环境长跑可用（无 10s 限制）；Vercel 函数内的 AI 调用（chat/ping）也走同一通道
- N2： Agnes 无并发 → 通道全局串行（进程内互斥锁 + 调用间隔 ≥4s）
- N3：推理模型特性已内化：调用方不需要知道 max_tokens 陷阱
- N4：统计与缓存读写轻量（单键 settings / 现有列），不新增表（术语表用 settings，翻译缓存复用 articles.translated_* 列）

## 不做的事

- 不做翻译/摘要/日报的具体业务实现（17/18 项做）
- 不做术语库的后台编辑 UI（先 settings 直写，UI 归 P2-4 或 17 项附带）
- 不做向量检索/embeddings
- 不改现有 translate 模式的调用方式（17 项统一改造）

## 验收标准

- AC1：连续 20 次 AI 调用无一触发 429（runner 实测日志）
- AC2：kill 掉 Agnes（临时错误 key）后翻译自动降级 Bing/Google 并成功产出译文
- AC3：术语表写入「LLM→大语言模型」后，新译文里 LLM 全部译为「大语言模型」
- AC4：初筛器对营销软文打分 <30 且 ignore=true，对深度技术文打分 ≥60
- AC5：settings 自定义 prompt 覆盖文件默认 prompt
- AC6：ai.stats 可见 24h 调用数/失败数
- AC7：回归测试全绿
