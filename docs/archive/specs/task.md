# 全网情报系统复刻 Tasks

> 依据已批准的 spec.md + plan.md。按五期组织，共 60 个任务。
> 约定：`npm run dev` = 后端 nodemon + 前端 vite 构建watch；所有验证在 Windows PowerShell 执行。

## 文件清单

| 操作 | 文件 | 职责 | 期 |
|------|------|------|---|
| 新建 | `package.json` / `.gitignore` | 依赖与脚本（start/build/test/setup:customer） | 一 |
| 新建 | `config/customer-config.json` | F50 全部配置项模板 | 一 |
| 新建 | `server/db.js` | SQLite 连接 + 7 张表迁移 | 一 |
| 新建 | `server/util/{http,time,log}.js` | 重试/超时 fetch、相对时间、日志 | 一 |
| 新建 | `server/index.js` | Express 入口、静态托管、三页面路由 | 一 |
| 新建 | `server/routes/{settings,sources,groups,articles,videos,opml,status,backup}.js` | 一期 REST API | 一 |
| 新建 | `server/services/collectors/registry.js` | 适配器登记与 URL 识别 | 一 |
| 新建 | `server/services/collectors/rss/index.js` | 通用 RSS/Atom 适配器 | 一 |
| 新建 | `server/services/collectors/wechat/index.js` | OPML 同步 + 公众号文章抓取 | 一 |
| 新建 | `server/services/collectors/bilibili/index.js` | UP 主解析、视频抓取、直链 | 一 |
| 新建 | `server/services/scheduler/index.js` | 定时任务注册 | 一 |
| 新建 | `server/services/backup.js` | 备份/恢复 | 一 |
| 新建 | `web/` vite + tailwind 骨架、`src/{main.jsx,api.js,theme.jsx}` | 前端基础 | 一 |
| 新建 | `web/src/pages/ReaderPage.jsx` | 阅读器三栏双 Tab | 一 |
| 新建 | `web/src/components/{Sidebar,ArticleList,ArticleView,VideoGrid,VideoDetail,SourceTable,StatusCard}.jsx` | 一期组件 | 一 |
| 新建 | `web/src/pages/SettingsPage.jsx` + `components/{WechatTab,BilibiliTab}.jsx` | 设置页（两个 Tab） | 一 |
| 新建 | `tools/setup-customer.js` | 一键配置脚本 | 一 |
| 新建 | `server/services/ai/{deepseek,summary,daily}.js` | DeepSeek 客户端、速览、日报引擎 | 二 |
| 新建 | `server/routes/{ai,daily}.js` | AI/日报 API | 二 |
| 新建 | `web/src/pages/DailyPage.jsx` | 日报页 | 二 |
| 新建 | `web/src/components/{AiPanel,AiSettingsModal,DailyHeader,StatCards,ColumnSection,QuickStudyModal,DailySettingsModal}.jsx` | 二期组件 | 二 |
| 新建 | `cloud/_queue_lib.php` + 三个队列 PHP | 云端队列（F43） | 三 |
| 新建 | `server/services/queue/poller.js`、`server/routes/queue.js` | 队列轮询与 API | 三 |
| 新建 | `web/src/components/PendingList.jsx` | 待处理区 UI | 三 |
| 新建 | `tools/submit.ps1`、`tools/http-shortcuts-template.json` | Windows 工具 + 安卓配置 | 三 |
| 新建 | `docs/ANDROID_SUBMIT_GUIDE.md` | 安卓图文指南 | 三 |
| 新建 | `server/services/collectors/douyin/index.js`、`server/routes/auth.js` | 抖音适配器 + 扫码登录 | 四 |
| 新建 | `web/src/components/DouyinTab.jsx` | 抖音 Tab | 四 |
| 新建 | `server/services/collectors/x/index.js` | X（RSSHub）适配器 | 四 |
| 修改 | `web/src/components/WechatTab.jsx` | 增加通用 RSS / X 添加入口 | 四 |
| 新建 | `tests/{columns,matchers,queue}.test.js` | 关键单测 | 五 |
| 新建 | `docs/DEPLOYMENT.md` | 部署文档 | 五 |

---

