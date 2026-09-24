# 设计：信息过载与信息茧房防御体系（2026-09-13 立项）

> 用户提出的问题：899+ 源持续增长；各源更新刻度不统一（X 6h、公众号数天一更或一小时腹泻式多篇）→ **信息过载**；
> 多方信源井喷（如尼泊尔泥石流）+ 广告钩子文/无干货营销稿 → 真实、权威、小众但行业级重要的内容被淹没 → **自我设限的信息茧房**。
> 本文调研业界成熟方案并映射到本系统（多管齐下，不依赖单一机制）。

## 一、业界成熟方案（调研结论）

| 方案 | 出处 | 要点 | 本系统现状 |
|---|---|---|---|
| **事件聚类去重**（story clustering） | [Feedly Engineering](https://feedly.com/engineering/posts/reducing-clustering-latency)、[Microsoft RSS Clusgator](https://www.microsoft.com/en-us/research/publication/a-novel-clustering-based-rss-aggregator/)、[Newsloth](https://newsloth.com/blog/news-clustering-and-deduplication) | 把跨发布者的近重复文章折叠成"同一事件"一条，是抗过载第一防线；工程上用 MinHash/LSH 或标题分词 Jaccard 降延迟 | ✅ 已有雏形：阅读器「合并同事件」开关（标题 Jaccard ≥0.5），未用于早报 |
| **MMR 多样性重排**（Maximal Marginal Relevance） | [ScienceDirect 2020 滤泡测量研究](https://www.sciencedirect.com/science/article/abs/pii/S1568494620307092) | 推荐=相关性 − λ·与已选集合的相似度，是兼顾"相关"与"多样"的业界标准算法 | ❌ 未实现 → T4-2 |
| **用户显式多样性控制** | [Nieman Lab 五条出路](https://www.niemanlab.org/2012/07/are-we-stuck-in-filter-bubbles-here-five-potential-paths-out/) | 给用户"多样性滑杆"而非黑盒；用户自己定探索比例 | 🔶 破茧栏固定 Top5（T2-2 R4 设计），无用户可调项 |
| **个性化无害论的证据** | [Google News 多样性实证](https://www.researchgate.net/publication/318256136_Burst_of_the_Filter_Bubble_Effects_of_personalization_on_the_diversity_of_Google_News)、[PMC 综述](https://pmc.ncbi.nlm.nih.gov/articles/PMC8923337/) | 滤泡效应在新闻聚合场景实证证据混合；**去重+编辑性多样性设计可对冲** | 设计语境参考 |
| **源头质量分** | BestBlogs 范式（本项目已借鉴） | AI 初筛 + 六维评分让高分内容浮上来 | ✅ 两阶段初筛+六维已上线 |

## 二、本系统的七层防御设计（多管齐下）

> 层 1-3 抗过载，层 4-7 抗茧房。标注 ✅已有 / 🔶部分 / ❌待建（对应 T4 编号）。

### L1 频率分层（抗过载）❌→T4-1
源按活跃度分三档：高频（60min，Top200/破茧源）、中频（180min，普通博客/公众号）、低频（360min+，播客/周刊/低产）。
数据已有：`extra.intervalMin` 双端生效（2026-09-13 导入即用）。**演进**：按"实測更新频率"自动调档（腹泻式源自动降频、聚合多条一次给），替代静态分档。

### L2 事件聚类去重（抗过载+抗井喷）🔶→T4-2
把阅读器的「合并同事件」从"前端可选项"升级为**早报/我的早报/周报的默认管线步骤**：
井喷事件（≥5 源报道）在早报中折叠为**一个主题条目**（带"N 源报道"徽章+可展开），条目排序按"最快源时间+最高分"而非被刷屏。

### L3 每日报量配额（抗过载）❌→T4-2
早报总条数硬上限（建议 30）+ 各主题栏内配额；单源单日入报上限（默认 3，防单源刷屏）；补充阅读 10 条独立配额。

### L4 六维评分初筛（抗噪音）✅
> **部分已作废（2026-09-24）**：本段「**补强**：…在 filterArticle prompt 中显式列负例」这条做法已被
> `docs/RSS高质量信息流系统设计参考文档 (1).md` §1.6 架构纪律推翻（「预筛层任何一级出现模型调用即违例，
> 那是用美元做正则表达式能做的事」）——把标题党词表交给模型判，正是它禁止的形状。替代决策与落地边界见
> `docs/specs/44-prescreen-tier/spec.md`（词表代码化 + Pass 1 改二元三问）。六维评分本身仍有效。
选题/内容/深度/实用/创新/表达六维 + 两阶段初筛已在管线。**补强**：广告/钩子文特征降权（标题党词表+正文广告密度启发式），在 filterArticle prompt 中显式列负例（"震惊体/不看后悔/限时广告/荐股"），评分强制压到阈值下。

### L5 权威加权 + 小众保护（抗淹没）❌→T4-2
- 权威加权：按源历史"高分率"给源级 authority 系数（0.8~1.2），乘入 totalScore——大事件权威源排前。
- **小众保护（反马太效应）**：设"低曝光源保护位"——每天固定 2-3 个名额给"近 14 天从未入报但六维 ≥75"的源（这正是"小众一说就是行业级颠覆"的挖掘通道）。

### L6 破茧双管 + MMR 探索位（抗茧房）❌→T4-2
- 破茧栏（未订阅源 Top5 强制曝光）保持；
- 探索位混排用 **MMR**：`score = 0.7·totalScore − 0.3·max_similarity(候选, 已选集)`（相似度=标题 Jaccard），保证探索位内部也不同质；
- **用户多样性滑杆**：设置「探索强度」低/中/高（探索位占比 5%/10%/20%），写 settings，前端我的早报页即可调。

### L7 主题全景四视角（认知防茧房）🔶→T3-1 R0c
碎片聚合成主题全景，事件/领域/人物/产品对比四类视角——同一事件从多源对照读，天然防止单一叙事（BestBlogs 范式，T3-1 已立项）。

## 三、实施映射

| 层 | 落点 | 依赖 |
|---|---|---|
| L1 | 收集端（collect-turso intervalMin + 自动调档） | 无 |
| L2/L3 | daily-ai/mybrief/weekly 管线（runDailyAi 组装前） | 六维数据已有 |
| L4 | _ai.js filterArticle prompt + prompts/filter.md | 无 |
| L5 | analyzeArticle 汇总后的源级 authority 表（settings 缓存） | 历史数据已有 |
| L6 | runMyBrief/runDailyAi 组装排序 | L2 |
| L7 | T3-1 R0c | AI 配额 |
