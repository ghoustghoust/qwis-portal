# 我的早报（19-my-brief）Plan

## 架构概览

```
runner daily-ai 批次（00:32 北京）
  └─ runDailyAi() 深析池 analyzed[]
        └─ runMyBrief(analyzed)   ← 复用，零额外深析调用
             ├─ 订阅集合: SELECT id FROM sources WHERE focus=1 AND enabled=1
             ├─ 过滤: analyzed.filter(a => subscribed.has(a.source_id))
             ├─ 分层: top 3 / featured 7 / rest ≤40（按 totalScore）
             ├─ 导语: generateTheme(全部入选)
             ├─ 关键词: 高频 tags 统计 ≤8
             ├─ 存储: settings['mybrief.latest']
             └─ 推送: _alerts 渠道直发（导语+top3 标题）
                            │
Vercel: GET /api/mybrief → settings['mybrief.latest'] 透传（公开读）
前端: /mybrief/ → MyBriefPage（三态：引导/空态/正常）
```

## 核心数据结构

### settings['mybrief.latest']
```json
{
  "date": "2026-09-12",
  "theme": "今日聚焦……",
  "keywords": ["AI","Agent","成本"],
  "degraded": false,
  "generatedAt": "…",
  "sections": {
    "top":     [{id,title,url,source,cover,totalScore,scores,reason,summary,quote,points,tags,translated}],
    "featured":[...同构 ≤7],
    "rest":    [...同构 ≤40]
  }
}
```
空态：`{empty:'no-content', date, message}`；无订阅：`GET /api/mybrief` 返回 `{ok:true, empty:'no-subscription'}`（不读 settings）

### 订阅集合（v1）
`SELECT id FROM sources WHERE focus=1 AND enabled=1`（P2-1 订阅模型上线后改读 settings.subscribedSourceIds，仅此一行改动）

## 模块设计

### tools/collect-turso.js — `runMyBrief(analyzed)`
- 在 runDailyAi 落库后调用（analyzed 复用）；analyzed 为空/降级时跳过（daily 已降级，mybrief 同步空态）
- 组装：按 source_id ∈ 订阅集合过滤 → totalScore 排序 → 切层
- 关键词：tags 频率统计 top 8
- 推送：`_alerts.dispatch('mybrief', {title:'☀️ 我的早报 · M月D日', text: 导语 + top3})`——注意 dispatch 需要 events.mybrief（DEFAULT_EVENTS 增补，默认 true；pushEnabled=false 时跳过）
- source_id 入 analyzed：深析时保留 a.source_id（候选查询 SELECT 已含 a.source_id？需要补——候选查询 SELECT 列表加 a.source_id）

### api/[...slug].js — `GET /api/mybrief`
- 先查订阅集合：空 → `{ok:true, empty:'no-subscription'}`
- 否则读 settings['mybrief.latest'] → 透传（公开 GET 白名单加路径）

### web/src/pages/MyBriefPage.jsx（新建，~250 行）
- 三态渲染：no-subscription（引导去源库标记）/ no-content（今日订阅源无更新）/ 正常
- 正常态：大日期 serif 标题 → 导语（斜体）→ 关键词 pill 行 → 「头条推荐」大卡片（TOP1-3，封面右置）→「精选内容」中卡片 ≤7 →「补充阅读」紧凑行 ≤40 → 类型筛选器（全部/文章/视频，播客/推文 disabled 置灰）
- 卡片复用 ColumnSection 的富卡片元素（评分/理由/金句/观点/标签），但按样图重排（封面右侧、TOP 排名角标、「来自你的关注」徽章）
- 路由注册 + 导航入口（「我的早报」放「每日早报」旁）

## 模块交互

```
daily-ai cron 00:32 → runDailyAi → runMyBrief → settings.mybrief.latest
                                              ↘ 飞书推送
用户打开 /mybrief/ → GET /api/mybrief → 三态渲染
```

## 文件组织

```
tools/collect-turso.js        — +runMyBrief + runDailyAi 尾部调用 + 候选查询补 source_id
api/_alerts.js                — DEFAULT_EVENTS + mybrief
api/[...slug].js              — +handleMyBrief + 路由 + 公开白名单
web/src/pages/MyBriefPage.jsx — 新建
web/src/App.jsx / Header.jsx  — 路由 + 导航 <!-- doc-lint:ignore：spec 19 已交付，其后 SPA 重构为 main.jsx/admin.jsx，本行是当时的事实 -->
tests/regression-my-brief.test.js — 新建
docs/ 同步
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 生成时机 | daily-ai 批次内复用深析池 | 零额外 AI 成本（AC6） |
| 存储 | settings.mybrief.latest（单键） | 报告 <100KB；免迁移 |
| 订阅集合 | focus 源（一行可切换） | P2-1 前可用的最强信号 |
| 推送事件 | _alerts 增补 mybrief 事件 | 复用冷却/渠道/失败隔离 |
| 页面 | 独立路由独立组件 | 与 DailyPage 布局差异大（样图定制） |
