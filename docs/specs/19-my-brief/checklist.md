# 我的早报（19-my-brief）Checklist

## 实现完整性

- [ ] 订阅过滤（验证：mybrief 报告所有条目的 source_id ∈ focus 集合）
- [ ] 分层约束（验证：top≤3、featured≤7、rest≤40；按总分排序）
- [ ] 编辑导语 + 关键词标签行（验证：报告含 theme 与 keywords ≤8）
- [ ] 无破圈（验证：报告无 fallback 栏目/热榜来源条目）
- [ ] 三态 API（验证：focus=0 → no-subscription；有订阅无内容 → no-content；正常 → sections 三层）

## 集成

- [ ] 共享深析池（验证：daily-ai 日志中 mybrief 组装阶段无额外 analyze 调用）
- [ ] 飞书推送（验证：推送开启时收到「我的早报 · M月D日」+ 导语 + 头条 3 条）
- [ ] 前端三态（验证：浏览器三种状态渲染正确，卡片含 TOP 角标/评分/金句/观点/「来自你的关注」）

## 编译与测试

- [ ] `node --check` 全部改动文件通过
- [ ] `node --test tests/regression-my-brief.test.js` 全绿
- [ ] `npm test` 无新增失败
- [ ] `npm run build:vercel` 无错

## 端到端场景

- [ ] 场景 1：标记 3 个 focus 源 → dispatch → /mybrief/ 出现订阅专属早报
- [ ] 场景 2：focus 全部取消 → /mybrief/ 显示引导态（去源库标记订阅）
- [ ] 场景 3：次日 09:00 → 页面已更新 + 飞书已收到导语
