# 源写 API 上云（14-sources-write）Checklist

> 每一项通过运行代码或观察线上行为验证。

## 实现完整性

- [ ] `POST /api/sources` 新增源生效（验证：线上带 JWT POST 测试源 → 返回含 id 的 item；GET /api/sources 列表可见）
- [ ] 幂等（验证：同 url 重复 POST → 不产生第二条记录）
- [ ] `DELETE /api/sources/:id` 级联（验证：删测试源后其文章同步消失）
- [ ] `POST /api/sources/:id/refresh` 标记到期（验证：返回文案含"runner"；DB 中 next_fetch_at 为 NULL）
- [ ] `PUT /api/sources/:id/interval` 校验（验证：0/负数/非数 → 400；合法值写入 extra.intervalMin）
- [ ] `POST /api/sources/batch` 全 action（验证：enable 解冻+错峰 / disable / focus 增量 / move kind 校验——故意 move 一个 kind 不匹配的分组，该项报错其余成功）
- [ ] `POST /api/sources/autoclassify` 两模式（验证：dryRun 返回建议且 DB 快照前后无变化；apply 只动建议中的源且跳过锁定源）
- [ ] `/api/groups` 写（验证：建组→改名→move 源进组→删组后源回未分组）
- [ ] 审计（验证：source.create/delete/batch 等在 /api/audit 可见）

## 集成

- [ ] 管理后台「源库」Tab 云端批量操作可用（验证：线上 /admin/ 源库勾选两个源批量 focus → 列表星标出现）
- [ ] 新源被 runner 拾取（验证：测试源创建后 ≤15min 内 last_fetched_at 更新，随后清理删除）
- [ ] 本地端不受影响（验证：本地 `npm test` 通过）

## 编译与测试

- [ ] `node --check api/[...slug].js` 与 `api/_classify.js` 通过
- [ ] `node --test tests/regression-cloud-sources.test.js` 全绿（12 用例）
- [ ] `npm test` 全量无新增失败（存量 3 项 taskQueue 失败除外，已立项 P2-10）
- [ ] `npm run build:vercel` 构建无错

## 端到端场景

- [ ] 场景 1（加源全流程）：线上管理台加一个 RSS 源 → 自动分类入组 → 下轮 runner 抓到文章 → 阅读器该组出现内容
- [ ] 场景 2（批量治理）：源库筛选出 3 个源 → 批量移到新建分组 → 侧栏分组结构更新
- [ ] 场景 3（防误删）：DELETE 一个不存在 id → 404 且无任何数据变化
