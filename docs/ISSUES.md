# 全网情报系统 · 已知问题清单（活文档）

> 只列**当前活跃**的问题（未修复 / 观察中 / 挂案）。
> 已核销历史：`docs/deprecated/ISSUES-resolved-2026-09-14.md`（09-13~09-15 全量，含热点榜三阶段/媒体治理/精选断更根治）
> 与 `docs/deprecated/ISSUES-resolved-2026-09-13.md`（更早）。
> 功能需求类事项见 `docs/NEXT-DEV-REQS.md`。
> 最后更新：2026-09-18 晚（AI 守卫 + 构建中断修复 + 周刊杂志版还原 + 用户 6 条页面标注；活跃 B12~B19、挂案 H9~H13）

---

## 🔴 活跃 bug

| # | 问题 | 定性 | 去处 |
|---|------|------|------|
| B8 | 综述/文章详情无排版（加粗/重点标注丢失，纯文本渲染） | 前端渲染层（markdown 化） | T5-5 / spec 32 |
| B10 | 每日早报 AI 版仍显示关键词版栏目注解（"Codex、Claude、豆包…"） | AI 栏目 desc 未随 v2 更新 | T5-3 一并 |
| B11 | 后台 Tab 切换懒加载 chunk 冷启动卡顿（前台已做骨架屏，后台未覆盖） | 感知性能 | spec 33 |
| B12 | `npm test` 基线 4 项红：regression-bc 的 A9/A10/B15/B18 断言 `portal/api/_safeimg.js`、`portal/api/_handlers.js` 等——这些文件已在 portal 自身提交 `2e81cd7`（Vercel serverless 重构）中删除，测试未跟着重新锚定。**违反 AGENTS.md §3「必须全绿」，且 B18 一红就没人再盯云端 /api/img 的 SSRF 防护**（该风险在 H3 里是已知挂案） | 测试锚点失效（非产品缺陷） | 待立小 spec：把 B18 重新指向 `api/[...slug].js` 真实云端读路径 |
| B13 | 生产构建自 09-17 16:38 起连续 4 次 Error：`8284f70`/`3288371` 已提交但 `web/src/components/ui/MdText.jsx` 从未入库 → rollup `Could not resolve` → **线上一直跑 09-17 之前的旧 bundle**，周刊兜底与我的早报 AI 渲染「修了但没上线」 | 已修（d7b5df4 补提交），部署已 ● Ready | 本轮 |
| B14 | `tools/collect-turso.js` 调用**从未定义的 `qOne()`**（6 处：`:648 :655 :725 :970 :971 :1216`），每处 `ReferenceError` 被上层 `try/catch` 吞成一行 runner 日志。后果：`reading.digest` 从未生成（**阅读足迹卡自上线起就没存在过**）、`daily-ai stats.videos` 恒 0、collect「少量失败」分支下同一 try 内的 `collectStalled` 停滞检测被整体跳过 | 已修（补 `qOne` + 静态回归锁），待 runner 批次产出验证。详见坑 #33 | 本轮 |
| B15 | `articles.read_at` 疑似被批量写入：24h 内 `read_at >= 24h前` 命中 **24855 行**（占库存绝大多数），修复 B14 后「阅读足迹」会直出「过去 24 小时读了 24855 篇」这种荒谬数字 | 待查：定位是哪条链路在自动标已读（疑热榜/聚合源的 read 回写），digest 口径需按真实用户行为收敛 | 需单独确认 |
| B16 | 周刊导语污染第四次复现（坑 #26）：第 2 期 `theme` 入库为「我需要找到贯穿这些文章的核心主线。」并同步进 `weekly.archive` 标签；且 `generateWeeklyMagazine` 五条 `return null` 全不出声 → coverTheme/storylines 整体为空无从判断 | 清洗器已修（句首第一人称一票否决 + 反向保护用例）+ 放弃原因已打日志；**脏数据需重跑一期周刊覆盖** | 本轮 |
| B17 | 周刊初筛预算结构性不足：本轮 2015 条候选 × `ai.minIntervalMs=4000` 串行 ≈ 2.2 小时，而 `runWeekly` 的初筛窗只有 `BUDGET_MS*0.4`=24 分钟 → 日志必出现「初筛预算截断」，周刊实际只策展了 `published_at DESC` 前缀，**不是全周内容** | 待决策：提高初筛配额 / 改为批量初筛 / 预筛降量（六维分门槛） | 需拍板 |
| B18 | 视频/播客条目的「置信度评分」与「标题翻译」无法呈现：`videos` 表实测**既无 `score` 也无 `translated_title` 列**（列清单：id,source_id,platform,title,url,vid,cover,duration,author,intro,published_at,favorite,created_at,watched_at,play_uri）。`enrichBriefTitles` 也因此结构性跳过视频（id 是 `'v'+id`，查 `articles` 永不命中） | 需决策：给 videos 建列并把视频接进翻译/深析管线（涉 schema + 三端采集语义同步 + AI 配额），或放弃这两个诉求 | 需拍板 |
| B19 | 我的早报「今日总结」线上常空：`generateTheme` 判污染后返回 null（宁缺毋滥，方向是对的），根因是 Agnes 推理模型间歇只吐 reasoning 不吐正文——与坑 #26 同源 | 已断掉"reasoning 冒充正文"（无正文即抛错）；额度/模型侧波动归 W6 继续观察 | 观察中 |
| B20 | 每日早报**完全没有分析后质量门槛**（用户标注「一两颗星是不是含金量不高」抓出）：深析契约无 `veto`，`runDailyAi` 只在初筛用 `ignore`，「重点更新」栏判据是 `source_spotlight`（看源不看分）→ 实测 `score=10`「出售 AI 工作站」reason 自陈"不适合收录至早报"仍坐最显眼大卡。另：本地灾备 `daily-ai.js analyzeBatch` 只返回 `{summary,importance,tags}` **无六维分**，与 runner 深析契约已分叉，门槛无法同口径同步 | 门槛已加（`passesDailyQualityGate`，默认 ≥30 与 `ai.filterThreshold` 同口径，可配 `ai.dailyMinScore`）；**待下一批 daily-ai 跑批生效**。长期需给模型 `veto` 出口 + 本地补六维分 | 本轮（待验证） |
| B21 | 每日早报缺「本期索引」（周刊页 T5-6 已有右侧条目索引可复用），且从别的页签切回 `/daily/` 有卡顿；期号方面 `daily_reports` 有自增 `id`（线上 `report.id=100`）但直接当"第 N 期"无意义（含非 AI 批次插入），仍应与我的早报一起走归档设计 | 索引/卡顿待查（卡顿需先定位是 chunk 冷加载还是 46 卡 + 封面重排）；期号并入 H13 一起定 | 待办 |

