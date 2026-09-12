# 翻译链完整上云（17-translate）Plan

## 架构概览

```
用户点击「翻译」→ POST /api/articles/:id/translate → settings translate.queue=[id,...]
                                                          │
runner 每15min translate 模式:                               │
   消费 translate.queue（手动优先）                            │
   → 自动增量（translated_title IS NULL 的英文文章）            │
   → 多轮管线 translatePipeline(article)                      ▼
        轮1 初翻(_ai.translateText) → 轮2 词库对照修正 → 轮3 精翻(长文/高分)
        → 写 articles.translated_title/translated_content/translation_provider
                                                          │
前端 ArticleView/QuickStudyModal ← 详情接口返回 translated_* + provider
   未译英文文 → 「翻译」按钮 → 入队 → 60s 轮询详情 → 出现即切换
```

## 核心数据结构

### articles 表新增列
`translation_provider TEXT`（agnes/bing/google/null）—— Turso ALTER TABLE，启动时 IF NOT EXISTS 加列（migrate 模式：collect-turso.js 启动时 `ALTER TABLE ... ` catch 已存在）

### settings['translate.queue']
`{ "ids": [123, 456] }` —— 手动翻译队列；runner 消费后移除

## 模块设计

### api/_ai.js 增补
- `refineWithGlossary(original, draft)`：轮 2——把 glossary 命中项+初翻草稿给模型，只输出修正后全文
- `refinePass(original, draft)`：轮 3——四类问题检查 + 意译（仅长文 ≥1500 字）
- 两个新 prompt：`prompts/translate-refine.md`（轮2）、`prompts/translate-polish.md`（轮3）

### api/[...slug].js 增补
- `handleArticleTranslate(req, id)`：存在性+英文校验 → 已翻译则直接返回 → 入队（去重）→ `{queued:true, etaMin:20}`
- 路由：`POST /api/articles/:id/translate`
- 文章详情/list 字段补 `translation_provider`（SELECT a.* 自动带上）

### tools/collect-turso.js 改造
- `translatePipeline(article)`：轮1 → 轮2（glossary 非空时）→ 轮3（plainText ≥1500 字）→ 返回 {title, content, provider}
- `runTranslate`：先 `SELECT` 消费 translate.queue（逐个取详情翻译并从队列移除），再走自动增量（现有逻辑）
- 写库增加 translation_provider

### 前端（web/src/components/ArticleView.jsx + QuickStudyModal.jsx）
- 未翻译英文文章显示「翻译」按钮 → POST 入队 → 按钮变「翻译中…」→ 60s 轮询详情 → translated_* 出现即切换显示
- meta 行加翻译来源徽章：「Agnes 精翻 / Bing 机翻 / Google 机翻」

## 模块交互

```
ArticleView 按钮 → POST translate → Turso settings.queue
runner translate → 读 queue → pipeline → articles.translated_*
ArticleView 轮询详情 → 出现译文 → 自动切换
```

## 文件组织

```
api/_ai.js                     — +refineWithGlossary/refinePass
prompts/translate-refine.md    — 新建（轮2 词库对照修正）
prompts/translate-polish.md    — 新建（轮3 精翻）
api/[...slug].js               — +handleArticleTranslate + 路由
tools/collect-turso.js         — translatePipeline 多轮 + queue 消费 + provider 入库
web/src/components/ArticleView.jsx      — 翻译按钮 + 轮询 + 来源徽章
web/src/components/QuickStudyModal.jsx  — 同上（快读弹窗）
tests/regression-translate.test.js      — 新建
docs/ 同步（HANDOVER/FEATURE_MATRIX/changes）
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 手动翻译 | 异步入队（settings 队列） | Hobby 10s 物理限制，同步必超时（spec 已定） |
| 队列入库 | settings `translate.queue` 而非新表 | 轻量；runner 已有 settings 读写 |
| provider 标记 | articles 新列 translation_provider | 列表/详情直接可用，比 extra JSON 好查 |
| 轮 3 触发条件 | 长文 ≥1500 字 | 控制 Agnes 配额消耗（20 RPM） |
| 轮 2 触发条件 | glossary 非空且初翻含英文术语残留 | 无线库时跳过省调用 |
