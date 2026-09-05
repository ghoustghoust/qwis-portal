# 安卓快捷提交配置指南（HTTP Shortcuts）

在手机（安卓）上把 B站 / 抖音 / 公众号链接一键提交到本系统的云端订阅队列。
本机 `npm run setup:customer` 会自动生成导入配置文件 `data/http-shortcuts.json`
（Token 与域名已按你的部署渲染好，无需手填）。

## 链路原理

```
安卓分享菜单 → HTTP Shortcuts 接收链接 → 自动识别平台 → 确认弹窗
→ POST 到云端队列（wechat / bilibili / douyin）
→ 本机按轮询间隔（默认 10 分钟）拉取到待处理区并解析为正式订阅 → 云端清空
```

## 第一步：安装 HTTP Shortcuts

任选其一：

- Google Play / F-Droid 搜索 **HTTP Shortcuts**（作者 Waboodoo，免费开源）
- GitHub 下载 APK：https://github.com/Waboodoo/HTTP-Shortcuts/releases

## 第二步：把配置文件传到手机

`data/http-shortcuts.json` 传到手机任意目录（微信文件传输 / 邮件 / 数据线均可）。

> 注意：该文件包含云端队列 Token，请用可信渠道传输，不要发到群聊。

## 第三步：导入配置

1. 打开 HTTP Shortcuts → 右上角菜单（⋮）→ **Import / Export**
2. 选择 **Import from file**，选中刚传到手机的 `http-shortcuts.json`
3. 导入成功后会出现「情报提交」分类，内含三个快捷方式：
   - 提交 B站链接（→ bilibili-video-queue.php）
   - 提交抖音链接（→ douyin-video-queue.php）
   - 提交公众号链接（→ wechat-rss-queue.php）

导入内容一览：

| 配置项 | 说明 |
|---|---|
| 全局变量 `base_url` | 云端队列域名（已渲染为你的部署地址） |
| 全局变量 `queue_token` | 云端队列 Token（标记为 secret，不参与再导出） |
| 全局变量 `shared_link` | 开启「允许从分享对话框接收值」，承接分享进来的链接 |
| 每个快捷方式 | POST JSON `{token,url,name,type}` 到对应队列端点，执行前弹确认框 |

### 如果导入失败（App 版本差异）

手动新建一个快捷方式即可，参数如下（以 B站为例，抖音/公众号只换端点与 type）：

- 方法：`POST`
- URL：`https://你的域名/bilibili-video-queue.php`
- 请求体类型：自定义文本，`Content-Type: application/json`
- 请求体：`{"token":"你的Token","url":"{{shared_link}}","name":"","type":"bilibili"}`
- 变量：新建全局静态变量 `shared_link`，勾选「允许从分享对话框接收值」

## 第四步：使用

1. 在 B站 / 抖音 / 微信里打开视频、主页或文章 → 点「分享」→ 选 **HTTP Shortcuts**
   （分享文本会进入 `shared_link` 变量）
2. 选择对应的「提交 XX 链接」快捷方式
   - 快捷方式会先校验链接平台，不匹配会直接提示并中止
3. 弹窗显示「识别到：XX / 类型 / 链接，确认加入订阅队列？」→ 点「确认」
4. 提示「已加入订阅队列」即成功；本机 10 分钟内自动拉取到设置页对应 Tab 的
   待处理区，随后解析为正式订阅

> 小提示：在快捷方式的「触发与执行设置」里勾选「直接分享目标」（Direct Share），
> 分享菜单里会直接出现该快捷方式，少点一步。

## 常见问题

**Q1：分享菜单里找不到 HTTP Shortcuts？**
确认 `shared_link` 变量开启了「允许从分享对话框接收值」；部分系统需在系统设置的
「默认应用 / 分享」里启用。也可先在快捷方式详情页开启 Direct Share。

**Q2：点确认后提示「提交失败」？**
- 检查手机能否访问云端域名（浏览器打开 `https://你的域名/` 应能访问）
- 检查 Token 是否与本机 `cloud/token.json` 一致（重新运行 `npm run setup:customer`
  后需重新导入新的 `data/http-shortcuts.json`）
- 云端 403 即 Token 错误

**Q3：提交成功了，设置页待处理区没有条目？**
本机按轮询间隔（默认 10 分钟，可在设置页队列折叠区调整）自动拉取；
也可在设置页点「同步队列」立即拉取。

**Q4：公众号提交的是文章链接还是账号？**
提交 `mp.weixin.qq.com` 文章链接，本机会解析出公众号名称进入「待提交公众号信息」区，
仅供手动复制，不会自动提交到第三方网页（F24）。

**Q5：Token 泄露了怎么办？**
在 `config/customer-config.json` 填新 `apiToken`（或删除 `cloud/token.json` 与 `.env`
中的旧值）后重跑 `npm run setup:customer`，重新上传 `cloud/` 并重新导入手机配置。