## 🟡 观察中（有明确验证时间点）

| # | 事项 | 观察点 |
|---|------|------|
| W1 | quickscore 即时补分 + 21:30 晚间主批（09-15 已补 AGNES_API_KEY，cd66f52） | 今晚 21:30 批次应产出六维评分；精选白天应持续有当日内容 |
| W2 | 主题全景综述 prompt 修复（09-14 修） | 今晚 21:30 批次综述不再出现"评语"元评论 |
| W3 | 日报/我的早报「视频与播客」栏（09-14 加） | 今晚批次起应出现媒体栏且可播放 |
| W4 | 翻译插队 60 篇热点英文文章（09-14 晚入队） | 事件榜/精选英文条目陆续转中文 |
| W5 | 翻译管线系统性修复（09-15：薄正文仅标题通道/清洗器补起手式/占位金句清洗/优先级=早报>我的早报>周刊>热点榜+id 直接补候选池；34+2 篇污染回炉重翻） | 今晚 21:30 主批+后续 translate 轮次：早报类条目中文标题无元评论/无胡编标题/金句无占位符 |
| W6 | 2026-09-18 早报/周刊 AI 守卫（`lib/brief-guards.js` 不变量 12 + 周刊 <4 条不发布 + mybrief 补刷 reading.digest + 报警覆盖面扩 daily-ai/weekly/mybrief + dispatch `inputs.mode` 补跑口） | 部署后：①`/api/daily` 应立刻回到 `schemaVersion:2`（带 theme/stats.themes/六维）；②dispatch mode=mybrief 后 `/api/mybrief` 应带 `digest` 键；③`/api/weekly` 若不足 4 条应保留上一期而非变空；④北京 09:03 的 `daily-report` 裸报不再能遮蔽 AI 版 |

