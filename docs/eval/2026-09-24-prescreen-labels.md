# 标注清单 · 零额度初筛（朴素贝叶斯 / TF-IDF）效果实验的输入

> 生成时间：2026-09-24T12:49:12.646Z（只读探针，零生产写）
> 分层：腹泻源(≥20 篇/日) 8 个、中量源(3~19) 12 个、小源(≤2) 20 个；每源取近 24h 内 2 篇 → **实得 53 条**
> （计划 80，差额是部分小源近 24h 不足 2 篇 —— 这本身就是"≤2 篇/日的源占 83%"那个分布的体现）。
> **你要做的**：每行在最右列勾 `留` 或 `砍`。判据就用你日常那句直觉——"这篇我早上想不想读"。
> 用途：同一份标签同时喂给 ①现在的 AI 初筛 ②朴素贝叶斯 ③TF-IDF 质心，算三者的
> 「误砍率（你标留却被砍）/ 漏砍率（你标砍却留下）」——**误砍率是决定这层能不能上线的那个数**。
>
> **勾完后一条命令出结论（零网络、零模型、毫秒级）**：
> `NODE_PATH="D:/全网情报系统/node_modules" node --env-file=.env tools/eval-prescreen-learning.cjs`
> 它会打印三臂对照（多项式 NB / 互补 NB / TF-IDF 质心）+ 分歧带清单（模型之间或模型与你意见不一致的那几条）。
> ⚠️ 脚手架自带的合成自测已经量出：**几十条标注的量级下 NB 家族不可信**（合成 12 条上多项式 NB 全判"砍"、
> 互补 NB 全判"留"，只有 TF-IDF 质心两向都有错）→ 这轮先看 TF-IDF 那一臂，NB 要等标签上到几百条。
> **09-24 15:40Z 更正：这句只成立一半。**"互补 NB 全判留"里混着脚手架自身的一个**反号 bug**（argmin 应为 argmax），
> 不能全记在小样本头上；"多项式 NB 有长度偏置"那条仍然成立。已用行为标签重做三臂回测，答案在文末
> 「三臂行为回测」（含 D1/D2/D3 与采用建议）。

## 行为正样本回测（09-24 14:33Z 只读探针，先于人工标注的一答）

正样本 = 库里 `read_at IS NOT NULL OR later=1` 的 **246 条**（你真点开过 / 标过稍后读的文章）。
把 spec44 步2 准备的"零判断"判据跑在这 246 条上，再看同规则在近 7 天 4,000 篇上的拦截率：

| 判据 | 打到正样本（误砍） | 近 7 天拦截 | 判读 |
|---|---|---|---|
| **R1 commit / Release notes 形态** | **0/246 = 0.0%** | 176 篇（4.4%） | **纯赚** → 该上 |
| **R2 正文极薄 <600 字符** | **99/246 = 40.2%** | **2,913 篇（73%）** | **否决**：它惩罚"正文短"，而你点开过的热榜卡片式条目恰恰短 |
| **R3 标题极短 <12 字符** | **24/246 = 9.8%** | 599 篇 | 否决：误砍样本是豆瓣热门 / Product Hunt 短标题，你也在读 |
| 任一规则命中 | **108/246 = 43.9%** | **75.9%** | 砍掉四分之三池子的代价 = 四成多"你读过的"一起被砍 |

误砍的 R2 实例（全部是真打开过的）：`Claude 接管应用日常维护：388 个 PR 的实践`[AIHOT 热榜] 正文 392 字、
`DeepSeek Harness v0.1 开发者预览版发布` 371 字、`DeepSeek V4 Pro与Grok 4.6同日发布…` 379 字。

**据此改判据清单**（spec44 §步2 已同步）：只上**形态类**（R1 + `prompts/filter.md` 的负例词表），
**不上长度/字数类**。口径边界要说清：这 246 条本身有偏（全库打开率仅 **0.68%**、且偏榜单类），
所以它是**必要不充分的否决证据** —— 被它打中的判据一定不能上；没被打中的（如 R1）仍需下面这张表来定召回底线。

