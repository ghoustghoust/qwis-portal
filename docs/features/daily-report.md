# 日报引擎

> ⚠️ 适用范围：本文描述本地 Express（server/）实现。云端对应物：采集 tools/collect-turso.js、API api/[...slug].js；差异与云端覆盖见 docs/FEATURE_MATRIX.md。
> 补注：云端日报由 runner 每日北京 09:03 生成，无 AI 增强（Agnes 401）。

> `server/services/ai/daily.js` + `server/services/ai/_tokens.js` — 每日情报生成
> 最后更新：2026-09-05

## 设计目标

- **自动日报**：每日定时（默认 08:00）生成情报摘要
- **四栏目分类**：培训课程 / 重点更新 / AI 技术 / 其它重要
- **去重限流**：Jaccard >= 0.5 跨源去重，同源同栏限流 3 条
- **AI 增强降级**：有 AI Key 时 AI 评分/摘要，无 Key 时整体降级为规则排序
- **出库安检**：乱码标题/风控错误页不得入报

## 核心流程

```
generate()
  ├── collectCandidates(windowHours)  // 收集候选
  │   └── SELECT articles WHERE published_at > cutoff
  ├── classify(candidates)            // 分栏分类
  │   ├── focus 源 → 「重点更新」
  │   ├── 关键词匹配 → 对应栏目
  │   └── fallback 栏兜底
  ├── dedupAndCap(sections)           // 去重 + 限流
  │   ├── Jaccard >= 0.5 → 合并（取优先级高的为主条目）
  │   └── 同源同栏 > 3 条 → 截断
  ├── hasMojibake / isErrorPageItem   // 出库安检
  ├── AI 增强（可选）
  │   ├── 有 Key → AI 评分/摘要/标签
  │   └── 无 Key → 整体降级为规则排序
  └── 落库 daily_reports 表
```

## 纯函数模块（_tokens.js）

从 daily.js 提取，消除 events.js 的反向依赖：

```js
const { normalizeTitle, titleTokens, jaccard } = require('./ai/_tokens');

normalizeTitle(title)  // 标题归一化：小写 + 去日期前缀 + 去标点
titleTokens(title)     // token 集合：拉丁/数字整词 + CJK 二元组
jaccard(setA, setB)    // Jaccard 相似度
```

## 数据模型

| 表 | 关键字段 | 说明 |
|----|---------|------|
| daily_reports | id, generated_at, window_hours, stats(JSON), sections(JSON) | 日报记录 |
| articles | source_id, title, url, published_at, score | 候选来源 |

## 接口契约

```js
const daily = require('./ai/daily');
daily.generate();           // 生成日报
daily.needsGeneration();    // 是否需要生成（时间已过且今日无日报）
daily.getClassifyRules();   // 获取分栏规则
```

## 配置

| settings 键 | 默认值 | 说明 |
|-------------|--------|------|
| `daily.time` | `'08:00'` | 生成时间 |
| `daily.windowHours` | `48` | 候选窗口（小时） |
| `daily.aiEnabled` | `true` | 是否启用 AI 增强 |
| `daily.columns` | 四栏目配置 | 栏目名称/关键词/顺序 |

## 注意事项

1. **乱码安检**：`hasMojibake()` 检测西里尔/乱码特征，`isErrorPageItem()` 过滤风控页
2. **focus 源全收**：`extra.focus=1` 的源文章全部进「重点更新」，不走关键词匹配
3. **跨源合并**：不同源同主题文章合并为一条，aggregator 源为主条目
4. **补跑机制**：服务启动时检测 `needsGeneration()`，缺失则立即补生成
