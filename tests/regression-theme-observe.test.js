// 导语归因锁 T1~T4（H30）
// 为什么有这几条（用户 09-24）：「我们要让功能正式的可以使用，能进行之前所说的各项功能，
//   而不是之前验证的一半停摆一半未开发」。实测：库里 16 期 AI 档有 **15 期 theme 为空**（94%），
//   而 `api/_ai.js#generateTheme` 的三条 `return null` 出口**既不落日志也不入库**——
//   "模型没答"与"答了但被污染判据否决"在事后完全无法区分，所以这条 ✅ 一直挂着却没人知道它没在工作。
//   本锁钉的是**归因必须可区分**（why 三态）+ **旧字符串契约不许被我改坏**（另两个调用方还在用）。
// 取证：`tools/_probe-ai-feature-presence.cjs`（只读）；读数写在 docs/ISSUES.md H30。
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const ai = require('../api/_ai.js');

test('T1 pickThemeReply 三条空出口各自可区分（why 不许混成一个 null）', () => {
  const ok = ai.pickThemeReply('从模型发布，到芯片管制，再到开源反扑，本周的主线是算力政治化。');
  assert.equal(typeof ok.theme, 'string', '正常导语必须仍返回字符串（旧契约）');
  assert.ok(!ok.why, '有导语时不该带 why');

  const rejected = ai.pickThemeReply('用户希望我作为科技媒体主编，从入选列表中提炼出一句话导语\n让我来概括今日主题');
  assert.equal(rejected.theme, null);
  assert.equal(rejected.why, 'all_lines_rejected', '每行都是元文本 ⇒ 必须是 all_lines_rejected，不许与"模型没答"混同');
  assert.equal(rejected.lines, 2);

  // 这句要"活过"行级 isAnalysis（不以 我/让我/我来 开头、不长、不以冒号结尾），
  // 再被 picked 级的一票否决打掉（含"叙事"）——只有这种两层不同判的形状才能证明 why 是分得开的
  const vetoed = ai.pickThemeReply('本周报道的核心叙事集中在芯片出口管制与模型开源两条线，读者可以从多个角度理解它。');
  assert.equal(vetoed.theme, null);
  assert.equal(vetoed.why, 'picked_vetoed', '挑出来又被一票否决 ⇒ 必须是 picked_vetoed（这条最能暴露判据过严）');
  assert.ok(typeof vetoed.detail === 'string' && vetoed.detail.length > 0, '被否决那句要留下前 60 字，否则无法回看是不是误杀');
});

test('T2 空输入与纯空白不许抛错，且给得出 why（探针与线上都会喂到这种形状）', () => {
  for (const bad of ['', null, undefined, '\n\n  \n']) {
    const r = ai.pickThemeReply(bad);
    assert.equal(r.theme, null);
    assert.ok(r.why, `空输入 "${String(bad)}" 必须带 why，不许静默 null`);
  }
});

test('T3 旧的字符串契约没被改坏：generateTheme(items) 与 detailed 版同判', async () => {
  // 不联网：只验证两个入口的关系（detailed 是形状来源，generateTheme 是它的 .theme 投影）
  const src = require('node:fs').readFileSync(require.resolve('../api/_ai.js'), 'utf8');
  assert.match(src, /async function generateTheme\(items\) \{\s*return \(await generateThemeDetailed\(items\)\)\.theme;/,
    'generateTheme 必须是 generateThemeDetailed 的 .theme 投影 —— 周刊/我的早报两个调用方只吃字符串，形状一改它们就全空');
  assert.equal(typeof ai.generateTheme, 'function');
  assert.equal(typeof ai.generateThemeDetailed, 'function');
  assert.equal(typeof ai.pickThemeReply, 'function');
});

test('T4 runner 在 theme 为空时必须把 themeSkip 写进 stats（不许只 log 一句就过）', () => {
  const src = require('node:fs').readFileSync(require.resolve('../tools/collect-turso.js'), 'utf8');
  assert.match(src, /generateThemeDetailed\(allItems\)/, 'runner 又用回只吃字符串的 generateTheme ⇒ 归因会重新消失');
  assert.match(src, /themeSkip: \{ why:/, 'stats 里少了 themeSkip ⇒ H30 又变回看不见');
  assert.match(src, /why: 'throw'/, '抛错分支也必须被归因（原来这条只在日志里，事后查不到）');
});
