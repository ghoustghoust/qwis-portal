# 变更记录：源写 API 上云（14-sources-write）

> 日期：2026-09-12 ｜ 类型：功能移植（P0-2）｜ 流程：mew-spec 四件套

## 改了什么

| 端点 | 说明 |
|---|---|
| `POST /api/sources` | 新增源：URL 启发式识别类型 + 幂等查重 + 自动分类挂接 + 立即到期 |
| `DELETE /api/sources/:id` | 级联删除（源+文章+视频） |
| `POST /api/sources/:id/refresh` / `refresh-all?type=` | 标记立即到期，runner ≤15min 补抓 |
| `PUT /api/sources/:id/interval` | 源级刷新间隔（extra.intervalMin 合并写，null 删键） |
| `POST /api/sources/batch` | enable（解冻+0-6h 错峰）/disable/focus/unfocus/move（kind 校验+锁定），≤200 ids |
| `POST /api/sources/autoclassify` | dryRun 预览（不落库）/ apply（跳过锁定源），8 类目录+关键词兜底 |
| `POST/PUT/DELETE /api/groups*` + `POST /api/groups/move` | 分组管理（kind 校验 + categoryLocked 手动锁定） |

新增 `api/_classify.js`（本地 classify.js 的 serverless 移植；OPML 层级解析省略）。

## 验收证据

- 回归测试 12/12 绿（真实 Turso，tests/regression-cloud-sources.test.js）
- **性能对抗发现**：autoclassify 预览初版 N+1 查询（638 源 × 逐次查组）实测 70s，超 Vercel 10s 限制必然 504 → 改为分组一次性预载，70s→0.66s
- 线上实测（见下）

## 关键语义差异（云端 vs 本地，有意为之）

- refresh = 标记到期交 runner（本地是同步抓取）——10s 限制 + 防与 runner 并发双写
- 新增源 resolve 简化（不联网探测名称/头像，主机名兜底 + 自动分类）
