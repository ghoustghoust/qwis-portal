// tools/check-official-vs-we-mp.cjs - 对比官方 RSS vs we-mp-rss

const http = require('http');
const https = require('https');
const { db } = require('../server/db');

async function checkOfficialRSS() {
  return new Promise((resolve, reject) => {
    https.get('https://qbitai.com/feed/', res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function checkWeMpFeed() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:8001/feed/MP_WXS_3236757533.atom?limit=50', res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function main() {
  console.log('[OFFICIAL RSS vs WE-MP-RSS COMPARISON]\n');
  
  const [officialRSS, weMpFeed] = await Promise.all([checkOfficialRSS(), checkWeMpFeed()]);
  
  // Parse official RSS
  const officialTitles = Array.from(officialRSS.matchAll(/<title>(.*?)<\/title>/g), m => ({
    title: m[1],
    link: Array.from(officialRSS.matchAll(/<link href="([^"]+)"/g), m => m[1])[1]
  })).slice(1, 20);
  
  // Parse we-mp feed
  const weMpTitles = Array.from(weMpFeed.matchAll(/<title>(.*?)<\/title>/g), m => ({
    title: m[1],
    link: Array.from(weMpFeed.matchAll(/<link href="([^"]+)"/g), m => m[1])[1]
  })).slice(1, 20);
  
  console.log('>>> OFFICIAL RSS (https://qbitai.com/feed/)');
  console.log(`Total entries: ${officialTitles.length}`);
  console.log('\nLatest articles:');
  officialTitles.forEach((t, i) => {
    console.log(`  ${i + 1}. ${t.title.substring(0, 50)}...`);
  });
  
  console.log('\n\n>>> WE-MP-RSS (http://127.0.0.1:8001/feed/MP_WXS_3236757533.atom)');
  console.log(`Total entries: ${weMpTitles.length}`);
  console.log('\nLatest articles:');
  weMpTitles.forEach((t, i) => {
    console.log(`  ${i + 1}. ${t.title.substring(0, 50)}...`);
  });
  
  console.log('\n' + '='.repeat(80));
  console.log('\nCOMPARISON:\n');
  
  const officialUrls = new Set(officialTitles.map(t => t.link.split('?')[0]));
  const weMpUrls = new Set(weMpTitles.map(t => t.link.split('?')[0]));
  
  const onlyInOfficial = Array.from(officialUrls).filter(url => !weMpUrls.has(url)).slice(0, 15);
  
  if (onlyInOfficial.length > 0) {
    console.log(`⚠️  CRITICAL ISSUE: ${onlyInOfficial.length} articles are in Official RSS but NOT in we-mp-rss!`);
    console.log('\nThese missing articles:');
    onlyInOfficial.forEach(url => {
      const title = officialTitles.find(t => t.link?.split('?')[0] === url)?.title || 'N/A';
      console.log(`  ❌ ${title.substring(0, 60)}`);
      console.log(`     ${url}`);
    });
    console.log('\n\nROOT CAUSE: we-mp-rss is NOT fetching the latest articles from WeChat Read!');
    console.log('This is a BUG in the weread采集 channel of we-mp-rss.');
  } else {
    console.log('✅ Both feeds have same articles');
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
