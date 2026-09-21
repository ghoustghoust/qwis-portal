/* 一次性：拉某个 collect run 的 job 日志，只看 mybrief 相关行（把 B77 的推断变成证据）。用完即删。 */
const { execFileSync } = require('child_process');
const PROXY = 'http://127.0.0.1:12000';
const API = 'https://api.github.com/repos/ghoustghoust/qwis-portal';
function token() {
  const out = execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' });
  return /^password=(.+)$/m.exec(out)[1].trim();
}
const gh = (t, url) => JSON.parse(execFileSync('curl', ['-sS', '--ssl-no-revoke', '-x', PROXY,
  '-H', 'Accept: application/vnd.github+json', '-H', 'Authorization: Bearer ' + t, '-H', 'User-Agent: qwis-eval', url],
  { encoding: 'utf8', maxBuffer: 40 << 20 }));

(async () => {
  const t = token();
  const runs = gh(t, API + '/actions/runs?per_page=12').workflow_runs.filter((r) => /06:45|07:01|07:15|07:30|06:32|06:15|05:45/.test(r.created_at));
  for (const r of runs) {
    const jobs = gh(t, API + `/actions/runs/${r.id}/jobs`).jobs;
    console.log(`\n### run ${r.id} ${r.created_at} head=${r.head_sha.slice(0, 7)} jobs=${jobs.map((j) => j.name + ':' + j.conclusion).join(',')}`);
    for (const j of jobs) {
      let text = '';
      try { text = execFileSync('curl', ['-sSL', '--ssl-no-revoke', '-x', PROXY, '-H', 'Authorization: Bearer ' + t,
        API + `/actions/jobs/${j.id}/logs`], { encoding: 'utf8', maxBuffer: 60 << 20 }); } catch (e) { console.log('  日志拉取失败', String(e.message).split('\n')[0]); continue; }
      const hits = text.split('\n').filter((l) => /mybrief|订阅源今日|无深析/.test(l));
      console.log(`  job ${j.name}: mybrief 相关 ${hits.length} 行`);
      for (const h of hits.slice(-8)) console.log('   ' + h.replace(/^.*?Z\s+/, '').slice(0, 170));
    }
  }
})().catch((e) => { console.log('ERR', String(e.message).split('\n')[0].slice(0, 200)); process.exitCode = 2; });
