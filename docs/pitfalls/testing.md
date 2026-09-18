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

### #T2 云端测试覆盖写生产 `settings` 且 `after()` 静默失败：报警链路被打死 2 天（2026-09-19）
- 症状：后台报警日志显示"已触发"，但 `audit_log` 最近三条真实事件全是 `sent:0/total:1`；线上 `settings.alerts.channels` 只剩 `{id:'test-ch',name:'TEST',url:undefined,enabled:true}`，silence 里留着 `sourceId:777777`。
- 根因：`tests/regression-cloud-alerts.test.js` 直连生产 Turso 并 `saveConfig()`，测试数据字字对应（777777 只存在于该文件），`after()` 恢复未生效且无人断言 → 生产配置被测试写坏。这是 #13「云端测试直打生产库」的复发，这次打死的正是"告诉我们出事了"的那条链路。
- 规则：①写生产配置的测试必须**快照 → 写入 → 还原 → 断言还原成功**，断言失败要让测试变红（不能只 catch）；②生产写路径要有"测试指纹守卫"（识别 `test-` 前缀 id、`127.0.0.1` 回调地址、777777 之类哨兵值即拒绝写入并告警）；③报警/凭据这类"自证链路"的键，任何改动后必须跑一次真实投递验证（`POST /api/alerts/test` 收到消息才算完）；④**监控显示"已触发"不等于"已送达"**，UI 必须区分 `dispatched` 与 `delivered`。
- 案例：`docs/ISSUES.md` B44/BL7；恢复入口 `tools/sync-alerts-config.js --force`（本地 `settings.alerts.channels[].config.url` 是真值来源）。

### #T3 检测器只覆盖一种形态 = 假门禁；"确实被读"不等于"被消费"（2026-09-19 实测）
- 症状：`settings.ai.features` 挂着 4 个复选框和「x/4 已启用功能」统计，白盒 W3 却报绿。用户据此以为 AI 功能可开关，实际「摘要/分类/事件关联」全是规则实现。
- 根因：W3 的判据是**后端从不 getSetting**。而 `ai.features` 确实被 getSetting 读了——只是读它的那一行只是把它塞进同一个 GET 响应的属性里，供界面回显。写回 → 显示 → 没有任何行为分支消费，闭环在设置页内部。
- 规则：①写"假开关检测"时必须同时覆盖两种形态——**无人读**与**只被自己回显**（判据：某键的每一处 `getSetting` 都长得像响应对象属性，见 `tools/eval-whitebox.cjs` W3b）；②任何新检查器上线前做**负向验证**：造一个该缺陷的最小样本（本轮造 `ai.fakeDemo`：GET 回显 + PUT 写回 + 界面含该键），确认它会红，再删掉确认变绿；没做负向验证的检查器视同不存在；③近似重复的判定要按**特征集合重叠度**判，不按字面量全等（见坑 #37 与 W10）。
- 案例：B51；同一形态在断言层也发生过一次（B53 第一版正则永不命中 → 坏代码在场仍显示绿），规则见 `docs/EVAL_GUIDE.md` §4.1。