# 一期：本地阅读器核心（MVP）

## T1: 项目骨架与依赖
**文件：** `package.json`、`.gitignore`
**依赖：** 无
**步骤：**
1. `package.json`：依赖 express@4、better-sqlite3、rss-parser、node-cron、playwright；devDependencies：vite、@vitejs/plugin-react、tailwindcss、nodemon
2. scripts：`start`=node server/index.js，`build`=vite build（web 目录），`test`=node --test tests/，`setup:customer`=node tools/setup-customer.js
3. `.gitignore`：node_modules/、data/、.env、web/dist/
**验证：** `npm install` 退出码 0

## T2: 客户化配置模板
**文件：** `config/customer-config.json`
**依赖：** T1
**步骤：**
1. 按 spec F50 写全字段：opmlUrl、cloudBaseUrl、apiToken（空=自动生成）、deepseekKey、bilibiliCookie、douyinLoginMode、intervals{opml:12h,rss:8h,bilibili:60,douyin:360,queue:10}、generateClients:true
2. 字段加 `_comment` 说明（JSON 允许额外字段，读取时忽略 `_` 前缀）
**验证：** `node -e "JSON.parse(require('fs').readFileSync('config/customer-config.json'))"` 不抛错

## T3: 数据库层
**文件：** `server/db.js`
**依赖：** T1
**步骤：**
1. better-sqlite3 打开 `data/app.db`（目录不存在则建）
2. 执行建表迁移：groups、sources、articles、videos、pending_items、daily_reports、settings、credentials（字段照 plan.md SQL）
3. articles.url、videos.url 加 UNIQUE 索引；sources(type)、articles(source_id,read_at) 加普通索引
4. 导出 db 实例与 `getSetting(key,def)`/`setSetting(key,val)`（JSON 序列化）
**验证：** `node -e "require('./server/db.js')"` 后 `data/app.db` 存在且 `sqlite_master` 有 7 张表

## T4: 工具层
**文件：** `server/util/http.js`、`time.js`、`log.js`
**依赖：** T1
**步骤：**
1. http.js：fetch 封装（超时 15s、重试 2 次、自定义 header/Cookie）
2. time.js：`relativeTime(iso)`→「8h/1天/N天前」；`nowIso()`
3. log.js：带时间戳分级日志，敏感字段（token/key/cookie）打码
**验证：** `node --test` 无此文件测试则手动 `node -e` 调 `relativeTime` 输出正确

## T5: Express 入口与三页面路由
**文件：** `server/index.js`
**依赖：** T3
**步骤：**
1. express.json()、/api 路由挂载占位、静态托管 `web/dist`
2. GET `/reader/`、`/daily/`、`/wechat/` 均返回 dist/index.html（SPA fallback）
3. 监听 3000 端口，启动时执行一次建表迁移
**验证：** `npm start` 后 `curl.exe -s -o NUL -w "%{http_code}" http://localhost:3000/reader/` 输出 200（三路径均测）

## T6: 前端骨架与三主题
**文件：** `web/vite.config.js`、`web/tailwind.config.js`、`web/src/main.jsx`、`web/src/theme.jsx`、`web/src/api.js`
**依赖：** T1
**步骤：**
1. vite root=web、build.outDir=dist；tailwind content 指向 src
2. theme.jsx：`data-theme` 挂 `<html>`，三套主题 CSS 变量（warm-paper 米色底棕按钮 / blue-white / dark），localStorage 持久化，左下角主题按钮循环切换
3. api.js：fetch 封装（json、错误抛出含 status）
**验证：** `npm run build` 成功；主题切换后刷新页面主题保持

## T7: 适配器框架
**文件：** `server/services/collectors/registry.js`
**依赖：** T3
**步骤：**
1. 定义适配器契约（match/resolve/fetch/defaultIntervalMin，照 plan.md）
2. `register(adapter)`、`getAdapter(type)`、`detectByUrl(url)`（遍历各适配器 match 返回首个命中）
3. 预留 wechat/bilibili/douyin/rss/x 五个登记位（后四者后续任务填充）
**验证：** `node -e` 注册一个 mock 适配器后 detectByUrl 正确命中

