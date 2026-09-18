# 全网情报系统 · 文档清洁与归档规范（底层文档治理）

> **这份文档管什么**：什么时候必须清洁文档、清洁时留什么、剔出去的内容按什么分类归档、归档要登记哪些依赖、以及怎么机器化自检。
> **它自己是底层文档**（`DEVELOPMENT_STANDARDS.md` §文档规则的可执行版本；两者冲突以本文为准并回改本文）。
> 最后更新：2026-09-18（首版，含 §8 本次清洁执行记录与待验收归档队列）

---

## 1. 触发时机（满足任一即必须做清洁，不做等于欠债）

| 触发 | 说明 |
|---|---|
| 用户说「清洁文档」 | 全量走 §3 SOP，一次做完 |
| 一个功能批次交付完并**用户验收通过** | 只清这批：把流水账从活文档抽进 §2 归档分类 |
| 活文档自相矛盾被抓到（头部范围 ≠ 正文范围、日期 ≠ git 日期、引用不存在） | 立即改，属**修正**不属归档，不需要等验收 |
| 单份活文档超阈值（见 §5 门禁） | 触发核销轮 |

> 关键区分：**修正（correction）** 随时可做；**归档（archiving）** 必须等验收。
> 未验收就把修复记录删掉 = 掩盖现场；验收后还留着 = 污染活文档。这两条都算违规。

## 2. 分层模型：底层文档白名单 + 归档分类

### 2.1 底层文档（活文档）——清洁后根目录与 `docs/` 顶层**只允许这些**

| 路径 | 职责（唯一性） | 谁引用它 |
|---|---|---|
| `AGENTS.md` | Agent 强制约束 + 三端心智模型 | 所有 Agent 首读 |
| `ARCHITECTURE.md` | 架构决策 + 已知坑索引（**不写死坑数**） | AGENTS §0 |
| `README.md` | 上手 + 目录结构 | 人 |
| `docs/INDEX.md` | **文档地图**（全量登记，见 §5） | AGENTS §0 |
| `docs/CLOUD_PIPELINE_GUIDE.md` | 云端实时链路 + 不可破坏不变量（P0） | AGENTS §0 首位 |
| `docs/FEATURE_MATRIX.md` | **功能矩阵 SSOT** | AGENTS §0 |
| `docs/ISSUES.md` | **活跃问题 SSOT**（活跃 bug / 观察 / 挂案） | 全员 |
| `docs/NEXT-DEV-REQS.md` | **需求队列 SSOT**（未开工/在途） | 全员 |
| `docs/RUNBOOK.md` | 运维排障手册 | AGENTS §4 |
| `docs/DELIVERY_VERIFICATION.md` | 线上实测流程（AGENTS §2.2 指名） | AGENTS §2 |
| `docs/DEVELOPMENT_STANDARDS.md` | 开发/验收规范 | DEV_GUIDE |
| `docs/DEV_GUIDE.md` | 开发者上手 | — |
| `docs/DOC_GOVERNANCE.md` | **本文**（文档治理） | INDEX |
| `docs/HANDOVER.md` | 凭据与端点速查（⚠️ 本地文件，永不提交） | AGENTS §0 |
| `docs/ROADMAP-2026-09.md` | 用户已拍板决策母文档（只留决策，不留流水） | NEXT-DEV-REQS |
| `docs/HANDOFF_PROMPT.md` | 新窗口接手提示词（薄，**不复述进度**） | — |
| `docs/ANDROID_SUBMIT_GUIDE.md` | 对接类**现役**手册：安卓 HTTP Shortcuts 提交链路 | ARCHITECTURE §7、RUNBOOK §、`tools/setup-customer.js:160` |
| `docs/X_SETUP_GUIDE.md` | 对接类**现役**手册：RSSHub + X cookie | ARCHITECTURE §7 |
| `docs/pitfalls/` | **踩坑库**（按域，见 §2.3） | ARCHITECTURE §5 |
| `docs/features/` | **功能语义权威**（模块干什么） | INDEX |
| `docs/specs/` | 决策与四件套（含 mew-spec 产物） | ISSUES / NEXT-DEV-REQS |
| `docs/contracts/` | 接口契约 JSON（读层响应形状） | 前端/测试 |

被代码或活文档**指名引用**的手册不许移走（移动 = 制造悬空引用，`tools/setup-customer.js` 这类运行时提示也会一起失效）。除上表外的文件不得留在 `docs/` 顶层。

### 2.2 白名单之外的目录职责