## 🟢 挂案（外部依赖/低优先，保持跟踪）

| # | 问题 | 状态 |
|---|------|------|
| H1 | YouTube 对数据中心 IP 反爬假 404 → 熔断反复（139 源 41 启用；熔断源由 cleanup 批次自动恢复） | 挂案：彻底解需住宅代理；现状可接受 |
| H2 | 日报引擎双份实现（api/daily-generate.js 仅兜底 vs [...slug].js 内联） | 挂案：主链路在 runner，T3 系重构时收敛 |
| H3 | P2-4 AUTH_SECRET 回退 'dev-secret' / P2-5 /api/img 无 SSRF 防护 / P2-6 LIKE '%%' 慢查询 / P2-7 handleDaily UTC 日期比较 | 低危挂案（Vercel 网络隔离+量级小） |
| H6 | B站采集"更好的方案"调研（Cookie 主链 vs 现匿名降级） | 用户提出，待调研 |
| H7 | 云端 /api/articles 无 dedup=1 分支（本地有，pre-existing 漂移）：今日视图成默认落地路径后，双端「合并同事件」行为差异被放大 | 挂案：T5 剩余重构时收敛（2026-09-15 对抗审查记录） |
| H8 | spec30 C3「保存后前台关键数字实时预览」未做（对照卡为生效配置静态摘要，验收②只要求对照卡）；subscription.ids 跨 serverless 实例 30s 缓存窗口（人工点击速度下不可达） | 挂案：后续小 spec（2026-09-15 对抗审查 P3） |
| H9 | **`.gitmodules` 缺失**：`portal` 在索引里是 gitlink（`160000`，pin `1f2f253`）但仓库无 `.gitmodules` → clone 后 portal 为空目录、`git submodule update` 无法解析；Vercel 构建日志已报 `Warning: Failed to fetch one or more git submodules`。另 portal 是**另一个独立 Vercel 项目**（`prj_LTaPscWw…`，名 `portal`）长期落后根树，双站漂移 | 挂案：需决策「补 .gitmodules」还是「停掉 portal 部署/收编为普通目录」（2026-09-18 审查记录） |
| H10 | `settings.ai.features`（translate/summary/classify/analyze）是**假开关**：`AiSettingsTab` 有 4 个复选框 +「x/4 完成度」，`api/_ai.js` 与 `collect-turso.js` 零引用。线上回显 `classify:false/analyze:false` 会被误判成「AI 被关了」 | 挂案：要么接进生成链路，要么从 UI 摘除（2026-09-18 排查中踩到） |
| H11 | `weekly.archive` 每期内嵌完整 report、items 又在 `storylines[].items` 重复一份，`:878` 明确不截断；`handleWeekly` 每次请求全量解析后只投影 5 个字段，而 `[...slug]` 函数预算只有 30s | 挂案：慢性 504 面，需加投影/截断策略 |
| H12 | `settings['weekly']` 在后台可编辑（`/api/settings` merge + 周刊设置卡片），但 `runWeekly` 从不读它——窗口/条数全硬编码（`collect-turso.js:765-766`、`:844`） | 挂案：改了无效，需接配置或撤 UI |
| H13 | 我的早报**没有期号也没有归档**：`runMyBrief` 落库的 `mybrief.latest` 只有 `date/generatedAt/theme/keywords/sections/themes/degraded`，无 `issue`，且全库不存在 `mybrief.archive`（单键覆盖写，历史期直接丢失）。用户 2026-09-18 标注「我的早报也该有期号」。周刊有期号是因为 `saveWeekly` 从 `weekly.archive` 末位 +1 | 挂案：要期号必须先有归档（否则期号会随覆盖写重置）；属功能设计，需单独立项 |

## 已关闭挂案（本轮核销）

- ~~H4 实时流 Tab 缺失~~ → 已实现（热点榜「AI 信息实时流」，2026-09-14）
- ~~H5 xgo.ing 桥接 X 源可用性观察~~ → 观察期满：127 启用 X 源全部 status=ok（2026-09-15 实测），关闭
