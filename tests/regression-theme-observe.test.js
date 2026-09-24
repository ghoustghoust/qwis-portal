// 导语归因锁 T1~T5（H30）
// 为什么有这几条（用户 09-24）：「我们要让功能正式的可以使用，能进行之前所说的各项功能，
//   而不是之前验证的一半停摆一半未开发」。实测（`tools/_probe-ai-feature-presence.cjs`，只读）：
//   库里 AI 档 16 行里 **15 行 theme 为空**；按北京日 5 天里 4 天当天所有期都无导语；全库 57 期只有 1 期带导语
//   （`id=49 / 09-20`）—— 单看"94%"会把"读者几乎从没读到"说成"偶尔读到"，而 `api/_ai.js` 的三条 `return null` 出口
//   **既不落日志也不入库** ⇒ "模型没答"与"答了但被自己的污染判据否决"
//   事后完全分不清，所以这项挂着 ✅ 的功能能安静地缺好几天。
// 两条形状约定（09-24 审查指出后写清）：
//   ① `require('../api/_ai.js')` **放在用例内**，不放文件顶层 —— 顶层加载一旦断，整文件变成"文件名级红"，
//      归因不到具体用例（`docs/pitfalls/testing.md` #67/#120 那一族）；
//   ② 光钉"我这处调用点写对了"不够（T3/T4 的文本正则会漏掉别的调用点），所以补 T5：**全仓扫**
//      `generateThemeDetailed(` 的每一处都必须要么投影 `.theme`、要么把归因写进 stats。
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
// 纯函数提取器（无副作用、不读环境），T6 与 P12 共用同一份 ⇒ 判据不会两边各写一套再漂移
const { objectLiteralKeysAt } = require('../tools/stats-literal-keys.cjs');

const ai = () => require('../api/_ai.js');

test('T1 三条空出口各自可区分（why 不许混成一个 null）', () => {
  const ok = ai().pickThemeReply('从模型发布，到芯片管制，再到开源反扑，本周的主线是算力政治化。');
  assert.equal(typeof ok.theme, 'string', '正常导语必须仍返回字符串（旧契约）');
  assert.ok(!ok.why, '有导语时不该带 why');

  const rejected = ai().pickThemeReply('用户希望我作为科技媒体主编，从入选列表中提炼出一句话导语\n让我来概括今日主题');
  assert.equal(rejected.theme, null);
  assert.equal(rejected.why, 'all_lines_rejected', '每行都是元文本 ⇒ 必须是 all_lines_rejected，不许与"模型没答"混同');
  assert.equal(rejected.lines, 2);

  // 这句要"活过"行级 isAnalysis（不以 我/让我/我来 开头、不长、不以冒号结尾），再被 picked 级一票否决打掉（含"叙事"）
  const vetoed = ai().pickThemeReply('本周报道的核心叙事集中在芯片出口管制与模型开源两条线，读者可以从多个角度理解它。');
  assert.equal(vetoed.theme, null);
  assert.equal(vetoed.why, 'picked_vetoed', '挑出来又被一票否决 ⇒ 必须是 picked_vetoed（这条最能暴露判据过严）');
  assert.ok(typeof vetoed.detail === 'string' && vetoed.detail.length > 0, '被否决那句要留下前 60 字，否则无法回看是不是误杀');
});

test('T2 空输入与纯空白不许抛错，且给得出 why（线上与探针都会喂到这种形状）', () => {
  for (const bad of ['', null, undefined, '\n\n  \n']) {
    const r = ai().pickThemeReply(bad);
    assert.equal(r.theme, null);
    assert.ok(r.why, `空输入 "${String(bad)}" 必须带 why，不许静默 null`);
  }
});

test('T3 旧的字符串契约没被改坏：generateTheme 仍是 detailed 版的 .theme 投影', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', '_ai.js'), 'utf8');
  assert.match(src, /async function generateTheme\(items\) \{\s*return \(await generateThemeDetailed\(items\)\)\.theme;/,
    'generateTheme 必须是 generateThemeDetailed 的 .theme 投影 —— 周刊/我的早报两个调用方只吃字符串，形状一改它们就全空');
  for (const fn of ['generateTheme', 'generateThemeDetailed', 'pickThemeReply']) {
    assert.equal(typeof ai()[fn], 'function', `导出缺 ${fn}`);
  }
});

