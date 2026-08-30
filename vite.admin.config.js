import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

// 云端管理后台独立构建(十一期 M4):root=portal 自身,与主前端(web/)完全隔离
// base=/admin/ 使资源路径全部落在 /admin/ 下,输出 dist-admin/ 后由 copy-routes.js 并入 dist/admin/
const r = (p) => fileURLToPath(new URL(p, import.meta.url));
export default defineConfig({
  root: r('.'),
  base: '/admin/',
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: r('dist-admin'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        admin: r('./admin.html'),
      },
    },
  },
});
