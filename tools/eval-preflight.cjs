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
const SITE = require('../lib/cloud-site').CLOUD_SITE;
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
// 坑：undici 的 ProxyAgent 必须配 undici 自己的 fetch；用全局 fetch 会静默忽略 dispatcher 而 fetch failed
async function probeJson(url, ms = 8000) {
  const { ProxyAgent, fetch: uFetch } = require('undici');
  const r = await uFetch(url, { dispatcher: new ProxyAgent(PROXY), signal: AbortSignal.timeout(ms), redirect: 'manual' });
  return { status: r.status, body: await r.json().catch(() => null) };
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

  // 3) 云端站点活着 + 冷启动耗时基线 + **线上是否真在跑 origin/main**
  try {
    const t0 = Date.now();
    const st = await probe(`${SITE}/api/meta`);
    const ms = Date.now() - t0;
    add('cloud:/api/meta 响应', st === 200, 'env', `HTTP ${st} / ${ms}ms`);
    // 2026-09-19 实况：连续 5 次 git push 之后 production 仍是 36 分钟前的 deployment，
    // 而 preflight 只看"本地 HEAD 已推到 origin"——那验的是 GitHub，不是**正在服务的那一份代码**。
    // 本项目最大历史故障就是"以为上线了其实没有"，所以这一条必须比 sha。
    try {
      const meta = (await probeJson(`${SITE}/api/meta`)).body || {};
      const want = sh('git rev-parse origin/main');
      if (!meta.commit) {
        add('cloud:线上 commit == origin/main', false, 'env',
          '云端 /api/meta 未回传 commit（说明读层还没带这个字段上线，本身即等于"改动没生效"）');
      } else {
        add('cloud:线上 commit == origin/main', meta.commit === want, 'product',
          `线上 ${String(meta.commit).slice(0, 7)} / origin/main ${want.slice(0, 7)}${meta.commit === want ? '' : ' ← Vercel 未部署，改动在线上看不到'}`);
      }
    } catch (e) { add('cloud:线上 commit == origin/main', false, 'env', e.message); }
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
    // 判据在 lib/alert-channels.js（唯一实现）。原先这里写的是
    // `enabled && url.startsWith('http')`，于是生产库里那个 url=http://127.0.0.1:1 的 test-ch
    // 被判成「1 个可用渠道」，把 P0 的 BL7（报警无出口）在门禁里显示成绿灯。见坑 #43。
    const { usableChannels, deliveryState } = require('../lib/alert-channels');
    const usable = usableChannels(chans);
    add('config:报警渠道有真实出口', usable.length > 0, 'config',
      usable.length ? `${usable.length} 个可用渠道（${usable.map((c) => c.id).join(', ')}）`
        // 只印 scheme://host，路径与 query 一律不落进终端/报告 JSON —— 飞书/钉钉 webhook 的 token 就在里面
        : `channels=${JSON.stringify(chans.map((c) => `${c.id}:${String((c.config || {}).url || '').replace(/^(https?:\/\/[^/]+).*/i, '$1/…')}`))} —— 报警链路无出口（BL7）。恢复：node tools/sync-alerts-config.js --force`);
    const dv = deliveryState(al.recentLog);
    add('config:最近报警真的送达', dv.state === 'ok', 'config',
      `${dv.state === 'ok' ? '' : dv.state === 'unknown' ? '未验证：' : '送达失败：'}${dv.detail}（dispatched ≠ delivered）`);
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
