// tools/verify-restart-diagnostic.cjs - 重启后完整性验证脚本

const http = require('http');
const { db } = require('../server/db');

async function checkSource(source) {
  const rows = db.prepare(`
    SELECT id, title, url, published_at, created_at, 
      LENGTH(content_html) as clen,
      CASE WHEN LENGTH(content_html) > 500 THEN 'full' ELSE 'summary' END as type
    FROM articles
    WHERE source_id = ?
    ORDER BY published_at DESC
    LIMIT 5
  `).all(source.id);
  
  return {
    name: source.name,
    total: rows.length,
    latestPubDate: rows[0]?.published_at || null,
    fullCount: rows.filter(r => r.type === 'full').length,
    summaryCount: rows.filter(r => r.type === 'summary').length,
    avgLength: rows.reduce((sum, r) => sum + r.clen, 0) / (rows.length || 1),
    delays: rows.map(r => ({
      pubDate: r.published_at,
      delayMin: Math.round((new Date(r.created_at) - new Date(r.published_at)) / 60000)
    }))
  };
}

async function main() {
  console.log('[RESTART VERIFICATION AUDIT]\n');
  console.log('Sources to check:');
  
  // Quantum Bit - use correct LIKE syntax with %
  const qbitId = db.prepare("SELECT id FROM sources WHERE name LIKE '%量子位%'").get().id;
  const qbit = await checkSource({ id: qbitId });
  
  console.log(`\n>>> ${qbit.name} (ID: ${qbitId})`);
  console.log(`Latest pubDate: ${qbit.latestPubDate}`);
  console.log(`Articles: ${qbit.total} (${qbit.fullCount} full, ${qbit.summaryCount} summary)`);
  console.log(`Delays:`, qbit.delays);
  
  // Fetch feed to compare
  const feedPromise = new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:8001/feed/MP_WXS_${qbitId}.atom?limit=5`, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
  
  const feedData = await feedPromise;
  const feedTitles = (feedData.match(/<title>([^<]+)<\/title>/g) || []).map(t => t.replace(/<\/?title>/g, ''));
  console.log(`Feed top titles:`);
  feedTitles.slice(0, 5).forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
  
  console.log('\n' + '='.repeat(80));
  console.log('CONCLUSION:');
  if (qbit.latestPubDate >= new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) {
    console.log('✅ NEWEST ARTICLE IS RECENT (<24h) - FEED FETCH IS WORKING');
  } else {
    console.log('⚠️ OLDEST ARTICLE (>24h) - FEED FETCH HAS NOT RUN');
  }
  console.log('='.repeat(80));
  
  // Output DB state for frontend verification
  const latest = db.prepare('SELECT MAX(published_at) as max_pub FROM articles WHERE source_id=?').get(qbitId);
  console.log(`\nFrontend should show article with pubDate: ${latest.max_pub}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
