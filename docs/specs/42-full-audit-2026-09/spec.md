# spec 42 · 全量深度代码审计（第一轮）


> 类别：决策 spec（**原位冻结**，不搬家） | 来源：2026-09-19 那轮「全量深度代码审计」
> 归档原因：**用户在 2026-09-21 明确否决该轮继续推进** —— 项目仍在开发阶段，不在这个阶段做全体功能审计；
>   该轮的 W1 六维扫描 / W2 复核 / W3 落台账从未放行，也不要按它排期。
> 关联代码：`docs/specs/42-full-audit-2026-09/quarantine/audit-graph.cjs`（分析器已被并行会话隔离，见 `MANIFEST.md`）、`server/services/scheduler/index.js`（§6 已执行的 AU-5 默认值翻转）、
>   `tests/regression-audit42-portal-channel.test.js`（该翻转的锁，保留在回归网里）
> 关联坑：`docs/pitfalls/testing.md` #58/#59 | 取代关系：**不作废已执行的动作**（portal 下线/删除、2h 同步通道关闭），
>   只冻结未开工的审计波次与其发现台账（AU-01~05）
> 状态：**冻结，待用户明确重启**（不是作废）—— 里面的可达图/调度登记表数据是 09-19 的快照（`rootHead 668e254`），
>   重启前必须重跑 `docs/specs/42-full-audit-2026-09/quarantine/audit-graph.cjs`（隔离区现位，旧路径 `tools/` 已随冻结撤出），不得当现状引用；活文档一律不再引用本文件排期。
> 最后更新：2026-09-19
> 状态：W0 地基已建成，停在 W0′ 检查点等用户复核
> 关联代码：`docs/specs/42-full-audit-2026-09/quarantine/audit-graph.cjs`、`server/services/scheduler/index.js:132-137`、`tools/eval-whitebox.cjs:39`
> 取代：无（新增审计轮，不改既有 SSOT）

## 1. 范围与边界

- **逐行**：主仓库 `server/ api/ web/ lib/ tools/ tests/ scripts/` 与根配置。
- **结构对账不逐行**：`archive/`（1.1 GB，历史归档）、`.cluster/`（外部 harness 残留）。
- **portal**：本轮开工前为裸 gitlink 子模块；已实测判定为「主仓库 09-16 状态的历史快照副本」，
  其 Vercel 项目与本地目录**已于 2026-09-19 经用户授权下线/删除**（过程见 §6）。
- **权威口径**：`DOC_GOVERNANCE.md` §4.5「portal 是副本不是权威」；`.qoder/repowiki` 与知识卡
  经用户判定为 09-04 陈旧快照，**本轮一律不作证据**，以代码实测为准。

## 2. 阻塞级（AU- 前缀避让既有 B/BL/W/H 编号）

| 级 | 判据 | 处置权限 |
|---|---|---|
| AU-1 | 线上链路正在坏 / 数据正在丢 / 告警无出口 | 只出证据，生产写需授权 |
| AU-2 | 用户可感知错误、功能受损、隐私暴露面 | 汇总：牵扯文件 + 出处，不自行修 |
| AU-3 | 三端/多副本同源常量与调度周期分叉 | 给收敛方案与回滚点，不自行修 |
| AU-4 | 死代码与冗余资产 | 只出删除候选清单，不删 |
| AU-5 | 微改（四条同时成立：不改导出/路由/SQL/调度/鉴权、不在禁写清单、有探针证明行为不变、diff 仅新增或文案） | 直接改 + 打标记 |

## 3. 波次

| 波 | 谁 | 内容 | 状态 |
|---|---|---|---|
| W0 | 主代理 | `audit-graph.cjs`（现位 `quarantine/`）→ `reach.json` / `schedule.json` / `dir-index-draft.md` | ✅ 完成 |
| W0′ | 用户 | 复核地基数据、砍/调范围 | ⏳ 进行中 |
| W1 | 6 只读子代理 | 六维度结构级扫描（死代码/调度/质量/安全/功能完整性/性能） | 待放行 |
| W1.5 | 主代理 | 跑子代理提交的「待实测」探针 | — |
| W2 | 3 独立复核子代理 | 数字口径 / 死代码反证 / 调度生效性反证 | — |
| W2.5 | 主代理 | 复跑全部 AU-1 + 全部 Conflict + 每维度抽 2 条；复现不出者从报告删除 | — |
| W3 | 主代理 | 报告 + 修复清单落 `ISSUES.md`/`NEXT-DEV-REQS.md` + `lint:docs` 收口 | — |

