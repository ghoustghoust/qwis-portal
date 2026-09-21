# 我的早报（19-my-brief）Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `tools/collect-turso.js` | +runMyBrief + runDailyAi 尾部调用 + 候选查询补 source_id |
| 修改 | `api/_alerts.js` | DEFAULT_EVENTS 增补 mybrief |
| 修改 | `api/[...slug].js` | +handleMyBrief + 路由 + 公开白名单 |
| 新建 | `web/src/pages/MyBriefPage.jsx` | 我的早报页（三态） |
| 修改 | `web/src/App.jsx`、`web/src/components/Header.jsx`（或导航所在文件） | 路由 + 导航入口 | <!-- doc-lint:ignore：spec 19 已交付，其后 SPA 重构为 main.jsx/admin.jsx，本行是当时的事实 -->
| 新建 | `tests/regression-my-brief.test.js` | 回归测试 |
| 修改 | docs 三件 | 文档同步 |

## T1: runMyBrief 生成管线

**文件：** `tools/collect-turso.js`
**依赖：** 无
**步骤：**
1. 候选查询 SELECT 列表补 `a.source_id`
2. `runMyBrief(analyzed)`：订阅集合查询（focus=1 AND enabled=1）→ 空则跳过并写 `{empty:'no-subscription'}` → 过滤 → 按 totalScore 排序 → 切层 top 3/featured 7/rest ≤40 → generateTheme → 高频 tags ≤8 → 写 settings['mybrief.latest']
3. runDailyAi 落库后调用 runMyBrief(analyzed)（降级路径时传空数组 → 写空态）
4. 推送：`_alerts.dispatch('mybrief', {title, text})`（pushEnabled 判断 + 无内容跳过）

**验证：** 本地限量跑（先标记 2 个 focus 源）Turso 出现 mybrief.latest

## T2: alerts 事件增补

**文件：** `api/_alerts.js`
**依赖：** 无
**步骤：**
1. DEFAULT_EVENTS 加 `mybrief: true`

**验证：** `node --check`

## T3: GET /api/mybrief

**文件：** `api/[...slug].js`
**依赖：** 无
**步骤：**
1. `handleMyBrief`：订阅集合空 → `{ok:true, empty:'no-subscription'}`；否则读 settings.mybrief.latest 透传（无则 `{empty:'no-content'}`）
2. 路由 + PUBLIC_GET_PATHS 加 `/api/mybrief`

**验证：** T6 用例

## T4: MyBriefPage 前端

**文件：** `web/src/pages/MyBriefPage.jsx` + 路由/导航
**依赖：** T3（联调）
**步骤：**
1. 三态渲染（引导/空态/正常）
2. 正常态按样图：大日期 → 导语 → 关键词 pill 行 → 头条推荐（TOP 角标大卡片，封面右置）→ 精选内容 ≤7 → 补充阅读紧凑行 ≤40
3. 类型筛选器（全部/文章/视频可用；播客/推文置灰预留）
4. 「来自你的关注」徽章 + 评分星 + 理由/金句/观点/标签（复用样式类）
5. 路由注册 + 导航「我的早报」入口

**验证：** 构建 + 浏览器实测三态

## T5: 回归测试

**文件：** `tests/regression-my-brief.test.js`
**依赖：** T1-T3
**步骤：**
1. 用例：① focus=0 → no-subscription ② 标记 focus 源 → runMyBrief 只含订阅源 ③ 分层数量约束（top≤3/featured≤7/rest≤40）④ 无 fallback 栏来源混入（无破圈）⑤ GET /api/mybrief 三态响应
2. 测试数据用后即清（focus 复位、mybrief.latest 恢复）

**验证：** 全绿

## T6: 文档 + 线上验收

**步骤：** docs 同步 → push → 标记 focus 源 → dispatch 验证生成 → 前端截图 → 飞书推送确认

## 执行顺序

```
T1 → T2 → T3 → T4 → T5 → T6
```
