# P1-12 修复规范：前端 401 处理缺陷

> 状态：✅ 已修复  
> 日期：2026-09-09  
> 影响模块：`web/src/api.js`（前端 fetch 封装）  
> 关联问题：P0-1/P0-3/P0-7 同轮修复

---

## 1. 问题描述

**ISSUES.md 原文**：
> `handleResponse` 检查 `data.needLogin` 字段来决定是否弹出登录框，但后端 401 响应格式为 `{ ok: false, error: '...' }`，从不包含 `needLogin`。用户 token 过期后登录弹窗不会自动弹出，用户只能看到空白页面。

**涉及代码**：
- 前端：`web/src/api.js` L94
- 后端：`api/[...slug].js` L109

---

## 2. 根因分析

### 2.1 直接原因

`handleResponse` 函数中的 401 检测逻辑使用了错误的判断条件：

```javascript
// 错误代码
if (res.status === 401 && data && data.needLogin) {
  setToken('');
  window.dispatchEvent(new CustomEvent('qwis:unauthorized'));
}
```

条件 `data.needLogin` 要求后端在 401 响应体中包含 `needLogin: true` 字段。但后端 `api/[...slug].js` 的 `requireAuth` 函数返回的 401 响应格式为：

```javascript
// 后端实际返回格式
{ status: 401, body: { ok: false, error: 'Unauthorized' } }
```

**后端从不包含 `needLogin` 字段**，导致条件永远为 `false`，401 处理逻辑永远不会执行。

### 2.2 设计意图 vs 实际实现

| 层面 | 设计意图 | 实际实现 |
|------|----------|----------|
| 前端契约 | 401 时检查 `data.needLogin` | 后端不返回此字段 |
| 后端契约 | 401 返回 `{ ok: false, error: '...' }` | 与前端期望不匹配 |
| 正确行为 | 401 → 清 token → 弹登录框 | 401 → 静默失败 → 空白页面 |

### 2.3 根本原因

前后端 401 响应契约不一致。前端假设后端会在 401 响应体中显式标记 `needLogin`，但后端使用通用的 `{ ok: false, error }` 错误格式，不区分「需要登录」和其他 401 场景。

---

## 3. 影响范围评估

### 3.1 直接影响

| 场景 | 影响 |
|------|------|
| Token 过期（7 天有效期到期） | 登录弹窗不自动弹出，用户看到空白页面 |
| Token 被手动清除 | 需要写操作的功能静默失败 |
| 管理台访问 | 未登录用户无法触发登录弹窗 |
| 阅读器只读功能 | 不受影响（GET 公开路由不需要鉴权） |

### 3.2 不受影响的场景

- GET 公开路由（articles/videos/hot/daily/status/settings/reading 等）不需要鉴权
- 已登录且 token 有效的用户不受影响
- 本地 Express 端不受影响（有自己的中间件链）

### 3.3 修复方案的影响分析

**修复策略**：将条件从 `res.status === 401 && data && data.needLogin` 改为 `res.status === 401`。

**安全性评估**：
- ✅ 所有来自 `/api/*` 的 401 响应都意味着认证失败，清 token + 弹登录框是正确的行为
- ✅ 非 JSON 响应（如 Vercel 平台级 401）也会触发，这是期望行为
- ✅ `setToken('')` 是幂等操作，多次调用无副作用
- ✅ `qwis:unauthorized` 事件由 LoginGate 组件监听，弹出登录框或显示提示

**回归风险**：极低。修改仅放宽了触发条件（从「401 + needLogin」到「401」），不改变任何成功路径逻辑。

---

## 4. 修复策略

### 4.1 方案选择

| 方案 | 描述 | 优劣 |
|------|------|------|
| A. 前端适配后端 | 移除 `data.needLogin` 检查 | ✅ 1 行改动，最小变更；✅ 与现有后端契约一致 |
| B. 后端适配前端 | 后端 401 响应增加 `needLogin: true` | ❌ 需改后端多处；❌ 增加无意义字段 |
| C. 双端统一新契约 | 定义新的 401 响应格式 | ❌ 过度设计；❌ 影响面大 |

**选择方案 A**：最小改动、零风险、与现有后端契约完全一致。

### 4.2 代码修改

**文件**：`web/src/api.js`  
**位置**：`handleResponse` 函数内 L94  
**改动**：1 行

```diff
-    if (res.status === 401 && data && data.needLogin) {
+    if (res.status === 401) {
```

---

## 5. 验收标准

### 5.1 功能验收

| # | 测试场景 | 期望结果 |
|---|----------|----------|
| 1 | Token 过期后发起任意需鉴权的 API 请求 | 自动弹出登录弹窗 |
| 2 | Token 过期后发起 GET 公开路由请求 | 正常返回数据，不弹登录框 |
| 3 | 未登录状态访问需鉴权路由 | 弹出登录弹窗 |
| 4 | 登录成功后继续操作 | 正常执行，无 401 |
| 5 | 非 JSON 的 401 响应（如 Vercel 平台级） | 也能触发登录弹窗 |

### 5.2 回归验收

| # | 测试场景 | 期望结果 |
|---|----------|----------|
| 1 | 正常 API 调用（200 响应） | 不受影响，正常返回数据 |
| 2 | 网络错误（无响应） | 抛「网络请求失败」错误，不触发 401 逻辑 |
| 3 | 后端 500 错误 | 抛错误，不触发 401 逻辑 |
| 4 | 后端 404 错误 | 抛错误，不触发 401 逻辑 |

---

## 6. 同轮修复项（P0-1 / P0-3 / P0-7）

本轮同时修复了以下 3 个 P0 问题，均在 `api/[...slug].js`：

### P0-1：阅读沉淀页数据缺失
- **改动**：重写 `handleReading` 函数
- **内容**：从仅返回 counts → 完整实现 UNION ALL 查询（文章 + 视频），支持 tab/type/q/cursor 参数，返回 items + nextCursor + counts
- **代码量**：+100 行（从 6 行扩展到 106 行）

### P0-3：热点榜筛选无效
- **改动**：重写 `handleHot` 函数
- **内容**：新增 tab/category/q/source 筛选 + 游标分页支持
- **代码量**：+60 行（从 13 行扩展到 70 行）

### P0-7：全部标为已读不可用
- **改动**：新增 `handleArticlesReadAll` 函数 + dispatch 路由注册
- **内容**：`POST /api/articles/read-all` 支持按当前过滤条件批量标记已读
- **代码量**：+25 行

---

## 7. 变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `api/[...slug].js` | 修改 | P0-1 handleReading 重写、P0-3 handleHot 重写、P0-7 read-all 路由新增 |
| `web/src/api.js` | 修改 | P1-12 401 处理条件修复（1 行） |

---

## 8. 部署注意事项

1. 修改仅涉及 `api/[...slug].js` 和 `web/src/api.js`，无需改数据库 schema
2. 前端修改需重新 build（`npm run build`）
3. 后端修改随 Vercel 部署自动生效
4. 建议部署后验证：
   - `GET /api/reading?tab=all` 返回 items 数组（非仅 counts）
   - `GET /api/hot?tab=featured` 和 `GET /api/hot?tab=all` 返回不同数据
   - `POST /api/articles/read-all`（带 auth）返回 `{ ok: true, updated: N }`
   - Token 过期后前端自动弹出登录框