## T8: 通用 RSS 适配器
**文件：** `server/services/collectors/rss/index.js`
**依赖：** T7
**步骤：**
1. match：http(s) 链接即可（优先级最低，放最后登记）
2. resolve：拉 feed 取 title/link/favicon 存 sources(type='rss')
3. fetch：rss-parser 解析，条目映射为 articles（title/url/author/cover/summary/content_html/published_at），url 去重
4. defaultIntervalMin: 480
**验证：** 用任一公开 RSS（如阮一峰博客）resolve+fetch 后 articles 表有新行

## T9: 公众号适配器（OPML）
**文件：** `server/services/collectors/wechat/index.js`
**依赖：** T8
**步骤：**
1. `syncOpml(opmlUrl)`：拉 OPML→解析 outline（名称+RSS xmlUrl）→diff 本地 sources(type='wechat')→新增/恢复/更新计数写 settings
2. fetch(source)：复用 rss 适配器抓单源
3. 状态字段：lastSyncAt、lastResult{added,restored,updated} 存 settings
**验证：** 以本地静态 OPML 文件起 http 服务测试，sync 后 sources 表行数与状态卡计数正确

## T10: B站适配器
**文件：** `server/services/collectors/bilibili/index.js`
**依赖：** T7、T4
**步骤：**
1. match：`space.bilibili.com/(\d+)`、BV 号视频链接（api 反查 uid）、纯数字 uid；不命中返回 false
2. resolve：api.bilibili.com/x/space/acc/info 取昵称/头像；失败抛出「添加失败：没有识别到 B站 up，请粘贴 space.bilibili.com 的主页链接或直接填写数字 uid」
3. fetch：x/space/wbi/arc/search 拉视频列表 → videos 表（bvid/封面/时长/简介）
4. `getPlayUrl(bvid)`：带 credentials 表 Cookie 请求 playurl 接口取直链；无 Cookie 返回 null
5. defaultIntervalMin: 60
**验证：** 添加真实 uid 后 sources/videos 表有数据；错误输入返回 spec 原文提示

## T11: 调度中心
**文件：** `server/services/scheduler/index.js`
**依赖：** T9、T10
**步骤：**
1. `start()`：读 settings 间隔注册 OPML（12h）、RSS（8h）、B站（60min）interval 任务
2. `reschedule()`：settings 变更后清旧任务重建
3. 任务内遍历对应 type 的 enabled 源调 fetch，更新 last_fetched_at/next_fetch_at/status
**验证：** 把间隔改为 1 分钟，观察日志按分钟触发且 sources 时间字段更新

## T12: 订阅源与分组 API
**文件：** `server/routes/sources.js`、`groups.js`
**依赖：** T7、T9、T10
**步骤：**
1. sources：GET（按 type/enabled 过滤、带未读数）、POST（detectByUrl→resolve→入库，失败透传提示文案）、PUT `:id/toggle`、POST `:id/refresh`（立即 fetch）、DELETE `:id`
2. groups：CRUD + POST `/api/groups/move`（source_id→group_id，拖拽落点）
**验证：** curl 全流程：添加→列表→toggle→refresh→删除返回 200 且数据正确

## T13: 文章 API
**文件：** `server/routes/articles.js`
**依赖：** T3
**步骤：**
1. GET `/api/articles`：tab=all|later|history、source_id/group_id/q（标题+内容 LIKE）、cursor 分页（每页 30）
2. GET `:id`：返回全文 content_html，并顺手置 read_at（历史存档流转）
3. POST `:id/later` 切换；POST `/api/articles/read-all`（按当前过滤条件）
**验证：** curl 造数据后：all/later/history 三 tab 数据正确；搜索命中；read-all 后 all 未读清零

## T14: 视频 API
**文件：** `server/routes/videos.js`
**依赖：** T10
**步骤：**
1. GET `/api/videos`：tab=all|favorite|history + source/group 过滤 + 分页
2. GET `:id`：详情；GET `:id/play?mode=direct|official`：direct 调 getPlayUrl，失败/无 Cookie 回退 official embed 地址
3. POST `:id/favorite` 切换
**验证：** 有 Cookie 时 play?mode=direct 返回可播放地址；无 Cookie 返回官方 embed

