# 精选周刊（20-weekly-picks）Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `tools/collect-turso.js` | +runWeekly + weekly 模式注册 |
| 修改 | `.github/workflows/collect.yml` | +weekly cron（周五 18:00 北京 = '3 10 * * 5' UTC）+ job |
| 修改 | `api/[...slug].js` | +handleWeekly（?issue=N）+ 路由 + 白名单 |
| 新建 | `web/src/pages/WeeklyPage.jsx` | 周刊页 |
| 修改 | `web/src/main.jsx`、`web/src/i18n.jsx` | 路由/导航/文案 |
| 新建 | `tests/regression-weekly.test.js` | 回归测试 |
| 修改 | docs 三件 | 文档同步 |

## T1: runWeekly 生成管线

**文件：** `tools/collect-turso.js`
**依赖：** 无
**步骤：**
1. 窗口 [now-7d, now)；候选查询（非热榜/非聚合器/启用源，≤2000）
2. 初筛 filterArticle → 深析 analyzeArticle（≤150，预算 60min）
3. classifyWeeklyTheme 规则归类（4 类关键词映射）
4. impactScore 加权排序 → top 20（宁缺）
5. generateTheme 导语
6. 期号=archive 尾+1；写 weekly.latest + archive 追加（≤4 期完整报告）
7. 降级：AI 连败 → 热度排序产出 + degraded

**验证：** `node --check` + T5 用例

## T2: workflow weekly job

**文件：** `.github/workflows/collect.yml`
**依赖：** T1
**步骤：**
1. cron '3 10 * * 5'（UTC 周五 10:03 = 北京 18:03）
2. job weekly：`node tools/collect-turso.js weekly`（含 AGNES_API_KEY env）

**验证：** yaml 语法

## T3: GET /api/weekly

**文件：** `api/[...slug].js`
**依赖：** 无
**步骤：**
1. handleWeekly：默认透传 weekly.latest；?issue=N 从 archive 找对应期
2. 空态 {empty:'no-content'}；路由+白名单

**验证：** T5 用例

## T4: WeeklyPage 前端

**文件：** `web/src/pages/WeeklyPage.jsx` + main.jsx + i18n.jsx
**依赖：** T3
**步骤：**
1. 刊头（第 N 期 + 日期范围 + 导语）+ 归档 pill 切换
2. 类别分组（行业大变化/重大影响/教学课程/新理解/其它）+ rank 卡片（复用 BriefCard 元素 + 类别徽章）
3. 导航「精选周刊」（DocIcon）+ i18n 键

**验证：** 构建 + 浏览器实测

## T5: 回归测试

**文件：** `tests/regression-weekly.test.js`
**依赖：** T1-T3
**步骤：**
1. 用例：① 窗口=7 天 ② 归类规则 4 类命中 ③ impactScore 加权排序 ④ top20 硬上限与宁缺 ⑤ API 空态/正常/归档查询 ⑥ archive ≤4 期滚动
2. AI 打桩

**验证：** 全绿

## T6: 文档 + 验收

**步骤：** docs 同步 → push → （配额恢复后）周五 18:03 首次真实运行验证

## 执行顺序

```
T1 → T2 → T3 → T4 → T5 → T6
```
