# 03 - 公众号走托管 RSS 决策

> 类型：已确定（短期不变）
> 生效日期：2026-09-04
> 决策人：用户拍板

## 背景

公众号采集曾经历两代方案：自建 we-mp-rss（Python 子进程 + 微信读书 Cookie）和 wechat2rss 托管 RSS。需要确定长期方案。

## 选项对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| 自建 we-mp-rss | 完全自控 | 太重、Python 子进程维护成本高、Cookie 失效频繁 |
| **wechat2rss 托管 RSS** | 零维护、稳定 | 单点依赖（img-proxy）、缺失 28 个源 |

## 最终选择

**公众号走 wechat2rss.bestblogs.dev 托管 RSS**，不自建引擎。375 个公众号源以 type='rss' 导入。

## 理由

1. we-mp-rss 自建引擎太重（Python 子进程 + 微信读书 Cookie 管理）
2. wechat2rss 提供稳定 RSS 输出，正文在 content:encoded
3. 图片由对方 img-proxy 代理（单点依赖，已知情接受）
4. 缺失的 28 个原 wemp 源接受损失

## 影响范围

- we-mp-rss 代码移 trash/，全部退役
- .env 的 WEMP_* 变量全部失效可删
- 旧 65 个 wemp 源 enabled=0（历史文章保留）
- 公众号源统一走 RSS 适配器
