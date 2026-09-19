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

### #40 Windows 上 execSync 走 cmd.exe：`^ | & % < >` 会吃掉命令，取证方向能被静默反转（2026-09-19 实测）
- 症状：`tools/eval-f2p.cjs` 第一版用 `--base ca42cd5^` 取"改动前"基线，结果 base 侧 3/3 全绿、判成"这条锁是假的"。实际上它根本没回到父提交。
- 根因：Node 的 `execSync` 在 Windows 上经 **cmd.exe** 解释整条字符串，而 `^` 是 cmd 的转义符 → `ca42cd5^` 被剥成 `ca42cd5`。git 收到的是"改动本身"，于是"改前红"永远不成立。同一类静默篡改还发生过两次：commit message 里的反引号路径被命令替换掉（内容凭空消失）、`npm test | tail` 把退出码换成 `tail` 的 0。
- 规则：①凡是**带 ref、路径、外部输入**的子进程一律 `execFile`/`execFileSync`（数组参数，不经 shell），`execSync` 只用于完全静态的命令串；②git ref 显式写 `^{commit}` 而不是裸 `^`，并**先 `rev-parse` 成 sha 再用**，比较 `baseSha === headSha` 时直接拒绝取证；③任何"取证据"的工具都要有正向探针：本例是自检里那条「base 侧必须真的看见红」——如果 base 与 head 结果一样，判假而不是判过；④交付信息（commit message）里的路径/命令不许走 shell 插值，统一 `git commit -F <文件>`。
- 案例：`tools/eval-f2p.cjs` 的 `gitRaw/git` 改造；修好后同一命令正确报出 `base 2e2c757 红 3/3 → head 0/3`。

### #41 取证基线选错，会被判成"锁是假的"——而那份判据的下一步动作是删用例（2026-09-19 实测）
- 症状：`npm run eval:f2p -- --base 64124b7 --tests tests/regression-20260919c.test.js` 报「改前也全绿 —— 这条锁抓不到 bug，按 §6 应删掉或重写断言」，指向 8 条刚写完、明知能抓 bug 的锁。
- 根因：基线 sha 是我凭记忆挑的，`64124b7` 其实是修复提交 `5aa8118` 的**子孙**——那棵树里修复早就在，"改前红"在物理上不可能发生。工具没错，错在输入；但工具把"输入错了"和"锁假了"报成同一句话，而后者附带的动作是**删除测试**，等于让一次记错 sha 变成永久削弱回归网。
- 规则：①取证基线**不靠人记**：由"这条锁在哪个提交引入"（`git log -S<用例名> -- <文件>` 取最老一条）反查，工具提供 `--auto-base`；②显式给 `--base` 时先做**基线守卫**——base 若已包含目标锁的引入提交，退出码 2 并印出建议基线与"这是取证输入错了，不是锁假了，不要按 §6 删用例"；③"改前也全绿"只允许在守卫通过之后出现，此时才是真假锁；④守卫自身要有正向探针（同一批锁在 `intro^` 上必须放行），否则一个方向写反的守卫会把所有取证都拒死——本轮 `suggestBase` 的祖先判断就反过一次，症状正是"建议基线 = 最新提交"。
- 案例：`tools/eval-f2p.cjs` 的 `lockIntroCommit/baseIsStale/suggestBase` + 自检「base 已含该修复 → 判'基线选错'而不是'锁假了'」「自动基线取最老且与传入顺序无关」；同一轮另有一条相关判据：`Cannot find module` 要按**裸包名 vs 相对路径**分成 env 红与产品红（收敛型修复只有产品红这一种取证形态）。
- 另见：坑 #40（同一工具的 shell 元字符坑）、`docs/EVAL_GUIDE.md` §6。

### #42 云端探针 URL 凭印象写 → 把"我打错域名"报成"线上故障"（2026-09-19 实测）
- 症状：推送后查线上指纹，`curl https://qwis-portal.vercel.app/api/meta` 返回 `DEPLOYMENT_NOT_FOUND`，第一反应是 Vercel 又把部署弄没了（当天正盯着 BL12）。
- 根因：`qwis-portal` 是 **GitHub 仓库名**，Vercel 应用是 `qwis-intel.vercel.app`。两个名字同源不同物，凭印象必错；而 `DEPLOYMENT_NOT_FOUND` 这个响应长得极像"部署不存在"的真实故障。
- 规则：①任何外部探针（URL、参数名、字段名）必须**从仓库里抄**——`grep` 权威文档或代码，不许凭记忆；②探针失败先自查请求本身（换一个已知肯定存在的端点、看响应体是不是自家服务的错误页格式），再下"线上坏了"的结论；③这条是 `docs/EVAL_GUIDE.md` §3.3「探针参数不许猜」的域名版，判据同源，只是本轮换个维度又踩了一次。
- 案例：本轮实测；`docs/EVAL_GUIDE.md` §3.1「远端已部署」以 `/api/meta` 的 `commit` 指纹为准，权威域名见 `docs/FEATURE_MATRIX.md`。