## T15: 设置/OPML/状态/备份 API
**文件：** `server/routes/settings.js`、`opml.js`、`status.js`、`backup.js`、`server/services/backup.js`
**依赖：** T9
**步骤：**
1. GET/PUT `/api/settings`：分区读写（intervals/queue/ai/daily），PUT 敏感字段「留空不覆盖」、GET 脱敏（token/key/cookie 只返回是否已配置）
2. POST `/api/opml/sync` 手动触发；GET `/api/status` 汇总三 Tab 状态卡数据
3. backup.js：导出 sources/groups/settings 为 `data/backups/subscriptions-yyyymmdd-hhmmss.json`；restore 读最新覆盖
4. routes：POST `/api/backup`、POST `/api/backup/restore`、GET `/api/backup/latest`
**验证：** 备份生成带时间戳文件；改乱数据后 restore 恢复；latest 返回文件名/时间/条数

## T16: ReaderPage 布局与 Sidebar
**文件：** `web/src/pages/ReaderPage.jsx`、`components/Sidebar.jsx`
**依赖：** T6、T12
**步骤：**
1. 三栏布局 + 文章/视频双 Tab 切换（共用 Sidebar）
2. Sidebar 文章态：全部/稍后阅读/历史存档（带计数）、分组区（新建分组、HTML5 drag 拖拽源入组）、订阅源列表（favicon/名称/未读数/手动刷新/上次下次抓取时间）
3. Sidebar 视频态：全部视频/收藏/历史存档 + 视频分组与订阅列表
**验证：** 页面三栏渲染；拖拽源入组后刷新仍在组内；计数与 API 数据一致

## T17: 文章列表与阅读栏
**文件：** `components/ArticleList.jsx`、`ArticleView.jsx`
**依赖：** T13、T16
**步骤：**
1. ArticleList：来源/标题/两行摘要/方形缩略图/相对时间/未读蓝点/选中高亮
2. ArticleView：来源、大标题、发布时间、content_html 渲染（图片/小标题/加粗）；工具条：稍后阅读♡（激活紫填充）、打开原文↗、⋯；上一篇/下一篇/关闭；全部已读✓
3. 主题按钮在左下角
**验证：** 对照 17 视频截图走查：列表字段齐全；点开文章自动入历史；♡变色；上下篇导航正确

## T18: 视频网格与详情页
**文件：** `components/VideoGrid.jsx`、`VideoDetail.jsx`
**依赖：** T14、T16
**步骤：**
1. VideoGrid：多列卡片（封面+右下时长角标、两行标题、UP 主头像+名称+N天前）
2. VideoDetail：返回按钮、HTML5 播放器（默认 direct，提供「切回官方播放器」）、标题/UP主+时间/简介、底部收藏与「在原平台打开」
**验证：** 网格字段齐全；详情页 direct 可播（配 Cookie 后），可切官方 embed；收藏生效

## T19: SettingsPage + WechatTab
**文件：** `web/src/pages/SettingsPage.jsx`、`components/{WechatTab,StatusCard,SourceTable}.jsx`
**依赖：** T9、T15
**步骤：**
1. 三 Tab 框架（公众号/B站/抖音，抖音 Tab 一期占位）
2. WechatTab：OPML 配置（间隔/自动同步/保存/同步按钮）、RSS 配置（同构）、8 张状态卡、订阅表格（头像/昵称/订阅中徽章/新增时间/RSS链接）
3. 备份区：立即备份/恢复最新备份 + 最新备份信息
**验证：** 保存后 settings 落盘；同步按钮触发状态卡更新；备份按钮生成文件

## T20: BilibiliTab
**文件：** `web/src/components/BilibiliTab.jsx`
**依赖：** T10、T12
**步骤：**
1. 状态卡（运行模式本机模式/订阅源数/视频数）+「本机模式无需 RSSHub」提示 + 刷新按钮
2. 自动刷新配置（60min）；添加 UP 主表单（链接/uid + 名称可空）；失败展示 T10 的原文提示
3. 已订阅列表：头像/名称/平台徽章/条数/上次刷新/启用开关/刷新/删除；高级与诊断折叠区（占位）
**验证：** 添加成功/失败两路径 UI 正确；开关与删除即时生效

