# 全网情报系统 · 开发规范与验收标准

> 所有开发者（含 AI Agent）必须遵守的约定。最后更新：2026-09-09

---

## 1. 代码规范

### 1.1 命名约定

- **文件名**：kebab-case（如 `daily-generate.js`、`AiSettingsTab.jsx`）
- **组件名**：PascalCase（如 `AiSettingsTab`、`DailySettingsTab`）
- **函数/变量**：camelCase（如 `handleDaily`、`getSetting`）
- **常量**：UPPER_SNAKE_CASE（如 `PUBLIC_GET_PATHS`、`DAILY_COLUMNS`）
- **数据库字段**：snake_case（如 `published_at`、`source_id`）

### 1.2 目录结构

```
api/              # Vercel Serverless 正式代码（主部署）
server/           # 本地 Express 代码（开发/灾备）
web/src/          # 前端 React 代码
  components/     # Tab 组件（每个 Tab 一个文件）
  pages/          # 页面组件（AdminPage、ReaderPage 等）
docs/             # 项目文档
docs/deprecated/  # 已归档的历史文档
tools/            # 工具脚本
```

### 1.3 Import 约定

- 前端组件使用相对路径 import
- 后端模块使用 `require()` 而非 `import`
- 禁止循环依赖

---

## 2. 三端同步规则

系统有三套后端实现：**本地 Express**（`server/services/collectors/`）、**Vercel Serverless 备份端点**（`api/collect.js`）、**GH runner 采集主链路**（`tools/collect-turso.js`）。

### 2.1 强制同步

| 操作 | 必须同步 |
|------|---------|
| 新增/修改 API 路由 | ✅ 本地/云端都要改 |
| 修改采集语义（过滤/清洗/熔断/去重/增量） | ✅ 三端同步：`server/services/collectors/` + `api/collect.js` + `tools/collect-turso.js` |
| 修改数据库查询 | ✅ 确认各端 SQL 兼容 |
| 新增 settings key | ✅ 各端读写逻辑对齐 |
| 修改鉴权白名单 | ✅ PUBLIC_GET_PATHS 和 Express middleware 同步 |

### 2.2 检查流程

1. 改完一端后，搜索其余实现是否有对应代码
2. 如果只改了一端，在 commit message 标注 `[Vercel only]` 或 `[Local only]` 并说明原因
3. 新功能优先实现 Vercel 端，再补本地 Express 端

### 2.3 差异容忍

以下允许不一致：
- 本地 Express 可有 Playwright 依赖（抖音采集）
- Vercel 端不能有 Node.js 原生模块

---

## 3. 测试要求

### 3.1 提交前必跑

```bash
npm test          # 全绿
npm run build     # 通过（前端无编译错误）
```

### 3.2 测试覆盖

- 新增 API 路由：至少写一个单元测试
- 修改现有逻辑：确保原有测试不被 break
- 前端组件：手动验证功能正常

### 3.3 集成测试

修改涉及数据库的操作后，运行：
```bash
node tools/audit-cloud.js   # 云端巡检（需生产环境可达）
```

---

## 4. 文档更新约定

### 4.1 必须更新文档的场景

| 场景 | 需更新的文档 |
|------|-------------|
| 修改部署架构 | `ARCHITECTURE.md` |
| 新增/删除 API 路由 | `docs/FEATURE_MATRIX.md` + `docs/DEV_GUIDE.md` |
| 修复已知问题 | `docs/ISSUES.md`（标记状态） |
| 修改日报逻辑 | `docs/RUNBOOK.md` §日报 |
| 新增功能模块 | `docs/features/` 新增对应文档 |
| 凭据/API 变更 | `docs/HANDOVER.md` |
| 功能/端点变更 | `docs/FEATURE_MATRIX.md` |
| 调度频率变更 | 联动 `ARCHITECTURE.md` + `docs/HANDOVER.md` + `docs/RUNBOOK.md` + `docs/CLOUD_PIPELINE_GUIDE.md` 四处 |

### 4.2 文档格式

- 每个文档头部必须有 `> 最后更新：YYYY-MM-DD`
- 活文档（如 ISSUES.md）在修改记录区追加条目
- 归档文档移入 `docs/deprecated/` 并加标注

---

## 5. 验收 Checklist（PR 前检查）

### 代码质量
- [ ] `npm test` 全绿
- [ ] `npm run build` 通过
- [ ] 无硬编码密钥（用 `process.env` 或 `getSetting`）
- [ ] 无 `console.log` 调试残留（用 `console.error` 或 log 模块）

### 双端一致性
- [ ] Vercel API 改动已同步本地 Express（或标注原因）
- [ ] 本地 Express 改动已同步 Vercel API（或标注原因）

### 文档
- [ ] 改架构 → ARCHITECTURE.md 已更新
- [ ] 修 bug → ISSUES.md 状态已更新
- [ ] 新功能 → DEV_GUIDE.md / FEATURE_MATRIX.md 已更新

### 安全
- [ ] 新增路由已加入鉴权白名单或公开白名单
- [ ] 无明文密钥/密码提交
- [ ] 用户输入已做校验/转义

### 部署
- [ ] Vercel 环境变量已配置（如需新增）
- [ ] GitHub Actions workflow 已测试（如涉及）

---

## 6. Git 约定

### 6.1 Commit Message 格式

```
<type>: <简要描述>

type 可选：
  feat     新功能
  fix      修复
  refactor 重构
  docs     文档
  chore    工具/配置
  test     测试
```

### 6.2 分支策略

- `main`：生产分支（直接推送或 PR 合并）
- 功能分支：`feat/xxx`、`fix/xxx`

---

## 7. 环境配置

### 7.1 必需环境变量

| 变量 | 用途 | 配置位置 |
|------|------|---------|
| `TURSO_DATABASE_URL` | Turso 云数据库地址 | Vercel Env + .env |
| `TURSO_AUTH_TOKEN` | Turso 认证令牌 | Vercel Env + .env |
| `AUTH_SECRET` | JWT 签名密钥 | Vercel Env + .env |
| `COLLECT_KEY` | 采集触发密钥 | **三处同步**：本地 .env + Vercel Env + GitHub Secrets |
| `ADMIN_USER` | 管理员用户名 | Vercel Env + .env |
| `ADMIN_PASSWORD` | 管理员密码 | Vercel Env + .env |
| `AGNES_API_KEY` | Agencs AI API Key | Vercel Env + .env |
| `DEEPSEEK_API_KEY` | DeepSeek API Key（云端 AI 待启用：Agnes key 绑 IP 在云端 401，用 DeepSeek 回退） | Vercel Env + GitHub Secrets + .env |

### 7.2 安全红线

- `AUTH_SECRET` 不得使用 `dev-secret` 作为生产值
- API Key 不得硬编码在源码中
- 环境变量变更必须同步更新本文档
