# 精选周刊（20-weekly-picks）Checklist

## 实现完整性

- [ ] 窗口为生成时刻前 7 天（验证：周五 18:03 触发时窗口边界正确）
- [ ] 主题归类 4 类（验证：行业大变化/重大影响/教学课程/新理解各命中示例）
- [ ] impactScore 加权（验证：同总分下行业大变化排前）
- [ ] 20 条硬上限 + 宁缺（验证：>20 候选截断；<20 显示实际数）
- [ ] 归档 ≤4 期滚动（验证：第 5 期生成后第 1 期出档）

## 集成

- [ ] cron 周五 18:03 触发（验证：GH Actions 运行记录）
- [ ] GET /api/weekly 三态 + ?issue=N 归档查询
- [ ] 周刊页刊头/导语/分组卡片/归档切换正常

## 编译与测试

- [ ] `node --check` 全部改动文件通过
- [ ] `node --test tests/regression-weekly.test.js` 全绿
- [ ] `npm test` 无新增失败
- [ ] `npm run build:vercel` 无错

## 端到端场景

- [ ] 场景 1：周五 18:03 → 首期周刊生成 → /weekly/ 完整呈现
- [ ] 场景 2：AI 故障周 → 降级产出且 meta.degraded=true
- [ ] 场景 3：第二期生成后 → 归档 pill 可切回第一期
