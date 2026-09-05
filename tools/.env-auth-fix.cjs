// 一次性脚本：统一放行——注释掉 .env 中的 API_TOKEN（不打印其值，可逆）
// 逻辑：找到活跃的 API_TOKEN=... 行 → 前置注释保留原值；幂等（已注释则跳过）
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
const report = { ok: false };
try {
  if (!fs.existsSync(envPath)) {
    report.reason = 'no .env file';
    console.log(JSON.stringify(report));
    process.exit(0);
  }
  const raw = fs.readFileSync(envPath, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);
  let foundActive = 0, foundEmpty = 0, alreadyCommented = 0, changed = 0;
  const out = [];
  for (const line of lines) {
    if (/^\s*#\s*API_TOKEN\s*=/.test(line)) { alreadyCommented++; out.push(line); continue; }
    if (/^\s*API_TOKEN\s*=/.test(line)) {
      foundActive++;
      const val = line.slice(line.indexOf('=') + 1).trim();
      if (val === '' || val === '""' || val === "''") { foundEmpty++; out.push(line); continue; }
      changed++;
      out.push('# [auth-fix 2026-09-02] 统一放行（本机/可信LAN）：注释 API_TOKEN 使 REQUIRE_TOKEN=false；如需恢复鉴权，删除下一行行首的 "# " 即可');
      out.push('# ' + line);
      continue;
    }
    out.push(line);
  }
  if (changed > 0) fs.writeFileSync(envPath, out.join(eol), 'utf8');
  report.ok = true;
  report.foundActive = foundActive;   // 活跃 API_TOKEN 行数
  report.foundEmpty = foundEmpty;     // 活跃但值为空（本就等效禁用）
  report.alreadyCommented = alreadyCommented;
  report.changed = changed;           // 实际注释掉的行
  report.wroteBack = changed > 0;
  console.log(JSON.stringify(report));
} catch (e) {
  report.error = String(e && e.message || e);
  console.log(JSON.stringify(report));
}
