# 每日早报 v2（18-daily-ai-v2）Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `prompts/daily-analyze.md`、`prompts/daily-theme.md` | 深析/导语 prompt |
| 修改 | `api/_ai.js` | +analyzeArticle + generateTheme |
| 修改 | `tools/collect-turso.js` | +runDailyAi（daily-ai 模式）+ 降级链接 generateDaily |
| 修改 | `.github/workflows/collect.yml` | +daily-ai job（北京 00:32） |
| 修改 | `api/[...slug].js` | handleDaily 透出 theme |
| 修改 | `web/src/pages/DailyPage.jsx` | 导语区 + AI 卡片 + 改名每日早报 |
| 新建 | `tests/fixtures/daily-golden.json`、`tools/eval-filter.js` | 黄金集评测 |
| 新建 | `tests/regression-daily-ai.test.js` | 回归测试 |
| 修改 | docs 三件 | 文档同步 |

## T1: 两个 prompt + _ai 增补

**文件：** `prompts/daily-analyze.md`、`prompts/daily-theme.md`、`api/_ai.js`
**依赖：** 无
**步骤：**
1. daily-analyze.md：六维评分（每项 0-10 + 评分锚点说明）+ totalScore 0-100 + reason/summary/quote/points/tags 严格 JSON 输出 + 「只输出 JSON」
2. daily-theme.md：基于入选标题+理由生成一句话主题导语（≤60 字，样式：「从 X，到 Y，再到 Z，判断 W」）
3. `_ai.analyzeArticle(article)`：loadPrompt + aiChat(kind='analyze', maxTokens=768, timeoutMs=60000) → JSON 解析（脏输出返回 null）
4. `_ai.generateTheme(items)`：kind='theme', maxTokens=200

**验证：** `node --check api/_ai.js`

## T2: runDailyAi 模式

**文件：** `tools/collect-turso.js`
**依赖：** T1
**步骤：**
1. 窗口：北京自然日 [昨00:00, 今00:00)
2. 候选查询（复用现有 generateDaily 的排除规则：非热榜/非聚合器/启用源/勾选调子，LIMIT 500）
3. 初筛循环：filterArticle（<30 丢弃，统计 filterStats）
4. 深析循环：analyzeArticle，单篇失败跳过（N4），预算 90min 硬截止
5. 栏目组装：沿用 columns 语义（focus 优先 → 关键词栏目 → fallback 按 totalScore 排序），每栏 ≤15
6. 导语：generateTheme
7. 落库 INSERT daily_reports（stats 含 schemaVersion:2/theme/degraded:false/filterStats）
8. 降级：AI 全链失败（首篇深析就连败 3 次）→ 调现有 generateDaily + stats.degraded=true

**验证：** 本地小窗跑通（TRANSLATE_LIMIT 类小参数控制候选数）

## T3: workflow daily-ai job

**文件：** `.github/workflows/collect.yml`
**依赖：** T2
**步骤：**
1. 新 cron `32 16 * * *`（北京 00:32）
2. 新 job daily-ai：`node tools/collect-turso.js daily-ai`
3. 旧 daily-report job 改为不再定时（留 workflow_dispatch 手动可用作降级兜底）

**验证：** yaml 语法 + dispatch 实测

## T4: handleDaily 透出 theme

**文件：** `api/[...slug].js`
**依赖：** T2
**步骤：**
1. handleDaily 读取最新报告时把 stats 里的 theme/schemaVersion/degraded 透到响应顶层

**验证：** 线上 GET /api/daily 响应含 theme

## T5: 前端早报页

**文件：** `web/src/pages/DailyPage.jsx`（+ 必要的 i18n 键）
**依赖：** T4
**步骤：**
1. 标题「每日情报」→「每日早报」（i18n）
2. 顶部导语区（theme 存在时）：日期 + 斜体导语 + 关键词标签（取高频 tags）
3. AI 卡片：schemaVersion=2 条目渲染 ★totalScore + reason + summary + quote 引用块 + points bullets + tags pills + 阅读全文；旧格式按旧卡片
4. 头条区（第一栏）卡片带 AI 总结强调

**验证：** 构建 + 浏览器实测

## T6: 黄金集 + 回归测试

**文件：** `tests/fixtures/daily-golden.json`、`tools/eval-filter.js`、`tests/regression-daily-ai.test.js`
**依赖：** T1-T4
**步骤：**
1. 黄金集 20 篇（10 优/10 劣标注）
2. eval-filter.js：跑分输出分布
3. 回归用例：① analyzeArticle 脏 JSON 兜底 null ② 窗口计算正确（跨月/跨日边界）③ 栏目组装 focus 优先 ④ 降级路径触发 ⑤ handleDaily 透出 theme

**验证：** 全绿

## T7: 文档 + 线上验收

**步骤：** docs 同步 → push → 手动 dispatch daily-ai 实测 → 前端截图验收

## 执行顺序

```
T1 → T2 → T3 → T4 → T5 → T6 → T7
```
