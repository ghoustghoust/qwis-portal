# 坑 · AI 管线（ai）

### #8 日报出库安检
- 症状：乱码标题/风控错误页混进早报。
- 规则：入库前 hasMojibake（西里尔字符/锟斤拷检测）+ isErrorPageItem（"参数错误/访问频繁"类短标题）双检，daily.js 与 collect-turso.js 两处实现都要有。

### #24 settings 覆盖 env 的配置链，"环境异常"先查 settings 残留（2026-09-11 误诊订正）
- 症状：Agnes key 云端 401，曾误诊为"key 绑 IP"。
- 真根因：Turso `settings.ai` 残留 `{apiBase: deepseek 域名, key: 空}`，settings 优先级高于 env → 拿 Agnes key 打 DeepSeek 域名。
- 叠加：agnes-2.5-flash 是**推理模型**，max_tokens 太小被 reasoning 烧光返回空 content（已改 64/512 + reasoning_content 兜底）。
- 规则：①改 env 永远修不好 settings 覆盖的问题，先 `SELECT value FROM settings WHERE key='ai'`；②Vercel env 与文档要实测核对，不能信纸面；③推理模型 max_tokens 给足。

### #26 推理模型输出必须三层清洗，验收必含真实输出复测（2026-09-13）
- 症状：三个独立场景（翻译/每日导语/我的早报导语）先后把思维链当产物入库。实测形态：①中文指令复述（"用户提供了一篇…要求我从四个维度…"）②英文 "Here's a thinking process: 1. **Analyze User Input:**" ③第一人称元思考（"我想到一个更好的方式来组织这个叙事"）。
- 规则：**标记提取（译文：/最终稿：）→ 思维链/元任务拒绝（回退上一轮草稿或 null）→ 机器兜底（翻译降级 Bing/Google）**；导语类全污染返回 null 不渲染，绝不回退污染行；正则打补丁是打地鼠，验收必须包含真实模型输出的线上复测。
- 实现：api/_ai.js `sanitizeTranslationReply` / `isThinkingLikeReply` / `generateTheme`（回归：regression-20260913 F3 系列、regression-daily-ai 3b）。

### #A1 Agnes 免费池配额规律（2026-09-13 实测）
- 持续 ~15 RPM 调用 45-60 分钟即耗尽（HTTP 429/60s 超时），约 50 分钟自愈；期间 `_consecFail>=3` 触发 ai_failed 报警（属预期）。
- 规则：大批量 AI 任务（daily-ai/weekly/eval-filter）串行排期、避开叠加；生成窗口 > 翻译（T4 调度优先级需求）；eval-filter 之类验证选配额空闲窗跑。
