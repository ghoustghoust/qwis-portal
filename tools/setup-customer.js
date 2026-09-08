// setup:customer 一键配置脚本（F51）
// 读 config/customer-config.json → 生成 .env（含随机 Token）→ 初始化 DB、写入 settings → 输出指引
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'customer-config.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`未找到配置文件: ${CONFIG_PATH}`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  // 忽略 _ 前缀注释字段
  const clean = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith('_')) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      clean[k] = {};
      for (const [k2, v2] of Object.entries(v)) if (!k2.startsWith('_')) clean[k][k2] = v2;
    } else {
      clean[k] = v;
    }
  }
  return clean;
}

function genToken() {
  return crypto.randomBytes(24).toString('hex'); // 48 位随机 Token
}

// 幂等：配置未填 apiToken 时，优先复用已生成的 Token（cloud/token.json → .env），最后才生成新随机值
function resolveToken(cfg) {
  if (cfg.apiToken) return cfg.apiToken;
  const tokenJsonPath = path.join(ROOT, 'cloud', 'token.json');
  try {
    const t = JSON.parse(fs.readFileSync(tokenJsonPath, 'utf8')).token;
    if (t) return String(t);
  } catch (e) { /* 不存在或损坏则继续 */ }
  const envPath = path.join(ROOT, '.env');
  try {
    const m = fs.readFileSync(envPath, 'utf8').match(/^API_TOKEN=(.+)$/m);
    if (m && m[1].trim()) return m[1].trim();
  } catch (e) { /* 同上 */ }
  return genToken();
}

function main() {
  const cfg = loadConfig();
  const token = resolveToken(cfg);
  const tokenGenerated = !cfg.apiToken;

  // 1. 生成 .env
  const env = [
    `PORT=3000`,
    `CLOUD_BASE_URL=${cfg.cloudBaseUrl || ''}`,
    `API_TOKEN=${token}`,
    // 海外源代理（F47/F48）：留空则直连；国内服务经 NO_PROXY 绕过
    `HTTPS_PROXY=${cfg.proxy || ''}`,
    `NO_PROXY=localhost,127.0.0.1,${(cfg.cloudBaseUrl || '').replace(/^https?:\/\//, '')},api.deepseek.com`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(ROOT, '.env'), env, 'utf8');
  console.log(`✔ .env 已生成（Token ${tokenGenerated ? '已自动生成 48 位随机值' : '使用配置文件中的值'}）`);

  // 2. 初始化 DB + 写 settings
  const { db, getSetting, setSetting } = require('../server/db');
  const { nowIso } = require('../server/util/time');

  if (cfg.intervals) setSetting('intervals', cfg.intervals);
  if (cfg.opmlUrl) setSetting('opml.url', String(cfg.opmlUrl));
  setSetting('queue', {
    baseUrl: cfg.cloudBaseUrl || '',
    token,
    intervalMin: (cfg.intervals && cfg.intervals.queue) || 10,
    enabled: !!cfg.cloudBaseUrl,
  });
  if (cfg.deepseekKey) {
    setSetting('ai', {
      apiBase: 'https://api.deepseek.com/chat/completions',
      model: 'deepseek-v4-flash',
      apiKey: String(cfg.deepseekKey),
    });
  }
  if (cfg.bilibiliCookie) {
    db.prepare(
      'INSERT INTO credentials(platform, cookie, updated_at) VALUES(?,?,?) ON CONFLICT(platform) DO UPDATE SET cookie=excluded.cookie, updated_at=excluded.updated_at'
    ).run('bilibili', String(cfg.bilibiliCookie), nowIso());
  }
  // 七期：AIHOT 热点榜（actor 渲染进三个官方 feed 模板，新机器按此建源；已有库不重复）
  if (cfg.aihot && cfg.aihot.actor) {
    setSetting('aihot', { actor: String(cfg.aihot.actor), enrichGapMs: Number(cfg.aihot.enrichGapMs) || 2000 });
    const exists = db.prepare("SELECT COUNT(*) c FROM sources WHERE url LIKE '%aihot.virxact.com%'").get().c;
    if (!exists) {
      const a = cfg.aihot.actor;
      const mk = (name, url, extra) => db.prepare(
        "INSERT INTO sources(type, name, url, extra, enabled, status, created_at) VALUES('rss',?,?,?,1,'ok',?)"
      ).run(name, url, JSON.stringify(extra), nowIso());
      mk('AIHOT 热榜', `https://aihot.virxact.com/feed/all.xml?aihot_actor=${a}`, { aggregator: 1, intervalMin: 30 });
      mk('AIHOT 精选全文', `https://aihot.virxact.com/feed/full.xml?aihot_actor=${a}`, { aggregator: 1, marksFeatured: 1, intervalMin: 30 });
      mk('AIHOT 日报', `https://aihot.virxact.com/feed/daily.xml?aihot_actor=${a}`, {});
      console.log('✔ AIHOT 三个 feed 源已登记（热榜/精选全文/日报）');
    }
  }
  console.log('✔ 数据库已初始化（data/app.db），配置项已写入 settings');

  // 3. 生成云端队列 token.json（部署到宝塔站点时随 cloud/ 一起上传，供 PHP 校验）
  const cloudDir = path.join(ROOT, 'cloud');
  if (fs.existsSync(cloudDir)) {
    fs.writeFileSync(path.join(cloudDir, 'token.json'), JSON.stringify({ token }, null, 2), 'utf8');
    console.log('✔ cloud/token.json 已生成（随 cloud/ 上传到 PHP 站点，切勿泄露）');
  }

  // 4. 客户端配置生成（T37/T38）：安卓 HTTP Shortcuts JSON + Windows 提交工具
  if (cfg.generateClients) {
    generateClients(cfg, token);
  }

  console.log('\n===== 下一步 =====');
  // 检测运行环境，给出对应部署指引
  const isLinux = process.platform === 'linux';
  const hasPM2 = (() => {
    try { return spawnSync('pm2', ['--version'], { encoding: 'utf8', timeout: 5000 }).status === 0; }
    catch { return false; }
  })();

  if (isLinux && hasPM2) {
    console.log('检测到 Linux + PM2 环境（服务器部署）：');
    console.log('1. npm install --production');
    console.log('2. npm run build（构建前端）');
    console.log('3. npm run pm2:start（PM2 守护启动）');
    console.log('4. pm2 save && pm2 startup（开机自启）');
    console.log('5. 配置 Nginx 反向代理 → 127.0.0.1:3000（详见 docs/RUNBOOK.md）');
  } else {
    console.log('1. npm install（首次）');
    console.log('2. npm run build（构建前端）');
    console.log('3. npm start');
    console.log('4. 访问 http://localhost:3000/reader/ （阅读器）/daily/（日报）/wechat/（设置）');
  }
  if (!cfg.deepseekKey) console.log('提示：deepseekKey 未配置，AI 功能关闭（N7 降级），可在 customer-config.json 填入后重新运行本脚本');
}

