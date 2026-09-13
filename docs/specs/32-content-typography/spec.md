# 内容排版渲染（32-content-typography）

> **状态：草案（未开工）**——总 spec 见 `../26-platform-ia-refactor.md`（四层信息金字塔/源四轴模型）。
> 确认后按 mew-spec 四件套（spec/plan/task/checklist）补全再实施。

## 开发什么

编辑综述/编辑导语/周报注脚/文章摘要的 markdown 渲染：加粗、重点标注、分段结构保留（AI 输出的 markdown 不再被纯文本化）。

## 为什么需要

用户反馈"文章没有排版，加粗，标注重点等文章符号"——AI 输出的强调结构在渲染层被剥掉。

## 实现目标

综述与导语的加粗/重点在页面上可见；XSS 防护不放松（sanitize 后渲染）。

## 验收效果

①editorNote/导语中 **加粗** 渲染为粗体 ②sanitize 白名单含 b/strong/em/mark ③XSS 用例通过 ④纯文本旧数据渲染不变

## 设计参考图片

无

## 规模与依赖

小
