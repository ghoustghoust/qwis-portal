# 精选周刊（20-weekly-picks）Plan

## 架构概览

```
GH runner（每周五 18:00 北京，新 cron '3 10 * * 5' UTC，用户拍板）
  └─ node tools/collect-turso.js weekly
       ├─ 窗口：生成时刻往前 7 天
       ├─ 候选：全源非热榜非聚合器 ≤2000
       ├─ 初筛：filterArticle ×N（16 通道）
       ├─ 深析：analyzeArticle ×通过者（≤150）
       ├─ 主题归类：classifyWeeklyTheme(title+summary+tags) → 4 类
       ├─ 终选：impactScore = totalScore × 类别权重 → top 20
       ├─ 导语：generateTheme
       └─ 落库：settings['weekly.latest'] + 归档 settings['weekly.archive'] ≤4 期
                        │
Vercel: GET /api/weekly（公开读，含 ?issue=N 归档查询）
前端: /weekly/ → WeeklyPage（刊头/导语/类别分组卡片/归档切换）
```

## 核心数据结构

### settings['weekly.latest']
```json
{
  "issue": 3, "dateStart": "2026-09-07", "dateEnd": "2026-09-14",
  "theme": "本周主线……", "degraded": false, "generatedAt": "…",
  "items": [{
    "rank": 1, "id": 0, "title": "", "url": "", "source": "", "cover": null,
    "totalScore": 90, "scores": {}, "reason": "", "summary": "", "quote": "",
    "points": [], "tags": [], "weeklyTheme": "行业大变化|重大影响|教学课程|新理解|其它",
    "impactScore": 95
  }]
}
```

### settings['weekly.archive']
```json
[{ "issue": 3, "dateStart": "", "dateEnd": "", "theme": "", "count": 20 }]
```

## 模块设计

### tools/collect-turso.js — `runWeekly()`
- 窗口计算：[now-7d, now)，北京周五 18:00 触发
- 候选/初筛/深析复用 daily-ai 的同族逻辑（抽公共：候选查询参数化窗口，或独立实现保持简单）
- `classifyWeeklyTheme(item)`：规则优先（关键词映射 4 类），不确定归「其它」——不调 AI（省配额）
  - 行业大变化：发布/上线/收购/融资/政策/监管/离职/裁员
  - 重大影响：安全/漏洞/下架/事故/成本/价格
  - 教学课程：教程/指南/实战/课程/训练营/入门/手册
  - 新理解：观点/思考/复盘/范式/趋势/方法论
- impactScore = totalScore × weight（行业大变化 1.2 / 重大影响 1.15 / 教学课程 1.1 / 新理解 1.05 / 其它 0.9）
- 期号：weekly.archive 最后 issue+1（无则 1）

### api/[...slug].js — `GET /api/weekly`
- 默认透传 weekly.latest；`?issue=N` 从 archive 返回对应期（archive 只存索引则提示仅最新期完整可查——决策：archive 存完整报告，≤4 期）
- 公开白名单加路径

### web/src/pages/WeeklyPage.jsx（新建）
- 刊头：「精选周刊 · 第 N 期」+ dateStart~dateEnd + 导语
- 类别分组渲染（行业大变化/重大影响/教学课程/新理解/其它），组内按 rank
- 卡片复用 MyBrief 的 BriefCard 元素（评分/理由/金句/观点/标签/封面）+ 类别徽章
- 归档切换（顶部 pill 行：第 N 期/第 N-1 期…）
- 导航入口（SunIcon 后，CalendarIcon 变体或 DocIcon）

## 模块交互

```
cron 周一 00:45 → runWeekly → settings.weekly.latest/archive
用户 /weekly/ → GET /api/weekly(?issue=N) → WeeklyPage
```

## 文件组织

```
tools/collect-turso.js        — +runWeekly + weekly 模式注册
.github/workflows/collect.yml — +weekly cron（周一 00:45 北京）+ job
api/[...slug].js              — +handleWeekly + 路由 + 白名单
web/src/pages/WeeklyPage.jsx  — 新建
web/src/main.jsx              — 路由 + 导航
web/src/i18n.jsx              — nav.weekly
tests/regression-weekly.test.js — 新建
docs/ 同步
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 主题归类 | 规则关键词，不调 AI | 省配额；4 类边界清晰可枚举 |
| 归档 | archive 存完整报告 ≤4 期 | 查询简单；单期 ~50KB 可接受 |
| 候选查询 | 独立实现（参数化窗口） | daily-ai 的查询已特化自然日，硬抽公共易引入回归 |
| 期号 | archive 尾 issue+1 | 简单可靠 |
| 生成时间 | 周五 18:00 北京（用户拍板） | 周末阅读场景 |
