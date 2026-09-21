# `web/` — 前端构建根

Vite + React SPA 的配置与双入口层。源码在 `src/`（结构见 `src/README.md`）。

## 内容

| 内容 | 说明 |
|---|---|
| `src/` | 前端源码 |
| `index.html` | 主站入口页（阅读器 / 每日情报 / 热点榜），引 `/src/main.jsx` |
| `admin.html` | 后台入口页，引 `/src/admin.jsx` |
| `vite.config.js` | **双入口由 `rollupOptions.input` 显式声明**（`main` / `admin`）。`outDir: dist`、`chunkSizeWarningLimit: 600`（5.1 起监控包体积） |
| `tailwind.config.js` | 三主题（Tailwind + CSS 变量）配色与断点 |
| `postcss.config.js` | 构建期装载，不参与运行时 require |

## 构建与生效机制（易踩）

- 本地开发：`npm run dev:web`（Vite dev server）。
- 生产：`npm run build`；**云端用 `npm run build:vercel`**——它额外把根目录 `static-data/` 拷进 `web/dist/data` 作为读层兜底快照。
- 改完前端页面没变化，先查 `web/dist` 的时间戳是否新于 `src`（历史坑：脚本静默跳过导致构建滞后）。

**不放什么**：后端逻辑；`dist/` 是产物不入库；页面里直连 Turso/SQLite 的代码——一律走 `/api/*`。

**状态**：active
