const path = require('path');

/** @type {import('tailwindcss').Config} */
// content 用绝对路径：npm run build 从项目根目录执行时也能正确扫描 web/src
module.exports = {
  content: [
    path.join(__dirname, 'index.html'),
    path.join(__dirname, 'src/**/*.{js,jsx}'),
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
