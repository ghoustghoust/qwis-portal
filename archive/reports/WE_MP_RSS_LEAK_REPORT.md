# 公众号漏抓文章根因诊断报告

> **诊断时间**: 2026-09-03 12:00 +0800  
> **用户报告**: "左侧阅读器只显示'机器人 Demo'，右侧微信公众号还有'具身大脑''0.25s'sgpt-6'等多篇文章未展示"

---

## 🔍 一、关键事实对比

### 1.1 数据库实际状态 (source_id=30)

| 排名 | 标题 | published_at | created_at | 延迟 | 内容长度 |
|------|------|--------------|------------|------|----------|
| 1 | **今年最难的机器人 Demo** | 09-03 09:23 | 09-03 10:39 | 76min | 29 (纯摘要) |
| 2 | "没有 Token 的 CS 学生" | 09-01 17:23 | 09-01 17:24+8h | 481min | 103296 (全文) |
| 3 | 3 秒出片比播放还快... | 09-01 09:23 | 09-01 09:36 | 13min | 39 (摘要) |
| 4 | A 社化身 A 割!Claude 提额 25% | 08-30 12:07 | 08-30 12:46 | 39min | 58836 (全文) |
| 5 | 去年归国的徐梦迪... | 08-29 14:07 | 08-29 16:10 | 1227min | 25 (摘要) |
| 6 | Agent 业务半年进账近 5 亿 | 08-28 10:07 | 08-28 12:33 | 147min | 52 (摘要) |
| 7 | 我的自媒体搭子太能卷 | 08-28 04:01 | 08-28 07:08 | 187min | 75899 (全文) |

**总计**: 7 篇文章，其中 4 篇有全文，3 篇只有摘要

### 1.2 Feed API 响应

```
http://127.0.0.1:8001/feed/MP_WXS_3236757533.atom?limit=50
```

**实际返回**: 6-8 篇文章（最新为"机器人 Demo"pubDate=09-03 09:23）

### 1.3 微信公众号实际内容（用户截图）

**今天发布的文章**:
- ✅ "今年最难的机器人 Demo"（已在 DB）
- ❌ "具身大脑进了真实世界..."（未入库）
- ❌ "0.25 秒识破未见攻击..."（未入库）
- ❌ "神秘具身团队又放出..."（未入库）
- ❌ "TwinDEX 模型"相关（未入库）
- ❌ "GPT-6"Astra 能力公开..."（未入库）
- ❌ "企业级 Agent 落地有样板问!"（未入库）
- ❌ "李飞飞发布：全球首个多模态世界模型"（未入库）

---

## 🎯 二、问题根因定位

### 2.1 核心矛盾

| 维度 | 事实 | 推论 |
|------|------|------|
| **微信公众号** | 已发布至少 8 篇今天（9/3）的文章 | we-mp-rss 应该抓取 |
| **we-mp-rss Feed** | 只返回 6-8 篇，**没有今天的其他文章** | **we-mp-rss 采集失败** |
| **本地数据库** | 只有"机器人 Demo"一篇文章来自今天 09:23 | feed 漏抓导致 DB 漏入库 |
| **前端显示** | 只显示了 1 篇今日文章 | 因为后端只入库了 1 篇 |

### 2.2 根本原因：**we-mp-rss 微信读书通道失效**

**证据链**:
1. we-mp-rss 使用 weread（微信读书）API 采集公众号文章
2. weread 通道可能的问题：
   - 账号过期/登录失效
   - 订阅列表被微信官方拉黑/限流
   - weread API 接口变更
   - 网络代理问题（需要海外节点访问 weread）
   
3. **最关键证据**: 
   - `wemp.log` 最后更新时间是 9/2 19:30，距今已经**超过 16 小时无新日志**
   - 这意味着 we-mp-rss 可能根本没有运行！

### 2.3 验证假设

让我们检查我们 mp-rss 的实际工作状态：

```powershell
# 检查进程
Get-Process python -Id 3500 | Select-Object Id, StartTime

# 检查端口监听
netstat -ano | findstr ":8001"

# 查看最新日志
Get-Content data\logs\wemp.log -Tail 100
```

**预期发现**: 
- we-mp-rss 可能在昨晚崩溃后自动重启了
- 但 weread 通道的订阅/翻页逻辑失效，导致无法获取最新文章

---

## 🛠️ 三、修复方案

### 3.1 立即行动：手动触发一次全量抓取

#### 方法 1: 通过管理后台手动刷新（推荐）

```powershell
# 在浏览器打开 http://localhost:3000/admin
# 找到量子位源 (ID=30)
# 点击"手动刷新"按钮
# 这会触发一次强制 fetchSource()
```

#### 方法 2: 调用 API 直接刷新

```powershell
curl.exe -X PUT "http://localhost:3000/api/sources/30/fetch"
```

这会立即触发调度器抓取 quantum-bit 的最新 feed。

### 3.2 深度修复：排查 we-mp-rss 状态

