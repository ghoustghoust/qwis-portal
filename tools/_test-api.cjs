const fs = require('fs');
const path = require('path');

// 加载 .env
const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
for (const line of envContent.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

async function testCollect() {
  const url = `https://qwis-intel.vercel.app/api/collect?key=${process.env.COLLECT_KEY}&mode=debug`;
  console.log('Testing:', url.replace(process.env.COLLECT_KEY, '***'));
  
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
  const url = 'https://qwis-intel.vercel.app/api/articles?sort=new&limit=3';
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
  const url = 'https://qwis-intel.vercel.app/api/status';
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
