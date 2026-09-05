const path = require('path');

// 显式指定 tailwind 配置位置，保证从项目根目录执行 build 时同样生效
module.exports = {
  plugins: {
    tailwindcss: { config: path.join(__dirname, 'tailwind.config.js') },
    autoprefixer: {},
  },
};