| # | 判定 | 层 | 源(日均) | 标题 | 摘要头 120 字 |
|---|---|---|---|---|---|
| 1 |  | fat | Hacker News 首页(21.0) | Microsoft tried to ban "Microslop", and six months later it has given up | Article URL: https://www.windowslatest.com/2026/09/24/microsoft-tried-to-ban-microslop-and-six-months-later-it-has-given |
| 2 |  | fat | Hacker News 首页(21.0) | Can open-source prompt-injection detectors catch realistic AI agent attacks? | Article URL: https://github.com/rudratoshs/buried-injections |
| 3 |  | fat | 钛媒体：引领未来商业与生活新知(22.7) | 月内官宣74万吨扩产项目，锂电负极真的不够用了吗？｜行业风向标 | 9月22日、23日，科达制造（600499.SH）、杉杉股份（600884.SH）接力抛出重磅扩产公告，两项目均落地内蒙古包头，投资额合计高达96亿元，新增产能达到65万吨。若叠加一周前翔丰华（300890.SZ）刚公告的拟在四川遂宁落地年 |
| 4 |  | fat | 钛媒体：引领未来商业与生活新知(22.7) | 吴泳铭首先要给20GW“找工作” | 9月22日的云栖大会上，阿里巴巴集团CEO吴泳铭给出一组目标：到2032年，阿里云运营的全球数据中心规模超过20GW。平头哥新一代AI芯片真武V900单芯片算力达到上一代M890的3倍，2027年一季度量产。Qwen后续模型参数规模将扩展到 |
| 5 |  | fat | NYT &gt; World News(21.7) | Son of Israeli Ambassador to U.S. Critically Hurt in West Bank Attack, Officials Say | Neria Leiter, a reserve soldier, sustained life-threatening injuries after a Palestinian man drove into a military check |
| 6 |  | fat | NYT &gt; World News(21.7) | Here’s the latest. |  |
| 7 |  | fat | World news | The Guardian(20.0) | Second child dies after alleged Blue Mountain stabbing as mother faces additional murder c | One-year-old dies after alleged attack on Sunday, while three-year-old sibling remains in critical condition |
| 8 |  | fat | World news | The Guardian(20.0) | Global release announced for acclaimed Gaza documentary NAZA | Theatrical rollout across 56 territories planned for documentary about Israel’s mass killing of civilians in Gaza before |
| 9 |  | fat | Show HN(38.4) | Show HN: I Rebuilt Captcha with Jev | Article URL: https://www.localcan.com/blog/build-your-own-captcha |
| 10 |  | fat | Show HN(38.4) | Show HN: HodoClip - A browser scratchpad that saves links with clips | Article URL: https://chromewebstore.google.com/detail/hodoclip/olklheidccboooipkkbegbejgkonpcln |
| 11 |  | fat | 36氪(58.7) | 甲骨文就新墨西哥州数据中心发出不可抗力通知 | 甲骨文就新墨西哥州数据中心发出不可抗力通知。如果项目延期，甲骨文正试图推迟付款。（财联社） |
| 12 |  | fat | 36氪(58.7) | 中证指数有限公司决定修订中证全指指数和中证流通指数编制方案 | 36氪获悉，经研究，中证指数有限公司决定修订中证全指指数和中证流通指数编制方案。中证全指指数修订内容为：增加单个样本权重不超过15%的权重上限规则。指数编制方案其余部分保持不变。中证流通指数修订内容为：（1）增加单个样本权重不超过15%的权 |
| 13 |  | fat | V2EX · 技术(69.7) | 新项目： OpenApp 开源了。 | GitHub： https://github.com/seekskyworld/openapp 一句话介绍： |
| 14 |  | fat | V2EX · 技术(69.7) | 新项目： OpenApp 开源了。 | GitHub： https://github.com/seekskyworld/openapp 一句话介绍： |
| 15 |  | fat | Al Jazeera – Breaking News, World (48.0) | Fighting widens across Ethiopia as Tigray clashes escalate | Armed groups clashed with government forces across northern Ethiopia as fears mount of regional spillover. |
| 16 |  | fat | Al Jazeera – Breaking News, World (48.0) | Trump-Xi summit live: Trade, AI, Iran and Taiwan top US-China talks | Xi’s first White House visit in more than a decade comes amid ongoing disputes over trade, AI, Taiwan and war in Iran. |
| 17 |  | mid | OpenAI Developer Community · API(3.0) | Title: Locked out by MFA bug — Support promised email verification was restored, but it ne | Sharing my situation in case it helps others, and hoping someone can point me in the right direction. |
| 18 |  | mid | OpenAI Developer Community · API(3.0) | Ads Manager Conversion Key still returns 401 — missing `ads.third_party_events.write` scop | We are integrating the OpenAI Ads Conversions API for server-side conversion event delivery in production. |
| 19 |  | mid | Justine Moore(@venturetwins)(3.0) | I’m crying of laughter - please let this be the model that solved Navier-Stokes

