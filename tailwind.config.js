const path = require('path');

/** @type {import('tailwindcss').Config} */
// 深浅色跟随系统（CSS 变量 + prefers-color-scheme，见 src/index.css）
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
