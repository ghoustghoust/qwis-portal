# 云端报警引擎（15-cloud-alerts）Plan

## 架构概览

```
GH runner: tools/collect-turso.js
   ├─ collect 模式尾部 → detectAndAlert(stats, runResults)   ─┐
   ├─ daily 模式 catch → alerts.dailyFailed(err)              │  api/_alerts.js
   ├─ translate 失败批 → alerts.aiFailed(detail)              ├─ （Turso 版报警引擎：
   └─ cleanup 模式尾部 → frozenDigest()（熔断待办汇总）        │    渠道/冷却/静默/脱敏/日志）
                                                              │
Vercel: api/[...slug].js                                     │
   ├─ PUT  /api/alerts/config（掩码合并写）                    │
   ├─ POST /api/alerts/test                                   │
   └─ POST /api/alerts/clear-cooldowns                       ─┘
                        │
                        ▼
              Turso settings.alerts / alerts.cooldowns / audit_log
```

## 核心数据结构

### settings.alerts（与本地同构）
```json
{ "channels": [{"id","type","name","enabled","config":{...}}],
  "events": {"source_error":true, "source_paused":true, "daily_failed":true, "collect_stalled":true, "ai_failed":true, "frozen_digest":true},
  "cooldownMin": 120, "silence": [], "recentLog": [] }
```

### api/_alerts.js 接口
```
async dispatch(event, {sourceId?, sourceType?, title, text})  → {sent, skipped?, results}
async testAll()                          → 向全部启用渠道发测试消息
classifyError(errMsg, sourceType)        → {category, advice}  // 反爬/HTTP/超时/DNS/解析
sourceErrorText(source, failCount, err)  → 可诊断文案（F4）
frozenDigest()                           → 有熔断源才发汇总（F5）
```

### collect-turso.js 改动点
- collectOne 的失败分支记录到 runFailures[]（含源对象+错误）
- runCollect 尾部：`await postRunAlerts(stats, runFailures)`（try/catch 隔离，N3）
- runDaily 的 catch → `alerts.dailyFailed(err.message)`
- translate 模式统计失败 → `alerts.aiFailed(...)`
- runCleanup 尾部 → `alerts.frozenDigest()`

## 模块设计

### api/_alerts.js（新建，~300 行）
**职责**：Turso 版报警引擎，移植本地 alerts.js 全语义
**移植清单**：SENDERS 七渠道（含钉钉/飞书加签）、getConfig/saveConfig、冷却（loadCooldowns/inCooldown/markCooldown，settings 持久化——本地内存缓存在 serverless 无效，直接每次读 settings）、静默规则、maskChannels/mergeChannelSecrets、recentLog（≤50）、auditRecord 复用 [...slug].js 已有
**差异**：无 undici 代理直连兜底（runner/vercel 海外网络直连，不需要）

### 错误分类器（F4 核心）
```
classifyError(errMsg, sourceType):
  - sourceType='youtube' 且 HTTP 404/500 → {category:'反爬封锁', advice:'YouTube 对机房 IP 间歇封锁，下轮自动重试；连续 10 次才熔断，一般无需处理'}
  - /HTTP 403/ → {category:'访问被拒', advice:'检查源是否需要鉴权或已反爬；持续 24h 考虑换源'}
  - /HTTP 404/ → {category:'地址失效', advice:'feed 地址可能已变更，建议后台核对或换源'}
  - /timeout|aborted|ETIMEDOUT/ → {category:'超时', advice:'源站响应慢或网络抖动，下轮自动重试'}
  - /ENOTFOUND|EAI_AGAIN/ → {category:'DNS 解析失败', advice:'域名不可达，检查地址拼写或源站状态'}
  - 其它 → {category:'未知错误', advice:'到管理台源库查看 lastError 详情'}
```

### 云端配置端点（[...slug].js）
- `PUT /api/alerts/config`：body.alerts 整体写，channels 过 mergeChannelSecrets（掩码/空值保留旧密钥）；auditRecord
- `POST /api/alerts/test`：_alerts.testAll() 返回每渠道结果
- `POST /api/alerts/clear-cooldowns`：setSetting('alerts.cooldowns', {})

### 一次性迁移（F6）
`tools/sync-alerts-config.js`：读本地 SQLite settings.alerts → 写 Turso（若 Turso 已有则跳过，除非 --force）

## 模块交互

```
runner 每15min 采集尾 → postRunAlerts → _alerts.dispatch → Turso 冷却判断 → 渠道 HTTP
管理后台 AlertsTab → Vercel 配置端点 → Turso settings.alerts（runner 下轮生效）
```

## 文件组织

```
api/_alerts.js                       — 新建：Turso 版报警引擎
api/[...slug].js                     — 3 个配置端点 + 路由
tools/collect-turso.js               — 4 个检测点挂接
tools/sync-alerts-config.js          — 新建：一次性迁移脚本
server/services/alerts.js            — sourceError 文案接分类器（F4 双端同步）
tests/regression-cloud-alerts.test.js — 新建
docs/ 同步（HANDOVER/FEATURE_MATRIX/changes/ISSUES 核销）
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 引擎位置 | runner 批次尾部，非 Vercel 函数 | 与采集同上下文；函数 10s 做不了多渠道路由重试 |
| 冷却持久化 | Turso settings（每次读写） | serverless 无内存态；settings 读有 5s 缓存需注意——冷却读写绕过缓存直连 |
| 本地文案 | 只改 sourceError 文案接分类器 | 最小侵入；本地渠道逻辑不动 |
| frozen_digest 挂点 | cleanup（每日 04:13） | 每日一次不扰民；与清理天然同批次 |
| ai_failed/frozen_digest 新事件 | DEFAULT_EVENTS 云端增补 | 本地不增（本地无对应触发点） |
