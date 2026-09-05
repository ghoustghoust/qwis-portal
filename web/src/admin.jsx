import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { ThemeProvider } from './theme.jsx';
import { Toaster } from './toast.jsx';
import AdminPage from './pages/AdminPage.jsx';

// 管理后台独立入口（admin.html）：只渲染 AdminPage，不引入阅读器/日报/热点榜页面
// /admin/ 与 /wechat/（兼容）由后端指向本 bundle
createRoot(document.getElementById('root')).render(
  <ThemeProvider>
    <AdminPage />
    <Toaster />
  </ThemeProvider>
);