嵌套派发在本 harness 不可用（实测：Explore 与 general-purpose 子代理均无 `Agent`/`Task` 工具），
故以「分波」实现层级语义，子代理内部按模块分片自查。

## 4. 并发隔离（与同时在开发的 Agent）

- **禁写清单**（每波开工前用 `git status` 重取）：`AGENTS.md`、`docs/ISSUES.md`、`docs/EVAL_GUIDE.md`、
  `package.json`、`tools/eval-whitebox.cjs`、`tools/eval-e2e.cjs`、`web/src/admin.jsx`、
  `web/src/pages/{Admin,Daily}Page.jsx`、`server/services/ai/daily-ai.js`、`tools/_probe-*`/`_diag-*`、
  `tests/regression-20260919?.test.js`。
- **本审计写入面**：仅新增 `docs/specs/42-full-audit-2026-09/*`、`docs/eval/audit/*`、
  `audit-graph.cjs`（现位 `quarantine/`）、`tests/regression-audit42-*.test.js`；共享文件只允许 `docs/INDEX.md` 单行追加。
- 本轮已改的唯一既有文件：`server/services/scheduler/index.js`（AU-5 级默认值翻转，改前红/改后绿）。

## 5. W0 地基数据（`docs/eval/audit/reach.json`，rootHead 668e254）

- 源码文件 336；入口 runtime 13 / cli 44 / test 46；**runtime 可达 154**。
- **主仓库零引用孤儿 4 个 / 782 行**；`archive/` 内另有 81 个（历史归档，不计主结论）。
- 定时器注册点 26 处；`collect.yml` cron 7 条。
- 本地库实况：sources 共 678，**仅 29 启用且全部为 hotlist**（rss 457 / youtube 125 / wemp 65 全部 `enabled=0`），28 条已过期。

## 6. 本轮已执行动作与证据

| 动作 | 证据 |
|---|---|
| 停 2h 门户同步通道（默认 true→false，保留显式开关） | `tests/regression-audit42-portal-channel.test.js`。**09-21 复核更正**：该锁至今是**未跟踪文件**（`git ls-files --error-unmatch` 报 "Did you forget to 'git add'?"）⇒ 没有引入提交，`npm run eval:f2p -- --auto-base` 反查不到基线，**改前红这一侧从来没有证据**；原文那句"改前红 2 条 → 改后 3/3 绿"两侧分母还自相矛盾（2 vs 3），判为不实，已按实测改写。本轮只读复核：该文件本地跑 3 条全过（无证据 JSON，属并行会话在途工作，不由我提交）。这条不实是新加的 `[F2P出处]` 判据抓出来的（本体 `tools/doc-lint.cjs`，跑法 `npm run lint:docs:selftest`；出处 `docs/EVAL_GUIDE.md` §4.2 / 放行清单 §三 #12） |
| Vercel 项目 `portal` 下线 | `vercel project rm` → `Success!`；`project ls` 仅剩 `qwis-intel`；两域名均回 `DEPLOYMENT_NOT_FOUND` |
| 本地 `portal/` 删除（353 MB） | 删前留档：`archive/_diag/portal-0916-abandoned-hotevents.patch`（16.9 KB）；实测该提交内容已由主仓库 `88c40d6`（晚 48 分钟）落地；2 份独有文档与根树归档版差异仅治理头注 |
| 可疑凭据文件隔离 | `archive/_diag/portal-quarantine/`（Vercel 本地 env 仅构建元数据；09-02 鉴权放行一次性脚本） |
| 门禁 | `npm test` 387 项 0 红（首跑 1 条 `regression-my-brief` 偶发红，单跑 4/4 绿，二跑全绿）；`eval:whitebox` 全过 exit=0；`lint:docs` 见 §8 |

## 7. 发现台账（初）

