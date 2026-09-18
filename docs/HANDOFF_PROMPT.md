# 新窗口接手提示词（复制整段发给新 Agent）

> 最后更新：2026-09-18（删过期进度快照，改指 SSOT；阅读顺序补 ISSUES/pitfalls/GOVERNANCE）

````
你在接手「全网情报系统」（D:\全网情报系统，GitHub: ghoustghoust/qwis-portal，生产: https://qwis-intel.vercel.app）。

开始前按顺序读（不要跳）：
1. AGENTS.md（根目录）—— 7 条强制约束，违反=事故
2. docs/CLOUD_PIPELINE_GUIDE.md —— 云端实时链路地图
3. docs/FEATURE_MATRIX.md —— 三端功能矩阵（唯一权威）
4. docs/ISSUES.md —— 当前活跃 bug / 观察中 / 挂案（唯一问题清单）
5. docs/NEXT-DEV-REQS.md —— 需求队列（未开工/在途）
6. docs/pitfalls/README.md —— 踩坑库域索引（动手前查自己那域）
7. ARCHITECTURE.md §0/§3/§5 —— 架构决策 + 已知坑索引
8. docs/HANDOVER.md —— 凭据速查（⚠️ 本地文件含密钥，永不提交）
9. docs/DELIVERY_VERIFICATION.md —— 云端实测流程（验收必须走它）
10. docs/DOC_GOVERNANCE.md —— 文档清洁与归档规则（交付末尾必做）

三端心智模型：server/=本地全功能开发灾备；api/=Vercel 读层+管理台；
tools/collect-turso.js+.github/workflows/collect.yml=采集主链路（每15min直写Turso，
cron-job.org 外置触发兜底）。采集语义有三份实现，改一必查三。

硬性规则：改完必须 push 部署 + 线上实测 + 同步文档（FEATURE_MATRIX/HANDOVER）；
否定决策要落档；凭据三处同步（.env/Vercel/GH Secrets）。
````

## 当前进度（本文件不复述，见 SSOT）

> 进度快照写在这里必然过时（2026-09-12 那份快照就是这么烂掉的）。接手 Agent 请读：
> - 活跃问题 → `docs/ISSUES.md`
> - 待办需求 → `docs/NEXT-DEV-REQS.md`
> - 已完成且已验收的历史 → `docs/archive/`（分类见 `docs/DOC_GOVERNANCE.md` §2.3）
> - 交叉审核报告（09-11~12）→ 已归档 `docs/deprecated/AUDIT-2026-09-12.md`
