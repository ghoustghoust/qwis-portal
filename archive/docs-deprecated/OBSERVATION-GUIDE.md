# 本地观察指南 - P0+P1+P2 修复验证

## 🎯 目标
在正式部署到服务器前，先在本地运行 3-7 天，验证以下关键功能：

### ✅ 核心验证点
1. **P0 鉴权保护** - 所有 API 是否正确拦截未授权请求
2. **P1 全文补抓** - 每日凌晨 2 点是否自动补抓短内容文章
3. **P1 Cookie 续期** - we-mp-rss Token 是否正常刷新
4. **P2 日志脱敏** - 敏感信息是否被正确掩码
5. **P2 海外源增量** - YouTube/无 ETag 源是否正确过滤旧内容

---

## 🚀 启动步骤

### Step 1: 清理环境（可选）
```powershell
cd "d:\全网情报系统"
# 备份当前数据库
Copy-Item data/app.db data/app.backup.$(Get-Date -Format 'yyyyMMdd-HHmmss').db

# 清空日志（便于观察）
Remove-Item data\logs\*.txt -ErrorAction SilentlyContinue
Remove-Item data\logs\*.log -ErrorAction SilentlyContinue
```

### Step 2: 启动主服务
```powershell
# 方式 A: 正常启动
npm start

# 方式 B: 后台运行（推荐用于长期挂机）
Start-Process powershell -ArgumentList "cd 'd:\全网情报系统'; npm start" -WindowStyle Minimized
```

### Step 3: 启动监控器（双进程并行）
```powershell
# 打开新的 PowerShell 窗口
cd "d:\全网情报系统"
node monitor-local.js

# 或者后台运行
Start-Process powershell -ArgumentList "cd 'd:\全网情报系统'; node monitor-local.js" -WindowStyle Minimized
```

---

## 📊 观察要点

### 每小时检查一次（手动或自动）

#### 1. 查看监控日志
```powershell
Get-Content "data\logs\monitor-log.txt" -Tail 20
```

**正常输出示例**：
```
[2026-09-01T08:15:00.123Z] [健康检查] 文章总数：9611, 短内容待补抓：9611
[2026-09-01T08:15:00.456Z] [健康检查] 启用源数：25
[2026-09-01T08:15:01.789Z] ✅ we-mp-rss 服务在线 (http://127.0.0.1:8001)
```

**异常信号**：
- ⚠️ `pending_items 积压 > 100` → 聚合源富化延迟
- ⚠️ `连续失败 ≥2 次的源 > 3` → 某些 RSS 源可能失效
- ❌ `we-mp-rss 服务不可达` → 公众号采集引擎崩溃

#### 2. 查看主服务日志
```powershell
Get-Content "data\logs\app.log" -Tail 50 | Select-String "全文补抓|RSS 增量|Auth"
```

**期望看到的关键日志**：
```
[全文补抓] 定时任务已注册：每天凌晨 02:00
[RSS 增量] YouTube 频道：无 ETag 源，根据 pubDate 过滤掉 15 条旧文章
[Auth] 登录成功：user=admin
```

