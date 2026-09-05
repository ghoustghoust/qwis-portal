import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

// 配置文件位于 web/ 下，root 指向 web，产物输出 web/dist（由后端静态托管）
// 多入口：index.html（读者前端 reader/daily/hot）+ admin.html（管理后台，独立 bundle）
const r = (p) => fileURLToPath(new URL(p, import.meta.url));
export default defineConfig({
  root: r('.'),
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: r('index.html'),
        admin: r('admin.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // 开发期把 API 代理到本地后端
      '/api': 'http://localhost:3000',
    },
  },
});
