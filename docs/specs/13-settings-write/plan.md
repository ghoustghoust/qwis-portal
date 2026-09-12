# 设置写 API 上云（13-settings-write）Plan

## 架构概览

全部改动集中在云端 catch-all `api/[...slug].js`：新增 3 个 handler + 2 个工具函数 + 路由注册。前端零改动（现有调用天然适配），本地 `server/` 零改动（本来就有）。

```
浏览器(管理后台) ──PUT/GET──▶ Vercel api/[...slug].js
                                  ├─ handleSettingsPut      (PUT  /api/settings)
                                  ├─ handleDailySettingsGet (GET  /api/settings/daily)
                                  ├─ handleDailySettingsPut (PUT  /api/settings/daily)
                                  ├─ mergeSetting()         (读-改-写合并,敏感键留空不覆盖)
                                  ├─ validateDailyPatch()   (与本地同强度校验)
                                  └─ auditRecord()          (已存在,复用)
                                        │
                                        ▼
                                     Turso settings / credentials / sources.focus
```

## 核心数据结构

### settings 行（已有表）
`{ key: string PK, value: string(JSON) }` —— 涉及键：`intervals / opml.url / opml.enabled / queue / daily / daily.columns / hot / data / reader.views / ai（只读）`

### 黑名单（新增常量）
`SETTINGS_BLOCKLIST = ['auth.secret', 'admin.passwordHash', 'backup.latest', 'cloud.collect']`

### mergeSetting（新增工具函数）
```
async mergeSetting(key, patch, sensitiveKeys=[])
行为：读现值(缺省 {}) → 逐键合并（敏感键值为 undefined/'' 时跳过不覆盖）→ 写回
```

### validateDailyPatch（移植自本地 routes/daily.js）
```
输入 patch → 输出规整后的 {windowHours?, time?}
windowHours: 必须正数；time: 必须 HH:MM（小时≤23 分≤59，补零）
非法即 throw（调用方转 400）
```

### sanitizeColumns（移植自本地 routes/daily.js）
```
输入 columns 数组 → 输出规整栏目数组
名称必填；无 id 自动生成 c${Date.now()}_${i}；special 仅认 focus/fallback；
keywords 支持字符串(OR)或字符串数组(AND)，空项剔除
```

## 模块设计

### handleSettingsPut
**职责**：PUT /api/settings 分区合并写
**对外接口**：`(req) → jsonOk / {status:400, body:jsonErr}`
**流程**：
1. 黑名单检查：body 任意区合并后会触碰 SETTINGS_BLOCKLIST 键 → 400（F3）
2. **AI 区检查**：body.ai 存在 → 400「云端 AI 配置锁定为环境变量（AGNES_*）」（F4，先于一切写入）
3. 全量预校验（daily 字段/views 数组/retentionDays 范围）→ 任一失败 400 零写入（F6）
4. 分区执行：intervals→mergeSetting('intervals')；opml→opml.url/enabled 两键；queue→mergeSetting('queue',…,['token'])；daily→mergeSetting('daily', dailyPatch)；hot→mergeSetting('hot')；data→校验后 mergeSetting('data')；views→整体替换 setSetting('reader.views')；bilibili.cookie→upsert credentials
5. auditRecord('settings.update', detail: {sections: [写入的区名]})（F5）

### handleDailySettingsGet
**职责**：GET /api/settings/daily（日报设置页数据源）
**返回**：`{ok, windowHours, time, articleSourceIds, videoSourceIds, articleSources, videoSources, columns, defaultColumns}`
- 默认：windowHours=48, time='08:00', sourceIds=null(全选)
- articleSources: sources 表 type IN ('wechat','rss','x') → {id,type,name,focus,selected}
- videoSources: type IN ('bilibili','douyin','youtube') 同上
- columns: settings['daily.columns'] 缺省 DEFAULT_COLUMNS（复用文件内已有常量）

### handleDailySettingsPut
**职责**：PUT /api/settings/daily
**流程**：
1. 预校验 windowHours/time/articleSourceIds/videoSourceIds（数组）→ 失败 400 零写入
2. mergeSetting('daily', patch)
3. focus 两种写法：`focusSourceIds` 全量替换（`UPDATE sources SET focus = CASE WHEN id IN (SELECT value FROM json_each(?)) THEN 1 ELSE 0 END`，libSQL 支持 json_each）；`focus:{id:bool}` 逐条 UPDATE（batch）
4. `restoreDefaultColumns` → setSetting('daily.columns', DEFAULT_COLUMNS)；`columns` → sanitizeColumns 后替换
5. auditRecord('daily.settings', detail: {keys})
6. 不做 scheduler.reschedule（云端无调度器；runner 每 15min/每日 09:03 自然生效）

## 模块交互

```
管理后台各 Tab（WechatTab/QueuePanel/DataTab/DailySettingsTab/HotSettings/Sidebar视图）
  → PUT /api/settings → handleSettingsPut → mergeSetting → Turso
  → GET/PUT /api/settings/daily → handleDailySettings* → Turso + sources.focus
```

## 文件组织

```
api/[...slug].js            — 新增 2 工具函数 + 3 handler + 路由注册（唯一业务改动文件）
tests/regression-cloud-settings.test.js — 新增：mock req/res 打真实 serverless handler，test.* 前缀键用后即删
docs/HANDOVER.md            — §3.4 表补 settings 写端点（文档同步义务）
docs/FEATURE_MATRIX.md      — §2 P0-1 标记完成
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| AI 区写入 | 直接 400 报错（非静默忽略） | 用户拍板 env 锁定；明确报错防止管理台"假装保存成功"（spec 审批时已说明） |
| 黑名单实现 | 写前显式检查 body 各区键名 | settings 是自由键值表，黑名单比白名单更不侵入——本地各区键名是封闭的，可枚举检查 |
| focus 全量替换 | 复用本地 json_each 方案 | libSQL 兼容 SQLite json1；避免 638 行逐条 UPDATE |
| 调度联动 | 不做 | 云端无调度器进程；intervals/time 变更 runner 自然拾取（spec 明确不做） |
| 测试方式 | 直接 require `api/[...slug].js`，mock req/res 打真实 handler；settings 键统一用 `test.*` 前缀，用后即删 | 云端 handler 依赖 Turso，本地 express+APP_DATA_DIR 那套测的是本地路由（本地本来就有此功能，测了是空转——坑#18）；test.* 前缀不触碰生产键 |
