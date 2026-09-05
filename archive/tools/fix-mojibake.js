// 存量乱码文章修复:找出 GBK 页面被 UTF-8 误读的文章,用修好的 charset 感知抓取重新拉取并更新
// 乱码特征:锟 /  /  /  /  等 UTF-8-as-GBK 高频碎片字符
// 用法: node tools/fix-mojibake.js        (dry-run,只报告)
//       node tools/fix-mojibake.js --fix  (实际重抓修复)
const path = require('path');
process.env.APP_DATA_DIR = process.env.APP_DATA_DIR || path.join(__dirname, '..', 'data');
// zaochenbao 等站点需要代理
process.env.HTTPS_PROXY = process.env.HTTPS_PROXY || 'http://127.0.0.1:7890';
const { EnvHttpProxyAgent, setGlobalDispatcher } = require('undici');
setGlobalDispatcher(new EnvHttpProxyAgent());

const { db } = require('../server/db');
// UTF-8 被 GBK 误读的特征信号:西里尔字母(Ҫ 等)和罕见符号在中文正文中几乎不会出现
function mojibakeScore(text) {
  if (!text) return 0;
  let n = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if ((cp >= 0x0400 && cp <= 0x04ff) || (cp >= 0x0450 && cp <= 0x045f)) n++; // 西里尔
    else if (cp === 0xFFFD) n += 2; // 替换符
  }
  return n;
}

async function main() {
  const rows = db.prepare(
    "SELECT a.id, a.url, s.name AS sname, substr(a.content_html,1,2000) c FROM articles a JOIN sources s ON s.id=a.source_id"
  ).all();
  const bad = rows.filter((r) => mojibakeScore(r.c) >= 2);
  console.log(`扫描 ${rows.length} 篇,疑似乱码 ${bad.length} 篇`);
  for (const b of bad.slice(0, 20)) console.log(` #${b.id} [${b.sname}] ${b.url}`);

  if (!process.argv.includes('--fix')) return;
  const { _internals } = require('../server/services/collectors/rss');
  const { JSDOM } = require('jsdom');
  const { Readability } = require('@mozilla/readability');
  const upd = db.prepare('UPDATE articles SET content_html=?, summary=? WHERE id=?');
  let ok = 0, fail = 0;
  for (const b of bad) {
    try {
      const html = await _internals.fetchHtmlSmart(b.url);
      const dom = new JSDOM(html, { url: b.url });
      const parsed = new Readability(dom.window.document).parse();
      const content = (parsed && parsed.content) || '';
      if (content.length > 200 && mojibakeScore(content.slice(0, 2000)) < 2) {
        const summary = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
        upd.run(content, summary, b.id);
        ok++;
        console.log(` ✔ #${b.id} 重抓成功(${content.length} 字符)`);
      } else {
        fail++;
        console.log(` ✘ #${b.id} 重抓后仍不可用`);
      }
    } catch (e) {
      fail++;
      console.log(` ✘ #${b.id} ${e.message.slice(0, 80)}`);
    }
    await new Promise((r) => setTimeout(r, 1500)); // 限速
  }
  console.log(`修复完成: 成功 ${ok}, 失败 ${fail}`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
