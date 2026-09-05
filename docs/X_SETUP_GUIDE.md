# X（Twitter）订阅搭建指南：RSSHub + 小号 Cookie

> 目标：订阅各 AI 实验室官推（@OpenAI、@AnthropicAI、@GoogleDeepMind…）与行业 KOL 个人号。
> 原理：自建 RSSHub 实例，用你的 X 小号登录态（authToken cookie）读取公开时间线，转成 RSS 供本系统订阅。
> 成本：免费。维护：cookie 几个月过期一次，按第 3 步重新取一次即可。

## 1. 启动 RSSHub（Docker，二选一）

**本机（Windows，需装 Docker Desktop）：**

```powershell
docker run -d --name rsshub -p 1200:1200 `
  -e TWITTER_AUTH_TOKEN="你的authToken" `
  diygod/rsshub:latest
```

**宝塔服务器：** 宝塔面板 → Docker → 创建容器，镜像 `diygod/rsshub:latest`，端口映射 1200，环境变量同上。

> 没有 Docker 也可以 Node 直跑：`npm i rsshub -g && set TWITTER_AUTH_TOKEN=... && rsshub`，但 Docker 更省心。

## 2. 取 X 小号的 authToken cookie

1. 准备一个 **X 小号**（不要用大号，抓取行为有封号风险）
2. 浏览器登录小号 → 按 `F12` 打开开发者工具
3. 「应用/Application」→「Cookies」→ `https://x.com`
4. 找到 `auth_token` 这一行，复制它的 **Value**（一串 40 位十六进制字符）
5. 把它填进上面第 1 步的 `TWITTER_AUTH_TOKEN`

## 3. 接入本系统

RSSHub 跑起来后，在系统里配置模板（二选一）：

**方式 A（推荐，界面操作）：** 设置页 → 公众号 Tab → 扩展源区，添加 X 用户名时会用到该模板；模板地址通过 API 配置一次即可：

```powershell
# PowerShell 执行（把地址换成你的实例）
node -e "const {setSetting}=require('D:/全网情报系统/server/db.js'); setSetting('x.rsshubTemplate','http://localhost:1200/twitter/user/{name}'); console.log('OK')"
```

**方式 B（配置文件固化）：** 部署文档见 `docs/DEPLOYMENT.md`。

配置后，在「扩展源」直接粘贴 `https://x.com/OpenAI` 或用户名 `OpenAI` 即可订阅。

## 4. 推荐订阅清单（AI 实验室官推）

| 账号 | 说明 |
|---|---|
| @OpenAI | OpenAI 官方 |
| @AnthropicAI | Anthropic 官方 |
| @GoogleDeepMind | Google DeepMind 官方 |
| @MetaAI | Meta AI 官方 |
| @MistralAI | Mistral 官方 |
| @xaboratory / @xai | xAI 官方 |
| @huggingface | Hugging Face 官方 |
| @Alibaba_Qwen | Qwen 官方 |

## 5. 常见问题

- **feed 返回 401/403**：cookie 过期或填错，重新按第 2 步取 `auth_token`，重启 RSSHub 容器
- **feed 返回 429**：抓取太频繁，把该源刷新间隔调大（设置页 RSS 刷新间隔，默认 8h 已很温和）
- **小号被锁**：换新小号重新取 cookie；避免短时间内大量添加账号
- **本机 RSSHub 需要代理吗**：RSSHub 访问 x.com 需要能连通外网。本机 Docker 需给容器配代理（`-e HTTPS_PROXY=http://host.docker.internal:7890`）；宝塔服务器若在境外则直连
