# `web/src/components/` — 业务组件

43 个 `.jsx` + `ui/`（7 个基础件）。

**这里唯一硬规则**：组件必须被某个入口的懒加载清单登记（主站 `main.jsx` / 后台 `admin.jsx`），否则线上表现是"点了白屏"而不是报错——B13 那类事故就是这么来的。

## 后台 Tab 组件（8 个，登记在 `admin.jsx` 的懒加载清单）

| 内容 | 说明 |
|---|---|
| `SourceLibraryTab.jsx` | 源库三视图（spec 29） |
| `DataTab.jsx` | 数据管理与清理 |
| `AlertsTab.jsx` | 报警管理（含渠道与静默） |
| `DailySettingsTab.jsx` | 日报设置 |
| `MonitorTab.jsx` | 健康度实时监控（内含一处 `setInterval` 60s） |
| `TranslateSkillTab.jsx` | 翻译技能配置 |
| `AiSettingsTab.jsx` | AI 能力台（spec 39；保存会写 `settings.ai`，BL9 裁决为"可写 + 审计 + 告警"） |
| `BriefCenterTab.jsx` | 早报中心（spec 40；含周刊归档删除 `DELETE /api/weekly/archive/:issue`） |

## 平台侧 Tab

`BilibiliTab.jsx`、`WechatTab.jsx`、`HotSettings.jsx`、`IntervalEditor.jsx` —— 内容聚合平台与调度间隔的配置面。**改间隔要同步重算 `next_fetch_at`**（历史坑）。

## 阅读器与每日情报

`ArticleList.jsx`、`ArticleView.jsx`、`ColumnSection.jsx`、`DateFilter.jsx`、`FilterPanel.jsx`、`Sidebar.jsx`、`SidebarGroups.jsx`、`OverviewRail.jsx`、`NewArticlesBanner.jsx`、`DailyBriefCard.jsx`、`DailyHeader.jsx`、`HotDetail.jsx`、`HotEvents.jsx`、`VideoDetail.jsx`、`VideoGrid.jsx`、`ThemePanorama.jsx`、`QuickStudyModal.jsx`

## 运维与状态面

`AdminRefCard.jsx`、`BackfillPreviewModal.jsx`、`CollectTrendChart.jsx`、`ErrorBoundary.jsx`、`LoginGate.jsx`、`LoginModal.jsx`、`PendingList.jsx`、`QueuePanel.jsx`、`Skeleton.jsx`、`SourceTable.jsx`、`StatCards.jsx`、`StatusCard.jsx`、`icons.jsx`

## ★ 已知零引用

`DouyinTab.jsx`（503 行）——全仓库除自身 `export default` 外**没有任何引用者**，两个入口的懒加载清单里也没有它。要么后台本该有抖音管理入口而漏接（功能缺失），要么该删（死代码）。判定挂 spec 42 AU-03；**后台正被并行重构，复验以最新树为准**。

`ui/` 下 7 个是基础件（按钮/卡片/弹窗一类），被上面的业务组件复用，不直接对页面。

**不放什么**：只服务单个页面的局部组件（该就近放页面目录）；跨端业务规则（进 `lib/`）；把"以后可能用"的组件先建在这里。

**状态**：active
