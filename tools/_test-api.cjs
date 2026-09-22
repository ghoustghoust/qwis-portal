const fs = require('fs');
const path = require('path');
const { CLOUD_SITE } = require('../lib/cloud-site');


// 加载 .env
const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
for (const line of envContent.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

async function testCollect() {
  const url = `${CLOUD_SITE}/api/collect?key=${process.env.COLLECT_KEY}&mode=debug`;
  // B70④：掩码不得依赖 env 已加载——key 未加载时 replace(undefined) 会把密钥原样打印（B110/坑 #69 同族）。
  // 直接按参数名遮值，与 env 加载与否无关
  console.log('Testing:', url.replace(/(key=)[^&]+/, '$1***'));
  
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(url, { method: 'POST', signal: ctrl.signal });
    clearTimeout(timer);
    const text = await res.text();
    console.log('Status:', res.status);
    console.log('Response:', text.slice(0, 500));
  } catch (e) {
    console.log('Error:', e.message);
  }
}

async function testArticles() {
  const url = `${CLOUD_SITE}/api/articles?sort=new&limit=3`;
  console.log('\nTesting:', url);
  
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    const data = await res.json();
    console.log('Status:', res.status);
    if (data.items) {
      data.items.forEach(a => {
        console.log(`  - ${a.title?.slice(0, 50)} | published: ${a.published_at} | created: ${a.created_at}`);
      });
    }
  } catch (e) {
    console.log('Error:', e.message);
  }
}

async function testStatus() {
  const url = `${CLOUD_SITE}/api/status`;
  console.log('\nTesting:', url);
  
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    const data = await res.json();
    console.log('Status:', res.status);
    console.log('Response:', JSON.stringify(data, null, 2).slice(0, 300));
  } catch (e) {
    console.log('Error:', e.message);
  }
}

(async () => {
  await testStatus();
  await testArticles();
  await testCollect();
})();
