# 翻译链完整上云（17-translate）Checklist

## 实现完整性

- [ ] 手动入队端点（验证：线上 POST translate → `{queued:true, etaMin:20}`；重复 POST 不重复入队；已翻译文章返回 already）
- [ ] 队列消费（验证：runner 日志可见手动队列优先处理，成功后队列移除）
- [ ] 多轮管线（验证：长文日志含 refine/polish 轮次；短文仅轮 1+2）
- [ ] provider 标记（验证：详情接口返回 translation_provider；前端徽章正确显示 精翻/机翻）
- [ ] 词库一致性（验证：glossary 已有术语在译文中按库译出）

## 集成

- [ ] 前端手动翻译闭环（验证：线上打开一篇未译英文文章 → 点翻译 → ≤20min 后译文自动出现并切换）
- [ ] 中英切换对照不受影响（验证：已译文章切换按钮工作正常）
- [ ] 本地端不受影响（npm test 无新增失败）

## 编译与测试

- [ ] `node --check` 全部改动文件通过
- [ ] `node --test tests/regression-translate.test.js` 全绿
- [ ] `npm test` 无新增失败
- [ ] `npm run build:vercel` 无错

## 端到端场景

- [ ] 场景 1：新英文文章 → 自动精翻（含术语）→ 阅读器可见「AI 精翻」徽章
- [ ] 场景 2：手动点翻译 → 队列 → runner 拾取 → 译文出现
- [ ] 场景 3：Agnes 故障期 → 机翻降级产出 → 徽章显示「机翻」，恢复后新文章回切精翻
