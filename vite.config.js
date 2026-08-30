import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

// 门户 = 主系统读者前端本体(web/)的 Vercel 构建
// root 指向 ../web(阅读器/每日情报/热点榜);publicDir 指 portal/public(data 快照 + 静态资源)
// 只留 main 入口(admin.html 是本地管理后台,云端无后端,不打包)
const r = (p) => fileURLToPath(new URL(p, import.meta.url));
export default defineConfig({
  root: r('../web'),
  publicDir: r('public'),
  plugins: [react()],
  build: {
    outDir: r('dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: r('../web/index.html'),
      },
    },
  },
});
