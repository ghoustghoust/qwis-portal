# AGENTS.md — 全网情报系统 · Agent 协作规则

> 最后更新：2026-09-20（新增 §2.9 文档改动戳：改完 `.md` 跑 `node tools/doc-stamp.cjs` 刷新 `docs/STAMPS.md`，并禁止把 commit 号手写进文档头部；§3 的 10 条清单至今仍未提交）
> 任何 AI Agent 接手本项目前**必读**。本文件是项目级强制约束，优先级高于其它文档。
> 原则：**文档从真实环境逆推，不是约束；线上实测是唯一验收标准。**
## 品味
1\. \*\*新增功能\*\*：先与用户详细讨论，明确用户需求，了解用户为何要添加该功能、想实现什么效果，直到最终明确因果链后，将你的理解回馈给用户，最后再讨论落地方案；

2\. \*\*维护/删除功能\*\*：先与用户沟通清楚希望删除或维护后实现什么目的，然后将理解反馈给用户，最后评估实现该目的会牵扯哪些模块、逻辑，再输出具体的落地方案；

3\. \*\*明确的 bug/问题\*\*：先与用户明确详细的复现路径，确认复现后，分析可能涉及的模块功能点及相关文档，然后进行深层分析；如果分析与当前项目决策点有分歧，先反馈给用户、讨论明确因果链后，最后再输出具体的方案；

4\. \*\*spec 的风格\*\*：明确因果链、明确边界、禁止什么；

5\. \*\*harness 落地原则\*\*：不包含纯产品意图（功能意图）、探索性功能、文案、UI、一次性设计；

6\. \*\*新功能\*\*最终落地且自测通过后，需要反馈用户是否需要 spec、harness；

7\. \*\*维护/bug 修复\*\*时，根据 spec 和 harness 落地原则，自行评估是否需要 spec 和 harness。

除非用户明确任务全自动化，交给你完全自主，否则按照以上AI Agent风格来
## 0. 先读什么（顺序固定）

1. `docs/CLOUD_PIPELINE_GUIDE.md` —— 云端实时链路地图 + 不可破坏的不变量（P0）
2. `docs/FEATURE_MATRIX.md` —— 本地/云端/runner 三端功能矩阵（唯一权威，SSOT）
3. `ARCHITECTURE.md` —— 架构决策 + 已知坑（每条坑都对应过一次线上事故）
4. `docs/HANDOVER.md` —— 凭据速查 + API 清单（⚠️ 含密钥，本地文件，永不提交）
5. `docs/DOC_GOVERNANCE.md` —— 文档清洁与归档规则（§2 第 3 条「同步文档」的执行标准；每轮交付末尾必做）

## 1. 三端心智模型（改代码前必须知道自己在改哪一端）

| 端 | 代码 | 职责 |
|---|---|---|
| 本地 Express | `server/` | 全功能开发/灾备（抖音/B站/文件快照 only here） |
| Vercel 读层 | `api/`（catch-all `[...slug].js` + collect.js + daily-generate.js） | 线上 API + 管理后台 |
| GH runner | `tools/collect-turso.js` + `.github/workflows/collect.yml` | 采集主链路，直写 Turso |

**采集语义有三份实现**（server/services/collectors/、api/collect.js、tools/collect-turso.js）——改任何一份的过滤/清洗/熔断/去重/UA/间隔，必须同步检查另外两份。

## 2. 强制约束（2026-09-11 审计后新增，违反=事故）

本项目曾长期"本地开发完不推云端、不实测、不写文档"，导致云端停摆 2 天无人发现、5 份文档 5 个版本。以下规则不可协商：

1. **改完必须推云端**：`git push origin main` 即触发 Vercel 自动部署（Git 集成已连）。本地验证 ≠ 完成。
2. **必须云端实测**：按 `docs/DELIVERY_VERIFICATION.md` 流程打真实线上端点（需代理 `http://127.0.0.1:12000`（本机 Clash 实际端口，2026-09-13 起；git 亦已配 http.proxy） + curl `--ssl-no-revoke`）。截图/curl 响应才算证据。
3. **必须同步文档**：功能变更 → 改 `docs/FEATURE_MATRIX.md` + `docs/HANDOVER.md`；调度/频率/链路变更 → 还要改 `ARCHITECTURE.md` + `docs/RUNBOOK.md` + `docs/CLOUD_PIPELINE_GUIDE.md`。
4. **否定/作废决策也要落档**：推翻旧决策时，在旧文档头部加「已作废 + 日期 + 替代决策链接」，禁止静默删除。
5. **单一事实源**：调度频率、功能矩阵、凭据位置、测试数等易变事实，全库只许一份写死值，其它文档写"见 XX"。
6. **凭据三处同步**：`COLLECT_KEY` / `TURSO_*` 等改值时必须同时改 本地 `.env` + Vercel env + GitHub Secrets（本系统最大血泪坑，曾致全链路 403 停摆 2 天）。
7. **不动刀原则**：没读懂现有实现前不改写；不重写能修的东西；不引入需要无头浏览器的云端功能。
8. **文档改动要有时间和版本**：改完任何 `.md` 跑 `node tools/doc-stamp.cjs` 刷新 `docs/STAMPS.md`（每份文档的最近改动 = 短号 · 日期 时:分 · 提交主题），产物随同提交。**不许**把 commit 号手写进各文档头部——写戳那次提交会立刻让它滞后，且 `git log -1` 会把"只改头注/只改错别字"的元提交冒充成内容改动（机制与实测样本见 `docs/DOC_GOVERNANCE.md` §2.6）。

## 3. 测试约定

