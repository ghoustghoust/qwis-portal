# 源四轴语义迁移（27b-source-axes）

> **状态：✅ 已完成 2026-09-15**（commit `f338ac1`+`83db503`）——四轴列 spotlight/muted/reader_visible + settings subscription.ids；生产 Turso schema-first 迁移（8 个 focus 源行为不变）；focus 列物理保留、代码引用清零（验收③达成）；tests/source-axes.test.js 锁四轴互不影响（验收④）。

## 开发什么

拆开 focus 一字段四职：上架(enabled)/收录(readerVisible 新)/订阅(subscription.ids)/重点(spotlight 原 focus 瘦身)/屏蔽(muted 新)；源库四轴批量操作；focus=1 一次性迁移为 spotlight+订阅集。

## 为什么需要

focus 身兼四职（早报订阅/重点栏/smart加权/星标）导致前台后台都不知所措——功能没拆开又在并用。

## 实现目标

每轴一个控件只管一件事；早报中心=订阅/重点唯一策展入口；源库只管轴状态与批量调整。

## 验收效果

①迁移后我的早报/重点栏/smart 排序行为与迁移前一致 ②源库可对组批量设各轴 ③focus 字段退役且无引用残留 ④回归测试锁死四轴互不影响

## 设计参考图片

无

## 规模与依赖

中（核心）
