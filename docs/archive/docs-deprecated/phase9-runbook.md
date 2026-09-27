# 九期:破茧计划 —— 热榜矩阵 + 事件热点榜 + 日报破茧栏(运维备忘)

> 2026-08-28 完成。目标:信息源多样性、跳出信息茧房。

## 新增能力

| 模块 | 位置 | 说明 |
|---|---|---|
| hotlist 适配器 | `server/services/collectors/hotlist/index.js` | 轮询 newsnow `/api/s?id={id}&latest`(JSON→articles);兼容 60s 每日新闻(`hotlist60s://60s`)。source.url 规范:`hotlist://{newsnow源id}`;score=热度值(万/亿已归一);category=领域 |
| 热榜源种子 | `tools/seed-hotlist.js` + 31 源 | 建领域分组(综合热搜/科技热榜/财经热榜/国际视野/文化生活)+ 批量插源(幂等);`--fetch` 触发首抓 |
| 公众号号库 | `tools/seed-mp-library.js` + `mp-library-seed.json` | 8 领域(种子 60 号)→ we-mp-rss 搜索/订阅(限速 3s)→ 情报系统 sync → 领域分组回写 |
| 事件聚合引擎 | `server/services/events.js` | 近 72h 全域条目 Jaccard(≥0.4) 跨源聚类;热度=Σ权重×24h 半衰衰减×1.5^(信源数-1);缓存 5min;状态标 新/爆/发酵中/收尾 |
| 事件榜 API | `server/routes/hot.js` | `GET /api/hot/events?domain=`、`GET /api/hot/events/:rank?domain=` |
| 热点榜前端 | HotPage 第三 Tab「热点榜」 | 领域筛选 + 排名/状态标/信源数/热度 + 事件详情时间线 |
| 日报破茧栏 | `daily.js` generate() 尾部 | 「茧房外」栏:与常读领域(AI/科技)交集最小的 Top5 事件;无事件自动跳过 |

## 关键配置与开关

- `hotlist.baseUrl`(settings 或 env `HOTLIST_BASE_URL`):newsnow 实例,默认公共 `https://newsnow.busiyi.world`;失效时可自建 newsnow(Nuxt3,Node 直跑)改这里即可
- `.env` 新增 `HTTP_PROXY`(原来只有 HTTPS_PROXY,http:// 源如 FT中文曾因此直连失败)
- we-mp-rss 侧:`gather.model=weread_mp`、`weread.auto_add_to_shelf=false`(不加书架防风控)、定时任务「公众号定时采集-全部源」cron `7 */2 * * *`
- 热榜源默认 30 分钟一轮(extra.intervalMin),60s 源 6 小时一轮

## 失效源记录(公共 newsnow 实例实测 500,已摘除)
- `kuaishou` 快手、`36kr-renqi` 36氪人气榜(36kr 全系在公共实例不可用;自建实例可再试)

## 已知边界
- 热榜条目是标题级(发现层),全文靠公众号/RSS 深读层
- newsnow 无微信公众号热文源(2026 年无开源通道);公众号热点由"号库覆盖 + 事件聚合"近似
- we-mp-rss 列表接口是 limit/offset 分页(不是 page/size)——sync 已修复,`collectors/wemp/bridge.js` 是无引用的旧代码,分页参数仍是错的,清理时可删

## 热榜内容填充(2026-08-28 补丁)
- 微博等平台 newsnow 不给 hover 概述(上游如此),适配器已加:无 hover 时兜底 content_html(标题+原文链接),并每轮对 5 条无概述条目做 Readability 原文补抓
- 存量空内容条目已一次性兜底修复(1131 条)

## GBK 页面乱码修复(2026-08-28 补丁 2)
- 根因:fetchText/undici 一律按 UTF-8 解码,联合早报(zaochenbao.com)是 GBK 页面 → 乱码
- 修复:rss 适配器新增 fetchHtmlSmart(content-type header → <meta charset> 嗅探,gbk/gb2312→gb18030,big5→big5),fetchFulltext 改走它
- 存量:tools/fix-mojibake.js(西里尔字母特征探测,全文库扫出 3 篇联合早报,已全部重抓修复)
- 注意:zaochenbao 直连被重置,需走代理(服务器 .env 的 HTTPS_PROXY 已配)
- we-mp-rss 托管:wempSupervisor 会剥离子进程的 PORT 变量(它的 config 是 ${PORT:-8001},继承主系统 PORT 会抢 3000 端口)