- 验收 = 下面每条都跑并留证据（口径与判据见 `docs/EVAL_GUIDE.md`）：
  1. `npm test` 全绿（条数唯一写死处见 `docs/FEATURE_MATRIX.md` §1.5，本文件不复制；引用 server/* 的测试文件先 require tests/helpers）
  2. `node smoke-test.js` 冒烟（生产库副本，零副作用）
  3. `npm run build:vercel` 无错
  4. `npm run lint:docs` 零错（文档门禁，规则见 `docs/DOC_GOVERNANCE.md`）
  5. `npm run eval:preflight` 环境前置（代理 / **线上 commit == origin/main** / Turso / 测试隔离 / BL7-BL9 配置告警）——红则先修环境，不许跳过去跑剧本
  6. `npm run eval:whitebox` 全过（**号位与项数不在文档枚举** —— 以 `tools/eval-whitebox.cjs` 实存为准（§2 第 5 条单一事实源；09-23 实测 24 项，历史文档曾同时存在 W1~W9 / W1~W11 / W9~W21 三种互相矛盾的写法）。覆盖面例如：三端常量、假开关与"只被回显"的 settings、null 序列化、动态 WHERE、路由面、重复判定、**入口 Provider 完整性**、删除谓词只一份、建表源列集不分叉…；只准变好，新增缺口须进 `docs/eval/whitebox-baseline.json`）
  7. `npm run eval:process` 全过（这次评测运行可不可信 F1~F8：截图/报告/断言数/占位文案/证据路径/退出码/参数出处/**断言三类覆盖**；任一不过本轮不算通过——产物不诚实判 `fail_product`、运行条件不足判 `fail_env`，两者都不许当"验收过"）
  8. 云端实测：按 `docs/DELIVERY_VERIFICATION.md` 打真实线上端点，curl/截图才算证据；**只有在第 5 条判「线上一致」时才算数**
  9. F2P：本轮每条修复出 `npm run eval:f2p -- --auto-base --tests <锁文件> --cases <本轮锁名前缀>`（基线由锁的引入提交反查，**必须逐条点名**——"文件里有红"不算证据，坑 #45），证据落 `docs/eval/f2p/*.json`；改前不红的锁一律删或重写（禁止型断言须配正向探针，见 EVAL_GUIDE §4.1）。**退出码 1=锁假了（可删/重写），2=未评测（基线错、没跑到、没点名）只许修输入，禁止删用例**（坑 #41/#45）
  10. `npm run eval:e2e` **全过（41-2 已交付，与白盒同级的自检验收层级）**：默认打线上、每剧本连跑 3 次（§3.4 口径），产出 `docs/eval/e2e/<轮次>/{report.json,env_lock.json,screens/}`；退出码 1=产品红、2=环境/flaky/空跑。**它就是"页面真的对用户生效"这一层的证据来源**，未跑不得声称交付完成；确实没覆盖到的面（如需登录态的后台闭环剧本）必须显式记为未验收，不许用"接口 200"代替。
     - **验收轮 vs 探针轮（EVAL_GUIDE §3.7）**：只有「全剧本 × ≥3 轮 × 真实云端」才允许 exit 0；用 `--only`/`--fast`/本地目标跑出来的绿一律退 2 并打 `NOT_ACCEPTANCE`，**写进交付说明前先看 `env_lock.json` 的 `acceptance.ok`**。跑过 ≠ 验收过。
  11. `npm run eval:content`（41-8，✅ 已交付：三层自检 `--self-test` 必须全绿；真评需 `--judge` 且人工对齐够 3 条产物才写趋势；stub 轮次不算已验收）——AI 产物**内容质量**仍属人工兜底，不与 e2e 混计
- **固定交付链（一轮都不许跳，用户 2026-09-19 重申）**：
  改完 → **`git push`（每次功能修复后立刻推，不攒批）** → **GitHub Actions 检查**：`collect.yml` 最近批次无红且本 commit 的 job 日志无新报错（⚠️ 当前**没有 push-CI**，`npm test`/`lint:docs` 只在本地跑；要"Actions 报不报错"成为可检查项需补 `.github/workflows/ci.yml`，见 FEATURE_MATRIX §1.5 末行）→ **Vercel 真实云端实测**（先 `/api/meta` 的 `commit == origin/main`，再打端点/截图）→ **冒烟测试 `node smoke-test.js`** → **对抗性审查**（不能只靠自己复查：至少一个独立 reviewer 看这批改动，见坑 #45 第⑤条）→ **白盒评测 `npm run eval:whitebox`** → **端到端评测 `npm run eval:e2e`（已就位：没跑 = 这轮没做完，不许用"接口 200"代替）** → **同步全部文档**（`FEATURE_MATRIX.md` / `ISSUES.md` / `NEXT-DEV-REQS.md` / `ARCHITECTURE.md` / `RUNBOOK.md` / `CLOUD_PIPELINE_GUIDE.md` / 坑编号 / spec 状态），最后 `npm run lint:docs` 收口。
  跳过其中任何一步都必须在交付说明里写明"没做"及原因（本轮就发生过：漏跑 `smoke-test.js`、文档未同步 FEATURE_MATRIX 就被用户问出来）。
- 每个线上修过的 bug 必须有回归测试

## 4. 常用入口

| 事项 | 入口 |
|---|---|
| 云端排障 | `docs/RUNBOOK.md` §10 + `GET /api/health/status`（含采集心跳） |
| 手动触发采集 | GH Actions → Run workflow，或 `POST /api/rss/refresh`（标记到期） |
| 凭据/密钥 | `docs/HANDOVER.md` §1.5（本地文件） |
| 待开发清单 | `docs/FEATURE_MATRIX.md` §2 |
| 评测/门禁命令全清单 | `docs/FEATURE_MATRIX.md` §1.5（唯一清单；§3 的十条验收按它跑） |
