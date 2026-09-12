# 设置写 API 上云（13-settings-write）Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `api/[...slug].js` | 新增 SETTINGS_BLOCKLIST / mergeSetting / validateDailyPatch / sanitizeColumns + 3 个 handler + 路由注册 |
| 新建 | `tests/regression-cloud-settings.test.js` | 云端 handler 真实调用回归测试（mock req/res + test.* 前缀键） |
| 修改 | `docs/HANDOVER.md` | §3.4 管理功能表补 3 个端点 |
| 修改 | `docs/FEATURE_MATRIX.md` | §2 P0-1 标记完成 |

## T1: 工具函数与黑名单

**文件：** `api/[...slug].js`（插在 auditRecord 之后）
**依赖：** 无
**步骤：**
1. 定义 `SETTINGS_BLOCKLIST = ['auth.secret', 'admin.passwordHash', 'backup.latest', 'cloud.collect']`
2. 实现 `async mergeSetting(key, patch, sensitiveKeys=[])`：getSetting 读现值（缺省 {}）→ 逐键合并（敏感键值为 undefined/'' 跳过；其余 undefined 跳过）→ setSetting 写回
3. 移植 `validateDailyPatch(patch)`（windowHours 正数 / time HH:MM 补零，非法 throw）
4. 移植 `sanitizeColumns(cols)`（名称必填 / 无 id 自动生成 / special 仅 focus|fallback / keywords 支持 AND 数组）

**验证：** `node --check api/[...slug].js` 通过

## T2: handleSettingsPut（PUT /api/settings）

**文件：** `api/[...slug].js`
**依赖：** T1
**步骤：**
1. 黑名单检查：若 body 任一区的键名或 body 顶层键命中 SETTINGS_BLOCKLIST → `{status:400, body:jsonErr('含系统保留键，禁止写入')}`
2. `body.ai` 存在 → 400「云端 AI 配置锁定为环境变量（AGNES_*），请在 Vercel env 修改」（先于一切写入）
3. 预校验：daily 区过 validateDailyPatch；views 区（数组 ≤20、name 非空 ≤20 字、filter 对象）；data.retentionDays（1-90 整数）——任一失败 400 零写入
4. 分区执行：intervals→mergeSetting('intervals')；opml→opml.url/opml.enabled 两键单独 setSetting；queue→mergeSetting('queue', patch, ['token'])；daily→mergeSetting('daily', dailyPatch)；hot→mergeSetting('hot')；data→mergeSetting('data')；views→setSetting('reader.views', views)；bilibili.cookie→upsert credentials（INSERT ... ON CONFLICT(platform) DO UPDATE）
5. auditRecord('settings.update', { detail: { sections } })
6. 返回 jsonOk({})

**验证：** T6 测试用例 1-5 全过

## T3: handleDailySettingsGet（GET /api/settings/daily）

**文件：** `api/[...slug].js`
**依赖：** 无
**步骤：**
1. 读 settings 'daily'（缺省 {windowHours:48, time:'08:00'}）与 'daily.columns'（缺省 DEFAULT_COLUMNS，复用文件内已有常量）
2. articleSources：查 sources type IN ('wechat','rss','x') → {id,type,name,focus:!!focus,selected: selectedIds?includes:true}
3. videoSources：type IN ('bilibili','douyin','youtube') 同上
4. 返回 jsonOk({windowHours,time,articleSourceIds,videoSourceIds,articleSources,videoSources,columns,defaultColumns})

**验证：** T6 测试用例 6

## T4: handleDailySettingsPut（PUT /api/settings/daily）

**文件：** `api/[...slug].js`
**依赖：** T1、T3
**步骤：**
1. 预校验 windowHours/time/articleSourceIds/videoSourceIds（须数组）→ 失败 400 零写入
2. mergeSetting('daily', patch)
3. focusSourceIds 存在 → 全量替换：`UPDATE sources SET focus = CASE WHEN id IN (SELECT value FROM json_each(?)) THEN 1 ELSE 0 END`；否则 focus 对象 → 逐条 UPDATE 组成 batch 一次写
4. restoreDefaultColumns → setSetting('daily.columns', DEFAULT_COLUMNS)；columns → sanitizeColumns 后 setSetting
5. auditRecord('daily.settings', { detail: { keys } })；返回 jsonOk({})
6. 不做 reschedule

**验证：** T6 测试用例 7-9

## T5: 路由注册

**文件：** `api/[...slug].js` dispatch()
**依赖：** T2、T3、T4
**步骤：**
1. POST/PUT 区加：`if (path === '/api/settings' && method === 'PUT') return handleSettingsPut(req);`（注意现有 GET /api/settings 不动）
2. `if (path === '/api/settings/daily' && method === 'PUT') return handleDailySettingsPut(req);`
3. GET 区加：`if (path === '/api/settings/daily') return handleDailySettingsGet(req);`（放在 `/api/settings` 之前）
4. 确认 PUBLIC_GET_PATHS 加入 `/api/settings/daily`（读公开，与 /api/settings 一致）

**验证：** `node --check` + T6 全部用例

## T6: 回归测试

**文件：** `tests/regression-cloud-settings.test.js`
**依赖：** T2-T5
**步骤：**
1. 写 mockRes（setHeader/status/json/end 链式收集）与 mockReq（method/query/body）工具
2. 加载 .env 的 TURSO_*（test.* 键隔离，用后在 finally 删除）
3. 用例：① PUT views 合法→读回一致 ② PUT views 非法→400 且其它区未动 ③ PUT daily time 非法→400 ④ PUT 带 auth.secret→400 ⑤ PUT ai 区→400 ⑥ GET /settings/daily 结构完整 ⑦ PUT daily windowHours=72→读回 ⑧ queue.token 留空不覆盖（先设 test 键再 PUT ''）⑨ focusSourceIds 全量替换生效 ⑩ 每次成功写有 audit_log 记录
4. 鉴权用 AUTH_DISABLED 路径或生成 token——handler 层直接调，requireAuth 在 dispatch 之前，mock dispatch 调用即可

**验证：** `node --test tests/regression-cloud-settings.test.js` 全绿

## T7: 文档同步 + 部署验收

**文件：** docs/HANDOVER.md、docs/FEATURE_MATRIX.md
**依赖：** T6
**步骤：**
1. HANDOVER §3.4 补：PUT /api/settings、GET/PUT /api/settings/daily
2. FEATURE_MATRIX §2 P0-1 标 ✅
3. commit + push（用户确认后）→ 等 Vercel READY → 线上实测 AC1-AC6（curl 带 JWT）

**验证：** 线上 curl 实测输出符合 AC1-AC6

## 执行顺序

```
T1 → T2 → T3 → T4 → T5 → T6 → T7
```