- `docs/deprecated/` —— **整篇作废**的文档。头注必须写「已作废 + 日期 + 替代文档指针」，禁止静默删除（AGENTS §2.4）。
- `docs/archive/` —— **已完结内容**的分类归档层，见 §2.3。
- `archive/`（仓库根） —— 与分析产物/评测素材同级的历史仓库级归档，不放活文档。

### 2.3 归档分类（用户指定的六类 → 每类都有「现役位」与「归档位」）

清洁动作的本质就是：**内容验收通过后，从现役位搬到同类归档位**，并在现役位留一行指针。

| 类别 | 现役位（还在跟进的） | 归档位（已验收/已完结） | 收什么 |
|---|---|---|---|
| **功能** | `docs/features/`、`docs/NEXT-DEV-REQS.md` | `docs/archive/feature/` | 已验收功能的交付说明、需求源头、产品范式借鉴（如 `BESTBLOGS_BORROW.md` 待 T3 收尾后入此） |
| **优化** | `docs/ISSUES.md` 观察中、`FEATURE_MATRIX.md` | `docs/archive/optimization/` | 性能/感知/配额/成本类优化的前后对比与实测数据 |
| **调试** | `docs/ISSUES.md` 活跃表 | `docs/archive/debugging/`（ISSUES 核销批次沿用 `ISSUES-resolved-<date>.md` 命名，现存于 `docs/deprecated/`，**新批次一律进归档位**） | 单期修复流水、DELIVERY 类文档、已完结 `changes/*.md` |
| **踩坑** | `docs/pitfalls/`（**只累积不归档**） | — | 症状/根因/规则/案例四段式，按域一文件：collection / backend / ai / frontend / deployment / testing |
| **对接** | `docs/ANDROID_SUBMIT_GUIDE.md`、`docs/X_SETUP_GUIDE.md`、`cloud/` 说明、`features/collectors.md` | `docs/archive/integration/` | 已停用/已替换的第三方链路方案（如 we-mp-rss 退役方案、wemp 集成报告——历史件已在 `archive/docs-deprecated/`） |
| **密钥管理** | `docs/HANDOVER.md` §1.5（本地）、`ARCHITECTURE.md` §6 | `docs/archive/credentials/` | 凭据**轮换史与位置矩阵**（三处同步记录、失效事件） |

> ⚠️ **密钥类硬规则**：`docs/archive/credentials/` 里**只许出现凭据名、存放位置、轮换时间、掩码指纹（前 4 后 4）**，永不写完整明文密钥。真实值只在本地 `.env` / Vercel env / GitHub Secrets 三处（AGENTS §2.6）。提交前 `git status` 复核不得含该目录之外的密钥泄漏。

### 2.4 归档文档必须登记的依赖（头注格式，固定五字段）

```markdown
> 类别：调试 | 归档自：docs/ISSUES.md B14 / 本轮会话 2026-09-18
> 关联代码：tools/collect-turso.js:74-79（qOne）、:697-720（熔断自动恢复）
> 关联坑：docs/pitfalls/collection.md#33 | 关联 spec：docs/specs/21-bilibili-runner | 取代：无
> 状态：已验收（用户 2026-09-XX 确认）／待验证 —— 待验证不得归档
```

五字段缺任一项 = 归档无效（出了问题查不到，就是当初没写依赖）。
反向也要登记：活文档里被抽走的那一行，改成一行指针（`详见 docs/archive/debugging/xxx.md`），不许留空行。

## 3. 清洁 SOP（照做，不要凭印象）

**Step 0 冻结验收**：列出本轮拟归档的条目，逐条问「用户验收了吗」。没有 → 留在活文档，进 §8 待验收队列。

**Step 1 事实反向核对（先代码后文档）**——活文档里的每个易变事实都要回到代码/环境取真值：

```bash
grep -n "cron:" .github/workflows/collect.yml          # 调度频率唯一真值
grep -rn "intervalMin\|refreshInterval" server/services/collectors/ | head   # 采集间隔默认值
npm test 2>&1 | tail -5                                 # 测试数以命令输出为准，不写进文档
```
逐项核对：调度频率 / 采集间隔 / 测试基线 / 域名 / 端口 / 代理端口 / 凭据位置 / 功能矩阵 / 表列清单。发现冲突 → 改文档，**不改真值来源**。

**Step 2 头部元信息核对**：`> 最后更新：YYYY-MM-DD` 必须等于该文件最后一次**内容**改动日期（`git log -1 --format=%ad --date=short -- <file>`），且头部声明的范围（"B12~B19"、"H9~H13"）必须与正文表格实际范围一致。

