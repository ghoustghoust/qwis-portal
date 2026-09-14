# 视频/播客上榜可播放（31-media-playback）

> **状态：✅ 已实施（2026-09-14，commits 09576cc/e72e22d/d799d86）**——总 spec 见 `../26-platform-ia-refactor.md`。
> 落地形态：云端补齐 `/api/videos/:id`、`/play`（YouTube/B站官方 embed）、`/favorite`；播客 enclosure 音频归位 `audio_url`（lib/media.js）并入视频板块（🎧 卡 + 图片+声音播放页）；日报/我的早报新增「视频与播客」栏（窗口内新媒体免 AI 直列）；QuickStudyModal 视频 embed/播客 audio 可播放。
> 确认后按 mew-spec 四件套（spec/plan/task/checklist）补全再实施。

## 开发什么

早报/我的早报/周报中的视频条目可播放（YouTube 外链或内嵌播放器）；播客条目提供音频播放器（RSS enclosure audio 字段，68 播客源均为标准播客 RSS）；参考阅读器的视频播放交互。

## 为什么需要

用户要求视频/播客能上榜且可播放；现状视频只有影视飓风能看（云端无 Playwright 解析直链），播客只以文章形态存在无音频。

## 实现目标

上榜视频/播客：视频=外链或嵌入播放；播客=页面内音频播放器；不依赖云端 Playwright（架构决策不变）。

## 验收效果

①早报视频条目可跳转/嵌入播放 ②播客条目页内可播（enclosure）③无 enclosure 的条目回退外链 ④youtube shorts 类错误条目不再入文章流（配合 B6）

## 设计参考图片

无

## 规模与依赖

中
