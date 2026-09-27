> ⚠️ **已废弃(2026-09-04)**:we-mp-rss 已退役,公众号改走 wechat2rss 托管 RSS(见 ARCHITECTURE.md §0/§8.2)。本文仅供历史参考。

# we-mp-rss 集成问题与解决方案

## ❌ 当前状态：假集成

### 问题描述
1. **硬编码 Windows 路径**  
   `server/services/wempSupervisor.js` L10: `'D:\tools\we-mp-rss'`
2. **外部进程 spawn（非模块集成）**  
   只是启动独立 Python 进程，并非 Node.js 模块化的真正集成
3. **跨平台不可用**  
   Linux 下 `.venv/Scripts/python.exe` 路径不存在

---

## ✅ 推荐方案对比

| 方案 | 优点 | 缺点 | 实施难度 | 推荐指数 |
|------|------|------|---------|---------|
| **A: Docker 容器化** | 跨平台、隔离性好、部署简单 | 需要安装 Docker | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **B: PHP 云端队列** | 符合项目架构、去本地依赖 | 需要云服务器运行 PHP | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| **C: 当前方案改进** | 无需重构代码 | 仍有路径依赖 | ⭐ | ⭐⭐ |

---

## 🚀 立即行动方案

### Step 1: 临时修复（已完成）✅
修改后的 `wempSupervisor.js` 支持：
- ✅ 环境变量 `WEMP_HOME` 配置
- ✅ 跨平台虚拟环境路径检测
- ✅ Linux/Mac 下自动切换到 `.venv/bin/python`

**使用方法**：
```bash
# 本地 Windows 开发（如果 D:\tools\we-mp-rss 已存在）
npm start  # 保持默认即可

# Linux 服务器部署
export WEMP_HOME=/opt/we-mp-rss
pm2 start ecosystem.config.js --name qw-server
```

### Step 2: 启用 PHP 云端队列（强烈推荐）✅

#### 前提条件
1. **云服务器已部署 PHP 队列服务**  
   - 访问 `https://api.qianmeng.news/wechat-rss-queue.php?token=xxx` 测试可达性
   - 确保 `cloud/token.json` 中的 Token 已生成

2. **`.env` 配置云端地址**
```bash
CLOUD_BASE_URL=https://api.qianmeng.news
API_TOKEN=<已脱敏-redacted-2026-09-04>
```

#### 改造步骤
修改 `server/services/collectors/wechat/index.js`：

```javascript
// server/services/collectors/wechat/index.js

const USE_CLOUD_QUEUE = !!process.env.CLOUD_BASE_URL;

async function syncOpml(url) {
  if (USE_CLOUD_QUEUE) {
    // 🚀 调用云端 PHP 队列服务
    const token = fs.readFileSync('cloud/token.json', 'utf8').trim();
    
    const response = await fetch(`${CLOUD_BASE_URL}/wechat-rss-queue.php`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ opml_url: url })
    });
    
    const result = await response.json();
    return result;
  } else {
    // 降级到本地模式（需手动安装 we-mp-rss）
    throw new Error('公众号采集需要在云服务器运行或使用 Docker');
  }
}
```

**效果**：
- ✅ 微信公众号 RSS 订阅 → 云端 PHP 队列 → Node.js 定时拉取
- ✅ 完全去除本地 Python 依赖
- ✅ 符合项目既有架构（已有 B 站/抖音队列）

---

## 🐳 Docker 部署方案（备选）

如果不想依赖云端队列，可以用 Docker 运行 we-mp-rss：

### Dockerfile.wechat
```dockerfile
FROM python:3.13-slim

WORKDIR /app

# 安装微信爬虫依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制源代码
COPY . .

# 暴露端口
EXPOSE 8001

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:8001/ || exit 1

CMD ["python", "main.py", "-job", "True"]
```

### docker-compose.yml
```yaml
version: '3.8'
services:
  wechat-engine:
    build:
      context: .
      dockerfile: Dockerfile.wechat
    container_name: wechat-engine
    ports:
      - "8001:8001"
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
    environment:
      - SECRET_KEY=${WEMP_SECRET_KEY}
      - WEMP_USERNAME=${WEMP_USERNAME:-admin}
      - WEMP_PASSWORD=${WEMP_PASSWORD:-admin@123}
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8001/"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
```

**启动命令**：
```bash
docker compose up -d
```

---

## 🔍 飞书报警未收到消息的排查

### 检查点 1: API 路由是否正确挂载
```javascript
// server/index.js
const routes = {
  '/api/alerts': './routes/alerts',  // ← 必须存在
};
```

### 检查点 2: `.env` 缺少飞书配置
**错误做法**: 把 webhook URL 写在 `.env`（不安全）  
**正确做法**: 在管理后台 `/admin/#/alarms` 页面配置

**操作步骤**：
1. 打开飞书群 → 添加自定义机器人
2. 复制 Webhook URL（类似 `https://open.feishu.cn/open-apis/bot/hub/xxx`）
3. 访问 `http://localhost:3000/admin/#/alarms`
4. 点击"添加渠道"：
   ```json
   {
     "type": "feishu",
     "name": "飞书报警通道",
     "config": {
       "url": "https://open.feishu.cn/open-apis/bot/hub/xxx"
     }
   }
   ```
5. 保存后点击"发送测试"验证

### 检查点 3: 当前报警日志显示正常
从你的截图看：
```
3h 前 [源已熔断暂停] → 飞书
```
说明**报警机制已工作**，只是你的飞书没收到可能是：
- ✅ 机器人配置错误（URL 过期/IP 白名单限制）
- ✅ 飞书群设置了"禁止机器人发言"
- ✅ 报警冷却期未到（配置了 120 分钟冷却）

---

## 📊 完整部署流程总结

### 阶段 1: 本地测试（当前）
- ✅ P0-P2 全部修复完成
- ✅ 单元测试通过（`npm test`）
-  运行 `node monitor-local.js` 观察 1-3 天

### 阶段 2: 云端部署（准备中）
- ☑️ 确认服务器已运行 PHP 队列
- ☑️ 更新 `ecosystem.config.js` 配置 PM2
- ☐ 设置环境变量 `CLOUD_BASE_URL`
- ☐ 配置飞书报警渠道
- ☐ 执行 `npm run setup:customer`

### 阶段 3: 生产运行
- ☐ 开启全文补抓定时任务（每日凌晨 2 点）
- ☐ 监控 pending_items 队列积压情况
- ☐ 定期检查 wempSupervisor 心跳日志

---

## 💡 关键建议

基于你的反馈，我建议：

1. **短期**: 继续使用我们刚修复的 `wempSupervisor.js`（跨平台兼容版），但**明确告知这不是真集成**
2. **中期**: 优先启用 **PHP 云端队列**方案（项目已有架构，无需额外开发）
3. **长期**: 考虑将微信公众号采集能力改写成纯 Node.js 实现（彻底移除 Python 依赖）

要我现在帮你：
- A) 编写启用 PHP 云端队列的代码改造？
- B) 创建 Docker Compose 部署脚本？
- C) 两者都做？

请告诉我你的优先需求！🔥
