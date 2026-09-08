# 订阅源库管理 + 源自动分类 Checklist

> 依据：spec.md 的 AC1-AC13 与 plan.md 的 13 条决策。每项均可通过运行代码或观察行为验证，不依赖逐行读码。

## 实现完整性

- [ ] 分类纯逻辑正确（验证：`node --test tests/classify.test.js` 全绿：关键词命中「腾讯技术工程」→编程技术；英文别名 Programming & Technology 与中文「编程技术」归一到同一目录项；无命中返回 null)
- [ ] 落组复用不重复建组（验证：测试断言——同名同 kind 复用；「人工智能」不并入现有「AI」组而是新建）
- [ ] OPML 层级解析覆盖存量（验证：测试断言 buildOpmlCategoryMap 的 Map 大小 >100，且抽查一个 YouTube 源 url 命中分类）
- [ ] 三个新增源挂接点生效（验证：回归测试——手动 POST 建源自动入组；syncOpml 新增源自动入组）
- [ ] 接口鉴权（验证：无 token `curl -X POST /api/sources/batch` 与 `/api/sources/autoclassify` 均返回 401;`GET /api/sources/library` 公开可达）

## 集成

- [ ] 批量启用=解冻语义+错峰（验证：回归测试——熔断源经 batch enable 后 enabled=1 且 fail_count=0 且 lastError 已清；多源 enable 后各 next_fetch_at 互不相同且落在 now~now+6h 窗口）
- [ ] 批量特别关注增量语义（验证：回归测试 AC12——先给源 A 设 focus=1，再 batch focus 源 B，断言 A 的 focus 仍为 1)
- [ ] move 跨类型拒绝+锁定（验证：回归测试——video 源 move 到 article 组返回 400;move 成功后 extra.categoryLocked=1)
- [ ] autoclassify dryRun 不落库（验证：回归测试——dryRun 前后 `SELECT COUNT(*) FROM sources WHERE group_id IS NOT NULL` 不变；apply 跳过 locked 源）
- [ ] 破茧栏名单联动（验证：apply 回填后 `settings['daily.cocoonFamiliar']` 包含所用分类组名；`node --test tests/regression-sourcelib.test.js` 相关断言通过）
- [ ] 路由无截胡（验证：POST /api/sources/batch 返回非 404;GET /api/sources 现有响应结构不变——items 仍含 unread 字段）

## 编译与测试

- [ ] `npm test` 全绿（含既有全部用例无回归）
- [ ] `npm run build` 通过（web 双入口构建无错）
- [ ] `node smoke-test.js` 通过（生产库副本零副作用冒烟）

## 端到端场景

- [ ] **场景 1（源库浏览+筛选，AC1/AC2/AC11)**：启动服务 → /admin/ 默认落「源库」Tab → 列表行含头像/占位、类型徽章、文件夹、状态徽章、条目数、最近抓取；组合筛选「类型=播客 + 状态=仅熔断」结果与数据库对照一致；三套主题逐一切换无违和；任何窗口宽度无横向滚动条
- [ ] **场景 2（批量关注，AC3)**：勾选 3 个已停用源 → 批量启用 → toast 显示成功计数 → 阅读器 Sidebar 出现这 3 个源 → 数据库 next_fetch_at 分散在未来 6h 内；再批量停用 → Sidebar 消失、调度器不再采集
- [ ] **场景 3（手动改归+锁定，AC4)**：源库中对某源下拉改组（下拉只出现同 kind 组）→ Sidebar 该源出现在新组；在阅读器 Sidebar 把另一源拖到别组 → 源库中该源显示 🔒；跨类型 move（视频源→文章组）被接口拒绝并提示
- [ ] **场景 4（新源自动分类，AC5)**：管理台添加一个名称含「技术」的 RSS 源 → 创建后自动归入「编程技术」；添加一个无命中源 → 保持未分组
- [ ] **场景 5（存量回填预览→执行，AC6/AC13)**：点「自动分类回填」→ 预览默认只列建议变更、每条含依据徽章、可见「跳过锁定 N 条」→ 取消 → 数据库无变化；再开 → 应用 → toast「已应用 N 项」→ Sidebar 分组结构变化；🔒 源位置不变；手动锁定源勾选「包含」后才会被变更
- [ ] **场景 6（特别关注互不干踩，AC12)**：日报设置页勾选源 A 为 focus → 源库批量特别关注源 B → 回日报设置页，A 仍勾选
- [ ] **场景 7（兼容性回归，AC10)**：阅读器分组导航、拖拽入组、全部已读、日报源勾选、热点榜分类筛选——与改版前行为一致