### #43 检查器把"失败理由字符串"当成通过：`pass: !!verdict` 让云端巡检永远满分（2026-09-19 实测）
- 症状：`node tools/audit-cloud.js` 输出「通过 19/19」，但同一行里写着 `✅ 采集端点鉴权 405 应401实际405`、`✅ 源列表异常`、`✅ 文章列表去重 deduped 标记缺失`——**报告里带着失败理由，却按通过计数**。
- 根因：判据函数约定"返回 `true` 通过、返回字符串给出失败理由"，而汇总处写的是 `pass: !!verdict`。非空字符串是 truthy，于是每条失败理由都被判成通过，理由反倒降级成一条附注。叠加第二个坑：该脚本基址写死在 2026-09-11 就已下架的 `qwis-portal.vercel.app`（坑 #42 同源，全库第 5 份手写副本），所以它 8 天来打的都是 404。
- 规则：①判据函数的返回类型必须**单一**：要么返回布尔，要么返回对象 `{pass, note}`，禁止"字符串=失败但用 truthy 判过"这种双关；②检查器一律要求 `pass === true` 才算通过（`verdictToResult` 即此判据），任何 `!!x` 式的宽判都要在锁里写明为什么宽；③检查器自身必须有**退出码**（有失败即非 0），否则人眼读完就散了，进不了任何门禁；④判据里的字段名、状态码、参数名一律**实测得来并写明出处**（本轮三条原判据分别错在：`b.items` 应为 `b.sources`、GET 断 401 应为 POST 断 403、`deduped` 字段云端压根不存在）；⑤契约不存在的检查**改成显式"未验收"第三态**（`SKIP:理由`），既不假装通过也不静默删除——删除会让缺口消失，明说会让缺口进清单。
- 案例：`tools/audit-cloud.js` 的 `verdictToResult` + `if (require.main === module) main()` 守卫；回归锁 `tests/regression-20260919e.test.js`（B64/B65/B66 共 8 条，含"正向探针"锁与"判据必须对得上实测契约"锁）。同一形态在 #T3（检测器只覆盖一种形态）与 #38（能力只用文案表达）已各发生过一次，本条是第三次。

### #44 分类器的正则跨行匹配会"造出"证据——一次合法取证被判成环境失败（2026-09-19 实测）
- 症状：给 41-8 的新文件出 F2P 证据时，工具拒绝：`base 侧有环境类失败（元凶：, ⏎ syscall: ）`。所谓"缺失路径"是两个换行之间的碎片，根本不存在这个文件。
- 根因：`/ENOENT[^\n]*?'([^']+)'/` 想抓 `ENOENT ... '路径'`，但 Node 抛出的对象 dump 长这样：`code: 'ENOENT',` 换行 `syscall: 'spawn python3',`。前缀 `[^\n]*?` 停在本行的引号上，捕获组 `[^']+` **却没禁换行**，于是跨过行首空白抓到 `,` + 换行 + `    syscall: ` 当作"路径"。分类器过宽时，它不是"漏判"而是**凭空造证据**。
- 规则：①抓路径/标识符的正则必须显式禁掉换行（`[^'\n]` 而不是 `[^']`），并用"必须同行出现"的结构锚定；②任何被分类器判成"环境红"的结果都要**点出原路径**（`envPaths`），报"有环境问题"而不给名字，等于让人瞎猜——这也是本轮加的要求；③分类器自身要同时有"树内=产品红 / 树外=环境红"两个方向的探针，以及一条"畸形输入不许产出结果"的探针（对象 dump 就是这类输入）；④同一套"树内/树外"判据要覆盖所有失败形态（`Cannot find module` 与 `ENOENT` 是同一件事的两种写法，只覆盖一种就是 #T3 的老坑）。
- 案例：`tools/eval-f2p.cjs` 的 `parseSummary(text, cwd)`/`repoRel()`；回归锁「41-3 ENOENT 按树内/树外分类，且正则不许跨行造出假路径」+ 取证器自检里「Node 的对象 dump 不许被当成缺失路径」。