test('T4 runner 在 theme 为空时必须把 themeSkip 写进 stats（不许只 log 一句就过）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'collect-turso.js'), 'utf8');
  assert.match(src, /generateThemeDetailed\(allItems\)/, 'runner 又用回只吃字符串的 generateTheme ⇒ 归因会重新消失');
  assert.match(src, /themeSkip: \{ why:/, 'stats 里少了 themeSkip ⇒ H30 又变回看不见');
  assert.match(src, /why: 'throw'/, '抛错分支也必须被归因（原来这条只在日志里，事后查不到）');
});

test('T6 读层每一处 report 字面量的**顶层**必须带 theme/schemaVersion/degraded（括号配平，不数窗口）', () => {
  // 为什么（09-24 三轮对抗审查逐步收紧）：
  //   第 1 轮抓出：新鲜分支给三个字段，过期分支只给 sections/stats ⇒ "库里有导语但读者看不到"（B112 同族）。
  //   第 2 轮抓出：只扫 handleDaily 会漏第 4 处（`handleDailyRegenerate`，后台点"重新生成"后回给前端的那份）。
  //   第 3 轮抓出：判据形式本身还是错的 —— "锚点后 700 字符里含 `theme:` 字样"三种假绿：① 注释里写一句就满足
  //   ② 字段嵌进子对象（前端只认 `item.theme`）也满足 ③ 两处返回点挨得近时，下一站的字段被算进这一站。
  //   ⇒ 换成 objectLiteralKeysAt：括号配平取字面量原文、只认**深度 1** 的键（同一个提取器已被 P12 的坏样本自证过）。
  const files = ['api/[...slug].js', 'api/daily-generate.js'];
  let sites = 0;
  for (const rel of files) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const anchor of ['report: {', 'report = {']) {
      for (const s of objectLiteralKeysAt(text, anchor)) {
        sites++;
        for (const k of ['theme', 'schemaVersion', 'degraded']) {
          assert.ok(s.keys.includes(k), `${rel}:${s.line} 的 ${anchor} 字面量缺顶层键 ${k} —— 走这条分支的读者看不到导语/档位（B112 同族）`);
        }
      }
    }
  }
  assert.ok(sites >= 5, `部署面只扫到 ${sites} 处 report 字面量（<5），判据已空转 —— 写法变了或文件变了就要同步这里`);
});

test('T8 每一处 buildThemePanorama 调用都必须取 .themes（返回形状从数组改成对象后的防漏锁）', () => {
  // 为什么（H32）：为了把"聚到几簇 / 命名成几个 / 四条出口各丢几次"落进库，
  // `buildThemePanorama` 的返回值从 `themes[]` 改成 `{themes, found, multi, named, drops}`。
  // 形状一改就漏一个调用方 ⇒ 症状是"主题全景永远空"且不报错（`themes` 变成对象，前端拿不到数组），
  // 正是本轮反复抓的那一类"静默降级"。所以调用点要机械扫，不靠记性。
  const SKIP = new Set(['node_modules', '.git', 'dist', 'data', 'archive']);
  const hits = [];
  (function sweep(dir) {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) { sweep(rel); continue; }
      if (!/\.(js|cjs|mjs)$/.test(e.name)) continue;
      const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      for (const m of text.matchAll(/buildThemePanorama\(/g)) {
        if (text.slice(Math.max(0, m.index - 20), m.index).includes('async function')) continue; // 定义处
        hits.push({ rel, ok: text.slice(m.index, m.index + 170).includes('.themes') });
      }
    }
  })('');
  assert.ok(hits.length >= 2, `只扫到 ${hits.length} 处调用点，判据已空转`);
  for (const h of hits) assert.ok(h.ok, `${h.rel} 有一处 buildThemePanorama 调用没取 .themes —— 会把对象当数组用，主题全景静默变空`);
});

