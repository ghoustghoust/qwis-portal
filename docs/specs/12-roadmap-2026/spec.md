# 总体开发 Spec — 2026-09 路线（P0~Pn 阻塞级排序）

> 母文档：`docs/ROADMAP-2026-09.md`（已确认）。本文是总体拆解，每项后续用 mew-spec 出细分 spec。
> 排序原则：阻塞关系优先（没设置写/源写，管理台就是摆设；没 AI 基础设施，翻译和日报都谈不上）。

---

## P0 阻塞级（管理台复活 + 报警止血）

### P0-1 设置写 API 上云
- 端点：`PUT /api/settings`、`GET/PUT /api/settings/daily`
- 效果：保存视图、日报栏目、队列配置、保留天数等 4 个管理 Tab 复活
- 依赖：无。风险：settings 是共享键值表，注意并发覆盖（整对象读-改-写）

### P0-2 源写 API 上云
- 端点：`POST /api/sources`（新增）、`DELETE /:id`、`POST /:id/refresh`、`POST /refresh-all`、`POST /batch`、`POST /autoclassify`、`/api/groups` 写 + `/move`
- 效果：云端源库从只读变可管理；新源 ≤15min 入流（next_fetch_at=NULL 交 runner）
- 依赖：无。注意 autoclassify 依赖 classify.js 分类目录逻辑移植

### P0-3 云端报警引擎 v1 + 报警质量修复
- 内容：runner 每轮采集尾部跑停滞/异常检测 → webhook 渠道（钉钉/Bark 等，配置存 Turso settings.alerts）；熔断事件从"自动暂停即沉默"改为"熔断汇总待办提醒"；报警文案带原因判断（反爬/真死/配置错）
- 同步修本地：本地 alerts 对 YouTube 反爬假 404 误报（阈值与云端对齐 + 原因分类）
- 依赖：无。效果：停采 30min 内收到报警，不再靠人肉发现

## P1 AI 体系（解锁前置：DEEPSEEK_API_KEY）

### P1-1 AI 供应商接入
- DeepSeek key 入三处（.env/Vercel/GH Secrets）；Agnes 保留但标记其限制（无思考模式/无并发/限流）
- 供应商链：Agnes（免费优先）→ DeepSeek（兜底）

### P1-2 AI 基础设施
- 串行限流调用队列（Agnes 无并发）+ 调用失败报警 + 结果缓存表（translations 缓存，只译增量）
- 术语对照库（settings 存术语表，翻译前注入 prompt）

### P1-3 翻译链路上云
- `ai/translate/*` 端点 + runner 增量翻译 job（英文新文章自动精翻）
- 备用谷歌/Bing 翻译降级链

### P1-4 AI 日报 v2
- 窗口改自然日整（昨 00:00~今 00:00）；凌晨 00:30 runner 开始批处理，09:00 前呈现
- 每篇产出：六维评分（**选题/内容/深度/实用/创新/表达**）、推荐理由、精选摘要、金句、关键观点
- 栏目保留现有四栏，AI 评分决定入选与排序

### P1-5 B站 wbi 采集移植 runner
- 纯 crypto 签名，无需浏览器；移植后 B站源云端自动更新

## P2 信息流个性化（防信息茧房）

### P2-1 源自选订阅模型
- settings 存订阅子集；前端源选择器；阅读器流按订阅过滤
- 注意与现有"分组"语义的关系（订阅≠分组）

### P2-2 推荐算法 v1（破茧双管）
- 破茧栏强化：每天强制曝光未订阅源的重要事件（复用六维评分）
- 主流探索位：按 ~10:1 比例混入未订阅源的高分内容
- 大事不漏：跨源聚类热度超过阈值的事件无视订阅过滤直送

## P3 体验完善

- 热榜原文抓取 / AIHOT enrich 移植 runner
- 前台轻操作：「为什么推荐」标注、一键关注此源
- 后台 Tab 收敛重组（11 → 4-5 区）
- 视频详情/收藏上云（播放直链永留本地）

## 永不云端化（架构决策，勿再翻案）

抖音采集/扫码登录（Playwright 登录态）、文件型 .db 整库快照（501 + 配置备份替代）、SSE（轮询替代）。

---

## mew-spec 拆分清单（每个一份四件套 spec/plan/task/checklist）

按序进行，每个完成并云端实测后才开始下一个：
`13-settings-write` → `14-sources-write` → `15-cloud-alerts` → `16-ai-infra` → `17-translate` → `18-daily-ai-v2` → `19-bilibili-runner` → `20-subscription` → `21-recommender`