// T37/T38：渲染客户端配置（安卓 HTTP Shortcuts JSON、Windows 提交工具配置与桌面快捷键）
function generateClients(cfg, token) {
  const baseUrl = String(cfg.cloudBaseUrl || '').replace(/\/+$/, '');

  // T38：渲染 http-shortcuts-template.json 占位符 → data/http-shortcuts.json
  const templatePath = path.join(__dirname, 'http-shortcuts-template.json');
  if (fs.existsSync(templatePath)) {
    const rendered = fs
      .readFileSync(templatePath, 'utf8')
      .replace(/__CLOUD_BASE_URL__/g, baseUrl)
      .replace(/__API_TOKEN__/g, token);
    const outDir = path.join(ROOT, 'data');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'http-shortcuts.json'), rendered, 'utf8');
    console.log('✔ data/http-shortcuts.json 已生成（安卓 HTTP Shortcuts 导入配置，用法见 docs/ANDROID_SUBMIT_GUIDE.md）');
  } else {
    console.warn('⚠ 未找到 tools/http-shortcuts-template.json，跳过安卓配置生成');
  }

  // T37：submit.ps1 的同目录配置（Token 与域名从 submit-config.json 读取）
  fs.writeFileSync(
    path.join(__dirname, 'submit-config.json'),
    JSON.stringify({ baseUrl, token }, null, 2),
    'utf8'
  );
  console.log('✔ tools/submit-config.json 已生成（submit.ps1 读取，切勿泄露）');

  // T37：桌面快捷方式 submit.lnk（Ctrl+Alt+Q 调 submit.ps1）；失败不阻塞 setup
  createDesktopShortcut();
}

function createDesktopShortcut() {
  if (process.platform !== 'win32') {
    console.log('… 非 Windows 环境，跳过桌面快捷方式生成');
    return;
  }
  try {
    const ps1 = path.join(__dirname, 'submit.ps1').replace(/'/g, "''");
    const psScript = [
      '$ws = New-Object -ComObject WScript.Shell',
      '$desktop = $ws.SpecialFolders("Desktop")',
      "$lnk = Join-Path $desktop 'submit.lnk'",
      '$sc = $ws.CreateShortcut($lnk)',
      "$sc.TargetPath = 'powershell.exe'",
      `$sc.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ''${ps1}'''`,
      `$sc.WorkingDirectory = '${path.dirname(ps1).replace(/'/g, "''")}'`,
      "$sc.Hotkey = 'CTRL+ALT+Q'",
      "$sc.Description = '全网情报系统：剪贴板链接提交到订阅队列'",
      '$sc.Save()',
      "Write-Output $lnk",
    ].join('; ');
    const r = spawnSync('powershell', ['-NoProfile', '-Command', psScript], {
      encoding: 'utf8',
      timeout: 15000,
    });
    const lnkPath = (r.stdout || '').trim();
    if (r.status === 0 && lnkPath && fs.existsSync(lnkPath)) {
      console.log('✔ 桌面快捷方式 submit.lnk 已生成（Ctrl+Alt+Q 提交剪贴板链接）');
    } else {
      console.warn(`⚠ 桌面快捷方式生成失败（不影响其他配置）：${(r.stderr || r.error || '').toString().trim() || '未知原因'}`);
    }
  } catch (e) {
    console.warn(`⚠ 桌面快捷方式生成失败（不影响其他配置）：${e.message}`);
  }
}

main();
