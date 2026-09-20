# `config/`

**放什么**：交付/部署用的**客户参数模板**。当前只有一件：`customer-config.json` —— 由 `tools/setup-customer.js` 读取，用来一次性写出客户环境的配置（它属于知识卡所说的「`customer-config.json` + `.env` + SQLite `settings`」三层配置里的第一层）。

**不放什么**：真凭据。密钥的单一事实源是本地 `.env`（+ Vercel env + GH Secrets 三处同步，AGENTS §2.6）；往这里填真值就等于把凭据放进 git 跟踪件（`docs/DOC_GOVERNANCE.md` §5 第 6 条的密钥正则**抓不到键名赋值**，是已知盲区，见 B80）。

**归属端**：本地 / 部署期（不参与运行时链路）

**状态**：active（**只有一个装载方**：`tools/setup-customer.js`；没有第二处读它，改字段要同步那个脚本）
