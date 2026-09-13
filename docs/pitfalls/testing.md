# 坑 · 测试（testing）

### #13 smoke-test 跑的是生产库副本
- 规则：smoke-test.js 启动时 backup 到临时目录 + APP_DATA_DIR 注入，结束清理；任何测试文件 require server/* 前必须先 require tests/helpers（APP_DATA_DIR 隔离），**严禁直写 data/app.db**。

### #18 回归测试必须驱动真实路由
- 案例：2026-09-05 验收发现 3 例"手写与实现相同 SQL 再断言自己"的实现式测试——实现改了测试照样绿（空转）。
- 规则：路由行为测试一律起 express 实例打真实 HTTP（tests/regression-sourcelib.test.js 是样板：app.listen(0) + generateToken + fetch）；云端 handler 用 mock req/res 直打 `api/[...slug].js`（regression-cloud-settings 模式）。

### #27 云端回归测试写真实 Turso：全量替换语义必须快照全部行（2026-09-13 事故）
- 案例：regression-cloud-settings 测 9（focusSourceIds 全量替换）的旧"恢复"只复位 2 个测试 id，而该语义 `UPDATE sources SET focus=CASE...ELSE 0 END` 写**整表** → 跑一次 npm test 把线上 8 个 focus 订阅源全部清零（audit_log 04:42 实锤）。
- 规则：①凡是"全量替换/整表 UPDATE"语义的测试，before 里快照该语义会触碰的**所有行**，finally 里用同一条语句精确还原；②用"测试前后关键集合一致"断言自证；③知悉：npm test 会直打生产 Turso（只读断言+带还原的写），跑全量前想一下此刻适不适合。

### #T1 测试并发下的偶发失败
- 症状：全量跑偶发 1-2 项失败（regression-ui-data 曾现），单跑全绿。
- 根因：node:test 并发下的端口/资源竞争。
- 规则：npm test 用 `--test-concurrency=1`（package.json 已配）；偶发失败先单跑复现再定性，别当实现 bug 修。
