// 直接调用 Vercel collect 函数，测试是否能成功
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
for (const line of envContent.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

async function testCollect() {
  const url = `https://qwis-intel.vercel.app/api/collect?key=${process.env.COLLECT_KEY}`;
  console.log('Calling:', url.replace(process.env.COLLECT_KEY, '***'));
  console.log('Time:', new Date().toISOString());
  
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const start = Date.now();
    const res = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
    });
    const elapsed = Date.now() - start;
    clearTimeout(timer);
    const text = await res.text();
    console.log(`Status: ${res.status} (${elapsed}ms)`);
    console.log(`Headers:`, Object.fromEntries(res.headers.entries()));
    console.log(`Body:`, text.slice(0, 1000));
  } catch (e) {
    console.log('Error:', e.message);
    console.log('Cause:', e.cause?.message || e.cause?.code || 'unknown');
  }
}

testCollect();
