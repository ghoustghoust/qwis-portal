import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

// 独立只读门户：纯静态 SPA，无后端；数据来自 public/data/*.json（构建时随 dist 打包）
// base './' 保证部署到任意子路径也能加载资源
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
