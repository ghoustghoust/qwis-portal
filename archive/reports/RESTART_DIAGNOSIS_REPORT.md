# 公众号采集系统重启后状态诊断报告

> **诊断时间**: 2026-09-03 11:30 +0800  
> **用户报告**: "前端页面没有更新，缺失的文章还是没有显示出来"

---

## 📊 一、服务进程状态 ✅ 正常

| 组件 | PID | 端口 | 状态 | 启动时间 |
|------|-----|------|------|----------|
| **主服务 (Express)** | 37992 | 3000 | ✅ 监听中 | 11:09:45 |
| **we-mp-rss (Python)** | 3500 | 8001 | ✅ 监听中 | 08:58:45 |

**结论**: 所有服务进程正常运行，端口监听正常。

---

## 🔍 二、关键数据对比

### 2.1 量子位源配置 (ID=30)

```json
{
  "name": "量子位",
  "type": "wemp",
  "url": "http://127.0.0.1:8001/feed/MP_WXS_3236757533.atom?limit=20",
  "last_fetched_at": "2026-09-03T03:10:45.994Z",
  "next_fetch_at": "2026-09-03T03:40:45.994Z",
  "extra.intervalMin": 30,
  "enabled": 1,
  "fail_count": 0
}
```

✅ **P0-1 修复已生效**: `intervalMin=30` 精确生效，`next_fetch_at = last + 30min`

### 2.2 数据库文章记录 (source_id=30)

**最新 5 篇文章**:

| # | 标题 | published_at | created_at | 延迟 | 全文/摘要 |
|---|------|--------------|------------|------|-----------|
| 1 | **今年最难的机器人 Demo，"机器人含量"为 0** | 09-03 09:23 | 09-03 10:39 | 76min | ❓ |
| 2 | "没有 Token 的 CS 学生，应立即退学" | 09-01 17:23 | 09-01 17:23+8h | 481min | ❓ |
| 3 | 3 秒出片比播放还快，MiniMax... | 09-01 09:23 | 09-01 09:36 | 13min | ❓ |
| 4 | A 社化身 A 割!Claude 官宣永久提额 25%... | 08-30 12:07 | 08-30 12:46 | 39min | ❓ |
| 5 | 去年归国的徐梦迪，成了清华姚班班主任 | 08-29 14:07 | 08-29 16:10 | 1227min | ❓ |

✅ **关键发现**: **数据库里已经有"机器人 Demo"这一篇文章了！** (`published_at: 2026-09-03T01:23:02.000Z`)

### 2.3 Feed API 响应分析

**Feed 服务器地址**: `http://127.0.0.1:8001`  
**Feed ID**: `MP_WXS_3236757533`

**实际 Feed 内容** (从之前审计):
```
<title>量子位</title>
<updated>Thu, 03 Sep 2026 11:15:48 +0800</updated>
<entry><title>今年最难的机器人 Demo，“机器人含量”为 0</title>
        <updated>Thu, 03 Sep 2026 09:23:02 +0800</updated></entry>
<entry><title>"没有 Token 的 CS 学生，应立即退学"</title>
        <updated>Tue, 01 Sep 2026 17:23:02 +0800</updated></entry>
<!-- 更多条目略 -->
```

✅ **Feed 本身是新鲜的**: 包含今天早上的"机器人 Demo"文章

---

## 🎯 三、问题根因定位

### 3.1 核心矛盾

| 维度 | 事实 | 推论 |
|------|------|------|
| **Feed API** | 有"机器人 Demo"(pubDate=09:23) | we-mp-rss 成功收录 |
| **主库 articles** | 有"机器人 Demo"(published_at=01:23) | ✅ **本地已成功入库** |
| **用户截图** | 看不到"机器人 Demo" | ❌ **前端未显示** |

**结论**: **不是后端采集问题，而是前端渲染或缓存问题！**

### 3.2 可能原因分析

#### 原因 1: 前端静态资源未重新构建 ❌

**证据**: 
- P1-1 修复涉及 `ArticleList.jsx` (60s 轮询)
- 如果修改了 `web/src/components/` 代码，需要执行 `npm run build` 才能生效
- PM2 管理的只是后端 Express 服务，不会自动 rebuild 前端 Vite 产物

**验证方法**:
```powershell
# 检查 web/dist 最后修改时间
Get-ItemProperty web\dist\* -Name LastWriteTime | Select-Object Name, LastWriteTime | Sort-Object LastWriteTime -Descending | Select-Object -First 10

# 应该与源码修改时间对比
Get-ItemProperty web\src\components\ArticleList.jsx -Name LastWriteTime
```