**Step 3 悬空引用扫描**：跑 `node tools/doc-lint.cjs`（§5）。文档里出现的每个路径/端点/表名/spec 编号都要验证存在；引用 `docs/deprecated/` 的必须写明「已归档」。

**Step 4 抽离归档**：按 §2.3 分类搬，按 §2.4 写头注，活文档原位留指针。

**Step 5 重建索引**：`docs/INDEX.md` 必须覆盖 `docs/` 下全部 `.md`（含 `contracts/`、`screenshots/`、`pitfalls/` 各域、`specs/` 全部编号、`archive/` 各分类）。漏登记 = 下次没人能找到。

**Step 6 去重与 SSOT 收敛**：同一事实多处写死 → 保留权威那处，其它改「见 X」。已作废决策加头注，不静默删。

**Step 7 交付**：`node tools/doc-lint.cjs` 0 错 + `npm test` 不新增红 + `git push origin main`（AGENTS §2.1）。文档改动也要推，否则下一个人读的是旧事实。

## 4. 写作红线（长期有效）

1. **易变事实不写死**：测试条数、坑条数、源数量、保留天数 → 写「以 `npm test` / `grep -c` / `settings.data` 为准」。
2. **单一事实源**：调度表只存在于 `collect.yml`；功能矩阵只存在于 `FEATURE_MATRIX.md`；凭据位置只存在于 `HANDOVER.md` §1.5。
3. **活文档只装"当前"**：ISSUES 只装未修复/观察中/挂案；已核销进 `docs/archive/debugging/ISSUES-resolved-<date>.md`。
4. **指针式推荐**：`HANDOFF_PROMPT`/`RUNBOOK` 之类入口文档只指路，不复述内容。
5. **portal/ 是副本不是权威**：`portal/docs/` 与根 `docs/` 分叉时**以根树为准**，同步工具停跑；任何文档修订不落到 portal。

## 5. 门禁与自检

`node tools/doc-lint.cjs`（已接入 `npm run lint:docs`；只读检查，非零退出码=不通过）：
1. 底层文档缺 `> 最后更新：YYYY-MM-DD` 头注 → **错**
2. 相对路径引用不存在 → 底层文档/`features/`/`pitfalls/` 报**错**，历史 spec 与变更记录报**警**（那里的引用是"当时的事实"）；刻意引用已删路径的行加 `<!-- doc-lint:ignore -->` 豁免
3. `docs/` 下存在未被 `INDEX.md` 登记的 `.md`/`.json`（文件名或任一上级目录命中即算登记）→ 警
4. `docs/archive/**` 缺 §2.4 头注字段 → **错**
5. 活文档超长（ISSUES > 130 行 / ARCHITECTURE > 400 行 / NEXT-DEV-REQS > 260 行 / FEATURE_MATRIX > 200 行）→ 警，提示核销轮
6. 明文密钥模式扫描（`ghp_` 前缀、`sk-` 前缀、Turso 带口令的 libsql 连接串、`*.libsql.cloud` 主机名），**只扫 git 跟踪文件**（本地未跟踪的 `docs/HANDOVER.md`/`.env` 属设计内）→ **错**，禁止提交

人工复核项（脚本查不了的）：范围声明与正文是否一致、同类事实是否只剩一处、归档指针是否可达、日期是否与内容改动相称。

## 6. 与其他文档的关系

- 上位：`AGENTS.md` §2 强制约束（本文是第 3、4、5 条的执行细则）。
- 平行：`docs/DEVELOPMENT_STANDARDS.md`（代码规范为主，文档规则让位给本文）。
- 下游：`docs/INDEX.md`（地图由本文规则生成）、`tools/doc-lint.cjs`（本文 §5 的实现）。

## 7. 大改动的文档义务（管理后台类页面/功能重构）

管理后台属**大页面 + 大功能重构**区，默认最低优先级，且必须：
1. 先出**总 spec**（一份框架：目标/边界/分板块/验收口径/回滚点），进 `docs/specs/NN-<topic>/spec.md`；
2. 每个小功能/板块各出一份 **mew-spec 小框架**（同目录 `NN-<topic>-<sub>.md`），列改动点、影响面、验收；
3. **用户同意后才动代码**；动工即建四件套（spec/plan/task/checklist），验收证据写进 checklist；
4. 交付后按 §3 Step 4 归档：功能语义进 `docs/features/`，流水进 `docs/archive/feature|optimization/`，坑进 `docs/pitfalls/`。

## 8. 本次清洁执行记录（2026-09-18 深夜，全量可复现）

