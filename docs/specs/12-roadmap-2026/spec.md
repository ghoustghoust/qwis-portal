# 总体开发 Spec — 2026-09 路线（P0~Pn 阻塞级排序）

> 母文档：`docs/ROADMAP-2026-09.md`（已确认）。本文是总体拆解，每项后续用 mew-spec 出细分 spec。
> 排序原则：阻塞关系优先（没设置写/源写，管理台就是摆设；没 AI 基础设施，翻译和日报都谈不上）。

---

## P0 阻塞级（管理台复活 + 报警止血）

### P0-1 设置写 API 上云 —— ✅ 已完成（2026-09-11，commit 2b66b76+fcfa03f）
- 端点：`PUT /api/settings`、`GET/PUT /api/settings/daily` 已上线并实测
- 四件套：docs/specs/13-settings-write/（spec/plan/task/checklist）
- 关键决策落档：云端 AI 配置锁定 env-only（settings.ai 污染事故）；黑名单键拦截；先校验后写入

### P0-2 源写 API 上云
- 端点：`POST /api/sources`（新增）、`DELETE /:id`、`POST /:id/refresh`、`POST /refresh-all`、`POST /batch`、`POST /autoclassify`、`/api/groups` 写 + `/move`
- 效果：云端源库从只读变可管理；新源 ≤15min 入流（next_fetch_at=NULL 交 runner）
- 依赖：无。注意 autoclassify 依赖 classify.js 分类目录逻辑移植

### P0-3 云端报警引擎 v1 + 报警质量修复 —— ✅ 已完成（2026-09-12，15-cloud-alerts）
- 内容：runner 每轮采集尾部跑停滞/异常检测 → webhook 渠道（钉钉/Bark 等，配置存 Turso settings.alerts）；熔断事件从"自动暂停即沉默"改为"熔断汇总待办提醒"；报警文案带原因判断（反爬/真死/配置错）
- 同步修本地：本地 alerts 对 YouTube 反爬假 404 误报（阈值与云端对齐 + 原因分类）
- 依赖：无。效果：停采 30min 内收到报警，不再靠人肉发现

## P1 AI 体系（~~解锁前置：DEEPSEEK_API_KEY~~ → 已解决，Agnes 云端可用 2026-09-11）

### P1-1 AI 供应商接入（已完成）
- Agnes 已修复云端可用：根因是 settings.ai 的 apiBase 污染（非 IP 绑定），已重置 + 三处 key 同步
- Agnes 官方约束写入架构：免费池文本实测 20 RPM、推理模型（reasoning 烧 max_tokens）、无思考模式 → 所有调用串行限流 + 给足 max_tokens
- 供应商链：Agnes（免费主力）→ DeepSeek（可选兜底，用户给 key 才启用）

### P1-2 AI 基础设施
- 串行限流调用队列（Agnes 免费池实测 20 RPM）+ 调用失败报警 + 结果缓存表（translations 缓存，只译增量）
- **两阶段过滤**（抄 BestBlogs Issue #564）：初筛只传标题+元信息+200 字符摘要 → 0-100 分 ≥30 才进深析——20 RPM 用出 200 RPM 的关键
- 术语对照库双层：全局静态术语表（settings 维护）+ 每篇即时识别补充
- prompt 独立文件管理（server/services/ai/prompts/），可版本化可迭代

### P1-3 翻译链路上云
- `ai/translate/*` 端点 + runner 增量翻译 job（英文新文章自动精翻）
- **三段式流程**（抄 BestBlogs）：术语识别→初译→检查（四类问题找茬）→意译；先译分析结果 JSON，全文按需译
- **分级降级链**（用户 2026-09-11 明确）：Agnes → Bing 翻译 → Google 翻译，逐级兜底
- **前端控件**（用户 2026-09-11 明确）：每篇英文文章支持中英文切换对照 + 手动点击翻译

### P1-4 AI 日报 v2
- 窗口改自然日整（昨 00:00~今 00:00）；凌晨 00:30 runner 开始批处理，09:00 前呈现
- **管线蓝本**（抄 BestBlogs 六节点）：分段（Markdown 结构感知）→ 段落精要 → 汇总 → 标签 → 评分 → 反思改进（每处改动带 UpdateReason，只删重要性<3 的信息）
- 每篇产出：六维评分（**选题/内容/深度/实用/创新/表达**，内部用 BestBlogs 打分细则映射）、推荐理由、精选摘要、金句、关键观点
- 栏目保留现有四栏，AI 评分决定入选与排序；降级链：AI 失败 → 关键词版 → 原始列表

### P1-5 B站 wbi 采集移植 runner
- 纯 crypto 签名，无需浏览器；移植后 B站源云端自动更新

## P2 信息流个性化（防信息茧房）

### P2-1 源自选订阅模型
- settings 存订阅子集；前端源选择器；阅读器流按订阅过滤
- 注意与现有"分组"语义的关系（订阅≠分组）

### P2-2 推荐算法 v1（破茧双管）
- **可解释四件套**（抄 BestBlogs）：每条候选内联 candidateSource/selectionReason/personalized/fallbackApplied；articles 表加 `selection_reason`、`candidate_source` 字段
- **行为画像 + 漂移检测**：显式兴趣（订阅）+ 隐式兴趣（reading 表行为学习）+ driftDetected 漂移哨兵
- 破茧栏强化：每天强制曝光未订阅源的重要事件（复用六维评分）
- 主流探索位：按 ~10:1 比例混入未订阅源的高分内容
- 大事不漏：跨源聚类热度超过阈值的事件无视订阅过滤直送

### P2-3 主题早报（BestBlogs 3.0 形态）
- 自然语言定制多份简报（"每天给我 X 简报，只看英文一手源，过滤营销稿"）→ 系统转成 来源+关键词+实体+排除条件
- 天然多视角防茧房；是固定四栏日报的演进形态

### P2-4 管理后台 UX 整改专项（2026-09-12 用户提出，均为云端+本地同 bundle 同修）

| 页面 | 现状问题 | 目标 |
|---|---|---|
| 日报设置 | 崩溃已修；**可读性不强**（表单堆叠） | 分区卡片化：窗口/时间一组、来源勾选一组、栏目管理一组，每组有说明文字 |
| 监控板块 | 可读性不强 | 折线图趋势对比（采集成功率/入库量随时间）+ 分页 + 更直观的数据呈现 |
| 数据统计 | 只有表格数字 | 存储统计实时饼图（各表占比，随时变化） |
| 报警管理 | 不够直观 | 重设计：渠道状态卡 + 触发时间线 + 事件类型筛选 |

## P3 体验完善

- 热榜原文抓取 / AIHOT enrich 移植 runner
- 前台轻操作：「为什么推荐」标注、一键关注此源
- 后台 Tab 收敛重组（11 → 4-5 区）
- 管理后台 UX 整改已提升为独立专项，见下方 P2-4
- 视频详情/收藏上云（播放直链永留本地）
- **移植铁律**（用户明确）：凡本地→云端移植，先验证本地功能真实可用（甄别 UI 壳）

## 永不云端化（架构决策，勿再翻案）

抖音采集/扫码登录（Playwright 登录态）、文件型 .db 整库快照（501 + 配置备份替代）、SSE（轮询替代）。

---

## mew-spec 拆分清单（每个一份四件套 spec/plan/task/checklist）

按序进行，每个完成并云端实测后才开始下一个：
`13-settings-write` → `14-sources-write` → `15-cloud-alerts` → `16-ai-infra` → `17-translate` → `18-daily-ai-v2` → `19-bilibili-runner` → `20-subscription` → `21-recommender`
