# `web/src/` — 前端源码

两个入口对应两套页面，**新增组件必须被某个入口的懒加载清单登记**，否则线上表现为"点了白屏"（B13 那类事故）。

## 内容

| 内容 | 说明 |
|---|---|
| `main.jsx` | 主站入口，被 `../index.html` 引 |
| `admin.jsx` | 后台入口，被 `../admin.html` 引；**后台各 Tab 的懒加载组件清单在这里** |
| `pages/` | 页面级组件（阅读器 / 每日情报 / 热点榜 / 后台） |
| `components/` | 45 项业务组件，含 `ui/` 基础件（7 项）；见其 `README.md` |
| `hooks/` | 目前只有 `useRealtime.js`（SSE / 轮询） |
| `api.js` | REST 客户端封装，含 401 统一处理（P1-12 修过） |
| `auth.js` | 登录态与 token |
| `i18n.jsx` | 国际化。**"界面显示裸 key 而不是文案"是已知缺陷形态**（84b503f 修过一次后台裸 key），端到端引擎现在会盯这个 |
| `theme.jsx` | 三主题切换 |
| `index.css` | 全局样式与 CSS 变量 |
| `store.jsx` | 全局状态 |
| `sanitize.js` | 富文本清洗（XSS 面，阅读器渲染不可绕过它） |
| `toast.jsx` | 通知 |
| `useSettings.js` | 设置读写钩子 |
| `beijing-date.mjs` | 前端「北京日界」唯一实现，是 `lib/time-window.js` 的**对端**（不变量 17 / B90：服务端与前端各算一套日界，日期筛选就会差 8 小时）。被回归锁引用，改口径必须两端同改 |
| `util.js` | 杂项工具 |
| `snapshot.js` | ★ **零装载**：Turso 迁移期的静态快照生成器，现在只有 `docs/deprecated/VERCEL_MIGRATION.md` 提到它（spec 42 AU-04）。现役链路不经过它 |

## 已知零引用组件（需产品判定）

`components/DouyinTab.jsx`（503 行）：全仓库只有它自己的 `export default`，两个入口的懒加载清单里都没有它。要么后台本该有抖音管理入口而没接上（功能缺失），要么它该删（死代码）。判定挂 spec 42 AU-03——**注意后台正在被另一个 Agent 重构，复验时以最新树为准**。

**不放什么**：跨端业务规则（进 `lib/`）；直连数据库的代码；把只服务一个页面的组件塞进 `components/` 根（该就近放页面目录）。

**状态**：active
