# 源写 API 上云（14-sources-write）Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `api/_classify.js` | 分类目录/关键词兜底/落组/预览/执行（移植自 server/services/classify.js） |
| 修改 | `api/[...slug].js` | 8 个 handler + 路由注册 |
| 新建 | `tests/regression-cloud-sources.test.js` | 真实 handler 回归测试（test 数据用后即删） |
| 修改 | `docs/HANDOVER.md` / `docs/FEATURE_MATRIX.md` / `docs/changes/2026-09-12-sources-write.md` | 文档同步义务 |

## T1: api/_classify.js 移植

**文件：** `api/_classify.js`（新建）
**依赖：** 无
**步骤：**
1. 逐字复制本地 classify.js 的 CATALOG（8 类目录+别名+关键词表）与 kindOfType/normalizeName/matchByKeyword
2. 省略 OPML 层级解析（无 OPML 文件上下文，spec 已声明）
3. 移植 async 化：`getOrCreateGroupId(zh, kind)`（精确同名同 kind 复用，否则 INSERT groups sort=max+1）、`classifySource(source)`（仅关键词路径）
4. 移植 `autoClassifySourceId(id)`、`previewReclassify({includeLocked, showAll})`、`applyReclassify(ids)`（跳过 categoryLocked=1）
5. 依赖注入：文件顶部接收 db helpers（qAll/qRun）或自行 createClient——采用自含 createClient（与 collect.js 同模式）

**验证：** `node --check api/_classify.js`

## T2: 源 CRUD handler（F1/F2/F5）

**文件：** `api/[...slug].js`
**依赖：** T1
**步骤：**
1. `handleSourceCreate`：url 必填 → url 查重（已存在返回 200+item）→ type 显式白名单校验或 URL 启发式 → name 缺省主机名 → INSERT（status='pending', next_fetch_at=NULL）→ autoClassifySourceId try/catch → auditRecord('source.create')
2. `handleSourceDelete`：存在性校验 → batch 三删（articles/videos/sources）→ auditRecord('source.delete')
3. `handleSourceInterval`：存在性校验 → 正数/null 校验（非法 400 零写入）→ extra.intervalMin 合并写 → auditRecord('source.interval')

**验证：** `node --check` + T7 用例 1-4

## T3: refresh handler（F3/F4）

**文件：** `api/[...slug].js`
**依赖：** 无
**步骤：**
1. `handleSourceRefresh(id)`：存在性校验 → `UPDATE sources SET next_fetch_at=NULL WHERE id=?` → 返回明确文案「已标记立即到期，≤15 分钟由云端 runner 采集」
2. `handleSourceRefreshAll`：支持 ?type= 过滤 → 同语义批量 → 返回受影响数
3. 均记 auditRecord

**验证：** T7 用例 5-6

## T4: batch + autoclassify handler（F6/F7）

**文件：** `api/[...slug].js`
**依赖：** T1
**步骤：**
1. `handleSourcesBatch`：ids 数组必填且 ≤200（超出截断+提示）；action 白名单 enable/disable/focus/unfocus/move；move 需 groupId + kind 校验 + categoryLocked=1；enable 走解冻语义（enabled=1/fail_count=0/status ok/清 lastError/+0-6h 错峰）；逐 id 收集 errors 部分成功
2. `handleAutoclassify`：dryRun→previewReclassify / apply→ids 必填+applyReclassify / 其余 400
3. 均记 auditRecord

**验证：** T7 用例 7-9

## T5: groups 写 handler（F8）

**文件：** `api/[...slug].js`
**依赖：** 无
**步骤：**
1. `handleGroupCreate`：kind article|video 校验 → sort=max+1 → INSERT
2. `handleGroupUpdate(id)`：存在性校验 → name/sort 合并写
3. `handleGroupDelete(id)`：组内源 group_id=NULL → 删组
4. `handleGroupMove`：source_id 必填 → kind 校验 → group_id 写 + categoryLocked=1
5. 均记 auditRecord

**验证：** T7 用例 10-12

## T6: 路由注册

**文件：** `api/[...slug].js` dispatch()
**依赖：** T2-T5
**步骤：**
1. 写区加：POST /api/sources、DELETE /api/sources/:id、POST /api/sources/:id/refresh、POST /api/sources/refresh-all、PUT /api/sources/:id/interval、POST /api/sources/batch、POST /api/sources/autoclassify、POST /api/groups、PUT/DELETE /api/groups/:id、POST /api/groups/move
2. 顺序约束：`/api/sources/batch`、`/api/sources/refresh-all`、`/api/sources/restore-all`（已有）必须在 `/api/sources/:id` 类正则之前匹配（防截胡——本地坑：sourcelib 须先挂）

**验证：** `node --check` + T7 全量

## T7: 回归测试

**文件：** `tests/regression-cloud-sources.test.js`
**依赖：** T2-T6
**步骤：**
1. 复用 13 项的 mock 模式（mockReq/mockRes/JWT）
2. 用例：① POST 新增 test 源→返回 item 含 id ② 同 url 重复 POST→不重复建 ③ DELETE→源+文章消失 ④ PUT interval 非法→400 ⑤ refresh→next_fetch_at 置 NULL 且返回 runner 提示文案 ⑥ refresh-all?type=→返回受影响数 ⑦ batch focus/unfocus 增量语义 ⑧ batch move kind 不匹配→该项报错其余成功 ⑨ autoclassify dryRun 不落库（前后 sources 快照对比）⑩ apply 跳过 categoryLocked 源 ⑪ groups 增改删+move kind 校验 ⑫ 写操作审计记录存在
3. 测试数据：源名统一 `TEST-` 前缀，after 全删（含其 groups/audit 不动）

**验证：** `node --test tests/regression-cloud-sources.test.js` 全绿

## T8: 文档同步 + 线上验收

**文件：** docs 三件
**依赖：** T7
**步骤：**
1. HANDOVER §3.4 补 8 个端点；FEATURE_MATRIX P0-2 标完成；changes 新增变更记录
2. push → 等 READY → 线上实测 AC1-AC7
3. AC1 端到端：POST 真实测试源（example.com feed）→ 等 runner 下轮 → 查 last_fetched_at 更新 → DELETE 清理

**验证：** 线上 curl 输出符合 AC1-AC7

## 执行顺序

```
T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8
```
（T3/T5 与 T1 无依赖，可提前；保持串行降低心智负担）