#### Step 1: 检查 we-mp-rss 是否正常运行

```powershell
# 进入 we-mp-rss 目录
cd D:\tools\we-mp-rss

# 查看进程日志
Get-Content logs/*.log -Tail 50 | Select-String "error|fail|exception"

# 测试 weread 登录状态
python tools/test_weread_login.py  # (假设有这个脚本)
```

#### Step 2: 重新登录微信读书账号

1. 访问 we-mp-rss 管理台：`http://127.0.0.1:8001/admin`
2. 退出当前账号并重新扫码登录
3. 确保能看到量子位的公众号订阅列表

#### Step 3: 检查 weread API 连通性

```python
# 在 we-mp-rss 目录执行
python -c "import requests; r = requests.get('https://weread.qq.com/web/bookshelf'); print(r.status_code)"
```

如果返回非 200，说明 weread 服务不可达。

### 3.3 长期优化：添加监控报警

建议添加以下检测项：

1. **每日文章数量监控**
   ```sql
   SELECT DATE(published_at) as day, COUNT(*) as cnt
   FROM articles WHERE source_id=30 GROUP BY DATE(published_at) ORDER BY day DESC LIMIT 7
   ```
   正常情况应该是每天 1-3 篇，如果某天为 0 则报警。

2. **Feed 新鲜度检测**
   ```python
   # 定时脚本
   curl http://127.0.0.1:8001/feed/MP_WXS_xxx.atom
   last_pub = parse_xml_updated()
   if datetime.now() - last_pub > 12h:
     send_alert("We-MP-RSS feed is stale!")
   ```

3. **同步延迟监控**
   - 记录 `created_at - published_at` 的差值
   - 如果超过 24h 则报警（可能 feed 漏抓）

---

## ✅ 四、临时解决方案（立即可用）

### 4.1 方式 1: 直接从官网 RSS 同步

如果 weread 通道彻底失效，可以改用官方 RSS：

1. **修改源配置**:
   ```sql
   UPDATE sources SET 
     url = 'https://qbitai.com/feed/',
     type = 'rss'
   WHERE name LIKE '%量子位%' AND id=30;
   ```

2. **重算间隔**:
   ```javascript
   // scheduler/index.js 会重新计算 next_fetch_at
   require('./server/services/scheduler').reschedule();
   ```

3. **验证效果**:
   ```powershell
   curl.exe "http://localhost:3000/api/articles?source_id=30&sort=new" | FindStr "robot|具身"
   ```

### 4.2 方式 2: 使用备用采集器（如有）

如果有其他公众号采集器（如爬虫方案），可以快速替换。

### 4.3 方式 3: 手动导入缺失文章

如果短期内无法修复 weread 通道，可以先手动补录：

```sql
-- 插入缺失的文章（需从微信公众号手动提取 URL 和摘要）
INSERT INTO articles (source_id, url, title, summary, published_at, created_at, content_html)
VALUES 
  (30, 'https://mp.weixin.qq.com/s/xxx', '具身大脑进了真实世界...', '摘要内容...', '2026-09-03T10:00:00Z', NOW(), ''),
  ...
;
```

---

## 📊 五、完整诊断总结

### 5.1 问题分级

| 问题 | 严重程度 | 影响范围 | 紧急修复难度 |
|------|----------|----------|--------------|
| **we-mp-rss weread 通道失效** | 🔴 高 | 所有 wemp 源漏抓 | 中（需重新登录 weread） |
| **前端未 rebuild** | 🟡 中 | 仅前端不显示 | 低（npm run build） |
| **全文补抓成功率低** | 🟢 低 | 部分文章只有摘要 | 中（需 fix_feed_retry 提升） |

### 5.2 优先级建议

1. **P0 (立即)**: 手动刷新 quantum-bit 源 → 触发 full re-fetch
2. **P1 (今天内)**: 检查并修复 we-mp-rss weread 登录状态
3. **P2 (本周)**: 添加 Feed 新鲜度监控报警
4. **P3 (长期)**: 实现多渠道采集冗余（weread + 直接爬取 + 官方 RSS）

### 5.3 下一步行动清单

```powershell
# Step 1: 手动触发刷新
curl.exe -X PUT "http://localhost:3000/api/sources/30/fetch"

# Step 2: 等待 5 分钟后检查
node -e "const{db}=require('./server/db');console.log(db.prepare('SELECT COUNT(*) as c FROM articles WHERE source_id=30 AND published_at >= datetime(\'now\', \'-1 day\')').get())"

# Step 3: 如果仍然为 0，登录 we-mp-rss 管理台重新扫码
# Step 4: 前端 rebuild（如果之前没做）
npm run build; .\restart-server.bat
```

---

## 🔗 附录：参考链接

- we-mp-rss 管理台：`http://127.0.0.1:8001/admin`
- 主系统管理后台：`http://localhost:3000/admin`
- 微信公众号官方 RSS：`https://qbitai.com/feed/`
- weread 文档：https://weread.qq.com/
