# 事件聚合与报警

> `server/services/events.js` + `server/services/alerts.js`
> 最后更新：2026-09-05

## 设计目标

- **事件聚合**：近 72h 全域条目跨平台聚类，生成热点事件榜
- **纯函数依赖**：titleTokens/jaccard 从 `_tokens.js` 导入，不依赖 daily.js
- **多渠报警**：7 种渠道（钉钉/企微/飞书/Server酱/Bark/TG/自定义 webhook）
- **防骚扰**：120min 冷却 + 阈值升级（2 次 error → 3 次 paused）

## 事件聚合引擎（events.js）

### 核心参数

| 参数 | 值 | 说明 |
|------|-----|------|
| WINDOW_H | 72h | 聚合窗口 |
| HALF_LIFE_H | 24h | 热度半衰时间 |
| SIM_THRESHOLD | 0.4 | Jaccard 相似度阈值（比日报 0.5 略宽） |
| CACHE_MS | 5min | 缓存时间 |

### 热度公式

```
热度 = Σ 条目权重(1 + score/100万) × 24h 半衰时间衰减 × 1.5^(信源数-1)
```

### 事件状态标

| 状态 | 条件 |
|------|------|
| 新 | 首发 < 6h |
| 爆 | 信源 >= 5 且最新 < 3h |
| 发酵中 | 首发 > 12h 且最新 < 12h |
| 收尾 | 其它 |

### 聚类流程

```
collectItems()           // 查询 72h 内全域条目
  └── cluster()          // Jaccard >= 0.4 贪心聚类
      └── 每簇 → {title, sources[], items[], heat, firstAt, latestAt}
          └── statusOf() // 标注事件状态
```

## 报警引擎（alerts.js）

### 报警事件

| 事件 | 触发条件 | 升级 |
|------|---------|------|
| source_error | 源连续失败 >= 2 次 | — |
| source_paused | 源连续失败 >= 3 次（自动熔断） | — |
| collection_stalled | 采集停滞（健康自检发现） | — |
| system_error | 系统级异常 | — |

### 报警渠道

```js
// settings.alerts 配置
{
  channels: [
    { type: 'dingtalk', webhook: '...', secret: '...' },
    { type: 'wecom', webhook: '...' },
    { type: 'feishu', webhook: '...' },
    { type: 'serverchan', key: '...' },
    { type: 'bark', url: '...' },
    { type: 'telegram', botToken: '...', chatId: '...' },
    { type: 'webhook', url: '...' }
  ],
  cooldownMs: 120 * 60e3  // 120min 冷却
}
```

### 冷却机制

```
同事件 + 同源 → 120min 内不重复发送
冷却记录存储在内存 Map 中，每 10min 自动清理过期记录（7 天）
```

### 阈值升级

```
fail_count=1 → 不报警
fail_count=2 → source_error 报警
fail_count=3 → enabled=0 + source_paused 报警（升级）
```

## 接口契约

```js
// 事件聚合
const events = require('./events');
const result = events.getEvents();  // 返回热点事件列表（带缓存）

// 报警
const alerts = require('./alerts');
await alerts.sourceError(source, failCount, errMsg);
await alerts.sourcePaused(source, failCount);
await alerts.collectionStalled(stalledSources);
```

## 纯函数依赖（_tokens.js）

```js
// events.js 不再依赖 daily.js，改引纯函数模块
const { titleTokens, jaccard } = require('./ai/_tokens');
```

## 注意事项

1. **批量刷新静默**：refresh-all / opml 路径 `opts.silent=true`，逐源报警被跳过，由调用方结尾汇总
2. **代理失败直连重试**：报警发送走代理失败时，自动直连重试一次
3. **异步触发**：报警通过 setImmediate 异步触发，不阻塞调度主流程
4. **脱敏**：报警内容经 `log.mask()` 处理，Token/Cookie/API Key 不泄露
