# 云端报警引擎（15-cloud-alerts）Checklist

## 实现完整性

- [ ] 7 渠道发送器在云端可用（验证：配 webhook 测试渠道 → POST /api/alerts/test → webhook 收到消息）
- [ ] 冷却生效（验证：同一事件同源连发两次 → 第二次 skipped:cooldown）
- [ ] 静默规则生效（验证：配置 silence 规则后对应事件不发送）
- [ ] 掩码合并（验证：GET config 密钥为 ********；PUT 回写掩码后真实密钥仍可用——test 发送成功）
- [ ] 错误分类器（验证：youtube+HTTP 404 → 文案含「反爬封锁」与「无需处理」；超时 →「下轮自动重试」）
- [ ] frozen_digest（验证：清理任务运行时若有熔断源则收到汇总；无则不发）

## 集成

- [ ] runner 采集轮失败源触发报警（验证：观察 GH Actions 日志 `[alerts]` 输出 + 渠道收到）
- [ ] 日报失败触发 daily_failed（验证：模拟/观察）
- [ ] 本地端文案升级（验证：本地源失败报警文案含原因分类）
- [ ] 报警失败隔离（验证：渠道全部不可达时 runner 采集任务 exit 0 正常完成）

## 编译与测试

- [ ] `node --check` api/_alerts.js + api/[...slug].js + tools/collect-turso.js 通过
- [ ] `node --test tests/regression-cloud-alerts.test.js` 全绿
- [ ] `npm test` 无新增失败
- [ ] `npm run build:vercel` 无错

## 端到端场景

- [ ] 场景 1（配置到报警闭环）：管理台配 Bark 渠道 → 测试消息到手机 → 制造一次源失败 → 收到含原因分类的报警
- [ ] 场景 2（停滞报警）：采集停滞 1h → 收到 collect_stalled
- [ ] 场景 3（不沉默）：存在熔断源时，次日 04:13 收到 frozen_digest 汇总
