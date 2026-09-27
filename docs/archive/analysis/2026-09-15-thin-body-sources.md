# 薄/空正文源普查（2026-09-15 v2 全量版，供取舍决策）

> v2 口径：全表聚合（不限时间窗、覆盖全部 1447 源）→ 薄率≥90% 且 ≥5 篇的粗筛 → 每源抽样 8 篇真实纯文本长度精测（≥7/8 薄才确认）。
> 比 v1（近 14 天 ≥10 篇）多抓到长尾小源：确认 96 个（v1 为 77 个）。
> ⚠️ 本清单仅供决策，未做任何删除。

## 总盘
- 源总数 1447；有文章的 1089；**从未产出文章 358**（rss 启用中 206 / rss 停用 61 / x 停用 31 / youtube 54 / bilibili 3 / douyin 1 / wemp 2）
- 确认薄/空正文 96 源：A 零内容 34 / B 仅链接占位 8 / C 摘要型 54
- 另有热榜/聚合类薄正文 17 源（设计态，无正文属正常，不在名单）

## A 类：零内容（抽样全空）——建议优先删除
**纯 RSS 死 feed（启用中，天天在采但全是空壳）**：
CNET #1467（36 篇全空）、Node.js Blog #799、ElevenLabs Blog #817、AIGC Weekly #1070、SUMSEC #1272、Simon Willison's Weblog #820（高声誉源，atom feed 本身就是空；可找替代 feed 再留）、Tripper Press #1141、安全客 #1063、CISA #1057、Shuibaco 水八口 #1118。

**YouTube 误写 articles 表（零正文，90 行与 videos 重复；大多数已停用）**——建议修适配器+清行，而非删源：
OpenAI #536、Chris Williamson #589、AI Engineer #509、Nikhil Kamath #570、The AI Advantage #542、Business Insider #555、Matthew Berman #532、Lenny's Podcast #604、Ryan Peterman #626、LangChain #526、The Diary Of A CEO #575、GitHub #622、AI Master #511、The PrimeTime #577、National Geographic #591、My First Million #568、mrblock #584、Core Memory Podcast #557、TED #597、Dwarkesh Patel #560、Silicon Valley Girl #572、Mind the Product #605、Theo-t3.gg #629、The Diary Of A CEO Clips #985。

## B 类：仅链接/元信息占位（实质 <30 字符）——建议删除或降级
| 源 | id | 形态 |
|---|---|---|
| Hacker News 官方 rss | 1133 | 正文=「Comments」链接（8 字符）|
| Lobsters | 1135 | 同上 |
| The latest research from Google | 991 | 只有分类名（~19 字符）|
| Arthur's Review | 1164 | 「转载自学院派Academia的视频」|
| Mox的笔记库 | 1243 | 标题残片 |
| Surmon.me | 1275 | 随机短句 |
| Fengc's Blog | 1166 | 只有「发布日期」|
| Release notes from codex | 1157 | 版本号一行 |

边缘（30-90 字符，实为导流/促销文案，精测划入 C 但建议按 B 看待）：BMPI #1386、柴郡猫 #1419、Innei #1217（往原址览之跳转链）、AAAS Science ToC #1076（期刊目录行）、ABB00717 #1109。

## C 类：摘要型 feed（有实质摘要，正文在源站）——不建议删除
54 源，含：36氪 #258（⚠️ 重点/订阅源）、HN Newest AI #1153 / LLM #1154、Al Jazeera、Phys.org、Engadget、NYT×4、BBC×2、Nature、Scientific American、蓝点网、Stack Overflow Blog、Cointelegraph、WSH、Redis、Elastic、Gino Notes、OpenAI Blog、Stripe、Databricks、Apple Newsroom、少数派、站长之家、FT中文网、张洪Heo、码录集、Phodal、keggin、Mokeyjay、枫林灯语、串串狗小刊、GISerlab、Jake blog、NPR×2、Washington Post、Good Good Good、Replicate、Cynical Developer、i食色摇闲情、晓空blog、蒙需、Spotify Engineering、顶尖研发、for_the_zero、Google DeepMind Blog #780（半空：13/20 空 + 短摘要，介于 A/C 之间）等。

## 重点/订阅集合交集（删前必看）
- **HN 首页 #70（spotlight+订阅）**：精测 12/12 全薄（127-202 字符链接列表；因 html 含长 URL 超过粗筛阈值未进名单，单独精测确认）。HN 本质是链接聚合无正文可给。建议保留（早报出标题+摘要即可），不接受再删。
- **36氪 #258（spotlight+订阅）**：摘要型可用，勿删。

## 另发现：358 个源从未产出文章
启用中的 rss 有 206 个零产出（大批小宇宙播客桥接源 + Qwen blog 等）。这些不产生内容也不制造污染，但占采集轮次配额。建议下一轮单独评估（播客桥是否该走 videos/podcast 通道）。

---

## 执行记录（2026-09-15 用户拍板后已落地）
- ✅ A 类 10 个死 RSS feed 已级联删除（CNET/Node.js/ElevenLabs/AIGC Weekly/SUMSEC/Simon Willison/Tripper Press/安全客/CISA/水八口），连带清掉 246 行零内容空壳文章
- ✅ YouTube 误写 articles 存量迁移：363 行 → 迁入 videos 90 行（90 行 videos 已有同 url 去重跳过；183 行为 shorts/无 ?v= 参数 url 无法提取 vid，随表清除——均为零内容行）+ articles 表 youtube 残留清零（videos youtube 总数 1718）
- ✅ 播客桥接源 65 个降频至 3 天（intervalMin=4320；小宇宙日更低频，用户口径）
- B/C 类未动（按用户取舍待定）；358 个零产出源（206 启用中 rss）留待下轮评估