## T21: setup:customer 脚本
**文件：** `tools/setup-customer.js`
**依赖：** T2、T3
**步骤：**
1. 读 customer-config.json→生成 .env（PORT、CLOUD_BASE_URL、API_TOKEN 空则生成 48 位随机）
2. 初始化 DB、把 Token/间隔/DeepSeek Key 写入 settings
3. 输出下一步指引（如何启动、三页面地址）
**验证：** 删除 data/ 与 .env 后 `npm run setup:customer`，全部重新生成且服务可启动

## T22: 一期联调
**依赖：** T1~T21
**步骤：**
1. 按 AC1/AC2/AC4/AC6（除队列）/AC11 走查
2. 修复发现的问题
**验证：** 一期对应 AC 全部通过并记录证据

---

# 二期：AI 速览 + 每日情报日报

## T23: DeepSeek 客户端
**文件：** `server/services/ai/deepseek.js`
**依赖：** T4
**步骤：**
1. `chat(messages, opts)`：读 settings 的 apiBase（默认 https://api.deepseek.com/chat/completions）、model（默认 deepseek-v4-flash）、apiKey
2. Key 为空抛「未配置 DeepSeek Key」；非 2xx 抛出含状态码错误（如 `DeepSeek API HTTP 402`）
**验证：** 无 Key 调用返回未配置提示；错误 Key 调用透传 401

## T24: AI 速览
**文件：** `server/services/ai/summary.js`、`server/routes/ai.js`
**依赖：** T23、T13
**步骤：**
1. POST `/api/ai/summary` {kind:'article'|'video', id}：取正文/简介纯文本→套提示词（settings['ai.prompt']，有默认模板）→返回摘要
2. GET/PUT `/api/settings/ai`：提示词/时间范围（48h|7d|all）；PUT 提供 restoreDefault
**验证：** 有 Key 返回摘要；改提示词后摘要以新提示词生成；恢复默认生效

## T25: AiPanel 与提示词弹窗
**文件：** `components/AiPanel.jsx`、`AiSettingsModal.jsx`
**依赖：** T24、T17
**步骤：**
1. ArticleView 工具条加星星按钮→展开速览面板（摘要渲染、复制按钮、设置齿轮、激活星星变紫）
2. 失败展示错误原文；弹窗：多行提示词框（只存提示词不载正文）、恢复默认、时间范围三选一、保存
**验证：** 对照截图走查成功/失败两态；复制 toast「已添加到剪贴板」

## T26: 日报引擎
**文件：** `server/services/ai/daily.js`
**依赖：** T23、T3
**步骤：**
1. `generate(windowHours)`：取窗口内 articles+videos 候选
2. 栏目规则：读 settings['daily.columns']——focus 源内容全进「重点更新」（时间倒序）→关键词命中进对应栏目→其余进「其它重要」
3. 启用 AI 时每条生成摘要+重要度（1-10）；未启用按关键词规则排序且无摘要（N7 降级）
4. 写 daily_reports（stats：候选/文章/视频数、窗口）
**验证：** 造 3 个源（1 个 focus）+10 条内容生成日报：分栏正确、focus 全收、fallback 兜底、stats 正确

## T27: 日报 API 与定时
**文件：** `server/routes/daily.js`、`scheduler/index.js`（修改）
**依赖：** T26、T11
**步骤：**
1. GET `/api/daily`（最新一份）、POST `/api/daily/regenerate`
2. GET/PUT `/api/settings/daily`：窗口/生成时间/来源勾选/focus/columns/AI 开关与 API 配置（Key 留空不覆盖）
3. scheduler 加 node-cron：按「每日生成时间」（默认 08:00）触发 generate
**验证：** regenerate 出新日报；把生成时间改为当前+2 分钟，到点自动生成

## T28: DailyPage 页头与统计卡
**文件：** `pages/DailyPage.jsx`、`components/{DailyHeader,StatCards}.jsx`
**依赖：** T27
**步骤：**
1. 报纸风页头：「48 小时订阅情报」标签+衬线超大标题「每日情报」+生成时间·排序方式·统计区间；右上重新生成+齿轮
2. 统计卡：候选内容/公众号文章/视频/统计窗口；生成后顶部提示条「已生成 DeepSeek 智能日报。」
**验证：** 对照截图走查布局与字段

