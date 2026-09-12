# AI 基础设施（16-ai-infra）Plan

## 架构概览

新建共享模块 `api/_ai.js`（runner 与 Vercel 函数共用，与 _alerts.js 同模式），全部 AI 调用收敛于此。

```
翻译(17) / 日报(18) / 初筛 / chat / ping
        │
        ▼
  api/_ai.js
   ├─ aiChat(messages, opts)        统一入口：串行限流 + 重试 + 统计
   ├─ translateText(text, opts)     降级链：Agnes→Bing→Google
   ├─ filterArticle(meta)           两阶段初筛（0-100 分）
   ├─ loadGlossary() / growGlossary()  术语库（读取/沉淀）
   ├─ loadPrompt(name)              prompts/ 文件 + settings 覆盖
   └─ aiStats()                     settings['ai.stats'] 滚动统计
        │
        ▼
  Turso settings（ai.glossary / ai.stats / prompts 覆盖）+ articles.translated_*
```

## 核心数据结构

### settings['ai.glossary']
```json
[{ "en": "Agent", "zh": "智能体", "domain": "AI", "note": "", "occurrenceCount": 12, "locked": true }]
```
- `locked:true` = 人工审核固化，自动生长不得覆盖

### settings['ai.stats']（滚动 24h）
```json
{ "calls": [{"at":"...","kind":"translate|filter|chat","ok":true,"ms":1234,"provider":"agnes"}] }
```
（保留最近 500 条，读出时聚合）

### prompts/ 目录（repo 内，新增）
```
prompts/translate.md     — 翻译主 prompt（含 {{glossary}} 占位）
prompts/filter.md        — 初筛 prompt（0-100 分，阈值语义内嵌）
prompts/term-extract.md  — 术语提取 prompt
```

### aiChat 选项
```
aiChat(messages, { kind, maxTokens=512, temperature=0.3, timeoutMs=30000, model })
```

## 模块设计

### 统一通道 aiChat（F1）
- 进程内互斥锁 + 调用间隔 ≥4s（12 次/分，Agnes 20 RPM 留 40% 余量）
- 429/5xx 指数退避 1s→2s→4s（最多 3 次）
- 供应商链沿用 [...slug].js 的 Agnes→DeepSeek（读取逻辑抽进 _ai.js 供双端复用）
- 每次调用写 ai.stats（kind/ok/ms/provider）；连续失败 ≥3 次 → _alerts.aiFailed（联动 15 项）

### 翻译降级链 translateText（F4）
- L1 Agnes（走 aiChat）；L2 Bing 免费端点；L3 Google 免费端点（gtx）
- 每级失败记 stats；全部失败返回 null（调用方决定跳过或报警）

### 术语库（F2）
- `loadGlossary()`：读 settings['ai.glossary']（数组）
- 匹配归一化：小写 + 英文单复数粗归一（去尾 s/es）
- `growGlossary(pairs)`：新对归一化查重 → 未锁定同义条目更新 occurrenceCount；全新条目以 locked:false 写入
- prompt 注入：命中术语格式化为「en → zh」清单填入 {{glossary}} 占位

### 初筛器 filterArticle（F3）
- 输入：{title, source, category, summary(≤200 字截断), language}
- 输出：{score(0-100), ignore, reason}
- 走 aiChat(kind='filter', maxTokens=128)；prompt 从 prompts/filter.md 读
- 阈值读 settings['ai.filterThreshold']（默认 30）

### prompt 加载（F5）
- `loadPrompt(name)`：settings[`prompt.${name}`] 非空则优先 → 否则读 repo `prompts/${name}.md`
- runner：fs.readFileSync（repo 已 checkout）；Vercel：文件随部署打包，fs 读 process.cwd()

## 模块交互

```
runner collect →（17 项挂载点）translateText → aiChat → Agnes
runner daily   →（18 项挂载点）filterArticle → aiChat
Vercel /api/ai/chat|ping → 改用 _ai.aiChat（消灭第二套调用）
```

## 文件组织

```
api/_ai.js                          — 新建：统一 AI 基础设施
api/_alerts.js                      — 不动（被 _ai.js 调用 aiFailed）
api/[...slug].js                    — aiChatCloud 改调 _ai.aiChat（收敛双实现）
prompts/translate.md / filter.md / term-extract.md — 新建
tools/collect-turso.js              — translate 模式改走 _ai（17 项完整接管，本项只接通道）
tests/regression-ai-infra.test.js   — 新建
docs/ 同步（HANDOVER/FEATURE_MATRIX/changes）
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 串行限流实现 | 进程内 promise 链 + 间隔计时 | runner 单进程；Vercel 函数实例内同理；不引入 Redis |
| 统计存储 | settings 滚动数组 ≤500 条 | 零建表；量级小 |
| 降级链范围 | 仅翻译 | 评分/摘要用机翻等于垃圾输出（spec 已定） |
| prompts 文件 | repo 内 .md + settings 覆盖 | runner/Vercel 都能 fs 读；保留后台可编辑性 |
| 术语生长写回 | 立即写 settings（合并读-改-写） | runner 串行环境无并发冲突 |
