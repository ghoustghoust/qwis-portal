# AI 基础设施（16-ai-infra）Checklist

## 实现完整性

- [ ] 统一通道限流（验证：并发 5 次调用，日志/统计显示间隔 ≥4s 串行执行）
- [ ] 429/5xx 退避重试（验证：桩测试观察重试间隔 1s→2s→4s）
- [ ] 降级链（验证：Agnes 打桩失败后译文来自 Bing/Google 桩，stats 有记录）
- [ ] 术语库（验证：glossary 写入 LLM→大语言模型 后，翻译 prompt 中包含该对照；growGlossary 后 occurrenceCount 累计、locked 不被覆盖）
- [ ] 初筛器（验证：营销软文桩 <30 且 ignore=true；深度技术文桩 ≥60）
- [ ] prompt 加载优先级（验证：settings 覆盖 > repo 文件）
- [ ] ai.stats 统计（验证：调用后 24h 计数/失败数/均耗可查）

## 集成

- [ ] 云端 ai/ping 与 ai/chat 走新通道后仍正常（验证：线上实测返回 ok）
- [ ] runner translate 走新通道（验证：GH Actions 日志可见降级链/术语沉淀输出，译文正常入库）
- [ ] 连续 AI 失败 → 收到 ai_failed 报警（15 项联动）

## 编译与测试

- [ ] `node --check` 三个改动文件通过
- [ ] `node --test tests/regression-ai-infra.test.js` 全绿（8 用例）
- [ ] `npm test` 无新增失败
- [ ] `npm run build:vercel` 无错

## 端到端场景

- [ ] 场景 1：新增一篇英文文章入库 → 下一轮 runner 自动精翻（含术语对照）→ 阅读器可见中文译文
- [ ] 场景 2：术语「Agent→智能体」固化进库 → 后续译文统一用「智能体」
- [ ] 场景 3：Agnes 故障期间翻译自动降级 Bing/Google，恢复后自动回切
