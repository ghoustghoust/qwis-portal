# 云端报警引擎（15-cloud-alerts）Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `api/_alerts.js` | Turso 版报警引擎（渠道/冷却/静默/脱敏/日志/分类器） |
| 修改 | `api/[...slug].js` | 3 个配置端点 + 路由注册 |
| 修改 | `tools/collect-turso.js` | 4 个检测点挂接（collect 尾部/daily catch/translate 失败/cleanup 汇总） |
| 修改 | `server/services/alerts.js` | sourceError 文案接错误分类器（F4 双端同步） |
| 新建 | `tools/sync-alerts-config.js` | 本地 settings.alerts → Turso 一次性迁移 |
| 新建 | `tests/regression-cloud-alerts.test.js` | 回归测试 |
| 修改 | docs（HANDOVER/FEATURE_MATRIX/changes/ISSUES） | 文档同步 |

## T1: api/_alerts.js

**文件：** `api/_alerts.js`（新建）
**依赖：** 无
**步骤：**
1. 移植 SENDERS 七渠道（钉钉/企微/飞书加签 HMAC、Server酱、Bark、TG、webhook），fetch + AbortSignal 8s 超时
2. getConfig/saveConfig（Turso settings.alerts）；DEFAULT_EVENTS 增补 ai_failed、frozen_digest
3. 冷却：loadCooldowns/inCooldown/markCooldown 直读写 settings `alerts.cooldowns`（≤200 条滚动）
4. 静默规则 + maskChannels/mergeChannelSecrets + recentLog ≤50
5. `classifyError(errMsg, sourceType)` → {category, advice}（按 plan 的 6 类规则）
6. `dispatch(event, {sourceId, sourceType, title, text})` 全流程（开关→静默→渠道→冷却→发送→日志）；无 audit 依赖（_alerts 自含，避免与 [...slug].js 循环引用——audit 写库在此文件内联实现）
7. 便捷入口：`sourceAlert(source, failCount, errMsg)`（≥3 paused / ≥2 error，文案带分类+建议）、`dailyFailed(err)`、`collectStalled(detail)`、`aiFailed(detail)`、`frozenDigest()`（查 fail_count>=3 AND enabled=0 的源，有才发）
8. `testAll()`：向启用渠道发「全网情报云端报警测试」

**验证：** `node --check api/_alerts.js`

## T2: 云端配置端点

**文件：** `api/[...slug].js`
**依赖：** T1
**步骤：**
1. `handleAlertsConfigPut`：body.alerts 整体写，channels 过 _alerts.mergeChannelSecrets；auditRecord('alerts.config')
2. `handleAlertsTest`：_alerts.testAll() 返回逐渠道结果
3. `handleAlertsClearCooldowns`：setSetting('alerts.cooldowns', {}) + auditRecord
4. 路由注册（PUT config / POST test / POST clear-cooldowns）

**验证：** T7 用例 1-3

## T3: runner 检测点挂接

**文件：** `tools/collect-turso.js`
**依赖：** T1
**步骤：**
1. 顶部 `const alerts = require('../api/_alerts')`——注意 api/_alerts.js 在 runner 环境可用（同 repo）
2. collectOne 失败分支：收集 {source, failCount（重查）, err} 到 runFailures[]
3. runCollect 尾部 `postRunAlerts(stats, runFailures)`：
   - 逐失败源 → alerts.sourceAlert(source, failCount, err.message)（分类文案）
   - collect_stalled 检测：`SELECT COUNT(*) FROM sources WHERE last_fetched_at > datetime('now','-1 hour') AND enabled=1` = 0 且本轮 total>0 全败 → alerts.collectStalled
   - 整体 try/catch 隔离，打印 `[alerts] ...` 日志
4. runDaily 外层 catch → alerts.dailyFailed(err.message)（不阻断退出码？失败本来 exit 1——先发报警再 exit）
5. translate 模式统计 failed>0 → alerts.aiFailed
6. runCleanup 尾部 → alerts.frozenDigest()

**验证：** 本地 `node tools/collect-turso.js collect`（少量源）日志可见 alerts 输出；T7 用例 4-5

## T4: 本地文案同步

**文件：** `server/services/alerts.js`
**依赖：** T1（分类器语义复制，本地不 import 云端文件）
**步骤：**
1. 本地新增同名 `classifyError`（复制分类规则，注释注明与 api/_alerts.js 同步义务）
2. sourceError 文案改为含「原因分类 + 处置建议」

**验证：** `npm test` 相关用例通过（本地有 alerts 测试的话）

## T5: 一次性迁移脚本

**文件：** `tools/sync-alerts-config.js`
**依赖：** 无
**步骤：**
1. 读本地 data/app.db settings.alerts（better-sqlite3 readonly）
2. Turso 已有 alerts.channels 且非空 → 跳过（除非 --force）
3. 写入 Turso settings.alerts + 打印渠道数（脱敏）

**验证：** 运行后 Turso settings.alerts.channels 与本地一致

## T6: 回归测试

**文件：** `tests/regression-cloud-alerts.test.js`
**依赖：** T1-T5
**步骤：**
1. 用例：① PUT config 写渠道（掩码合并：写掩码不覆盖真密钥）② GET config 密钥为掩码 ③ testAll 无渠道时返回 no-channels ④ 冷却：同 event+source 第二次 dispatch 被抑制 ⑤ classifyError 分类正确（youtube+404→反爬封锁等 4 例）⑥ frozen_digest 有/无熔断源两分支 ⑦ dispatch 失败不抛（渠道不可达时 sent=0 不 throw）
2. 测试渠道用 webhook 指向不可达地址（验证失败隔离 N3）

**验证：** `node --test tests/regression-cloud-alerts.test.js` 全绿

## T7: 文档同步 + 线上验收

**步骤：**
1. HANDOVER §3.4 补 3 端点；FEATURE_MATRIX P0-3 标完成；changes 记录；ISSUES 相关条目更新
2. push → READY → 线上实测：配渠道（用测试 webhook）→ test 发送 → AC1-AC7
3. 提醒用户：真实渠道配置走管理台「报警管理」Tab

## 执行顺序

```
T1 → T2 → T3 → T4 → T5 → T6 → T7
```
