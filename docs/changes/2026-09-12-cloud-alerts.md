# 变更记录：云端报警引擎（15-cloud-alerts）

> 日期：2026-09-12 ｜ 类型：功能移植 + 质量修复（P0-3）｜ 流程：mew-spec 四件套

## 改了什么

| 件 | 说明 |
|---|---|
| `api/_alerts.js`（新建） | Turso 版报警引擎：7 渠道（钉钉/企微/飞书加签/Server酱/Bark/TG/webhook）+ 冷却（settings 持久化）+ 静默规则 + 掩码脱敏/合并 + recentLog |
| `api/[...slug].js` | 新增 `PUT /api/alerts/config`（掩码合并）、`POST /api/alerts/test`、`POST /api/alerts/clear-cooldowns` |
| `tools/collect-turso.js` | 4 检测点：collect 尾部（源失败/熔断/停滞）、daily catch（daily_failed）、translate 失败批（ai_failed）、cleanup 尾部（frozen_digest 熔断待办汇总） |
| `server/services/alerts.js` | 本地 sourceError 文案接入错误分类器（F4 双端同步） |
| `tools/sync-alerts-config.js` | 本地 alerts 配置 → Turso 一次性迁移（已执行：飞书渠道已在云端） |

## 报警质量三修（用户 09-11 亲历问题）

1. **误报**：错误分类器区分「反爬封锁（可自愈，YouTube 假 404/500）/ 地址失效 / 超时 / DNS / 源站故障」——反爬类提示"下轮自动重试，一般无需处理"
2. **不沉默**：frozen_digest 每日 04:13（清理批次）汇总当前熔断待处理源清单
3. **可诊断**：每条报警含 原因分类 + 原始错误 + 处置建议 + 恢复入口

## 验收证据

- 回归测试 8/8 绿（冷却抑制/静默/掩码合并/失败隔离/分类器）
- 迁移脚本实测：飞书渠道已在 Turso
- 线上实测（见下）