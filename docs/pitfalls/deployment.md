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
