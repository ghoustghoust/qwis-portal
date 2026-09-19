# 41 · 端到端与白盒化评测（验收流程升级）—— 总 Spec

> **父**：治理层（不属任何页面，被 35/36/37/38/39/40 全部引用）｜**子**：41-1~41-6（见 §三）
> 状态：**待批准，未动工**（但它是 P0 止血的前置——用户 2026-09-19 决定"先建证据链再写生产"）。
> **分工**：评测**要求与口径**的 SSOT 是 `docs/EVAL_GUIDE.md`（流程、剧本、不变量清单、门禁、去污染规则）；
> 本文件只管**要建哪些工具、按什么顺序、验收怎么算过**。两处不得重复描述同一要求。
> 来源：用户 2026-09-19 指令——「验收新增额外流程：在 Vercel 测试后，你需要进行**端到端评测**和**白盒化评测**」，方法论参照 SWE-rebench（arXiv:2505.20411）。
> 最后更新：2026-09-19

## 一、要求在哪（不在本文件）

端到端与白盒**要检什么、怎么判过、如何防自证**，全部写在 `docs/EVAL_GUIDE.md`：
§3 端到端（环境前置 / 剧本清单 / 三类断言 / 四分类与 flaky / 性能预算 / **§3.6 过程性二值检查**）、
§4 白盒（W1~W9 不变量）、**§5 内容质量评测（LLM-as-a-Judge 五维 + 加权折算 + judge 纪律）**、
§6 F2P-P2P 与改前必红、§7 去污染四条、§8 不照搬清单、§9 产物与门禁。
论文机制与本项目的对应关系也在那里（§1、§8）。**本文件不重复描述要求，只拆工具。**

## 二、要建的八块（每块各出 mew-spec 小 spec）

| 小 spec | 内容 | 类型 | 规模 |
|---|---|---|---|
| 41-1 | 环境前置检查器：代理可达 / Vercel 部署 SHA 与远端一致 / 三端凭据一致 / Turso 可读 / 测试隔离库就绪；不通过即中止（`fail_env`） | 工具 | S ✅ 已交付 `tools/eval-preflight.cjs`（本轮再加「线上 commit == origin/main」硬判据） |
| 41-2 | 端到端剧本引擎：**✅ 已交付 `tools/eval-e2e.cjs`（`npm run eval:e2e`，09-19 夜）**。Playwright 驱动真实线上页面，10 条剧本（E1~E10）覆盖 6 个前台页 + 后台登录门；核心方法是 **DOM ↔ 页面自己发出的那次 API 响应对账**（`page.on('response')` 拦截 + `collected()` 合并本轮同接口多轮响应），不是"元素存在就算过"。四分类 + 每剧本连跑 3 次判 flaky + 截图/env_lock/report.json 落 `docs/eval/e2e/<轮次>/` + 退出码 0/1/2；`--self-test` 44 项判据全部配坏样本；已知缺口用 `KNOWN_GAPS` 显式登记（B72）而非删剧本。**首轮就抓到两个真缺陷**：B71（后台裸 i18n key，根因入口漏挂 Provider）、B74（晚到的旧响应覆盖筛选结果），详见 `docs/pitfalls/testing.md` #46~#49 | 新工具 | M ✅ |
| 41-3 | F2P/P2P 双集合与「改前必红」流程：与 git worktree/临时分支配合，未含改动的分支上先跑 F2P → **✅ 已交付 `tools/eval-f2p.cjs`**（`npm run eval:f2p`）：`--auto-base` 由锁的引入提交反查基线、自建 worktree、只拷新锁进旧树、两侧同用 `--cases` 过滤、自动挂 `NODE_PATH`、拒绝 `base == HEAD`，结论落盘 `docs/eval/f2p/*.json`；自检项数以 `--self-test` 输出为准（由回归锁要求"全绿"，不在文档写死数字）+ 回归锁 5 条（`^` 被 cmd 吃掉→坑 #40；凭记忆选错基线→误判假锁→基线守卫，坑 #41；`Cannot find module` 与 `ENOENT` 都按"树内/树外"分产品红与环境红；自检必须全绿）。已出证：b 10/10 红 @`4f87120`、c 8/8 红 @`44073de`、d 25/31 红 @`b766bf6`、e 12/12 红 @`947e753`、f 5/6 红 @`f3172b2`、F6 3/3 红 @`2e2c757`，head 侧全绿（f 里那条 stub 报告锁按设计只在有 golden 时才判，属 P2P 守卫，不参与 F2P） | 流程 | M ✅ |
| 41-4 | 白盒一致性检查：三端常量 diff + 不变量断言（档位优先读、settings/env 优先级、熔断阈值与冷却、`'null'` 序列化陷阱这类"曾经踩过"的形态） | 工具 | M ✅ 已交付 `tools/eval-whitebox.cjs`（W1~W10；本轮新增 W3b 假开关与 W10 重复判定，两者都做过负向验证） |
| 41-5 | 覆盖矩阵与空洞清单生成：解析 FEATURE_MATRIX 格子 × 剧本清单 → 未覆盖格子进 ISSUES；接进 `npm run lint:docs` 同级门禁 | 工具 | S ⛔ **工具待建，但分母问题已解除**（09-19 夜）：41-2 的剧本清单已交付（E1~E10，10 条），且**第一份矩阵已由人工核对产出** —— `coverage-matrix-20260919.md`（39 个功能格 × 逐格证据，结论 ✅3 / ◐8 / ⛔28）。工具化时以该文件为**对账基准**（自动产出的格子判定与手工判定不一致处必须逐格解释，防"生成器自己判松了"）。**本轮同时查清一件事**：`KNOWN_GAPS` 实测在 `tools/eval-e2e.cjs:1023` 是 `{}`，`uncoveredKinds` 也只统计"剧本内断言类别"，**两者都不是功能覆盖分母**，41-5 不许拿它们当绿灯（详见该文件 §4） |
| 41-6 | 验收口径落文档：AGENTS §3 增加「npm test + build:vercel + 云端实测 + `lint:docs` + **端到端/白盒/内容质量三层评测**」；`DELIVERY_VERIFICATION.md` 增章节；pitfalls↔tests 门禁 | 治理 | S ✅ 已落 `AGENTS.md` §3 |
| **41-7** | **过程性二值检查器**（小 spec 已出：`41-7-process-binary-checks.md`；要求正文 `docs/EVAL_GUIDE.md` §3.6）：`check_screenshot_taken(events)`、`check_report_generated(artifacts)`、`check_assertions_executed`、`check_no_stub_text`、`check_evidence_paths_resolve`；任一不过判 `fail_env`；接进 41-2 的退出码与报告。**本轮实测追加两项**：`check_exit_code_honest`（`cmd \| tail` 吞退出码真发生过）、`check_probe_params_sourced`（把 `type=` 当 `tab=` 打真发生过）→ **✅ 已交付 `tools/eval-process-checks.cjs`**：7 项检查各配「坏样本会红、好样本会绿」自检（`npm run eval:process`），并由 `tests/regression-20260919d.test.js` 两条锁钉住。自检在开发当场抓到两处真 bug：证据扫描全对象乱走会把 `file:line` 参数出处误判成缺失文件；模块被 require 时设 `process.exitCode` 会污染测试进程退出码。 | 工具（防"没真跑却算通过"） | S ✅ |
| **41-8** | **内容质量评测 harness**（EVAL_GUIDE §5）：**✅ 已交付** `tools/eval-content/{schema,scoring,judge,run}.py` + `tools/eval-content.cjs`（`npm run eval:content`）。`Task`/`MetricBase`/`MetricResult`/`MetricType`/`SolutionOutput` 以**零依赖同形本地实现**交付（本机 Python 3.14.4 无 agentscope；装依赖需用户点头，且计分口径不该被 pip 卡住），装了 agentscope 换 import 即可，报告 `engine` 字段说明用哪套。五维 judge + `norm(v)=(v-1)/4` 按 `axis_weights` 加权（无参照物时该轴从分母扣除）+ golden set 冻结（实测线上载荷键 `content_html`，第一版猜 `content` 导致 6/6 无参照物）+ 人工对齐 **≥3 条产物且一致率 ≥0.7 才写 trend** + `stub` 轮次标 `counts_as_judgment=false`/`warnings_advisory=true`（**stub 不算评测**，防"自己没干却报干过"）。三层自检 48 项（项数以命令输出为准），Node 侧接缝锁 `tests/regression-20260919f.test.js` 6 条 | 新工具 | M ✅ |

