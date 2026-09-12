# B站采集移植 runner（21-bilibili-runner）Plan

## 架构概览

```
runner collect（每 15min，到期驱动）
  └─ getAdapter('bilibili') → api/_bilibili.js
       ├─ reqCookie(): Turso credentials.bilibili → 匿名 buvid(spi, 1h 缓存)
       ├─ getWbiKeys(): nav 接口取密钥（30min 缓存 + -403/-799 强刷重试）
       ├─ fetchViaWbi（主链 arc/search 签名）
       ├─ fetchViaFallback = fetchViaSeries + fetchViaSearch（兜底合并去重）
       └─ → saveVideos(sourceId, videos)：INSERT OR IGNORE videos
Vercel: GET /api/sources/bilibili-diagnose（诊断三态）
```

## 核心数据结构

### videos 表写入（已有表，本地同构）
`source_id, title, url, vid, cover, duration, author, intro, published_at, created_at`——vid 唯一去重（INSERT OR IGNORE 依赖 videos.vid 唯一索引，迁移时确认/补建）

### api/_bilibili.js 接口（移植清单）
```
reqCookie()            credentials 表 → 匿名 buvid
getWbiKeys(force)      nav → mixinKey（30min 缓存）
signWbi(params, key)   MD5 签名（混淆表逐字复制）
fetchBiliVideos(source) → { videos: [...] }  三链路主备
diagnose()             Cookie/wbi/登录态三态
```

## 模块设计

### api/_bilibili.js（新建，~200 行）
- 自含 fetchJson（UA + Referer + Cookie 头，AbortSignal 10s）
- 逐字移植：MIXIN_KEY_ENC_TAB / signWbi / parseDuration / stripEm / 三链路 fetch
- 差异：db 走 Turso；无 util/http 代理层（runner 直连）；无 util/log（console）

### tools/collect-turso.js 接入
- `UNSUPPORTED_TYPES` 移除 bilibili（保留 wemp/douyin）
- `getAdapter('bilibili')` → `{ fetch: (source) => require('../api/_bilibili').fetchBiliVideos(source) }`
- `saveVideos(sourceId, videos)`：batch INSERT OR IGNORE；统计 videos 新增数
- collectOne 的 bilibili 分支：返回值 {videos} 走 saveVideos，{articles} 走 saveArticles（适配器返回结构区分）

### api/[...slug].js 诊断端点
- `GET /api/sources/bilibili-diagnose` → _bilibili.diagnose()
- 需鉴权（默认非公开）

### videos.vid 唯一索引迁移
- collect-turso.js 启动迁移：`CREATE UNIQUE INDEX IF NOT EXISTS idx_videos_vid ON videos(vid)`（try/catch）

## 模块交互

```
cron → collect → 到期 bilibili 源 → _bilibili 三链路 → videos 表 → /api/videos → 前端视频流
管理台 B站 Tab → bilibili-diagnose → Cookie 状态可视
```

## 文件组织

```
api/_bilibili.js                    — 新建：Turso 版 B站采集器
tools/collect-turso.js              — bilibili 接入 + saveVideos + vid 索引迁移
api/[...slug].js                    — 诊断端点 + 路由
tests/regression-bilibili.test.js   — 新建
docs/ 同步（HANDOVER/FEATURE_MATRIX/ISSUES 核销/changes）
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 独立文件而非塞进 catch-all | api/_bilibili.js | 与 _classify/_alerts 同模式，双端对照防漂移 |
| 无 Cookie 降级 | 匿名 buvid + 免登录链路 | B站源无 Cookie 也能跑通合集/搜索 |
| vid 去重 | UNIQUE 索引 + INSERT OR IGNORE | AC2 硬保证 |
| 播放直链 | 不移植 | 登录态强依赖（N3） |
