// 构建后把 index.html 复制到 SPA 路由目录(/reader/ /daily/ /hot/)
// 这样不依赖 vercel.json 的 catch-all rewrite(它会先吞掉 /api/* 函数路由)
const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, 'dist');
const html = fs.readFileSync(path.join(dist, 'index.html'));
for (const dir of ['reader', 'daily', 'hot']) {
  fs.mkdirSync(path.join(dist, dir), { recursive: true });
  fs.writeFileSync(path.join(dist, dir, 'index.html'), html);
}
console.log('SPA 路由副本已生成: /reader/ /daily/ /hot/');
