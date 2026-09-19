import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { ThemeProvider } from './theme.jsx';
import { LanguageProvider } from './i18n.jsx';
import { Toaster } from './toast.jsx';
import AdminPage from './pages/AdminPage.jsx';
import LoginGate from './components/LoginGate.jsx';

// 管理后台独立入口（admin.html）：只渲染 AdminPage，不引入阅读器/日报/热点榜页面
// /admin/ 与 /wechat/（兼容）由后端指向本 bundle
// P0 鉴权（2026-09-05）：管理台全部接口需登录，LoginGate blocking 模式强制登录
// B71（2026-09-19 端到端评测抓到）：这里漏挂 LanguageProvider —— 后台里任何 useI18n() 都拿到
// createContext 的兜底值 t:(k)=>k，登录门五个文案直接显示裸 key（login.title/username/password/submit）。
createRoot(document.getElementById('root')).render(
  <ThemeProvider>
    <LanguageProvider>
      <AdminPage />
      <Toaster />
      <LoginGate blocking />
    </LanguageProvider>
  </ThemeProvider>
);
