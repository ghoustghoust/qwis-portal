# 每日早报 v2（18-daily-ai-v2）Checklist

## 实现完整性

- [ ] 深析输出结构（验证：跑 analyzeArticle 真实 Agnes，返回含六维分数/totalScore/reason/summary/quote/points/tags）
- [ ] 主题导语生成（验证：导语 ≤60 字且与当日内容相关）
- [ ] 自然日窗口（验证：窗口边界用例跨日/跨月正确）
- [ ] 栏目组装（验证：focus 源优先进重点更新栏；fallback 按总分排序）
- [ ] 降级链（验证：AI 全挂时生成关键词版且 stats.degraded=true）
- [ ] 前端导语区 + AI 卡片（验证：浏览器打开早报页可见导语、评分星、金句引用块、观点 bullets）
- [ ] 旧格式兼容（验证：历史关键词版报告仍正常渲染）

## 集成

- [ ] cron 00:32 触发（验证：GH Actions 定时运行记录）
- [ ] GET /api/daily 透出 theme/degraded（验证：线上响应含字段）
- [ ] 后台日报设置的栏目/focus/来源勾选影响生成（验证：改设置后次日报告对应变化）

## 编译与测试

- [ ] `node --check` 全部改动文件通过
- [ ] `node --test tests/regression-daily-ai.test.js` 全绿
- [ ] `npm test` 无新增失败
- [ ] `npm run build:vercel` 无错
- [ ] 黄金集评测脚本可跑且分布合理（优文均分显著高于劣文）

## 端到端场景

- [ ] 场景 1：手动 dispatch daily-ai → 90min 内 Turso 出现 v2 报告 → 早报页完整呈现
- [ ] 场景 2：Agnes 故障日 → 关键词版降级早报仍生成 → meta 标记 degraded
- [ ] 场景 3：用户 09:00 打开早报 → 看到导语 + AI 策展内容 + 每篇推荐理由