## T29: 栏目区与日报卡片
**文件：** `components/ColumnSection.jsx`
**依赖：** T28
**步骤：**
1. 按 columns 顺序渲染各栏（栏名+右侧说明）；空栏显示「这一栏暂时没有命中内容」
2. 卡片：封面大图+「AI简介」标签+标题+摘要；AI 排序时显示重要度评分
**验证：** 栏目顺序/说明与设置一致；空栏文案正确

## T30: 快速学习弹窗
**文件：** `components/QuickStudyModal.jsx`
**依赖：** T29
**步骤：**
1. 点卡片打开：类型标签（公众号文章/视频）、大标题、来源+时间
2. 按钮：加入收藏/复制链接/打开原文；AI 总结卡（绿色标识「DeepSeek · 重要度 N」）；正文
**验证：** 三按钮功能正确；AI 卡字段与日报数据一致

## T31: 日报设置弹窗（含栏目管理）
**文件：** `components/DailySettingsModal.jsx`
**依赖：** T27
**步骤：**
1. 统计窗口（默认48）、每日生成时间（时间选择器，默认08:00）
2. 文章来源勾选（全选）+每个来源「重点关照」开关（激活红色「已重点关照」徽章）；视频来源同构
3. AI 开关、API 地址/模型/Key（留空保留）；**栏目管理**：列表增删改（名称/说明/关键词逗号分隔），可恢复默认四栏目
4. 保存
**验证：** 改栏目名+关键词后 regenerate，日报按新规则归类（AC5 后半段）

## T32: 二期联调
**依赖：** T23~T31
**步骤：** 按 AC3、AC5 走查并修复
**验证：** AC3/AC5 通过并记录证据

---

# 三期：云端队列 + 快捷提交

## T33: 队列公共库（PHP）
**文件：** `cloud/_queue_lib.php`
**依赖：** 无
**步骤：**
1. Token 校验：从 `token.json`（setup 生成）读期望 Token，请求 `?token=` 或 body.token 不一致返回 403 `{"ok":false,"error":"bad token"}`
2. JSON 文件存储：`<name>-queue.json`（flock 读写锁防并发损坏）
3. 函数：`queue_push($name,$item)`、`queue_pull($name)`、`queue_clear($name)`
**验证：** 本地 php -S 起服务，curl 错误 Token 得 403；push 后 JSON 文件有条目

## T34: 三个队列端点
**文件：** `cloud/wechat-rss-queue.php`、`bilibili-video-queue.php`、`douyin-video-queue.php`
**依赖：** T33
**步骤：**
1. 三文件结构一致，仅队列名不同
2. POST {token,url,name,type} → push → `{"ok":true}`（type 校验：wechat 仅文章链接、bilibili/douyin 仅视频/主页链接）
3. GET `?token=&action=pull` → `{"ok":true,"count":N,"items":[...]}`；`action=clear` → 清空 → `{"ok":true}`
**验证：** curl 全流程 push→pull(count 正确)→clear→再 pull(count=0)

## T35: 队列轮询器
**文件：** `server/services/queue/poller.js`、`server/routes/queue.js`
**依赖：** T7、T34、T11
**步骤：**
1. `syncQueue(name)`：GET pull→逐条写 pending_items→调 clear→后台逐条 resolve 转 sources（失败标 failed+error，只本机重试）
2. scheduler 注册轮询（默认 10min，三队列依次）
3. POST `/api/queue/sync` 手动同步，返回「导入 N 个，更新 N 个，清空云端 N 个；本地后台正在解析订阅」
**验证：** 手动 push 两条到云端→调 sync→pending_items 出现→稍后 resolve 成 sources→云端 count=0

