# 坑 · 部署与运维（deployment）

### #5 bat 文件必须 GBK 编码
- cmd 按 ANSI 解析；用 `tools/gen_bat.py` 生成，别手改。

### #20 GH Actions Secrets 与 Vercel env 是两套独立存储（2026-09-11 事故）
- 案例：COLLECT_KEY 只改一边 → 全部定时任务 403 **静默失败 2 天**才发现（数据停在 09-09）。
- 规则：密钥三处同步（本地 .env / Vercel env / GH Secrets）+ 失败要有报警（15-cloud-alerts 已建）。

### #21 vercel.json 不做 ${VAR} 插值，且 Vercel Cron 用 GET
- 案例：crons 块写 `?key=${COLLECT_KEY}` 传字面量 + collect.js 只收 POST → 该 cron 从未生效。
- 规则：vercel.json **永不加 crons 块**，定时任务全归 GH Actions。

### #22 本地代理必须 undici 自带 fetch + ProxyAgent 配套；进程退出用 exitCode
- 症状：把外部 undici 的 ProxyAgent 喂给 Node 内置 fetch → 全部 "fetch failed"（符号不兼容）。
- 规则：走代理时 `require('undici')` 的 fetch + ProxyAgent 成对使用（tools/collect-turso.js 是参考实现）；脚本末尾 `process.exitCode = 0` 自然退出，`process.exit(0)` 会触发 libuv 断言（exit 127）。
- 附：本机 Clash 实际端口 **12000**（2026-09-13 起，7890 已失效）；git 已配 http.proxy；`.env` HTTPS_PROXY=12000。

### #D1 push 后必须验证远端 SHA（2026-09-13 事故）
- 案例：修复 commit 后 push 的后台任务超时被杀未察觉，修复滞留本地 2 小时。
- 规则：`git push` 后必须 `git ls-remote origin main` 核对 SHA == 本地 HEAD；本机 push 需显式 HTTPS_PROXY（已固化 git config http.proxy=127.0.0.1:12000）。
- 附：快照 bot 会自动推 `chore: update data snapshots` commit，push 被拒（non-fast-forward）时先 `git pull --rebase` 再推。

### #D2 workflow 里加 AI 步骤必须检查所在 step 的 env 挂载（2026-09-15 事故）
- 症状：quickscore 挂在 collect 步尾部，runner 日志连续「未配置 AI API Key」，精选自 09-14 断更一天；21:30 晚间主批同样缺 key，深析全灭降级。
- 根因：`AGNES_API_KEY` 只挂在 translate/daily-ai(00:32)/weekly 三个 step 的 env 里，collect 步与 daily-ai-evening 步没挂——密钥"三处同步"（坑 #20）在 workflow 内部的变体：**同一 job 内不同 step 的 env 也是独立的挂载面**。
- 规则：runner 脚本里任何新增 AI 调用（quickscore/补分/深析），先确认它所在 step 的 env 有 AGNES_API_KEY；日志里出现「未配置 AI API Key」先查 workflow env 而不是代码。

### #D3 「已推到 origin」不等于「线上在跑」——交付验收必须比服务中的 commit（2026-09-19 复发）
- 症状：`git push` 连推 5 次全绿，`npm test` 全绿，本地读代码确认改动都在，但线上行为一点没变。真因是 Vercel 的 Git 触发在这段时间没产生新 deployment，production 还停在 36 分钟前那一份。
- 为什么会漏：AGENTS §2.1 把"push 即触发部署"当成事实，于是所有验收都建立在"push 成功"这个代理信号上；`eval:preflight` 也只比 `HEAD == origin/main`——那验的是 GitHub，不是**正在响应请求的那个函数**。
- 规则：①任何"我改的东西线上有没有"的判断，必须来自线上自己的回答：读层 `/api/meta` 回传 `VERCEL_GIT_COMMIT_SHA`，`eval:preflight` 有一条 `线上 commit == origin/main` 的硬判据（不一致即红并点名"Vercel 未部署"）；②接口新增字段后，**用该字段是否出现**当部署指纹（本轮就是靠 `/api/hot/categories` 缺 `map` 反证线上没更新）；③触发器坏了不要用手动 `vercel --prod` 绕过——那只会把根因永久盖住，本项目最贵的就是"以为上线了"。
- 案例：`docs/ISSUES.md` BL12；受影响验收：B56/B58/B62 的云端实测（B39/B53 在停摆前已上线）。
