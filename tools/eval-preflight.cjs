#!/usr/bin/env node
/**
 * 评测前置检查器（41-1 / EVAL_GUIDE §3.1）
 * 论文实测「安装验证」只有 14% 通过是全链瓶颈；我们最脆的是「本机代理 + 三端凭据 + 生产配置健康」。
 * 不通过一律判 fail_env（退出码 2）——**不许折算成产品缺陷，也不许跳过继续跑评测**。
 *
 * 用法：node tools/eval-preflight.cjs [--json]
 * 退出码：0=可开跑；2=fail_env（环境/凭据/网络）；1=配置类问题需人处置（BL7/BL8/BL9 告警）
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PROXY = process.env.EVAL_PROXY || 'http://127.0.0.1:12000';
const SITE = 'https://qwis-intel.vercel.app';
const asJson = process.argv.includes('--json');
const results = [];
const add = (name, ok, kind, detail) => { results.push({ name, ok, kind, detail }); return ok; };

function loadEnv() {
  const p = path.join(ROOT, '.env');
  if (!fs.existsSync(p)) return false;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.+)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
  return true;
}
const sh = (cmd) => execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();
async function probe(url, ms = 8000) {
  const { ProxyAgent, fetch: uFetch } = require('undici');
  const r = await uFetch(url, { dispatcher: new ProxyAgent(PROXY), signal: AbortSignal.timeout(ms), redirect: 'manual' });
  return r.status;
}

(async () => {
  loadEnv();

  // 1) 本机代理可达（不通则一切云端判定都无意义）
  try {
    const st = await probe('https://github.com');
    add('proxy:github 可达', st < 500, 'env', `${PROXY} → HTTP ${st}`);
  } catch (e) {
    add('proxy:github 可达', false, 'env', `${PROXY} 连接失败：${e.message} —— 请先开 Clash（本机代理端口见 AGENTS §2.2）`);
    return finish();
  }

  // 2) 本地改动已推送（AGENTS §2.1）：未推送 = 线上跑的还是旧代码
  try {
    const head = sh('git rev-parse HEAD');
    const remote = sh('git rev-parse origin/main');
    const dirty = sh('git status --porcelain').length > 0;
    add('git:HEAD 已推送', head === remote, 'env', head === remote ? head.slice(0, 7) : `HEAD ${head.slice(0, 7)} != origin/main ${remote.slice(0, 7)}`);
    if (dirty) console.log('  i 工作区有未提交改动（不影响评测，但交付前须处理）');
  } catch (e) { add('git:HEAD 已推送', false, 'env', e.message); }

  // 3) 云端站点活着 + 冷启动耗时基线
  try {
    const t0 = Date.now();
    const st = await probe(`${SITE}/api/meta`);
    const ms = Date.now() - t0;
    add('cloud:/api/meta 响应', st === 200, 'env', `HTTP ${st} / ${ms}ms`);
  } catch (e) { add('cloud:/api/meta 响应', false, 'env', e.message); }

  // 4) Turso 可读（评测只读端点，不写生产）
  try {
    const { createClient } = require('@libsql/client');
    const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
    const r = await db.execute('SELECT COUNT(*) c FROM sources');
    add('turso:可读', true, 'env', `sources=${r.rows[0].c}`);

    // 5) 生产配置健康（BL7/BL8/BL9 的显式告警口，替代"测试静默叠写"）
    const get = async (k) => { const x = await db.execute({ sql: 'SELECT value FROM settings WHERE key=?', args: [k] }); return x.rows[0] ? x.rows[0].value : null; };
    let al = {}; try { al = JSON.parse(await get('alerts') || '{}'); } catch { al = {}; }
    const chans = Array.isArray(al.channels) ? al.channels : [];
    const usable = chans.filter((c) => c.enabled && String((c.config || {}).url || '').startsWith('http'));
    add('config:报警渠道有出口', usable.length > 0, 'config',
      usable.length ? `${usable.length} 个可用渠道` : `channels=${JSON.stringify(chans.map((c) => c.id))} —— 报警链路无出口（BL7）。恢复：node tools/sync-alerts-config.js --force`);
    const mi = Number(await get('ai.minIntervalMs'));
    add('config:AI 限速保护开启', Number.isFinite(mi) && mi >= 1000, 'config',
      `ai.minIntervalMs=${await get('ai.minIntervalMs')}（应 ≥1000，runner 默认 4000；0 = 无间隔硬打免费池，BL8）`);
    const aiRaw = await get('ai');
    if (aiRaw) {
      let o = {}; try { o = JSON.parse(aiRaw); } catch { /* ignore */ }
      const sameKey = o.apiKey && o.apiKey === process.env.AGNES_API_KEY;
      add('config:settings.ai 未偏离 env', !!o.apiKey ? sameKey : true, 'config',
        `settings.ai 存在（keys=${Object.keys(o).join(',')}）；apiKey 与 env ${sameKey ? '同值（可写通道开着，审计未落地=BL9）' : '**不同值 → 401 风险，立即核对**'}`);
    }
    db.close();
  } catch (e) { add('turso:可读', false, 'env', e.message); }

  finish();
})();

function finish() {
  const bad = results.filter((r) => !r.ok);
  if (asJson) { console.log(JSON.stringify({ ok: !bad.length, results }, null, 1)); }
  else {
    for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} [${r.kind}] ${r.name} — ${r.detail}`);
    console.log(`preflight：${results.length - bad.length}/${results.length} 通过`);
  }
  const envFail = bad.some((r) => r.kind === 'env');
  process.exitCode = envFail ? 2 : (bad.length ? 1 : 0);
}