## T36: 队列配置与待处理 UI
**文件：** `components/PendingList.jsx`；修改 `WechatTab.jsx`、`BilibiliTab.jsx`
**依赖：** T35、T19、T20
**步骤：**
1. 两 Tab 加队列 API 折叠区：地址/Token（留空不覆盖）/轮询间隔（默认10）/启用开关/保存/同步队列按钮；显示 Token 状态与上次/下次同步
2. WechatTab 待提交公众号区：同步后出现条目+「复制链接/复制名称」按钮；同步失败展示错误详情
3. BilibiliTab 本地待处理订阅列表：名称/待处理状态/导入时间/原始链接
**验证：** 对照截图走查；同步按钮结果文案正确；复制按钮 toast 提示

## T37: Windows 提交工具
**文件：** `tools/submit.ps1`；`tools/setup-customer.js`（修改）
**依赖：** T34、T21
**步骤：**
1. submit.ps1：读剪贴板→正则识别平台（bilibili.com→bilibili 队列；douyin.com→douyin；mp.weixin.qq.com→wechat）→WinForms MessageBox 确认「识别到XX/类型/确认加入订阅队列」→POST 对应端点→结果提示
2. setup 增加：生成桌面快捷方式（绑定 Ctrl+Alt+Q 调 submit.ps1）
**验证：** 复制 B站链接按快捷键→弹确认→确定后云端 count+1

## T38: 安卓 HTTP Shortcuts 配置生成
**文件：** `tools/http-shortcuts-template.json`；`tools/setup-customer.js`（修改）
**依赖：** T34、T21
**步骤：**
1. 模板含三个 shortcut：分享菜单接收文本→正则识别→确认对话框→POST 对应队列（Token 与域名占位符）
2. setup 渲染占位符（cloudBaseUrl/apiToken）输出 `data/http-shortcuts.json`
3. 写 `docs/ANDROID_SUBMIT_GUIDE.md`：安装 App→导入 JSON→使用步骤
**验证：** 生成文件通过 HTTP Shortcuts App 导入校验（真机导入成功，分享 B站链接弹确认并提交成功）

## T39: 三期联调
**依赖：** T33~T38
**步骤：** 按 AC7、AC9 及 AC6 队列部分走查：安卓+Windows 各提交一条→10 分钟内自动入库→云端清空
**验证：** AC7/AC9 通过并记录证据

---

# 四期：抖音订阅 + 海外源扩展

## T40: 抖音适配器
**文件：** `server/services/collectors/douyin/index.js`
**依赖：** T7、T4
**步骤：**
1. match：douyin.com/user/ 主页、v.douyin.com 分享短链（跳转解析）、sec_uid 直填；失败抛「添加失败：没有识别到抖音 uid/sec_uid，请粘贴抖音用户主页链接或直接填写 sec_uid」
2. resolve：Playwright 带已存登录态访问主页取昵称/头像（未解析时名称显示原始 sec_uid）
3. fetch：抓作者视频列表→videos 表；**串行队列**：所有主页访问进同一队列，任务间隔 ≥10s
4. defaultIntervalMin: 360
**验证：** 连续添加 3 个作者，日志显示相邻请求间隔 ≥10s；错误输入返回原文提示

## T41: 抖音扫码登录
**文件：** `server/routes/auth.js`；修改 `server/services/collectors/douyin/index.js`
**依赖：** T40
**步骤：**
1. POST `/api/auth/douyin/start`：Playwright 起本机 Chromium 打开抖音登录页→轮询检测登录态→成功存 credentials(platform='douyin')→自动关闭窗口
2. GET `/api/auth/douyin/status`：已登录/未登录 + 保存时间
**验证：** 点击后浏览器弹出，手机抖音扫码→窗口自动关闭→status 返回已登录

## T42: DouyinTab
**文件：** `components/DouyinTab.jsx`
**依赖：** T41、T20（同构参考）
**步骤：**
1. 状态卡（本机模式/订阅源数/视频数）+「无需 RSSHub」提示+刷新按钮
2. 登录状态卡：未登录「未添加抖音订阅/需要时再扫码登录」+重新扫码；已登录「已保存登录态…」
3. 扫码登录弹窗（打开登录窗口/稍后处理）；自动刷新 360min 说明「严格串行，间隔 10 秒」
4. 添加作者表单+失败原文提示；待处理/已订阅列表（名称未解析显示 sec_uid）；高级与诊断折叠区
**验证：** 对照截图走查；扫码流程端到端通过