## 四、边界

**不做**：不搭 CI 云端评测集群（本机 + runner 足够）；不做多模型对比榜；不把端到端跑进生产写路径（评测一律走只读端点或隔离库；需要写操作的场景在 `APP_DATA_DIR` 副本上跑）；不追求覆盖率百分比好看——矩阵空洞清单是给人看的，不是 KPI。

## 五、验收标准

- AC1（41-1）：人为关掉代理后跑评测，输出 `fail_env` 且**不**产生"产品缺陷"结论。
- AC2（41-2）：一次命令跑完 5 页 + 后台 5 Tab，产出结构化报告（pass/fail 分类、耗时、截图路径）；同一剧本连跑 3 次结果稳定，偶发者被标 flaky 而非算通过。
- AC3（41-3）：本轮任选一个已修缺陷（如 B28 类型筛选），能出示"改前红、改后绿"两份证据；F2P 集合里没有"改前也通过"的用例。
- AC4（41-4）：白盒检查能在人为制造"只改一份实现"时报警（例如把 runner 熔断阈值从 3 改成 5 而不同步另两端）。
- AC5（41-5）：生成当前覆盖空洞清单（预期会暴露大量空白，这是目的不是失败）。**09-19 夜手工版已达成此判据**：`coverage-matrix-20260919.md` 给出 39 格里 ✅3 / ◐8 / ⛔28，空白占多数——工具未建，所以本条记「内容已交付、自动化未完成」，不许写成 AC5 已验收。
- AC6（41-6）：AGENTS §3 与 `DELIVERY_VERIFICATION.md` 一致，且 `npm run lint:docs` 能挡住"新增坑无测试"。
- AC7（41-7）：故意制造一次"截图没真拍、报告手写"的运行，过程检查必须把它判成 `fail_env` 而不是 pass。
- AC8（41-8）：同一批 golden set 跑两轮，五维分与人工标注一致率 ≥0.7 才允许写趋势；judge 模型/prompt 版本变更时，旧趋势数据自动标为不可比。
