# 新窗口接手提示词（复制整段发给新 Agent）

````
你在接手「全网情报系统」（D:\全网情报系统，GitHub: ghoustghoust/qwis-portal，生产: https://qwis-intel.vercel.app）。

开始前按顺序读（不要跳）：
1. AGENTS.md（根目录）—— 7 条强制约束，违反=事故
2. docs/CLOUD_PIPELINE_GUIDE.md —— 云端实时链路地图
3. docs/FEATURE_MATRIX.md —— 三端功能矩阵（唯一权威）
4. docs/ROADMAP-2026-09.md —— 已确认的需求与 4 项关键决策
5. docs/specs/12-roadmap-2026/spec.md —— 当前开发路线（P0~Pn）
6. ARCHITECTURE.md §0/§3/§5 —— 架构决策 + 已知坑
7. docs/HANDOVER.md —— 凭据速查（⚠️ 本地文件含密钥，永不提交）
8. docs/DELIVERY_VERIFICATION.md —— 云端实测流程（验收必须走它）

三端心智模型：server/=本地全功能开发灾备；api/=Vercel 读层+管理台；
tools/collect-turso.js+.github/workflows/collect.yml=采集主链路（每15min直写Turso，
cron-job.org 外置触发兜底）。采集语义有三份实现，改一必查三。

硬性规则：改完必须 push 部署 + 线上实测 + 同步文档（FEATURE_MATRIX/HANDOVER）；
否定决策要落档；凭据三处同步（.env/Vercel/GH Secrets）。
````

## 当前进度快照（2026-09-11 晚）

- 采集链路：✅ 全自动（cron-job.org 每15min 触发 → runner 直采 → Turso）
- 无感刷新/热榜时间序：✅ 已上线并实测
- 管理功能：✅ 8 组 20 端点已移植云端
- 云端 AI：✅ Agnes 已修复可用（真根因=settings.ai 污染非 IP 绑定）；翻译已在 runner 真实运转
- mew-spec 进行中：13-settings-write ✅ 完成（设置写上云+线上验收）；下一项 14-sources-write
- 无阻塞项
