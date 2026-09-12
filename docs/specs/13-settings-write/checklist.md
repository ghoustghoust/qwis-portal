# 设置写 API 上云（13-settings-write）Checklist

> 每一项通过运行代码或观察线上行为验证。

## 实现完整性

- [ ] `PUT /api/settings` 存在且按分区合并写生效（验证：线上带 JWT PUT `{data:{retentionDays:14}}` → GET 读回 retentionDays=14）
- [ ] `GET /api/settings/daily` 返回完整结构（验证：线上 GET 响应含 windowHours/time/articleSources/videoSources/columns/defaultColumns 六个键）
- [ ] `PUT /api/settings/daily` 生效（验证：PUT `{windowHours:72}` → GET 读回 72 → 恢复 48）
- [ ] 敏感键留空不覆盖（验证：先确认 queue 已配 token；PUT `{queue:{token:'', intervalMin:15}}` → GET 仍 `tokenConfigured:true` 且 intervalMin=15）
- [ ] AI 区锁定（验证：PUT `{ai:{model:'x'}}` → 400，错误文案含「环境变量」；GET /api/settings 的 ai 区不受影响）
- [ ] 黑名单拦截（验证：PUT `{intervals:{}, "auth.secret":"hack"}` → 400；随后 GET /api/status 正常，无异常写入）
- [ ] 先校验后写入（验证：PUT 同时带合法 intervals 和非法 views → 400；GET 读回 intervals 未变化）
- [ ] 审计留痕（验证：上述成功写入后 GET /api/audit?action=settings.update 有记录，detail.sections 正确）

## 集成

- [ ] 管理后台「日报设置」Tab 在云端可读取并可保存（验证：Playwright 打开线上 /admin/ 日报设置，修改时间保存，刷新后值仍在）
- [ ] 管理台保存视图生效（验证：线上阅读器侧栏保存一个视图，刷新页面后视图存在）
- [ ] 本地端行为未受影响（验证：本地 `npm test` 通过；本地 GET /api/settings 输出不变）

## 编译与测试

- [ ] `node --check api/[...slug].js` 通过
- [ ] `node --test tests/regression-cloud-settings.test.js` 全绿（10 用例）
- [ ] `npm test` 全量通过
- [ ] `npm run build:vercel` 构建无错

## 端到端场景

- [ ] 场景 1（用户改日报时间）：线上 /admin/ 日报设置把时间改为 07:30 → 保存成功 → GET /api/settings/daily 返回 time=07:30 → 改回 08:00
- [ ] 场景 2（防污染复现）：模拟向云端写错误 ai.apiBase → 被拒绝 400 → 云端 ai/ping 仍 200（AI 链路不受 settings 污染——回归 2026-09-11 事故）
- [ ] 场景 3（runner 拾取）：PUT daily windowHours=72 后，下一次 runner 日报任务使用新窗口（验证：观察下一份日报 window_hours 字段=72 后恢复）
