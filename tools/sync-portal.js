// 门户数据同步:导出 JSON → portal/ 独立 git 仓库 commit & push(Vercel 自动部署)
// 用法: node tools/sync-portal.js        (有变更才提交推送)
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORTAL = path.join(ROOT, 'portal');

function sh(cmd, cwd) {
  return execSync(cmd, { cwd: cwd || ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function main() {
  // 1. 导出最新数据
  sh('node tools/export-portal.js');

  // 2. portal 仓库提交推送
  if (!require('fs').existsSync(path.join(PORTAL, '.git'))) {
    console.log('portal 还不是 git 仓库,先跳过推送(完成首次 GitHub 绑定后再自动推送)');
    return;
  }
  const status = sh('git status --porcelain', PORTAL);
  if (!status) {
    console.log('数据无变更,跳过');
    return;
  }
  sh('git add -A', PORTAL);
  sh(`git commit -m "data: portal snapshot ${new Date().toISOString()}"`, PORTAL);
  try { sh('git push', PORTAL); } catch (e) { console.log('git push 失败(继续走 CLI 部署):', e.message.slice(0, 100)); }
  // 本地预构建 + 部署(portal 前端 root 指向 ../web,仓库里没有 web/,云端构建必然失败;
  // 且 Hobby 计划函数上限 12,所有 /api/* 已合并进单个 api/[...slug].js)
  sh('npx vercel build --prod', PORTAL);
  sh('npx vercel deploy --prebuilt --prod --yes', PORTAL);
  console.log('已同步: git push + Vercel 生产部署完成');
}

function run() {
  try {
    main();
  } catch (e) {
    // 推送失败(网络/凭据)不影响主系统
    console.error('门户同步失败(已忽略):', e.message.slice(0, 200));
  }
}

if (require.main === module) run();
module.exports = { run };
