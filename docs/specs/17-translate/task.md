# 翻译链完整上云（17-translate）Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `prompts/translate-refine.md`、`prompts/translate-polish.md` | 轮 2/轮 3 prompt |
| 修改 | `api/_ai.js` | +refineWithGlossary / refinePass |
| 修改 | `api/[...slug].js` | +handleArticleTranslate + 路由 |
| 修改 | `tools/collect-turso.js` | translatePipeline 多轮 + queue 消费 + provider 入库 + 加列迁移 |
| 修改 | `web/src/components/ArticleView.jsx`、`QuickStudyModal.jsx` | 翻译按钮/轮询/徽章 |
| 新建 | `tests/regression-translate.test.js` | 回归测试 |
| 修改 | docs 三件 | 文档同步 |

## T1: 两个新 prompt + _ai.js 增补

**文件：** `prompts/translate-refine.md`、`prompts/translate-polish.md`、`api/_ai.js`
**依赖：** 无
**步骤：**
1. translate-refine.md：输入原文+初翻草稿+术语表 → 只输出修正后全文（术语不一致处修正，其余不动）
2. translate-polish.md：检查四类问题（术语/表达结构/文化适应/格式）→ 意译输出终稿
3. `_ai.js` 加 `refineWithGlossary(original, draft)`、`refinePass(original, draft)`（都走 aiChat kind='translate'）

**验证：** `node --check api/_ai.js`

## T2: 手动翻译端点

**文件：** `api/[...slug].js`
**依赖：** 无
**步骤：**
1. `handleArticleTranslate(req, id)`：源存在性 → 已翻译直接返回 `{queued:false, already:true}` → 队列去重入队（settings translate.queue）→ 返回 `{queued:true, etaMin:20}`
2. 路由：`POST /api/articles/:id/translate`（注意在 `/api/articles/:id` GET 正则之后注册无冲突——方法不同）
3. auditRecord('article.translate', ...)

**验证：** T6 用例 1-3

## T3: runner 多轮管线 + 队列消费 + provider 列

**文件：** `tools/collect-turso.js`
**依赖：** T1
**步骤：**
1. 启动迁移：`ALTER TABLE articles ADD COLUMN translation_provider TEXT`（try/catch 已存在）
2. `translatePipeline(article)`：轮1 translateText → 轮2（glossary 非空）→ 轮3（≥1500 字）→ 返回 {title, content, provider, rounds}
3. `runTranslate`：开头先读 translate.queue → 逐个取详情走 pipeline → 成功即从队列移除（失败保留下轮重试）；再走现有自动增量
4. 写库带 translation_provider；translateOne 的旧签名替换为 pipeline 调用

**验证：** 本地 TRANSLATE_LIMIT=1 跑一次（真 Agnes）日志可见轮次

## T4: 前端按钮 + 轮询 + 徽章

**文件：** `web/src/components/ArticleView.jsx`、`QuickStudyModal.jsx`
**依赖：** T2（端点上线后联调）
**步骤：**
1. 未翻译且判定英文（isEnglish 启发式：标题 ASCII 占比）→ 显示「翻译」按钮
2. 点击 → POST → 按钮变「翻译中…」→ 每 60s 拉详情 → translated_content 出现即自动切换
3. meta 行徽章：provider==='agnes' → 「AI 精翻」；bing/google → 「机翻」
4. i18n 键补充（中英双语）

**验证：** 构建通过 + 浏览器实测

## T5: 回归测试

**文件：** `tests/regression-translate.test.js`
**依赖：** T2、T3
**步骤：**
1. 用例：① POST translate 入队 ② 重复入队去重 ③ 已翻译返回 already ④ 队列消费后移除（模拟）⑤ 非英文文章拒绝入队
2. 管线轮次用桩验证（轮1成功→轮2仅在有术语时触发→轮3仅长文）

**验证：** `node --test tests/regression-translate.test.js` 全绿

## T6: 文档 + 线上验收

**步骤：** HANDOVER/FEATURE_MATRIX/changes 同步 → push → 线上对真实英文文章 POST translate → 等 runner → 验证译文出现 + provider 标记

## 执行顺序

```
T1 → T2 → T3 → T4 → T5 → T6
```
