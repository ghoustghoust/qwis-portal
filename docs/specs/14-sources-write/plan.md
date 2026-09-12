# 源写 API 上云（14-sources-write）Plan

## 架构概览

改动集中在两处：`api/[...slug].js` 新增 8 个 handler + 新建 `api/_classify.js`（classify.js 的 serverless 移植副本，纯函数+Turso 查询）。

```
管理后台 ──▶ api/[...slug].js dispatch
                ├─ handleSourceCreate    POST   /api/sources          (F1)
                ├─ handleSourceDelete    DELETE /api/sources/:id      (F2)
                ├─ handleSourceRefresh   POST   /api/sources/:id/refresh   (F3 标记到期)
                ├─ handleSourceRefreshAll POST  /api/sources/refresh-all   (F4)
                ├─ handleSourceInterval  PUT    /api/sources/:id/interval  (F5)
                ├─ handleSourcesBatch    POST   /api/sources/batch    (F6)
                ├─ handleAutoclassify    POST   /api/sources/autoclassify (F7)
                └─ handleGroupsWrite     POST/PUT/DELETE /api/groups* (F8)
                          │ 共用
                          ▼
                   api/_classify.js（分类目录/关键词兜底/落组/预览/执行）
                          │
                          ▼
                        Turso
```

## 核心数据结构

### api/_classify.js 移植清单（对齐 server/services/classify.js）
- `kindOfType(type)` → 'article'|'video'
- `CATALOG`（8 类目录，中英别名归一 + 关键词表，数组顺序即优先级——逐字复制本地）
- `classifySource(source)`（去 OPML 层级解析——云端无 OPML 文件，仅关键词路径）
- `getOrCreateGroupId(zh, kind)`（精确同名同 kind 复用）
- `autoClassifySourceId(id)`（新源挂接点，try/catch 降级）
- `previewReclassify({includeLocked, showAll})` / `applyReclassify(ids)`（dryRun/apply 语义）

### sources 表写入点
- 新增：`INSERT INTO sources(type,name,url,avatar,uid,extra,enabled,status,created_at) VALUES(...,1,'pending',now)`
- 解冻（batch enable）：`enabled=1, fail_count=0, status='ok', next_fetch_at=now+random(0,6h)`，extra 清 lastError
- 手动锁定：`extra.categoryLocked=1` 合并写（move 的汇聚点）

## 模块设计

### handleSourceCreate（F1）
1. url 必填校验；`SELECT id FROM sources WHERE url=?` 查重（N4 幂等）→ 已存在返回 200 + 已存在 item
2. type 判定：显式 type → 校验白名单（rss/wechat/x/youtube/hotlist/bilibili/douyin）；否则 URL 启发式：`bilibili.com`→bilibili、`youtube.com|youtu.be`→youtube、`hotlist://`→hotlist、`mp.weixin.qq.com`→wechat、其余→rss
3. name 缺省 = URL 主机名
4. 插入 + autoClassifySourceId（try/catch 降级）+ auditRecord('source.create')

### handleSourceDelete（F2）
batch 三删（articles/videos/sources by id）+ auditRecord('source.delete')

### handleSourceRefresh / handleSourceRefreshAll（F3/F4）
UPDATE next_fetch_at=NULL，返回 message「已标记立即到期，≤15 分钟由云端 runner 采集」

### handleSourceInterval（F5）
extra.intervalMin 合并写（null 删键）；正数校验；auditRecord('source.interval')

### handleSourcesBatch（F6）
actions: enable/disable/focus/unfocus/move；move 带 kind 校验 + categoryLocked；enable 走解冻+错峰；200 ids 上限（N1）；逐 id 收集 errors，部分成功语义（与本地一致）

### handleAutoclassify（F7）
dryRun → previewReclassify；apply → ids 必填 + applyReclassify；其余 400

### handleGroupsWrite（F8）
POST（kind 校验 article|video，sort=max+1）/ PUT /:id / DELETE /:id（组内源 group_id=NULL）/ POST /move（kind 校验 + categoryLocked）

## 模块交互

```
SourceLibraryTab/WechatTab/BilibiliTab/Sidebar → 8 handlers → Turso
新源/启用源 next_fetch_at=NULL 或错峰 → collect-turso.js（runner 每 15min）拾取
```

## 文件组织

```
api/_classify.js                    — 新建：classify.js serverless 移植（纯 async/Turso 版）
api/[...slug].js                    — 8 handler + 路由注册
tests/regression-cloud-sources.test.js — 新建：真实 handler 测试（test 源建后即删）
docs/HANDOVER.md                    — §3.4 补端点
docs/FEATURE_MATRIX.md              — P0-2 标完成
docs/changes/2026-09-12-sources-write.md — 变更记录
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 分类逻辑放独立文件 | `api/_classify.js` 而非塞进 catch-all | classify.js 233 行，独立文件便于与本地对照防漂移 |
| OPML 层级解析 | 云端省略（无 OPML 文件上下文） | 仅关键词路径，覆盖 95% 场景；spec「不做的事」已声明 |
| refresh 云端语义 | 标记到期而非同步抓取 | 10s 限制 + 防与 runner 并发双写（spec F3 已批准） |
| batch 上限 | 200 ids/次截断 | N1 的 10s 约束 |
| 测试 | 同 13 项模式：mock req/res 真实 handler + test 数据用后即删 | 已验证的模式复用 |