(this g | I’m crying of laughter - please let this be the model that solved Navier-Stokes(this guy’s name is hayZee, we need to ge |
| 20 |  | mid | Justine Moore(@venturetwins)(3.0) | Exceptional essay from a legend in the entertainment industry.

I loved this story about | Exceptional essay from a legend in the entertainment industry.I loved this story about how Disney Animation moved from p |
| 21 |  | mid | InfoQ 推荐(13.7) | 云栖之后，10+阿里AI实战派将亮相QCon上海站 | “智以致用”——这是今年云栖的主题，也是整个AI产业正在经历的关键转折。当行业不再热衷于比拼模型参数，当“Agentic AI”“Vibe Coding”“AI for Science”从概念走向落地，一个更务实的问题摆在所有人面前：AI技 |
| 22 |  | mid | InfoQ 推荐(13.7) | 世界人工智能开源大赛（GOAI）总决赛暨颁奖盛典在杭州举行 | 9月22日至23日，世界人工智能开源大赛（GOAI）总决赛暨颁奖盛典在杭州云谷中心举行。 |
| 23 |  | mid | 人民网(10.7) | “小木雀没有等来归人，但我们等来了盛世。” | 荆楚大地，红色根脉深植山河。数字背后，是荆楚大地的热血与赤诚。九十余载，红色基因如何变成发展动能？记者探访湖北，找到了答案。 |
| 24 |  | mid | 人民网(10.7) | 2027年研考时间公布！ | 记者今天从教育部获悉，教育部近日印发《2027年全国硕士研究生招生工作管理规定》（以下简称《规定》），明确2027年全国硕士研究生招生初试时间为2026年12月19日至20日。 |
| 25 |  | mid | 财经早餐(3.4) | 【财经早餐】2026.09.24星期四 | ► 央视新闻：9月23日下午，国家主席习近平乘专机离开北京，应美国总统特朗普邀请，对美国进行国事访问。 |
| 26 |  | mid | 财经早餐(3.4) | 蒙牛开了一张"处方" | 一条不太起眼的消息藏在9月的食品行业新闻里：蒙牛控股的特医品牌&#34;特一亿诺&#34;，两款自研的特殊医学用途配方食品拿到了市场监管总局的注册批文——&#34;宁敏瑞&#34;是第一款符合新国标的国产婴儿氨基酸配方食品，&#34;萱康安 |
| 27 |  | mid | 机核(15.9) | 我想做这样的超英游戏，感觉能火！对话“超英”UP主BA【视频播客EP.71】 | 欢迎回到“核电波”！今天我们邀请到了超英UP主BA，和他聊聊超英游戏！本期为机核视频播客节目音频版，若大家想看我们在录节目的时候究竟是什么样的状态,可以关注我们的B站账号【核电波】 |
| 28 |  | mid | 机核(15.9) | 我那随叫随到的满级队友，和那些藏在游戏设备里的避风港 | 前两天聊起“硬件杀手级游戏”VS“玩家的容忍度”，鼠鼠翻出了自己的黑历史：刚入职的时候，用掌机玩《黑神话：悟空》，曾经是这位00后“新人时期”的一个黑历史、当然也是其他同事“嘲笑”她的一个点。 |
| 29 |  | mid | PLOS One(17.3) | Identification of rs28362336 as a risk SNP for generalized myasthenia gravis and its impac | by Zihong Chen, Qingling Guo, Liting Tian, Jingnan Jin, Xia Wang, Chunyu Yu, Yichen Li, Jingjing Zhang, Yan Li, Yufan Zh |
| 30 |  | mid | PLOS One(17.3) | Use of faricimab for refractory diabetic macular edema in real-world clinical practice: Wh | To evaluate the anatomical and functional outcomes of faricimab in the treatment of naïve and refractory diabetic macula |
| 31 |  | mid | NYT &gt; Technology(4.1) | Elizabeth Holmes to Transfer to Halfway House in August 2027 | The founder of the blood-testing start-up Theranos was sentenced to 11 years in prison for fraud and had been serving ti |
| 32 |  | mid | NYT &gt; Technology(4.1) | OpenAI’s A.I. Tried Breaching Four Other Targets, With No Prompting | In each incident, the technology appeared to be conducting mundane data collection and resorted to hacking techniques to |
| 33 |  | mid | 人民日报(13.0) | 格式化也没用！旧手机换掉前，一定多做这一步 | 淘汰的旧手机，很多人会考虑置换或是卖到二手市场，先别急！账户、隐私、工作信息若没清干净，就可能被不法分子利用，留下风险隐患。那么，换下来的旧手机该如何处理？ |
| 34 |  | mid | 人民日报(13.0) | “六金王”，张展硕！ | 原创 人民日报微信 2026-09-24 18:58 北京 9月24日在第二十届亚运会游泳比赛男子4×100米自由泳接力决赛中由赵家悦、王浩宇、张展硕、潘展乐组成的中国队以3分10秒60的成绩成功卫冕并打破亚洲纪录在此之前男子800米自由泳 |
| 35 |  | mid | NYT &gt; Science(4.7) | Salmon Are Thriving After Klamath Dam Removals, Study Finds | The first fall runs of chinook salmon since the project in California and Oregon was completed have surpassed researcher |
| 36 |  | mid | NYT &gt; Science(4.7) | Trump Backtracks on Plan for New Controls on N.I.H. Grants | Democrats and Republicans in Congress opposed the creation of a commission with the power to veto federal research award |
| 37 |  | mid | 雷峰网(3.1) | 全球份额73%，赛道越卷，大疆越强 | 当一个原本小众的硬件赛道被市场验证、大盘开始爆发时，各类跨界新势力便会蜂拥而至。随之而来的，往往是激烈的功能和参数内卷，而最早开辟市场的领头羊，其市场份额通常会被逐步摊薄。 |
| 38 |  | mid | 雷峰网(3.1) | 解读丨顶配售价近万元，小米 18 Pro 的高端局胜算几何? | 9 月 21 日晚，vivo 率先发布 X500 系列，把标准版起售价推到 5499 元；第二天，OPPO Find X10 系列接棒，Find X10 同样从 5499 元起步，产品线则跳过传统的 Pro 档，直接向上增加 Pro Max |
| 39 |  | mid | Cult of Mac(6.0) | Meta Ray-Ban glasses get a camera-free option and a Gen 3 upgrade | Meta’s new camera-free Ray-Ban glasses deliver up to 12 hours of battery life, while Gen 3 brings a slimmer design and i |
| 40 |  | mid | Cult of Mac(6.0) | Apple Watch Series 12 and Ultra 4 get emergency fix for reboot problem | A watchOS 27.0.1 update fixes a bug that caused some Apple Watch Series 12 and Ultra 4 models to unexpectedly restart ov |
| 41 |  | small | 人人都是产品经理(2.7) | WorkBuddy，提个需求就能做产品了？ | AI办公赛道卷到飞起，WorkBuddy却拿下中国个人端和企业级桌面智能体双榜第一。本文用&#34;一句话需求&#34;实测：让WorkBuddy从0到1开发一个面向英语老师的教育产品，不拆任务、不替它定流程，结果它真的做到了。功能丰富只是 |
| 42 |  | small | 人人都是产品经理(2.7) | AI在手，企业评估产品经理的标准真的变了 | 企业不再只听你讲做过什么，而是先看你用AI做出了什么：有没有可以体验的Demo？解决了什么问题？用了哪些AI能力？验证出了什么结果？ |
| 43 |  | small | DeepLearning.AI(@DeepLearningAI)(1.0) | Can you distill your way to a frontier model? 🧠

Anthropic's latest report highlights p | Can you distill your way to a frontier model? 🧠Anthropic&#39;s latest report highlights proxy query routing supporting  |
| 44 |  | small | Suhail(@Suhail)(1.4) | The Slack bot is especially good. Have been pleasantly surprised. | The Slack bot is especially good. Have been pleasantly surprised.💬0🔄0❤️6👀604📊1⚡ Powered by xgo.ing |
| 45 |  | small | Suhail(@Suhail)(1.4) | Linear is so good. I hadn’t really gotten to use it until recently. Lovely UX end to end.  | Linear is so good. I hadn’t really gotten to use it until recently. Lovely UX end to end. I can tell the team truly uses |
| 46 |  | small | Schneier on Security(0.9) | Malicious npm Packages That Evade Defenses | This is an impressive piece of malware. Its sophistication says nation-state to me, but there is no direct evidence and  |
| 47 |  | small | Release notes from zed(0.6) | v1.21.0 | This week's release includes faster rendering in syntax-highlighted files and Markdown code blocks, a language server co |
| 48 |  | small | Release notes from zed(0.6) | v1.22.0-pre | v1.22.x preview for @JosephTLyons |
| 49 |  | small | TED Talks Daily(1.0) | Why we blew up a dam — and saved a river / Amy Bowers Cordalis | For thousands of years, the Klamath River in Northern California was home to one of the continent’s great salmon runs, c |
| 50 |  | small | ZDNET Security(1.4) | How to fix your Windows File History if the September update broke it |  |
| 51 |  | small | ZDNET Security(1.4) | Nearly 70% of workers use AI regularly now – but many get no time to upskill |  |
| 52 |  | small | Stratechery by Ben Thompson(0.7) | An Interview with Colossus EIC Jeremy Stern About Profiling Mark Zuckerberg | An interview with Colossus EIC Jeremy Stern about profiling Mark Zuckerberg and other prominent tech figures. |
| 53 |  | small | 柴郡猫(0.1) | 噩耗，本站的微软 OneDrive E3 MSDN 存储被停止了，大量下载链接急需更新 | 今早打开OneDrive 上传资源发现账号已经被停止了，文件还未被删除。 感觉天塌了，上面资源太多了，要一个一 [&#8230;] |

## 三臂行为回测（09-24 15:33Z · 不等人标注先给出「会不会干掉我要的文章」的那个数）

> 触发：用户 09-24「贝叶斯/TF-IDF 消失没问题，主要是……**他是把我们需要的文章干掉了还是没营养的垃圾文章干掉了**。如果干掉了需要的文章我们应该考虑能不能更改，最后综合考虑是否采用」。
> 这份表要人勾 53 行才出结论，但**库里已经躺着用户自己的判断**，于是不等标注先做了一轮真回测：
> 正样本 = 已读(246) ∪ 稍后读(3) ∪ 进过精选(777)，负样本 = **保留策略自己判定"可删"的那批**（7 天前、未读、未标记、非精选，池 34,435，随机抽 3,033）。
> 语料只取 title+summary（**绝不取 `content_html`** —— 那列 587 MB，见 `docs/eval/2026-09-24-turso-read-amp.md`），落在 `data/prescreen-lab/corpus.jsonl`（不进 git）。
> 复现：`node tools/_probe-behavior-corpus.cjs`（需 `NODE_PATH=…/node_modules node --env-file=.env`）→ `node tools/eval-prescreen-behavior.cjs`（纯本地，4 秒，零网络零模型）。

### 一、三条设计各自的答案（AUC 带 95% 自助区间；工作点＝"砍掉全池 X%"）

| 设计 | NB | 互补 NB | TF-IDF 质心 | 长度单特征（对照） | 随机（地板） |
|---|---|---|---|---|---|
| **D1** 五折分层 CV，正样本含"精选"（＝蒸馏现有 AI 初筛） | .919[.91,.93] | .918[.91,.93] | .903[.89,.92] | .715 | .500 |
| **D2** 训练侧**完全不含**你读过的那批，测试＝你读过的 246 篇 + 另一半未读（标题+摘要） | **.708[.68,.75]** | .706[.67,.75] | .663[.63,.69] | .480[.43,.52] | .500[.44,.52] |
| **D3** 同 D2，特征**只用标题**（排除"有没有 AI 摘要"的风格泄漏） | .705[.67,.74] | .707[.67,.74] | .668[.63,.70] | .546[.50,.59] | .500 |

误砍率（被砍掉的量 ÷ 全部正样本）在同一批数上：

| 设计/臂 | 砍 25% 时 | 砍 50% 时 | **误砍 ≤3% 时最多能砍** | 误砍 ≤5% 时最多能砍 |
|---|---|---|---|---|
| D1 NB / TF-IDF | 2.9% / 2.7% | 8.7% / 9.9% | 25% | 30% |
| **D2 NB** | 10.6% | 26.4% | **10%** | 15% |
| **D3 TF-IDF** | 7.7% | 26.8% | **10%** | 15% |
| D3 CNB | 9.3% | 28.0% | 10% | 15% |
| 长度单特征 | **40.2%**（D2）/ 22.8%（D3） | 52.4% / 48.4% | **0%** | 0% |
| 随机 | 24.4% | 54.9% | 0% | 5% |

### 二、结论（直接回答"干掉的是我要的还是垃圾"）

1. **信号是真的，而且不是"穿了统计外衣的长度规则"**：D2/D3 三臂 AUC 的 95% 区间下界（.63~.68）与长度对照的区间上界（.52/.59）**不重叠**，也与随机分开。这条同时**复现了本文件上一节的读数**：长度规则在 246 篇真读过的条目上误砍 **40.2%**，与之前独立算出的 40.2% 一字不差（两条不同代码路径撞同一个数 → 互证）。
2. **但可上线的工作点比想象的窄得多**：把"误砍 ≤3%"当约束，能砍的只有池子的 **10%**（≤5% 时 15%）；要像初筛层那样砍 50%，就会连带干掉你**读过的条目里约四分之一**（26.4%~28.0%）。
   ⇒ **采用的形态**：当作**兜底排序 + 只砍最底一段**（例如池子超配额时优先牺牲最低分的 10%）是站得住的；当作"替代 AI 初筛的主力削减层"**不成立**。省下的模型调用也就 10% 量级（一夜 337 次里约 30 次），换不回"少一次深析"的风险。
3. **D1 那个 0.919 不许当成绩**：正样本里的"精选"本来就是**现在这套 AI 判分挑出来的**，用 D1 打分等于"问模型它自己会怎么选"。真答案只在 D2/D3（训练侧没见过你读的那批）。D1 与 D2 之间 0.21 的 AUC 落差，就是"AI 的口味"与"你的行为"之间的距离 —— 这个数字本身值得留：它说明**当前 AI 精选与你实际阅读之间，还有一段可以被学习的差**。
4. **三臂之间不必再选**：NB / 互补 NB / TF-IDF 在 D2/D3 上统计上不可分（区间互相覆盖，工作点也一样）。所以"用哪个模型"是伪问题，**瓶颈在标签量与标签口径**，不在模型族。
5. 与 44 号 spec 步2 的关系：**形态类规则**（0 误砍 / 246，见上一节 R1~R3）先上；**统计臂按本节的"≤10% 兜底段"口径**接在形态规则之后；两者都不改每源配额那条覆盖刀。

### 三、这一轮顺手抓出来的一个真 bug（脚手架自己的）

`tools/eval-prescreen-learning.cjs` 的**互补 NB 臂符号写反了**（原注释写着"CNB 取 argmin：补集代价小的一侧胜出"，实际 CNB 的类分是"与其它类的距离之和"，**越大越像本类**，该取 argmax）。
证据不是推导而是实测：接行为标签后该臂 **AUC=0.082**（比随机 0.5 低一大截＝系统性反向），改号后 **AUC=0.918/0.706**（D1/D2）。
⇒ **本文件头部那句「合成 12 条上多项式 NB 全判'砍'、互补 NB 全判'留'，只有 TF-IDF 质心两向都有错 → 几十条标注的量级下 NB 家族不可信」现在只剩一半成立**：
"互补 NB 全判留"里有**实现反号**的成分，不能全记在小样本头上（原句按 §2.4 保留不删，在此标注作废范围）。
"多项式 NB 的长度偏置"那条仍然成立 —— 三臂的分数口径现在统一成"越高越该留"，判定与阈值扫描共用一份。

### 四、这套数不能证明什么（先把边界说完）

- 负样本是**行为代理**：「7 天前未读未标记」包含"你根本没时间点开"的好文章，所以"漏砍率/挡对率"整体偏悲观，误砍率才是主判据。
- 测试侧正样本只有 246 条 → 工作点上的百分比是 1~2 条的粒度（10% 误砍 ≈ 25 条，3% ≈ 7 条）；**要拍板上限，还得这份表被逐行勾完**（那 53 行是"你没读过的样本长什么样"的唯一直视图）。
- 抽样把类别比固定成 1:3，线上池子的正率更低 → 百分比可看，绝对条数要按真实池重算。
- 语料只含标题+摘要，与线上初筛给模型的输入同形，**不含正文**：正文侧信号（本系统真正的体积大头）这一轮没有评。
