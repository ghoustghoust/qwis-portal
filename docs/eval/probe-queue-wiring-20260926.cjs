// 一次性只读探针：文件型 PHP 队列 / pending_items / job_queue 三者此刻的真实接线
// 跑法：node docs/eval/probe-queue-wiring-20260926.cjs   （只读打开 data/app.db，零写入；token 一律掩码）
const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, '..', '..', 'data', 'app.db'), { readonly: true, fileMustExist: true });

const mask = (v) => (v === undefined || v === null ? '(无)' : String(v).length ? '(已设·已掩码)' : '(空串)');
const hostOf = (u) => {
  try {
    return new URL(String(u)).host;
  } catch {
    return String(u || '(空)');
  }
};

console.log('== settings 里键名含 queue 的行 ==');
for (const r of db.prepare("SELECT key, value FROM settings WHERE key LIKE '%queue%'").all()) {
  let out = r.value;
  try {
    const o = JSON.parse(r.value);
    out = JSON.stringify(o, (k, v) => (k === 'token' || k === 'secret' || k === 'apiKey' ? mask(v) : v));
  } catch {
    /* 非 JSON 原样 */
  }
  console.log(`  ${r.key} = ${out}`);
}

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('job_queue','pending_items')").all().map((r) => r.name);
console.log(`\n== 队列表存在情况：${tables.join(', ') || '两张表都不存在'} ==`);
if (tables.includes('job_queue')) {
  const c = db.prepare('SELECT status, COUNT(*) n FROM job_queue GROUP BY status').all();
  console.log(`  job_queue: ${c.length ? c.map((r) => `${r.status}=${r.n}`).join(' ') : '0 行'}`);
}
if (tables.includes('pending_items')) {
  const c = db.prepare('SELECT type, status, COUNT(*) n FROM pending_items GROUP BY type, status').all();
  console.log(`  pending_items: ${c.length ? c.map((r) => `${r.type}/${r.status}=${r.n}`).join('  ') : '0 行'}`);
}

console.log('\n== 仓库内 cloud/ 文件（PHP 队列的服务端半边）==');
const fs = require('fs');
const cloudDir = path.join(__dirname, '..', '..', 'cloud');
for (const f of fs.readdirSync(cloudDir)) {
  const st = fs.statSync(path.join(cloudDir, f));
  let extra = '';
  if (f.endsWith('.json')) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(cloudDir, f), 'utf8'));
      extra = Array.isArray(j) ? `数组 ${j.length} 项` : `键 ${Object.keys(j).map((k) => (k === 'token' ? 'token(掩码)' : k)).join(',')}`;
    } catch {
      extra = '非 JSON';
    }
  }
  console.log(`  ${f}  末次改动 ${st.mtime.toISOString().slice(0, 10)}  ${extra}`);
}
