# B站采集移植 runner（21-bilibili-runner）Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `api/_bilibili.js` | Turso 版 B站采集器（wbi 三链路） |
| 修改 | `tools/collect-turso.js` | bilibili 接入 + saveVideos + vid 唯一索引迁移 |
| 修改 | `api/[...slug].js` | bilibili-diagnose 端点 + 路由 |
| 新建 | `tests/regression-bilibili.test.js` | 回归测试 |
| 修改 | docs 三件 | 文档同步 |

## T1: api/_bilibili.js

**文件：** `api/_bilibili.js`（新建）
**依赖：** 无
**步骤：**
1. 自含 fetchJson（UA/Referer/Cookie/10s 超时）+ Turso credentials 读取
2. 移植匿名 buvid（spi，1h 缓存）、getWbiKeys（30min 缓存+强刷）、MIXIN_KEY_ENC_TAB、signWbi、parseDuration、stripEm
3. 三链路：fetchViaWbi → fetchViaFallback（series+search 合并去重）
4. diagnose()：cookieConfigured / wbiKeyRefreshed / loginOk / uname / message

**验证：** `node --check` + 真实 UP 主手测（quota 无关，B站公开 API）

## T2: collect-turso.js 接入

**文件：** `tools/collect-turso.js`
**依赖：** T1
**步骤：**
1. UNSUPPORTED_TYPES 移除 bilibili
2. getAdapter 加 bilibili 分支
3. saveVideos(sourceId, videos)：batch INSERT OR IGNORE
4. collectOne 支持 {videos} 返回结构（计入 stats.videos）
5. 启动迁移：`CREATE UNIQUE INDEX IF NOT EXISTS idx_videos_vid ON videos(vid)`

**验证：** 本地跑 collect 只含 bilibili 源（COLLECT_LIMIT + type 过滤手动）

## T3: 诊断端点

**文件：** `api/[...slug].js`
**依赖：** T1
**步骤：**
1. GET /api/sources/bilibili-diagnose → _bilibili.diagnose()
2. 路由注册（需鉴权）

**验证：** T4 用例

## T4: 回归测试

**文件：** `tests/regression-bilibili.test.js`
**依赖：** T1-T3
**步骤：**
1. 用例：① signWbi 签名确定性（固定参数+key 产出固定 w_rid——与本地实现逐字比对） ② saveVideos 幂等（重复插入不重复） ③ diagnose 三态结构 ④ videos 列表接口可见新数据
2. 真实 B站 API 抽测 1 个知名 UP（网络允许时；失败跳过不阻断）

**验证：** 全绿

## T5: 文档 + 验收

**步骤：** docs 同步 → push → dispatch 观察 bilibili 源采集日志 → videos 表数据验证

## 执行顺序

```
T1 → T2 → T3 → T4 → T5
```