#### 3. 测试鉴权拦截
```powershell
# 尝试访问受保护接口（应该返回 401）
$ErrorActionPreference = "Continue"
Invoke-WebRequest -Uri "http://localhost:3000/api/sources" -SkipCertificateCheck | Select-Object -ExpandProperty StatusCode
# 预期输出：401

# 测试登录（应该返回 token）
$body = @{ username="admin"; password="admin123" } | ConvertTo-Json
$res = Invoke-WebRequest -Uri "http://localhost:3000/api/auth/login" -Method POST -Body $body -ContentType "application/json" -SkipCertificateCheck
$data = $res.Content | ConvertFrom-Json
$data.token.Substring(0, 50) + "..."
# 预期输出：eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## 🔍 每日关键时间点

### 凌晨 02:00 - 全文补抓触发
**观察命令**：
```powershell
Get-Content "data\logs\app.log" | Select-String "全文补抓" -Context 2,2
```

**正常输出**：
```
[2026-09-01T02:00:00.123Z] [INFO] [全文补抓] 定时任务触发
[2026-09-01T02:00:00.456Z] [INFO] [全文补抓] 启动：发现 100 篇摘要文章需要补抓…
[2026-09-01T02:05:30.789Z] [INFO] [全文补抓] 完成：成功 85，失败 15，处理 100 篇
```

**异常情况**：
- ❌ 没有 `[全文补抓] 定时任务触发` → cron 任务未注册
- ❌ `失败 > 50` → 大量第三方网站反爬或网络问题

### 每 10 分钟 - wemp 心跳检测
**观察日志关键词**：
```
wempDown (服务宕机报警)
wempCookieExpired (Cookie 失效特征)
```

### 每次源刷新时 - ETag/增量判断
**YouTube/X 等海外源期望输出**：
```
[RSS 增量] https://www.youtube.com/...: 无 ETag 源，根据 pubDate 过滤掉 8 条旧文章
```

**有 ETag 的源期望输出**：
```
(no log needed - 304 短路不记录)
```

---

## 🛠️ 常见问题排查

### 问题 1: 鉴权拦截所有页面导致前端无法加载
**症状**: 浏览器控制台出现 `401 Unauthorized` 错误  
**原因**: 白名单路径配置遗漏  
**修复**:
```javascript
// server/middleware/auth.js
const WHITELIST_PATHS = [
  '/health',
  '/api/status',
  '/reader/',      // ← 读者前端
  '/daily/',       // ← 日报前端
  '/hot/',         // ← 热榜前端
  '/admin/',       // ← 管理后台
  '/wechat/',      // ← 微信公众号前端
];
```

### 问题 2: 全文补抓失败率过高
**症状**: `[全文补抓] 完成：成功 X，失败 Y` 中 Y > 30  
**原因**: 第三方网站反爬/网络不稳定  
**解决**:
1. 检查代理配置（HTTPS_PROXY）
2. 调整补偿频率（减少单次抓取数量）
3. 忽略特定域名（手动编辑 db）

### 问题 3: pending_items 积压严重
**症状**: 监控日志显示 `⚠️ pending_items 积压：200 条`  
**原因**: 聚合源富化速度慢于新增速度  
**解决**:
1. 增加并发度（修改 enrichMissing() 中的 GAP_MS）
2. 人工触发批量富化：
   ```javascript
   const { enrichMissing } = require('./server/services/aihot/enrich');
   await enrichMissing(50); // 一次性处理 50 条
   ```

---

## 📈 观察周期建议

### 短期观察（1-3 天）
- ✅ 确认鉴权拦截正常工作
- ✅ 确认 we-mp-rss 心跳检测正常
- ✅ 确认日志脱敏生效

### 中期观察（3-7 天）
- ✅ 等待至少一次完整轮值的全文补抓（必须经历凌晨 02:00）
- ✅ 验证 YouTube 等海外源的增量过滤效果
- ✅ 检查 pending_items 队列稳定性

### 长期观察（7 天以上）
- ✅ 评估数据质量改善程度（对比补抓前后的 content_html 长度分布）
- ✅ 统计源失败率变化趋势
- ✅ 确定生产环境部署参数（如 HEALTH_CHECK_WARMUP_MIN）

---

## 🎯 通过标准

如果观察到以下情况，说明系统稳定，可以部署到服务器：

### ✅ 合格标准
1. **鉴权**: 所有 /api/* 接口（除 login 外）都返回 401 未授权
2. **全文补抓**: 单轮成功率 > 70%，且补抓后文章平均长度增长 > 20%
3. **wemp 心跳**: 无持续性的 wempDown/wempCookieExpired 报警
4. **日志脱敏**: 敏感字段（token/key/password）都被替换为 ***
5. **海外源增量**: YouTube 源每次只获取 0-5 条新视频（说明过滤有效）

### ❌ 不合格标准（需修复后再部署）
- 鉴权绕过（部分 API 可无 token 访问）
- 全文补抓失败率 > 50%（持续 3 轮以上）
- wemp 服务频繁崩溃（每小时重启 > 1 次）
- pending_items 无限累积（超过 500 条）

---

## 🚀 下一步行动

### 如果全部正常
→ **立即执行生产部署**（使用 PM2 + Nginx）

### 如果发现小问题
→ **修复后继续观察 24 小时**

### 如果发现严重 bug
→ **回滚代码 + 提交Issue + 重新测试**

---

## 💡 提示

1. **不要关闭两个进程**: 主服务 (`npm start`) + 监控器 (`node monitor-local.js`)
2. **定期查看日志**: 每天花 2 分钟 `tail -f data/logs/*.txt`
3. **截图留存**: 对关键指标（如补抓成功率）做截图记录
4. **时间同步**: 确保系统时间是正确的（否则 cron 不会触发）

祝你观察顺利！🎉
