# 立即行动：配置 we-mp-rss 公众号订阅

## 🔍 问题诊断

从你的截图可以看到：**we-mp-rss 的消息任务列表为空**！

```
消息任务列表
[空空如也]
```

这意味着 weread（微信读书）通道**根本没有订阅任何公众号**，所以无法抓取文章！

---

## ✅ 解决方案（按顺序执行）

### Step 1: 登录 we-mp-rss 管理台

打开浏览器访问：`http://127.0.0.1:8001/admin`

你会看到需要扫码登录微信读书账号。

---

### Step 2: 扫码登录微信读书

1. 点击"登录"按钮
2. 使用微信扫描二维码
3. **确保扫描后的账号能看到量子位的公众号**

**注意**: 微信读书的账号需要关注过目标公众号才能采集其文章！

---

### Step 3: 添加量子位到订阅列表

登录后，进入"订阅管理"页面：

1. 访问 `http://127.0.0.1:8001/subscribe-manage`
2. 搜索 "量子位"
3. 点击"添加到订阅"或类似按钮
4. 确认订阅成功

或者使用 API 直接添加：

```powershell
curl.exe -X POST "http://127.0.0.1:8001/api/subscriptions" ^
  -H "Content-Type: application/json" ^
  -H "Authorization: Bearer YOUR_SECRET_KEY" ^
  -d "{\"name\":\"量子位\",\"account_id\":\"MP_WXS_3236757533\"}"
```

---

### Step 4: 验证订阅生效

访问 `http://127.0.0.1:8001/message-tasks` (你刚才截图的页面)

应该能看到类似：

```
消息任务列表
┌─────────────────────┬─────────────┬──────┬────────┬────────┐
│ 名称                │ Cron 表达式 │ 类型 │ 状态   │ 操作   │
├─────────────────────┼─────────────┼──────┼────────┼────────┤
│ 公众号定时采集 - 量子位 │ */30 * * * * │ RSS  │ 启用    │ 编辑 测试│
└─────────────────────┴─────────────┴──────┴────────────────┘
```

---

### Step 5: 手动触发一次采集

在任务列表中点击"执行"按钮，或者通过 API：

```powershell
curl.exe -X POST "http://127.0.0.1:8001/api/tasks/run?source_id=3236757533"
```

等待 1-2 分钟后检查 Feed API：

```powershell
curl.exe "http://127.0.0.1:8001/feed/MP_WXS_3236757533.atom?limit=20" | Select-String '<title>|<updated>'
```

---

### Step 6: 主系统重新抓取

we-mp-rss 更新后，主系统会在下一轮 tick() 自动抓取：

```powershell
# 强制刷新 quantum-bit 源
curl.exe -X PUT "http://localhost:3000/api/sources/30/fetch"
```

---

## 📋 快速诊断清单

如果上述步骤后仍然没有新文章，检查以下事项：

### 1. 确认微信读书账号能访问量子位

```powershell
# 在浏览器访问 https://weread.qq.com/web/topic/articleList/xxx
# 替换 xxx 为量子位的 weread ID
# 如果打不开，说明 weread 通道被封禁/限流
```

### 2. 检查 weread API 连通性

```python
# Python 环境下执行
import requests
r = requests.get('https://weread.qq.com/web/user')
print(r.status_code, r.text[:200])
```

如果返回非 200，说明 weread 服务不可达。

### 3. 查看 we-mp-rss 日志

```powershell
Get-Content D:\tools\we-mp-rss\data\*.log -Tail 50 | Select-String "error|fail|exception"
```

### 4. 替代方案：使用官方 RSS

如果 weread 通道彻底失效，可以改用量子位的官方 RSS：

```sql
-- 修改 source 配置
UPDATE sources SET 
  url = 'https://qbitai.com/feed/',
  type = 'rss'
WHERE name LIKE '%量子位%' AND id = 30;

-- 重调度
node -e "const s=require('./server/services/scheduler');s.reschedule();console.log('Rescheduled!');"
```

---

## ⚠️ 常见错误处理

### 错误 1: 二维码过期/无效

**原因**: we-mp-rss 启动时生成的 .secret_key 文件可能过期  
**解决**: 
```powershell
del D:\tools\we-mp-rss\data\.secret_key
.\restart-server.bat  # 重启后生成新的密钥
```

### 错误 2: weread 账号被风控

**症状**: 扫描成功后无法看到公众号列表  
**原因**: 微信对频繁扫码/爬取行为有限制  
**解决**: 
- 等待 24h 后重试
- 尝试在其他网络环境下操作
- 考虑使用备用 weread 账号

### 错误 3: 订阅添加失败

**原因**: we-mp-rss 数据库损坏或连接异常  
**解决**:
```powershell
cd D:\tools\we-mp-rss
sqlite3 data/db.db "SELECT * FROM subscriptions;"  # 检查是否有数据
# 如果没有数据，手动插入：
sqlite3 data/db.db "INSERT INTO subscriptions (name, account_id) VALUES ('量子位', 'MP_WXS_3236757533');"
```

---

## 🎯 最终验证

完成所有步骤后，应该看到：

1. **we-mp-rss 订阅列表有量子位** ✓
2. **Feed API 返回最新文章** ✓
3. **主系统 articles 表有新文章** ✓
4. **前端显示"具身大脑""gpt-6"等文章** ✓

```powershell
# 完整验证脚本
node tools/.verify-restart-diagnostic.cjs
```

预期输出：
```
Latest pubDate: 2026-09-03T10:XX:XX.ZZZ
✅ NEWEST ARTICLE IS RECENT (<24h) - FEED FETCH IS WORKING
Frontend should show article with pubDate: 2026-09-03T10:XX:XX.ZZZ
```

