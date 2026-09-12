# B站采集移植 runner（21-bilibili-runner）Checklist

## 实现完整性

- [ ] wbi 签名与本地逐字一致（验证：固定参数+key → w_rid 相同）
- [ ] 三链路 fallback（验证：主链失败时日志可见兜底切换）
- [ ] saveVideos 幂等（验证：重复采集 videos 表不重复）
- [ ] 匿名 buvid 降级（验证：无 Cookie 时采集仍成功）
- [ ] 诊断端点三态（验证：GET bilibili-diagnose 返回 cookieConfigured/wbiKeyRefreshed/loginOk）

## 集成

- [ ] runner 实采（验证：GH Actions 日志 bilibili 源 ✓ + videos 表新行）
- [ ] 前端视频流出现 B站内容（验证：/api/videos 返回新视频）
- [ ] Cookie 失效报警归类（验证：-101 错误被分类为登录态失效）

## 编译与测试

- [ ] `node --check` 全部改动文件通过
- [ ] `node --test tests/regression-bilibili.test.js` 全绿
- [ ] `npm test` 无新增失败
- [ ] `npm run build:vercel` 无错

## 端到端场景

- [ ] 场景 1：后台加一个 UP 主源 → 下轮 runner 采到其最新视频 → 阅读器视频流可见
- [ ] 场景 2：Cookie 过期 → 匿名降级继续采集 + 报警提示登录态失效
