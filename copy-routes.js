// 构建后路由副本 + 管理后台并入 dist
// 1. 把 index.html 复制到 SPA 路由目录(/reader/ /daily/ /hot/)
//    这样不依赖 vercel.json 的 catch-all rewrite(它会先吞掉 /api/* 函数路由)
// 2. 把 dist-admin/(vite.admin.config.js 产物)并入 dist/admin/
const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, 'dist');
const html = fs.readFileSync(path.join(dist, 'index.html'));
for (const dir of ['reader', 'daily', 'hot']) {
  fs.mkdirSync(path.join(dist, dir), { recursive: true });
  fs.writeFileSync(path.join(dist, dir, 'index.html'), html);
}
console.log('SPA 路由副本已生成: /reader/ /daily/ /hot/');

function cpdir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) cpdir(s, d);
    else fs.copyFileSync(s, d);
  }
}

const adminDist = path.join(__dirname, 'dist-admin');
if (fs.existsSync(path.join(adminDist, 'admin.html'))) {
  const dst = path.join(dist, 'admin');
  cpdir(adminDist, dst);
  // admin.html → admin/index.html(/admin/ 直达)
  fs.renameSync(path.join(dst, 'admin.html'), path.join(dst, 'index.html'));
  console.log('管理后台已并入: /admin/');
}
