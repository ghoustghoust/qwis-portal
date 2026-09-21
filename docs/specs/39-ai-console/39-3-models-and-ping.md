# 39-3 · 提供商与模型：`/api/ai/models` + 轻量探活 —— 小 Spec

> 总框架：`spec.md`（39，G「真实控制点」）。状态：**待批准，未动工**。
> 最后更新：2026-09-19（复核轮）

## 现状（实测）

| 事实 | 证据 |
|---|---|
| 后台 AI 设置页只有三个输入：API Key / API Base URL / 模型；保存走 `PUT /api/ai/config` | `web/src/components/AiSettingsTab.jsx:119/130/139`，`:59` |
| **已有连通测试端点** `POST /api/ai/ping`，前端也调了 | `api/[...slug].js:1490`（实现）/ `:2846`（路由）/ `AiSettingsTab.jsx:72` |
| 但 ping **不返回耗时**（全仓 grep `elapsedMs` → 0 命中）→ 用户只知道"通了/没通"，不知道是 300ms 还是 25s | 本轮 grep |
| **没有模型清单端点**（grep `/api/ai/models` → 0 命中）→ 模型名靠手输，打错只能靠 ping 失败发现 | 本轮 grep |
| 写路径已有裁决（2026-09-19）：`PUT /api/ai/config` **保留可写**，但必须 ①审计（旧值指纹→新值指纹）②变更告警 ③写后轻量探活失败即回滚 | `docs/ISSUES.md` §已裁决；BL9 |
| 本地 `settings.ai` 实测**没有 `minIntervalMs`**（键只有 4 个），而 preflight 报 `ai.minIntervalMs=0` → 实际生效值来自 env/代码默认，后台看不见也改不了 | 只读两端 settings + `eval:preflight` 实跑 |

## 目标

1. 让用户在后台"选得出模型、看得见耗时、改得动限速"，而不是手输字符串赌一把。
2. 探活必须是**轻量的**：不占生成配额、不产生费用、不吃 30s 函数预算（本项目 Hobby 读层 30s 上限，见坑 #34）。

## 改动点（批准后才写）

| # | 内容 |
|---|---|
| T1 | `GET /api/ai/models`：**服务端持 key 代理**上游模型清单；按 `apiBase` 归一（OpenAI 兼容 / 其他），不支持则返回 `{supported:false}` 让前端回退手输；带超时与错误分类，**永不明文回显 key**（只前 4 后 4，沿用既有指纹规则） |
| T2 | provider 预设：内置几家常用 base + 各家控制台链接 + **"凭据三处同步"提示**（AGENTS §2.6 的最大血泪坑），点选后只填 base，不替用户猜 key |
| T3 | `/api/ai/ping` 升级为返回 `{ok, elapsedMs, httpStatus, errKind}`，并**降级为轻量探活**（HEAD/最小请求，不占生成配额）；失败要能区分 DNS / TLS / 401 / 超时 |
| T4 | `ai.minIntervalMs` 进后台（含下限保护：<1000 视为误配，三端同一实现读同一个构造函数——**这正是 BL8 的落点**） |

## 判据与验收

- AC1 断网/错 key/错 base 三种故障下，ping 返回的 `errKind` 互不相同且前端文案不写成"未知错误"（三类各一条锁）。
- AC2 `elapsedMs` 在页面上可见；e2e 剧本断言"页面显示的耗时 == 响应里的 `elapsedMs`"（DOM↔响应对账）。
- AC3 **不落明文**：`GET /api/settings`、`/api/ai/config` 的响应、审计记录、日志里都不得出现完整 key（回归锁：把已知 key 塞进三处输出，断言全部掩码）。
- AC4 T4 的下限保护必须**一份实现三端引用**；配白盒判据"出现第二处 `minIntervalMs` 阈值判断即红"。
- AC5 F2P 按 **B106** 构造规则：新建文件（如拟建的 `ai-providers.js`，落在 `lib/` 下）在基线里不存在时，判 `env` 不判"锁假了"。

## 边界

- 不做自动选模型/自动降级路由（那是产品策略，另案）。
- 不在 Vercel 侧做任何长耗时聚合（模型清单要缓存，失败即回退手输）。
- 不把 AI 配置改成 env-only（用户 2026-09-19 已裁决：保留可写 + 审计 + 告警）。