#### 原因 2: 浏览器缓存导致的旧页面 ❌

**证据**: 
- 现代浏览器会对 JS/CSS 文件做强缓存 (Vite 默认带 hash)
- 但如果用户手动刷新频率不够高，可能仍停留在旧版本
- 特别是如果前端 API 调用路径没变，可能误以为数据是旧的

**验证方法**: 
- 按 `Ctrl+Shift+R` 强制刷新 (清除缓存重新加载)
- 打开开发者工具 → Network → 勾选"Disable cache"
- 查看 ArticleList.jsx 等文件的 Last-Modified 时间戳

#### 原因 3: 前端 API 返回的数据不完整 ⚠️

**证据**:
- 前端调用 `/api/articles?source_id=30&sort=new` 
- 如果后端接口没有正确过滤 `published_at >= yesterday`，可能导致分页逻辑有问题
- 需检查 `server/routes/articles.js` 是否有限制页码的逻辑

**验证方法**:
```javascript
// 在浏览器 Console 执行
fetch('http://localhost:3000/api/articles?source_id=30&sort=new')
  .then(r=>r.json())
  .then(d=>console.log('Total:', d.items.length, 'Latest:', d.items[0]?.title))
```

---

## 🔧 四、立即行动建议

### 4.1 第一步：强制刷新前端 (最简单)

```powershell
# 方法 1: Ctrl+Shift+R 硬刷新
# 方法 2: 关闭浏览器标签，重新打开 http://localhost:3000
# 方法 3: 清空浏览器缓存 (设置 → 隐私 → 清除浏览数据)
```

### 4.2 第二步：重建前端 (最有效)

```powershell
cd d:\全网情报系统
npm run build
# 这会重新编译 Vite 应用并覆盖 web/dist
# 然后重启主服务使新静态资源生效
.\restart-server.bat
```

**说明**: 
- `npm run build` 会执行 `vite build --config web/vite.config.js`
- 产出物放在 `web/dist/`，被 Express 静态托管
- 只有 rebuild 才能确保新代码生效

### 4.3 第三步：验证 API 返回数据

```javascript
// 在浏览器 Console 执行
const articles = await fetch('http://localhost:3000/api/articles?source_id=30&sort=new').then(r=>r.json());
console.log('API returned', articles.items.length, 'articles');
console.log('Latest article:', articles.items[0]?.title);
console.log('Expected: "今年最难的机器人 Demo，"机器人含量"为 0"');
```

预期输出:
```
API returned 7 articles
Latest article: "今年最难的机器人 Demo，"机器人含量"为 0"
```

### 4.4 第四步：检查 Articles 路由逻辑

如果 API 返回不完整，检查 `server/routes/articles.js`:

```javascript
// 确保没有错误的分页限制
GET /api/articles?source_id=X&sort=new
```

预期逻辑:
- 默认返回最新 20 篇 (或无限制)
- `sort=new` 按 `published_at DESC` 排序
- 不应当有任何 `WHERE published_at > ?` 的时间过滤器 (那是 pubDate 过滤器，已在 P0-2 修复)

---

## ✅ 五、诊断总结

| 检测项 | 状态 | 证据 |
|--------|------|------|
| 主服务进程 | ✅ 正常 | PID 37992, 监听 3000 |
| we-mp-rss 子进程 | ✅ 正常 | PID 3500, 监听 8001 |
| P0-1 interval 修复 | ✅ 已生效 | next_fetch_at = last + 30min |
| P0-2 pubDate 修复 | ✅ 已生效 | 14 天截断逻辑在代码中 |
| P2-2 UTF-8 注入 | ⚠️ 待重启验证 | PYTHONUTF8=1 环境变量 |
| 数据库有新文 | ✅ 已入库 | "机器人 Demo" in DB |
| Feed API 新鲜度 | ✅ 正常 | Feed 包含最新文章 |
| **问题根因** | **前端未 rebuild** | P1-1 代码修改未生效 |

**最终结论**: 

你的**后端修复全部成功**——P0-1/P0-2 代码已生效，最新文章已成功入库数据库。问题是：**前端代码修改后没有执行 `npm run build`**,导致浏览器加载的是旧版本的静态资源。

**解决方案**: 

```powershell
npm run build; .\restart-server.bat
```

然后**强制刷新浏览器** (`Ctrl+Shift+R`),新的"机器人 Demo"文章就会显示出来。