test('T10 buildThemePanorama 里每一条 continue 都必须先给自己计数（H32：五条静默出口）', () => {
  // 为什么（H32 实测 + 第五轮审查补的第 5 条）：`themes: []` 这个读数原本分不清"标题聚不到簇"与"聚到了但命名/解析被丢掉"，
  // 因为循环里有五条 `continue` 一条都不留痕（切不出 token / !r.ok / 匹配不到 JSON / 缺 name|summary / parse 抛）。
  // 现在五条各自 bump() 计数。判据是机械的：函数体内每个 `continue` 之前必须有 `bump(`。
  // 这条锁**上岗当天就抓到一处**：我第一版只数了命名循环那四条，被它判红的是聚类循环里"标题切不出 token 就跳过"那条。
  // 坏样本（F2P 已做）：把任意一条 bump 摘掉 ⇒ 本条红；说明它真在管这件事，不是恒绿。
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'collect-turso.js'), 'utf8');
  const i = src.indexOf('async function buildThemePanorama(');
  assert.ok(i > 0, '找不到 buildThemePanorama —— 改名要同步这条锁');
  const body = src.slice(i, src.indexOf('\n}', src.indexOf('return { themes', i)));
  const cont = [...body.matchAll(/\bcontinue\b/g)];
  assert.ok(cont.length >= 4, `只扫到 ${cont.length} 条 continue，判据已空转（出口被合并也要同步这里）`);
  for (const c of cont) {
    const back = body.slice(Math.max(0, c.index - 60), c.index);
    assert.ok(/bump\(/.test(back), `命名循环里有一条 continue 前面没有 bump() 计数 ⇒ 它丢掉的是"已经聚出来的整簇"，线上只会看到 themes:[]（H32 的病根本身）`);
  }
});
test('T7 提取器自证：注释与字符串里的 `report: {` 不算返回点', () => {
  // 为什么（09-24 第四轮审查实测）：上一版 `objectLiteralKeysAt` 不认注释 ⇒ 一个洞两种坏：
  //   ① 注释里写一行"旧写法 report: { sections, stats }"就被判成缺字段的返回点（假红）；
  //   ② 反过来能用注释把 `sites>=5` 这条防空转的担保凑满（假绿）。
  //   坏样本就在这里喂：三行注释/字符串里的锚点必须全部不算，真返回点必须算且键读对。
  const { objectLiteralKeysAt } = require('../tools/stats-literal-keys.cjs');
  const fixture = [
    'const a = jsonOk({ report: { sections, stats, theme: null, schemaVersion: 1, degraded: false } });',
    '// 旧写法 report: { sections, stats } 已经废了',
    '/* 文档里的样例 report: { sections } */',
    'const u = "https://example.com/report: {not-a-site}";',
  ].join('\n');
  const got = objectLiteralKeysAt(fixture, 'report: {');
  assert.equal(got.length, 1, `注释/字符串里的锚点被当成返回点了：实得 ${got.length} 处（应为 1）`);
  assert.deepEqual(got[0].keys, ['sections', 'stats', 'theme', 'schemaVersion', 'degraded'],
    '真返回点的顶层键读错 ⇒ T6 整把锁的判据不可信');
});

test('T5 全仓扫：每一处 generateThemeDetailed 调用都必须投影 .theme 或落归因（防"别处用错形状还全绿"）', () => {
  const SKIP = new Set(['node_modules', '.git', 'dist', 'data', 'archive']);
  const hits = [];
  (function sweep(dir) {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) { sweep(rel); continue; }
      if (!/\.(js|cjs|mjs)$/.test(e.name)) continue;
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      for (const m of src.matchAll(/generateThemeDetailed\s*\(/g)) {
        hits.push({ rel, around: src.slice(Math.max(0, m.index - 90), m.index + 220) });
      }
    }
  })('');
  // 定义处（api/_ai.js 里的 `async function generateThemeDetailed`）不算调用点
  const calls = hits.filter((h) => !/function generateThemeDetailed/.test(h.around.replace(/\s+/g, ' ')));
  assert.ok(calls.length >= 1, '一处调用都扫不到 = 判据已经空转（改名/搬走都可能造成这种假绿）');
  for (const c of calls) {
    const projected = /\)\s*\.theme\b/.test(c.around) || /\.theme\b/.test(c.around);
    const attributed = /themeSkip/.test(c.around) || /\bth\.theme\b/.test(c.around);
    assert.ok(projected || attributed,
      `${c.rel} 里有一处 generateThemeDetailed(...) 既没投影 .theme 也没落归因 —— `
      + `它会把对象当字符串用（前端渲染成 [object Object]），而 T3/T4 看不见别处`);
  }
});
