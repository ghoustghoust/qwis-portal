# 每日早报 v2（18-daily-ai-v2）Plan

## 架构概览

```
GH runner（每日 16:30 UTC = 北京 00:30，新 cron）
  └─ node tools/collect-turso.js daily-ai
       ├─ 取候选：articles WHERE published_at ∈ [昨00:00, 今00:00) 北京（排除热榜/聚合器，上限 500）
       ├─ 初筛：filterArticle × N（16 通道，4s/篇）
       ├─ 深析：analyzeArticle × 通过者（单次调用→结构化 JSON）
       ├─ 组装：四栏目分类（栏目 keywords 匹配，沿用现有语义）+ 总分排序
       ├─ 导语：theme 生成（基于全部入选标题+理由）
       └─ 落库：daily_reports（v2 JSON，meta.schemaVersion=2）
                            │
Vercel: GET /api/daily → 返回 v2（含 theme + 富字段条目）
前端 DailyPage → 主题导语区 + AI 卡片（评分星/理由/摘要/金句/观点/标签）
降级：_ai 全链失败 → 现有 generateDaily 关键词版（meta.degraded=true）
```

## 核心数据结构

### daily_reports 行（v2，复用现有表）
```
generated_at, window_hours(=24), stats(JSON), sections(JSON)
sections = [{ column, desc, items: [{
  id, title, url, source, published_at,
  totalScore, scores: {选题,内容,深度,实用,创新,表达},
  reason, summary, quote, points[], tags[], translated
}]}]
report meta 存进 stats 字段：{schemaVersion:2, theme, degraded, filterStats:{candidates, passed, analyzed}}
```

### prompts/daily-analyze.md（新增）
输入：标题+来源+摘要+正文截断 1500 字 → 输出严格 JSON：
```json
{"scores":{"选题":0-10,"内容":0-10,"深度":0-10,"实用":0-10,"创新":0-10,"表达":0-10},
 "totalScore":0-100, "reason":"≤50字", "summary":"≤150字",
 "quote":"原文金句","points":["≤3条"],"tags":["≤4个"]}
```

## 模块设计

### tools/collect-turso.js 新增 `daily-ai` 模式
- `runDailyAi()`：窗口计算（北京时间自然日）→ 候选查询 → 初筛循环 → 深析循环（单篇失败跳过 N4）→ 栏目分配（沿用 daily-generate 的 columns 语义：focus 优先、关键词栏目、fallback 按总分）→ 导语生成 → INSERT daily_reports
- 降级：_ai.aiChat 连续失败/预算超 90min → 调现有 generateDaily（关键词版）+ meta.degraded
- workflow：新 cron `32 16 * * *`（北京 00:32），daily-ai job；旧 daily 关键词版保留为降级路径（不再定时跑，改由 daily-ai 内部 fallback 调用）

### api/_ai.js 增补
- `analyzeArticle(article)`：loadPrompt('daily-analyze') + aiChat(kind='analyze', maxTokens=768) → 解析 JSON（脏输出兜底 null）
- `generateTheme(items)`：导语（kind='theme', maxTokens=200）

### api/[...slug].js
- handleDaily：检测 schemaVersion=2 → 透传富字段（已有读取逻辑天然兼容，sections 是 JSON 直出）→ 无需大改，补 theme 字段透出

### 前端 DailyPage.jsx
- 顶部主题导语区（theme 存在时）：标题「每日早报 · M月D日」+ 斜体导语
- 条目卡片：AI 字段存在时渲染 评分（★+totalScore）、reason、summary、quote 引用块、points bullets、tags pills；否则旧卡片（N3）
- 标题文案「每日情报」→「每日早报」（i18n 键）

### 黄金集（F6）
- `tests/fixtures/daily-golden.json`：20 篇（10 优 ≥60 分预期 / 10 劣 <30 预期），含标题+摘要+预期分档
- `tools/eval-filter.js`：跑 filterArticle + analyzeArticle，输出分布对比

## 模块交互

```
cron 00:32 → daily-ai → Turso daily_reports → GET /api/daily → DailyPage
                       ↘ 失败降级 → generateDaily(关键词版)
```

## 文件组织

```
tools/collect-turso.js          — +runDailyAi + analyze/theme 调用
api/_ai.js                      — +analyzeArticle + generateTheme
prompts/daily-analyze.md        — 新建
prompts/daily-theme.md          — 新建
api/[...slug].js                — handleDaily 透出 theme
web/src/pages/DailyPage.jsx     — 导语区 + AI 卡片 + 改名
.github/workflows/collect.yml   — daily-ai job（00:32 北京）
tests/fixtures/daily-golden.json + tools/eval-filter.js — 黄金集
tests/regression-daily-ai.test.js — 新建
docs/ 同步
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 批处理时间 | 00:32 北京（新 cron） | 窗口闭合后立即跑，留足 8.5h 缓冲 |
| 旧关键词版 | 保留为降级路径，不再独立定时 | 早报绝不断更（F5） |
| 报告存储 | 复用 daily_reports 表 + stats 里塞 meta | 零迁移 |
| 深析输入 | 1500 字截断（非全文） | 控制 token；BestBlogs 同理 |
| 栏目语义 | 沿用现有 columns + focus 优先 | 后台日报设置继续生效 |
