# 日报设置迁移至管理后台

## 📋 概述

将原本在每日情报页面的弹窗式设置（`DailySettingsModal`）迁移到全网情报·管理后台的独立 Tab 页面（`DailySettingsTab`）。

---

## ✅ 完成情况

### 1. **新建组件**

文件路径：[`web/src/components/DailySettingsTab.jsx`](d:\全网情报系统\web\src\components\DailySettingsTab.jsx)

**功能特性**：
- ✅ 统计窗口（小时）配置
- ✅ 每日生成时间设置（24 小时制）
- ✅ 公众号文章来源勾选 + 重点关照开关
- ✅ 视频订阅来源勾选 + 重点关照开关
- ✅ 栏目管理（增删改、恢复默认）
- ✅ 实时保存提示与错误反馈

**与 Modal 的区别**：
- ❌ Modal：弹窗形式，需要 `open` 属性触发，有遮罩层
- ✅ Tab：常驻页面，直接展示，无需开关

---

### 2. **管理后台集成**

修改文件：[`web/src/pages/AdminPage.jsx`](d:\全网情报系统\web\src\pages\AdminPage.jsx)

**变更内容**：
```diff
+ import DailySettingsTab from '../components/DailySettingsTab.jsx';

  const tabs = [
    { id: 'wechat', label: '公众号 RSS' },
    { id: 'wemp', label: '公众号订阅' },
    { id: 'bilibili', label: 'B 站' },
    { id: 'douyin', label: '抖音' },
+   { id: 'daily', label: '日报设置' },
    { id: 'data', label: '数据' },
    { id: 'alerts', label: '报警管理' },
    { id: 'hot', label: '热点榜' },
  ];

  // ...
+ {tab === 'daily' && <DailySettingsTab />}
```

**Tab 顺序**：
1. 公众号 RSS
2. 公众号订阅
3. B 站
4. 抖音
5. **【新增】日报设置** ← 新入口
6. 数据
7. 报警管理
8. 热点榜

---

### 3. **后端 API**（无需修改）

所有设置数据已通过 [`/api/settings/daily`](d:\全网情报系统\server\routes\daily.js) 持久化到数据库：

| 接口 | 方法 | 说明 |
|------|------|------|
| `GET /api/settings/daily` | 读取配置 | 返回 windowHours, time, sourceIds, columns |
| `PUT /api/settings/daily` | 保存配置 | 更新数据库 settings 表 |

**数据库存储位置**：
- SQLite `settings` 表，key=`daily` → 主配置
- SQLite `settings` 表，key=`daily.columns` → 栏目配置

---

## 🔧 使用方式

### 用户操作流程

1. **访问管理后台**：打开 `http://localhost:3000/admin/`
2. **点击"日报设置"Tab**：顶部导航栏第 5 个标签
3. **修改配置**：
   - 调整统计窗口（如 24 小时）
   - 设置每日生成时间（如 08:00）
   - 勾选/取消文章源和视频源
   - 启用"重点关照"（该源内容自动进入"重点更新"栏）
   - 编辑栏目名称、描述、关键词
4. **保存设置**：点击底部"保存设置"按钮

---

## 📝 代码结构对比

| 组件 | 类型 | 入口 | 状态 |
|------|------|------|------|
| `DailySettingsModal` | 弹窗组件 | `/daily/` 页 | ⚠️ 保留但不再调用 |
| `DailySettingsTab` | Tab 组件 | `/admin/` 页 | ✅ 新启用 |

---

## 🚀 构建验证

```bash
cd web
npm run build
```

**构建输出**：
```
✓ 67 modules transformed.
rendering chunks...
dist/admin.html                  0.70 kB │ gzip:  0.52 kB
dist/assets/admin-CXmk9ogb.js   87.60 kB │ gzip: 25.87 kB  ↑ 新增 DailySettingsTab
```

---

## 🔄 可选清理

由于原 `DailySettingsModal` 已在代码中标注"设置入口已下线"，您可以选择：

### 选项 A：保留不删除（推荐）
- **理由**：备份价值，未来可能恢复为弹窗模式
- **操作**：什么都不用做

### 选项 B：完全移除
```bash
rm web/src/components/DailySettingsModal.jsx
```

并检查是否有其他地方引用（目前无）。

---

## 📊 配置文件完整性核查

运行以下脚本验证配置正确性：

```bash
node tools/verify-daily-config-integrity.js
```

**预期输出**：
```
✅ 每日情报配置完整且正确，无需后端迁移！
```

---

## 🎯 总结

### 核心变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `web/src/components/DailySettingsTab.jsx` | ✅ 新增 | 管理后台 Tab 页面 |
| `web/src/pages/AdminPage.jsx` | ✅ 修改 | 添加"日报设置"Tab |
| `web/src/components/DailySettingsModal.jsx` | ⚠️ 保留 | 旧弹窗组件（未调用） |

### 后端影响

- ✅ **零变更**：所有 API 已存在且工作正常
- ✅ **数据库结构**：无新增表或字段
- ✅ **API 契约**：GET/PUT `/api/settings/daily` 保持不变

### 用户体验

- ✅ 设置入口更统一：所有管理功能集中在一个页面
- ✅ 操作更直观：无需弹窗切换，全屏展示
- ✅ 降低误触风险：避免误点关闭导致未保存

---

## 📚 相关文件

- **前端组件**：`web/src/components/DailySettingsTab.jsx`
- **管理后台**：`web/src/pages/AdminPage.jsx`
- **后端 API**：`server/routes/daily.js`
- **服务层**：`server/services/ai/daily.js`
- **数据库 schema**：`server/db.js` (settings 表)

---

**完成时间**: 2026-09-03  
**优先级**: P2（体验优化）  
**验证状态**: ✅ 构建通过，API 正常
