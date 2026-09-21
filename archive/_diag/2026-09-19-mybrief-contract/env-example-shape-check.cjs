/* 一次性（只读，不回显任何值）：核 `.env.example` 里哪些键写了"看起来像真值"的内容，
   以及是否与本地 .env 的真值逐字相同。只打印键名 + 三个布尔。用完即删。 */
const fs = require('fs');
const parse = (f) => {
  const m = new Map();
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const x = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (x) m.set(x[1], x[2]);
  }
  return m;
};
const ex = fs.existsSync('.env.example') ? parse('.env.example') : new Map();
const real = parse('.env');
console.log('.env.example 存在 =', fs.existsSync('.env.example'), '；键数 =', ex.size);
const PH = /^(<|\$?\{?(your|Your|YOUR|changeme|CHANGEME|xxx|XXX|put-|replace))/;
for (const [k, v] of [...ex].sort()) {
  const same = real.has(k) && real.get(k) === v;
  if (PH.test(v) || v === '') continue;
  console.log(`  ${k}  长度=${v.length}  与本地真值逐字相同=${same}`);
}
