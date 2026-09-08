# TOOLS.md - 全网情报系统运维备忘

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## 项目环境

### 系统信息
- 平台：Windows 25H2
- Node 版本：20+（推荐 24）
- 工作目录：`D:\全网情报系统\`
- 端口：默认 3000
- 数据库：`data/app.db`（better-sqlite3，WAL 模式）

### 常用命令
```powershell
start-all.bat                    # 一键启动（含健康检查、自动开浏览器）
restart-server.bat               # 按 3000 端口找 PID 重启（管理员运行）
npm run build                    # 改了 web/src 后必须重建前端
npm test                         # 回归测试（189 项，2026-09-06）
node smoke-test.js               # 冒烟（跑生产库副本，零副作用）
node tools/audit-cloud.js        # 云端 19 项自检
node tools/ops-toolkit.js check  # 健康总览
node tools/ops-toolkit.js frozen # 熔断源清单
```

### 运维脚本清单（tools/）
| 脚本 | 用途 |
|------|------|
| `ops-toolkit.js` | 聚合工具：check/frozen/unfreeze/diagnose-bili/export |
| `sync-portal.js` | 同步本地快照到 Vercel portal |
| `export-portal.js` | 导出门户数据 |
| `import-bestblogs-opml.js` | 导入 bestblogs OPML 源清单（幂等） |
| `seed-hotlist.js` | 初始化热榜源 |
| `seed-turso.js` | 同步数据到 Turso |
| `setup-customer.js` | 客户化配置生成 |
| `audit-cloud.js` | 云端 19 项自检 |
| `gen_bat.py` | 生成 GBK 编码 bat 文件 |

### 关键配置位置
| 配置 | 位置 |
|------|------|
| 系统配置 | `D:\全网情报系统\.env` + settings 表 |
| 客户化配置 | `config/customer-config.json` |
| 数据库 | `data/app.db` |
| 备份 | `data/backups/app-*.db` |
| 日志 | `data/logs/qwis-out.log` / `qwis-error.log` |
| OPML 源清单 | `opml/`（wechat2rss 375 / youtube 124 / podcast 60） |

### 文档导航
- 架构：`ARCHITECTURE.md`（必读）
- 运维：`docs/RUNBOOK.md`
- 状态：`docs/PROJECT_STATUS.md`
- 索引：`docs/INDEX.md`
- 重构：`docs/REFACTOR_GUIDE.md`

## Related

- [Agent workspace](/concepts/agent-workspace)