## T43: 海外源适配器
**文件：** `server/services/collectors/x/index.js`；修改 `rss/index.js`
**依赖：** T8
**步骤：**
1. rss 增强：输入 youtube.com/@xxx 或 /channel/ 链接自动转官方频道 RSS
2. x 适配器：settings 配 RSSHub 实例地址模板（如 `https://rsshub.app/twitter/user/{name}`）→拼出 RSS 后委托 rss 适配器；UI 提示「X 依赖第三方 RSS 服务」
**验证：** 添加 YouTube 频道链接订阅成功出视频；配 RSSHub 后添加 X 用户出推文（articles）

## T44: 设置页海外源入口
**文件：** 修改 `WechatTab.jsx`（或独立「扩展源」区）
**依赖：** T43
**步骤：**
1. 添加表单支持「任意 RSS 地址 / YouTube 频道 / X 用户名」三种输入，说明文字标注依赖关系
2. 订阅表格 type 徽章区分 rss/x
**验证：** 三种输入分别添加成功并正常抓取

## T45: 四期联调
**依赖：** T40~T44
**步骤：** 按 AC8、AC10 走查并修复
**验证：** AC8/AC10 通过并记录证据

---

# 五期：部署加固与交付

## T46: 关键单测
**文件：** `tests/columns.test.js`、`matchers.test.js`、`queue.test.js`
**依赖：** T26、T40、T35
**步骤：**
1. columns：focus 优先/关键词命中/fallback 兜底/空栏
2. matchers：B站三种输入、抖音三种输入、错误输入原文提示
3. queue：push/pull/clear 协议与 Token 403
**验证：** `npm test` 全绿

## T47: 性能加固
**文件：** `server/routes/articles.js`、`videos.js`、`components/ArticleList.jsx`、`VideoGrid.jsx`
**依赖：** T13、T14
**步骤：**
1. 列表游标分页确认生效（每页 30）；图片 lazy loading；视频网格虚拟滚动（1000+ 条）
2. 慢查询检查（EXPLAIN，必要时补索引）
**验证：** 灌入 1000 视频+5000 文章，网格滚动不卡顿、列表首屏 <1s（N5）

## T48: 异常恢复加固
**文件：** `scheduler/index.js`、`poller.js`、各适配器
**依赖：** 全部采集模块
**步骤：**
1. 任务异常 catch 记 status='error' 不中断调度；启动时把中断的 pending/串行队列恢复执行
2. 连续失败 3 次的源自动暂停并在状态卡标注
**验证：** 断网重启服务：调度恢复、错误源标注、恢复联网后自动继续

## T49: 部署文档
**文件：** `docs/DEPLOYMENT.md`
**依赖：** 全部
**步骤：**
1. Windows 本地：Node 安装→npm install→填 config→setup:customer→npm start→三页面
2. 宝塔：建 PHP 站点→上传 cloud/ 4 文件→token.json 放置与权限→验证 curl
3. 安卓指南链接；常见问题（402、Cookie 失效、RSSHub 选择）
**验证：** 对照文档在干净目录全流程走通

## T50: 交付清单核对 + 全量回归
**依赖：** T1~T49
**步骤：**
1. 核对交付物：本地服务、4 个 PHP、http-shortcuts.json、submit.ps1、文档
2. 全量回归 AC1~AC12（AC12 真实数据验收由用户执行，提供记录模板）
**验证：** 回归报告全部通过

---

## 执行顺序

```
一期：T1→T2→T3→T4→T5→T6→T7→T8→T9→T10→T11→T12→T13→T14→T15
      →T16→T17→T18→T19→T20→T21→T22（一期验收）
        （T6 前端骨架可与 T3~T15 后端并行）
二期：T23→T24→T25→T26→T27→T28→T29→T30→T31→T32（二期验收）
三期：T33→T34→T35→T36→T37→T38→T39（三期验收，T37/T38 可并行）
四期：T40→T41→T42→T43→T44→T45（四期验收，T43 可与 T40~T42 并行）
五期：T46→T47→T48→T49→T50（最终验收）
```

> 每期结束后服务保持可用状态，再进入下一期；AC 映射见 spec.md 分期表。
