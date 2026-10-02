// 分批试探恢复被熔断的源（H14/H15 的人工入口之一）。
// 形状（RUNBOOK §5 解冻语义）：置启用 + 清 fail_count + 清 extra.last_error + 把 next_fetch_at 顶到立即到期；
// 保留源级间隔与校验标记（extra 其余键原样）。写前整批备份（--undo 可整体回滚），默认先 dry-run。
// 判定留给下一轮采集之后：恢复不等于修好，活/再熔由探针读数说话（见调用方）。
const { createClient } = require('@libsql/client');
const fs = require('fs');
const path = require('path');
const { maskDeep } = require('../lib/secrets.js');

const OPTS = { apply: false, undo: false, batch: 15, type: 'youtube', backup: '' };
for (const a of process.argv.slice(2)) {
  if (a === '--apply') OPTS.apply = true;
  else if (a === '--undo') OPTS.undo = true;
  else if (a.startsWith('--batch=')) OPTS.batch = parseInt(a.slice(8), 10) || 0;
  else if (a.startsWith('--type=')) OPTS.type = a.slice(7);
  else if (a.startsWith('--backup=')) OPTS.backup = a.slice(9);
}

for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(l.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const isYT = (t, e) => String(t).toLowerCase() === 'youtube' || /youtube/i.test(String(e || ''));

async function qAll(sql, args = []) { const r = await db.execute({ sql, args }); return r.rows; }
async function qRun(sql, args = []) { return db.execute({ sql, args }); }

(async () => {
  if (OPTS.undo) {
    // 整体回滚：把备份里那批源的三列（enabled/fail_count/extra）原样写回。
    if (!OPTS.backup) { console.error('--undo 需带 --backup=<备份路径>'); process.exitCode = 1; return; }
    const rows = JSON.parse(fs.readFileSync(OPTS.backup, 'utf8')).rows;
    let n = 0;
    for (const s of rows) {
      await qRun('UPDATE sources SET enabled=?, fail_count=?, extra=? WHERE id=?', [s.enabled, s.fail_count, s.extra, s.id]);
      n++;
    }
    console.log(`undo 完成：回滚 ${n} 个源（来源 ${OPTS.backup}）`);
    db.close(); process.exitCode = 0; return;
  }

  const rows = await qAll('SELECT id, name, type, enabled, fail_count, extra, last_fetched_at FROM sources');
  const all = rows.filter(s => isYT(s.type, s.extra));
  const { breakerThreshold } = require('../lib/source-breaker.js');
  const th = breakerThreshold('youtube');
  const frozen = all.filter(s => Number(s.enabled) === 0 && Number(s.fail_count || 0) >= th);
  const pick = frozen.slice(0, OPTS.batch);
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const backupDir = path.join('docs', 'eval');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `restore-${OPTS.type}-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({ at: new Date().toISOString(), count: pick.length, threshold: th, rows: pick }, null, 1));
  console.log(`备份已写：${backupPath}（${pick.length} 个源，阈值 ${th}）`);
  console.log(`该类型熔断总数 ${frozen.length}，本次选 ${pick.length} 个`);

  if (!OPTS.apply) { console.log('dry-run 完毕；要真恢复加 --apply --backup=' + backupPath); db.close(); process.exitCode = 0; return; }
  if (!OPTS.backup || OPTS.backup !== backupPath) { console.error('为防误操作：--apply 必须显式带上刚写的备份路径 --backup=' + backupPath); process.exitCode = 1; return; }

  const nowIso = new Date().toISOString();
  let done = 0;
  for (const s of pick) {
    const extra = (() => { try { return JSON.parse(String(s.extra || '{}')); } catch { return {}; } })();
    delete extra.last_error;
    extra.restore_probe = { at: nowIso, by: 'probe-restore-frozen', prev_fail_count: Number(s.fail_count || 0) };
    await qRun("UPDATE sources SET enabled=1, fail_count=0, status='ok', extra=?, next_fetch_at=? WHERE id=?", [JSON.stringify(extra), nowIso, s.id]);
    done++;
  }
  console.log(`已恢复 ${done} 个源：enabled=1 fail_count=0 status=ok，extra.last_error 已清、next_fetch_at 顶到 ${nowIso}（立即到期，下一轮采集即取）`);
  console.log('审计写入 extra.restore_probe（at/by/prev_fail_count）；回滚命令：node tools/probe-restore-frozen.js --undo --backup=' + backupPath);
  db.close(); process.exitCode = 0;
})().catch(e => { console.error('FAIL:', e.message); try { db.close(); } catch {} process.exitCode = 1; });