**Step 1 反向核对取到的真值**：cron → `.github/workflows/collect.yml:24-36`（7 条 cron / 9 job）；runner 模式 → `collect-turso.js:1954-1967`（7 种）；测试 → 实测 `npm test` 301 项 / 297 绿 / 4 红（红的即 B12，**不写进文档**）。

**已做（修正类，不需验收）**
- 头注日期与范围订正：`ARCHITECTURE.md`（09-11→09-18、三模式→七模式、§5 补 #D2 #35、`cloud/db.js`→`lib/db.js`）、`ISSUES.md`（范围声明 B12~B19→B8~B25/H1~H17）、`CLOUD_PIPELINE_GUIDE.md`（日期 + 测试基线不写死 + **B 站"未上云"与"报警引擎未上云"两行是错的**，已按 FEATURE_MATRIX 订正）、`HANDOVER.md`（生成时间/commit 指针 + 1.4 调度表降为指针 + 数据工具名 `_diag-turso`→`_debug-turso`）<!-- doc-lint:ignore：本段记录"从什么改到什么"，含已消失的旧路径 -->
- **SSOT 冲突消解**：调度表只存 `collect.yml`（ARCHITECTURE §3.6 与 HANDOVER §1.4 改为指针）；测试条数一律改「以 `npm test` 为准」；代理端口 **7890→12000**（`RUNBOOK.md:26`、`DELIVERY_VERIFICATION.md` 5 处、`X_SETUP_GUIDE.md:62`）；坑数不写死（`INDEX.md:20` "28 条已知坑"）
- **悬空引用**：`HANDOFF_PROMPT` → `docs/deprecated/AUDIT-2026-09-12.md`；`BESTBLOGS_BORROW` 提示词目录 → 根 `prompts/`（实测 7 个文件）；`NEXT-DEV-REQS`/归档件的 `docs/specs/26` → 真实文件名
- **过期快照清除**：`HANDOVER.md` §0「09-13 晚状态速览」（259 测试 / 899 源 / focus=1 八源，全部已失真）改为"本文件只装凭据位置"；`HANDOFF_PROMPT.md`「09-12 进度快照」同理
- **决策作废落档**：`NEXT-DEV-REQS.md` **T5-15「每轮修复后更新 DELIVERY-2026-09-XX.md」机制作废**（它就是文档污染的生产器），替代方案 = 交付即写 SSOT + 按本文归档
- **实情订正**：`docs/specs/` 中 10/12/27~34 **只有 spec.md**，`NEXT-DEV-REQS:2` 与本文此前"四件套完成"的说法已改（历史四件套不补，挂 `ISSUES.md` H17）
- **踩坑入库**：`docs/pitfalls/collection.md` **#35**（熔断=45min 抖动锁源 48h、三端自愈语义不一致、系统性故障批量误熔断），两处索引同步（`pitfalls/README.md`、`ARCHITECTURE.md` §5）
- **门禁脚本落地**：`tools/doc-lint.cjs`（§5 六条）+ `npm run lint:docs`

**已做（归档类，属已验收批次）**
- `docs/DELIVERY-2026-09-14.md` → `docs/archive/debugging/2026-09-14-delivery.md`（+§2.4 头注）<!-- doc-lint:ignore：记录搬家前路径 -->
- `docs/changes/2026-09-13-reader-pagination-and-content-fixes.md` → `docs/archive/debugging/` 同名<!-- doc-lint:ignore：记录搬家前路径 -->
- 新建 `docs/archive/README.md`（分类目录 + **按症状查的反向索引** + 已登记归档件表）
- `docs/INDEX.md` 全量重建（补 `contracts/` 5 件、`screenshots/` 14 张、specs 25~35、`archive/` 分类、`deprecated/` 18 件、portal 副本非权威声明）

**留在活文档里没动的（等验收，AGENTS §2 / 本文 §1）**
| 条目 | 现居 | 目标分类 |
|---|---|---|
| B13 构建中断、B14 `qOne`、B16 周刊导语清洗、B20 早报质量门槛（**都还没跑批/重跑验证**，见 W7） | `ISSUES.md` 活跃表 | 调试 `docs/archive/debugging/` |
| B8/B11 在途改动（未提交，见 B25）+ 用户页面标注本轮要重做 | 工作区 | — |
| `changes/2026-09-11-runner-direct-collect.md` | `docs/changes/` | **不移**：ARCHITECTURE/HANDOVER 仍指名引用（§4.5） |
| `BESTBLOGS_BORROW.md` | `docs/` 顶层 | 功能（待 T3 收尾） |
