# 全网情报系统 · 已知问题清单（活文档）

> 只列**当前活跃**的问题。已修复问题的完整历史在 `docs/changes/archive/`（变更记录）与
> `docs/deprecated/ISSUES-resolved-2026-09-13.md`（旧清单存档），本文件不再保留已核销条目。
> 功能需求类事项不在本文件，见 `docs/NEXT-DEV-REQS.md`（T3 系列）。
> 最后更新：2026-09-13 晚（大清洗：11 项 P0 + 16 项 P1/P2 已核销条目全部拧出归档）

---

## 🔴 活跃 bug

> B1-B4 已于 2026-09-13 晚修复并云端实测（commit d8b0347/8860be4/fce6edb/4ec3e47），详见文末修复记录。


| # | 问题 | 根因（已定性） | 修复方案 | 预估 |
|---|------|------|------|------|
| B1 | **每日早报"今日主题"显示 `2。`**（/daily/，2026-09-13 14:03 生成） | 当轮 generateTheme 被推理模型污染（当时日志"主题: 2"）。代码侧已三层加固（形状校验+元文本一票否决+null 语义，commit `1019280`），但 daily_reports #84 的存量 stats.theme 仍是脏值 | 一条 UPDATE 清空 #84 的 theme（与 mybrief 同处理）；今晚 00:32 定时管线会以干净代码重新生成 | 5 分钟 |
| B2 | **每日早报统计卡「候选内容 / 公众号文章 / 视频」显示 —** | daily-ai 管线写 stats 只含 `filterStats/sections/totalItems`，缺前端 StatCards 契约的 `candidates/articles/videos` 三键（老关键词管线也只写了前两个） | runDailyAi 组装 stats 时补齐三键（候选数已有 filterStats.candidates；公众号/视频数在候选查询时按 type 分计），连带给老管线补 videos | 30 分钟 |
| B3 | **页面切换严重卡顿**（阅读器/我的阅读/热点榜，每次加载几秒+） | 实测（2026-09-13 16:xx，代理链路）：`/api/reading?tab=all` **11.2s**、`/api/status` **6.1s**、`/api/hot?tab=all` 2.5s、`/api/articles` 1.8s。reading 的 UNION ALL 全表聚合 + status 的 overview 多组 COUNT 在 4.3 万行上反复扫描 | 见 `docs/NEXT-DEV-REQS.md` T3-3（查询优化+表达式索引+轻量缓存，目标 P95<2s） | 半天 |
| B4 | **阅读器"近7天入早报·来源榜"永远「本期暂无」** | 原 P3-5：handleStatus 不返回 `dailyItemCount/dailyTopSources`，OverviewRail 无数据可渲染（用户期望：头像+xx源+入榜次数） | 见 `docs/NEXT-DEV-REQS.md` T3-4（从 daily_reports 最近 7 天 sections 聚合来源计数） | 1-2 小时 |

## 🟡 挂案（外部依赖/低优先，保持跟踪）

| # | 问题 | 状态 |
|---|------|------|
| H1 | YouTube 反爬假 404 → 55 源熔断（阈值 10 已放宽） | 挂案：彻底解需住宅代理 RSSHub；熔断源每周由 cleanup 批次汇总提醒 |
| H2 | P2-1 日报引擎双份实现（api/daily-generate.js vs [...slug].js 内联） | 挂案：getOrGenerate 仅兜底用，主链路在 runner；T3-1 早报 v3 重构时一并收敛 |
| H3 | P2-4 AUTH_SECRET 回退 'dev-secret' / P2-5 /api/img 无 SSRF 防护 / P2-6 LIKE '%%' 慢查询 / P2-7 handleDaily UTC 日期比较 | 低危挂案（Vercel 网络隔离+量级小），随 T3-3 性能项顺手处理 |
| H4 | P1-9 "实时流"Tab 缺失 | 待设计（与 T3-1 主题全景可能合并形态） |
| H5 | xgo.ing 桥接的 219 个 X 推主源可用性未知 | 已导入（2026-09-13），观察 48h 抓取成功率；失败率过高则换 RSSHub 路由 |
| H6 | B站采集"更好的方案"调研（Cookie 主链 vs 现匿名降级） | 用户提出，见 NEXT-DEV-REQS T3-6 |

---

## 已核销条目去向

- **2026-09-09 ~ 09-12 的 P0-1~P0-11、P1-1~P1-16、P2-2/P2-8/P2-9/P2-10、P3 系列**：全部修复并云端实测，完整清单与修复记录见 `docs/deprecated/ISSUES-resolved-2026-09-13.md`。
- 专项分析（源自动刷新/调度冲突/双端差异矩阵）已随方案A落地失效，一并存档于上述文件。

---

## 修复记录（2026-09-13 晚，阻塞清单第 0/1/2 批）

| # | 修复 | 实测证据 |
|---|---|---|
| B1 | daily_reports #84 主题"2。"清空（json_set theme=null）；管线侧三层加固已在前批 | /api/daily theme=null ✅ |
| B2 | runDailyAi stats 补 candidates/articles/videos（videos=窗口内 videos 表新增） | 下一轮 00:32 生成后统计卡齐全 |
| B3 | 读层性能：status=overview 正连接（104ms）+四组合一；reading=两段式快路径（表达式覆盖索引+窄查询 221ms+按 id 取 31 行 120ms）；hot 时间窗参数化；补 8 个索引（Turso/server/db.js/runner 三处同步） | 线上热态：status 0.77s（原 6.1s/15s）、reading 1.5-2.8s（原 11-14s）、hot 1.0-2.3s、articles 1.1-2.5s；冷启动首轮仍 15-27s（Vercel 冷启动，另一议题） |
| B4 | handleStatus overview 补 dailyItemCount/dailyTopSources（近 7 天 daily_reports sections JS 聚合+头像回查） | 浏览器实测右栏渲染头像+来源+次数 ✅ |
| Q1 | IconRail EN 按钮移除 | 浏览器实测 ✅ |
| Q2 | GET /api/opml/export（公开 GET，标准 OPML 2.0 按分组嵌套）+ 源库导出按钮 | curl 200 + 结构正确 ✅ |
| Q3 | 库体积显示 sizeNote（Turso 云库口径说明） | 部署即生效 |
| Q4 | runner cleanup 默认 7 天保留清理（豁免已读/稍后读/精选；视频播客永不清）+ 云端 /api/data/cleanup 同语义 | 明晨 04:13 首跑观察 |
| Q5/Q6 | 源库：新建文件夹按钮、行内删除源（级联确认）、☆表头补语义 | 部署即生效（浏览器可验） |
| Q7 | 熔断源自动恢复：冻结 48h 自动重启（resumeCount，3 次后冷却 7 天），freeze 落 frozenAt | 明晨 04:13 首跑观察（92 个 YouTube 冻结源将被自动重试） |
| 顺手 | classify.buildOpmlCategoryMap 只读 bestblogs_*.opml（扁平 opml 污染分类映射，测试实锤修复） | tests 259 全绿 |
