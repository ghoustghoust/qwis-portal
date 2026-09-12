# 源写 API 上云（14-sources-write）Spec

## 背景

云端源库当前只读：管理后台的「源库批量操作 / 新增源 / 删除源 / 单源刷新 / 分组管理 / 拖拽移动 / 自动分类」全部 404。本地 Express 已有完整成熟实现（sources.js / sourcelib.js / groups.js + classify.js）。13-settings-write 已完成，云端设置可写；本项让云端源管理闭环。

需求澄清结论：**无开放问题**——用户已明确"这些功能云端必须能用"，本地语义即需求基准，逐项镜像。

## 目标

- 云端源库从只读变为完整可管理（增/删/刷/批量/分组/自动分类）
- 写语义与本地一致（含熔断联动、kind 校验、手动锁定、审计留痕）
- 新源写入后 ≤15 分钟被 runner 采纳入流（next_fetch_at 语义）

## 功能需求

- **F1**：`POST /api/sources` 新增源：url 必填；显式 type 或 URL 启发式识别（bilibili.com→bilibili、youtube→youtube、hotlist:// 等）；云端简化 resolve（不做全量网络探测，名称缺省取 URL 主机名）；新源自动分类挂接（失败不阻断建源）；`next_fetch_at=NULL`（立即到期）
- **F2**：`DELETE /api/sources/:id` 级联删除源及其文章/视频（与本地一致）
- **F3**：`POST /api/sources/:id/refresh`：云端语义 = 标记立即到期交 runner（返回明确提示），不做同步抓取（10s 限制 + 防与 runner 并发）
- **F4**：`POST /api/sources/refresh-all?type=`：全部启用源标记到期（复用 13 已验证的语义），返回受影响数
- **F5**：`PUT /api/sources/:id/interval`：extra.intervalMin 合并写（null 删除该键），正数校验
- **F6**：`POST /api/sources/batch`：enable（含解冻语义 + 0-6h 随机错峰）/ disable / focus / unfocus（增量）/ move（kind 校验 + extra.categoryLocked=1）
- **F7**：`POST /api/sources/autoclassify`：dryRun 预览（不落库，只列可执行建议 + noSuggestion 计数）/ apply（按 ids 执行，跳过锁定源）——移植 classify.js 的 8 类目录 + 关键词兜底逻辑
- **F8**：`/api/groups` 写：`POST`（kind article|video 校验，sort=max+1）、`PUT /:id`、`DELETE /:id`（组内源回未分组）、`POST /move`（kind 校验 + categoryLocked）
- **F9**：全部写操作记审计日志（action 与本地同名：source.create/delete/refresh/batch 等）

## 非功能需求

- N1：所有写操作 serverless 10s 内完成（单源操作单条 SQL；batch 上限 200 ids/次，超出截断并提示）
- N2：Bearer JWT 鉴权（复用现有中间件）
- N3：双端语义一致——同一请求在两端产生相同终态（除 F3/F4 的"标记到期 vs 立即抓"差异已在文案显式声明）
- N4：幂等——重复 POST 同源 URL 不产生重复记录（url 查重）

## 不做的事

- 不做云端同步抓取（refresh=标记到期，runner ≤15min 补抓）
- 不改前端（现有调用适配）；不改本地
- 源的 wbi/Playwright 解析不在本项（19-bilibili-runner）
- autoclassify 的分类目录编辑 UI 不做（目录与本地一致硬编码）

## 验收标准

- AC1：线上 POST 新增一个 RSS 源 → 返回 item（含 id）→ 下一次 runner 轮该源被抓取（last_fetched_at 更新）
- AC2：重复 POST 同 url → 不重复建源
- AC3：DELETE 源 → 源+其文章消失；autoclassify dryRun 返回建议且不落库（对比前后 sources 无变化）
- AC4：batch move 到 kind 不匹配的分组 → 该项报错其余成功（部分成功语义与本地一致）
- AC5：autoclassify apply 跳过 extra.categoryLocked=1 的源
- AC6：PUT interval 非法值（0/负数/非数）→ 400 零写入
- AC7：每类写操作在 /api/audit 有对应记录
- AC8：回归测试全绿（mock req/res 真实 handler + test 源建后即删）