| # | 级别 | 发现 | 证据出处 |
|---|---|---|---|
| AU-01 | AU-3 | **白盒 W1 把零装载的实现当"三端"之一断言**：`tools/eval-whitebox.cjs:39` 比对清单含 `lib/collectors/fetcher.js`，而可达图显示该文件装载数 0 → 门禁可被不运行的代码制造假红/假绿，且把三端悄悄扩成四端 | `reach.json` + `eval-whitebox.cjs:39` + `tests/regression-20260919b.test.js:87` |
| AU-02 | AU-4 | `lib/collectors/{fetcher,repo}.js`（161 行）自述「Serverless 兼容版本，对应 server/services/collectors/fetcher.js」，全仓库零 require → 采集语义的**第四份实现**残留 | `lib/collectors/fetcher.js:1-2` + 可达图 |
| AU-03 | AU-2 | `web/src/components/DouyinTab.jsx`（503 行）无任何 import；`AdminPage.jsx` 的 lazy 清单里没有它 → 后台无抖音管理入口。属「废弃未清理」还是「应有未做」需产品判定 | `grep -rn DouyinTab web/src/` 仅命中自身定义 |
| AU-04 | AU-2 | `web/src/snapshot.js`（118 行）仅被 `docs/deprecated/VERCEL_MIGRATION.md` 指涉 → 与 portal 同源的迁移期残留 | 可达图 |
| AU-05 | AU-2 | **明文密钥门禁结构性盲区**：`tools/doc-lint.cjs:124` 只扫 `ghp_`/`sk-`/libsql 连接串；git 跟踪的 `.env.example`（已在 `origin/main`，09-09 01:34）含 34 B `AUTH_SECRET`、23 B `ADMIN_PASSWORD` 形态值。哈希比对确认与本地 `.env` 现役值不同 → 非现役泄漏，但真值一旦填入不会被拦 | 哈希比对（未打印明文） |
| AU-06 | AU-2 | `settings.queue.token` 以明文存于 SQLite（40 位），且 `enabled:false` → 第三方云队列凭据入库、随库快照扩散 | `schedule.json`（已掩码） |
| AU-07 | AU-3 | 本地 Express 采集面实况与 AGENTS.md §1「本地=全功能灾备」不符：678 源仅 29 启用且全为 hotlist | `data/app.db` 只读查询 |
| AU-08 | AU-2 | 测试隔离缺陷：`regression-my-brief` 在全量顺序下偶发红、单跑绿 | 两次 `npm test` 对比 |
| AU-09 | AU-4 | `.cluster/expert-playbook.md`（git 跟踪）为另一套 harness 写的派单手册，引用的 `sessions_spawn`/`docx`/`DELIVERY/` 在本环境全不存在；同目录含 4 个一次性脚本 + 5 份 `test-out*.txt` | 文件内容 + `git ls-files .cluster` |
| AU-10 | AU-2 | **portal 删不干净**：`rm -rf portal` 后 15:06 目录又被重建（只剩 `public/data/*.json`），且 `git ls-files portal` 仍返回 `portal` → **gitlink 未从索引移除**，git status 反而不再显示该删除（子模块 .git 缺失后 git 无法比对）。当时无任何 `server/index.js` 进程在跑，故重建来自有人/脚本直接执行 `export-portal.js`。要真正退役必须 `git rm portal` + 摘掉 `jobs/portal.js`/`sync-portal.js`/`export-portal.js` 三件套 | `find portal`、`git ls-files portal`、`powershell Get-CimInstance Win32_Process` |
| AU-11 | AU-4 | 根目录污染：存在无扩展名文件 `db`、`db-wal`（SQLite 散落物）、`trash/`（5 文件）、`验证截图/`（24 文件）、`.mybrief-tmp.json`。其中 `db` 一度被索引生成器误判为一级目录（已修） | `ls -1` + `gen-dir-index.cjs` 首跑报错 |

## 8. 本轮未跑（如实登记）

`node smoke-test.js`、`npm run build:vercel`、`npm run eval:preflight`、`eval:process`、`eval:f2p`、
`eval:e2e`、云端实测、对抗性审查、文档全量同步 —— 均排在 W0′ 放行之后；`lint:docs` 当前输出含
`ISSUES.md 253 行>130`、`NEXT-DEV-REQS 317>260` 等警告级条目，错/警合计待收口时取。

**起本地服务抓调度注册日志**这一步刻意未做：`server/index.js` 一旦启动即会开启真实采集与写库
（对 734 MB 生产库副本产生副作用），需单独授权，或改用库副本沙箱。
