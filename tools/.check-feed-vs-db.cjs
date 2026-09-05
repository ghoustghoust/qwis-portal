// tools/check-feed-vs-db.cjs - Feed vs DB 对比脚本

const http = require('http');
const { db } = require('../server/db');

async function getFeedArticles() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:8001/feed/MP_WXS_3236757533.atom?limit=50', res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function getDbArticles() {
  const rows = db.prepare(`
    SELECT id, title, url, published_at, created_at, LENGTH(content_html) as clen
    FROM articles WHERE source_id=30 ORDER BY published_at DESC LIMIT 50
  `).all();
  
  return rows.map(r => ({
    ...r,
    pubDate: new Date(r.published_at),
    createdAt: new Date(r.created_at),
    delayMin: Math.round((r.createdAt - r.pubDate) / 60000)
  }));
}

async function main() {
  console.log('[FEED vs DB COMPARISON]\n');
  console.log('=' .repeat(80));
  
  // Get feed
  const feedData = await getFeedArticles();
  const feedTitles = Array.from(feedData.matchAll(/<title>(.*?)<\/title>/g), m => m[1]);
  const feedLinks = Array.from(feedData.matchAll(/<link href="([^"]+)"/g), m => m[1]);
  
  console.log('\n>>> FEED ANALYSIS');
  console.log(`Total <title> tags: ${feedTitles.length}`);
  console.log(`Total <entry> blocks: ${(feedData.match(/<entry>/g)||[]).length}`);
  console.log('\nLatest entries:');
  feedLinks.slice(1, 20).forEach((url, i) => {
    console.log(`  ${i + 1}. [${feedTitles[i + 1]?.substring(0, 40) || 'N/A'}]`);
    console.log(`     URL: ${url.substring(0, 60)}...`);
  });
  
  // Get DB
  const dbArticles = await getDbArticles();
  
  console.log('\n' + '=' .repeat(80));
  console.log('\n>>> DATABASE ANALYSIS');
  console.log(`Total articles in DB: ${dbArticles.length}`);
  console.log('\nRecent entries:');
  dbArticles.slice(0, 20).forEach((article, i) => {
    console.log(`  ${i + 1}. [${article.title.substring(0, 40)}...]`);
    console.log(`     Published: ${article.published_at}`);
    console.log(`     Delay: ${article.delayMin}min | Content len: ${article.clen}`);
  });
  
  // Compare
  console.log('\n' + '=' .repeat(80));
  console.log('\n>>> COMPARISON');
  
  const feedUrls = new Set(feedLinks.slice(1).map(u => u.split('?')[0])); // Remove anchor params
  const dbUrls = new Set(dbArticles.map(a => a.url.split('?')[0]));
  
  const inFeedNotInDb = Array.from(feedUrls).filter(u => !dbUrls.has(u)).slice(0, 15);
  const inDbNotInFeed = Array.from(dbUrls).filter(u => !feedUrls.has(u)).slice(0, 5);
  
  console.log(`\n📄 Articles IN FEED but NOT IN DB (missed):`);
  if (inFeedNotInDb.length === 0) {
    console.log('   ✅ All feed articles are in DB');
  } else {
    inFeedNotInDb.forEach(url => console.log(`   ❌ ${url}`));
  }
  
  console.log(`\n📄 Articles IN DB but NOT IN FEED (expired):`);
  if (inDbNotInFeed.length === 0) {
    console.log('   ✅ No expired articles');
  } else {
    inDbNotInFeed.forEach(url => console.log(`   ℹ️  ${url}`));
  }
  
  // Summary
  console.log('\n' + '=' .repeat(80));
  console.log('\nSUMMARY:');
  console.log(`Feed has ${feedUrls.size} articles, DB has ${dbUrls.size} articles`);
  console.log(`Missed articles (in Feed, not in DB): ${inFeedNotInDb.length}`);
  console.log(`Expired articles (in DB, not in Feed): ${inDbNotInFeed.length}`);
  
  if (inFeedNotInDb.length > 0) {
    console.log('\n⚠️  CRITICAL: We are MISSING articles from the feed!');
    console.log('This is NOT a frontend issue - this is a BACKEND ingestion problem.');
    console.log('The feed fetch has not been triggered recently or the parser failed.');
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
