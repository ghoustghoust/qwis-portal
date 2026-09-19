# 37-1 · P0 止血：报警链路恢复 + 永不再被测试写坏 —— 小 Spec

> 总框架：`spec.md`（37）。要求正文：`docs/EVAL_GUIDE.md` §6（F2P）、`docs/DOC_GOVERNANCE.md`。状态：**待用户授权（写生产 + 会真的开始发消息）**。
> 关联现状：`tools/sync-alerts-config.js`（本地→云端同步，2026-09-12 起就在仓库里）、`tests/regression-cloud-alerts.test.js`（哨兵污染源）、`lib/alert-channels.js`（本轮新建的出口/送达判据）
> UI 呈现归 `docs/specs/38-admin-ia-refactor/38-g-monitor-alerts-console.md` 的 G1/G2，本文件不另立界面 spec。
> 最后更新：2026-09-19

## 现状（本轮实测，全部为读生产库/读代码所得，未做任何写）

| 事实 | 证据 |
|---|---|
| 生产库 `settings.alerts.channels` 只剩一个渠道 `test-ch`，回调 `http://127.0.0.1:1` | 直读 Turso（只读查询）；形状与 09-17 的诊断略有变化（当时是 `url:undefined`） |
| 近 7 天 **33 条报警事件全部未送达**，最后一条 `2026-09-17T08:34`，`results[].error:"fetch failed"` | `settings.alerts.recentLog` |
| **本地真值渠道完好**：`feishu-1788064687082-y28w`（飞书，enabled=true，`https://open.feishu.cn/…`） | 直读本地 SQLite `settings` |
| 污染源仍在：`tests/regression-cloud-alerts.test.js:117` 写 `silence:[{sourceId:777777,…}]`，`:120` 用 777777 触发 | grep 实测 |
| 此前门禁看不到这件事：`eval-preflight` 判据 `enabled && url.startsWith('http')` 把哨兵渠道算成「1 个可用渠道 ✓」 | 本轮 B67，已修并如实报红 |

结论：**真值在本地，缺的是"把真值推回云端"这一步**，而这一步既是生产写、又会立刻恢复向用户飞书推送——所以按用户「先不写生产，等评测就位」的决定挂在这里等授权。

## 目标

1. 恢复出口：本地真值 → 生产（一次性、可核对、可回滚）。
2. 让"测试写坏生产配置"这条路**物理断掉**，而不是靠人记得还原。
3. 恢复与否，门禁都必须如实显示（已具备：`lib/alert-channels.js` + preflight 两条判据 + 回归锁 B67-0/1/2/3）。

## 功能点

| # | 内容 | 判据 |
|---|---|---|
| T1 | 同步前快照 | `node tools/sync-alerts-config.js --force` 执行前必须先把云端现值落盘（带时间戳），并在输出里给出快照路径；无快照不许写 |
| T2 | 同步后**送达**验证 | 不是"配置写进去了"，而是 `POST /api/alerts/test` 后回读 `recentLog` 该条 `results[].ok === true`（dispatched ≠ delivered，`deliveryState` 判据） |
| T3 | 测试写路径守卫 | `PUT /api/settings/alerts`（及 runner/Vercel 等价写点）识别哨兵值即拒绝并告警：`sourceId:777777`、`test-` 前缀 id、`127.0.0.1`/`localhost` 回调、`url:undefined`。判据在 `lib/alert-channels.js`，不在调用方各写一份（坑 #37/#43） |
| T4 | 回归测试隔离 | `tests/regression-cloud-alerts.test.js` 改为：不直连生产；若必须走云端协议，则**快照→写入→还原→断言还原成功**，断言失败要让测试变红（坑 #13/#T2 的既有规则） |
| T5 | 恢复后的噪声控制 | 恢复瞬间会重新开始推送：执行前检查 `silence` 与 `cooldownMin`，并允许 `--muted-first`（先静默 10 分钟再放开），避免一次爆发几十条打到用户 |
| T6 | 回滚 | 一条命令把快照写回，并再次 `deliveryState` 确认状态与快照时点一致 |

## 边界

- **不改事件模型、不加新事件类型**（那是 37-2/37-3/37-4）。
- 不把报警渠道配置搬进 env（用户 2026-09-19 对 `settings.ai` 的裁决思路是"保留可写 + 审计 + 告警"，渠道配置同理：留在 settings，加守卫与审计）。
- 明文 webhook 地址（含 token）不许出现在快照文件名、日志、报告与 commit（掩码规则同 `lib/alert-channels.js`）。

## 验收标准

- AC1：恢复后 `npm run eval:preflight` 的两条报警判据（有真实出口 / 最近真的送达）**同时变绿**，且绿的原因是读到了 `ok:true` 的投递记录，不是判据变松。
- AC2：F2P 双证据——
  - 改前红：T3 守卫在不含改动的树上必须"允许哨兵写入"（证明守卫真的在拦）；T4 的还原断言在旧测试上必须红（旧测试没有断言还原）。
  - 改后绿：`npm run eval:f2p -- --auto-base --tests <本任务锁文件>` 出证并落 `docs/eval/f2p/`。
- AC3：故意把渠道再次写坏成 `test-ch` 形状（在隔离库），门禁必须红——这条是"门禁会不会又骗人"的常驻哨兵测试。
- AC4：用户端实际收到一条测试消息（截图为唯一合格证据，`docs/DELIVERY_VERIFICATION.md` 口径）。

## 需要用户拍板 / 授权

1. **是否现在就执行 T1~T2**（生产写 + 飞书会开始收到消息）。评测侧已就位：判据、锁、F2P 工具、门禁显示都齐了，剩下的只是这一步授权。
2. T5 选哪种：先静默再放开，还是直接放开。
3. 若要"永不再犯"更硬的形态：是否允许给云端 settings 写接口加**白名单键**限制（超出白名单一律 403）——这会改变现有后台写配置的灵活性，属行为变更。
