// 实时探测：查询运行中后端的 /api/sources，计算真实的 next_fetch_at 间隔分布
// 目的：用 fresh live evidence 核实 .reschedule-out.json 的 stale8hAfter=115 与报告声称 =0 的矛盾
const fs = require('fs');

function intervalMinFor(src, intervals) {
  // 复刻 store.js intervalMinFor 逻辑
  let extra = {};
  try { extra = JSON.parse(src.extra || '{}'); } catch {}
  const per = Number(extra.intervalMin);
  if (Number.isFinite(per) && per > 0) return per;
  if (src.type === 'bilibili') return Number(intervals.bilibili) || 60;
  if (src.type === 'douyin') return Number(intervals.douyin) || 360;
  return (Number(intervals.rss) || 8) * 60;
}

(async () => {
  const out = { probeAt: new Date().toISOString(), error: null };
  try {
    const r = await fetch('http://127.0.0.1:3000/api/sources');
    const j = await r.json();
    const items = j.items || [];
    // 全局 intervals 无法从 /api/sources 直接拿到，用默认 {rss:8} 兜底（与 store.js 一致）
    const intervals = { rss: 8 };
    const now = Date.now();
    let stale8h = 0; // next_fetch_at 距 last_fetched_at > 6h 的源（wemp/hotlist 应为 30min，若>6h 即陈旧）
    let noLastFetch = 0;
    const byType = {};
    const staleSamples = [];
    for (const s of items) {
      const exp = intervalMinFor(s, intervals);
      byType[s.type] = byType[s.type] || { n: 0, expIntervalSet: {}, stale: 0 };
      byType[s.type].n++;
      byType[s.type].expIntervalSet[exp] = (byType[s.type].expIntervalSet[exp] || 0) + 1;
      if (!s.last_fetched_at) { noLastFetch++; continue; }
      const last = new Date(s.last_fetched_at).getTime();
      const next = s.next_fetch_at ? new Date(s.next_fetch_at).getTime() : null;
      if (next == null) continue;
      const gapMin = Math.round((next - last) / 60000);
      // 陈旧判据：期望 <=60min 的短周期源(wemp/hotlist)，实际 gap > 360min(6h) 即为残留 8h 陈旧 deadline
      if (exp <= 60 && gapMin > 360) {
        stale8h++;
        byType[s.type].stale++;
        if (staleSamples.length < 12) staleSamples.push({ id: s.id, name: s.name, type: s.type, expMin: exp, gapMin, next: s.next_fetch_at });
      }
    }
    out.total = items.length;
    out.noLastFetch = noLastFetch;
    out.stale8hAfter = stale8h; // 与 .reschedule-out.json 同名指标，用明确判据重算
    out.byType = byType;
    out.staleSamples = staleSamples;
    // 附带：next_fetch_at 相对 now 的未来分布
    const future = { overdue: 0, within1h: 0, within8h: 0, beyond8h: 0, null: 0 };
    for (const s of items) {
      if (!s.next_fetch_at) { future.null++; continue; }
      const d = (new Date(s.next_fetch_at).getTime() - now) / 60000;
      if (d <= 0) future.overdue++;
      else if (d <= 60) future.within1h++;
      else if (d <= 480) future.within8h++;
      else future.beyond8h++;
    }
    out.futureDist = future;
  } catch (e) {
    out.error = String(e && e.message || e);
  }
  fs.writeFileSync(__dirname + '/.live-reschedule-probe.json', JSON.stringify(out, null, 2));
  console.log('PROBE_DONE stale8hAfter=' + out.stale8hAfter + ' total=' + out.total + ' err=' + out.error);
})();
