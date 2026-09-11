# 全网情报系统 · 模块功能状态

> 逐模块列出本地 Express 与 Vercel 的实际功能状态与限制。
> 最后更新：2026-09-11（方案A：采集主链路移入 GH Actions runner 直写 Turso）

---

## 状态说明

- ✅ 完整可用
- ⚠️ 部分可用（有差异/限制）
- ❌ 不可用
- 🔲 未实现

---

## 模块状态矩阵

| 模块 | 本地 Express | Vercel | 差异/限制 |
|------|-------------|--------|----------|
| **文章列表** | ✅ | ✅ | Vercel 已排除热榜/聚合源 |
| **视频列表** | ✅ | ✅ | — |
| **热点榜** | ✅ | ✅ | Vercel 仅最近 3 天 200 条 |
| **事件聚合** | ✅ | ✅ | 72h 窗口 Jaccard 聚类 |
| **日报查看** | ✅ | ✅ | Vercel getOrGenerate 自动生成 |
| **日报生成** | ✅ | ✅ | 主链路：GH runner 每天 09:03 生成；Vercel getOrGenerate 兜底；手动 regenerate 路由仍缺失 |
| **我的阅读** | ✅ | ✅ | 2026-09-09 已修复（P0-1） |
| **阅读批量操作** | ✅ | ✅ | 2026-09-09 已修复（P0-8） |
| **阅读导出** | ✅ | ✅ | 2026-09-09 已修复（P0-8） |
| **源库管理** | ✅ | ❌ | Vercel 无 /api/sources/library |
| **源批量操作** | ✅ | ❌ | Vercel 无 /api/sources/batch |
| **自动分类** | ✅ | ❌ | Vercel 无 /api/sources/autoclassify |
| **源管理 CRUD** | ✅ | ⚠️ | Vercel 有基础 CRUD，无高级功能 |
| **分组管理** | ✅ | ✅ | — |
| **设置读写** | ✅ | ⚠️ | Vercel settings 表结构可能漂移 |
| **报警管理** | ✅ | 🔲 | Vercel 无报警引擎 |
| **数据备份/恢复** | ✅ | 🔲 | Vercel 无整库备份 |
| **健康自检** | ✅ | ✅ | /api/meta 已加入公开白名单 |
| **采集触发** | ✅ | ✅ | 主链路：GH Actions runner 每 30min 直写 Turso；Vercel /api/collect 仅手动备份（Hobby 10s 限 2 源） |
| **抖音采集** | ✅ | ❌ | 需要 Playwright，仅本地 |
| **B站采集** | ✅ | ❌ | wbi 签名未移植到云端（纯 crypto 可移植 runner，待做） |
| **热榜采集** | ✅ | ✅ | ⚠️ 必须浏览器 UA（newsnow 对自定义 UA 403），2026-09-11 已修 |
| **RSS 采集** | ✅ | ✅ | runner 直采；YouTube/X 在 runner 海外直连无需代理 |
| **图片代理** | ✅ | ⚠️ | Vercel 无代码层 SSRF 防护 |
| **AI 设置** | ✅ | ✅ | Agencs AI 配置 + 功能开关，管理后台「AI 能力」Tab |
| **AI 翻译** | ✅ | ✅ | 2026-09-11 上云：runner 每轮采集后自动翻译英文文章（Agnes AI） |
| **AI 摘要** | ✅ | ✅ | /api/ai/chat（Vercel 函数调 Agnes，需登录） |
| **管理后台** | ✅ | ⚠️ | Vercel 有 httpOnly cookie 鉴权，但 401 前端 needLogin 检查不匹配（P1-12） |
| **静态快照** | ✅ | ✅ | 兜底 public/data/*.json |
| **鉴权 JWT** | ✅ | ✅ | 读者 GET 公开，写操作需 Bearer |

---

## 待补齐优先级（Vercel 端）

1. **P0**：我的阅读完整功能（items + batch + export）
2. **P0**：日报自动生成（getOrGenerate 逻辑）—— ✅ 已完成
3. **P1**：源库管理（library + batch + autoclassify）
4. **P1**：/api/meta 加入白名单 —— ✅ 已完成
5. **P2**：AI 设置模块 —— ✅ 已完成
6. **P3**：报警引擎（可选，本地已有）
