#!/usr/bin/env node
// 行为标签版三臂评测：不等人工标注，先用**用户自己的行为**给朴素贝叶斯/互补NB/TF-IDF 定性。
//
// 回答的那句话（用户 09-24）：「他是把我们需要的文章干掉了还是没营养的垃圾文章干掉了。
//   如果干掉了需要的文章我们应该考虑能不能更改，最后综合考虑是否采用」。
// 所以判据不是准确率，是**工作点上的误砍率**：初筛层上线后要砍掉池子的 X%，那 X% 里有几篇是真读过的。
//
// 标签来源（全部是库里已有的行为事实，零新增人工）：
//   正=已读 / 稍后读 / 进过精选；负=保留策略自己判定"可删"的那批（7 天前未读未标记非精选）
// 语料由 tools/_probe-behavior-corpus.cjs 只读导出到 data/prescreen-lab/corpus.jsonl（不进 git）。
//
// 用法：node tools/eval-prescreen-behavior.cjs [corpus.jsonl]
'use strict';
const fs = require('fs');
const path = require('path');
const { tokens, fitNB, fitCNB, fitTfidf } = require('./eval-prescreen-learning.cjs');

const FILE = process.argv[2] || path.join(__dirname, '..', 'data', 'prescreen-lab', 'corpus.jsonl');
const ARMS = { NB: fitNB, CNB: fitCNB, 'TF-IDF': fitTfidf };
const pct = (x) => `${(x * 100).toFixed(1)}%`;

// 单一实现的打分入口：任一臂 → 「分数越高越该留」
function scoreWith(armName, train, tok) {
  const f = ARMS[armName](train);
  return (sm) => f(tok(sm));
}
// AUC（Mann-Whitney，带并列值折半）：阈值无关，先回答"这两臂到底有没有信号"
function auc(scored) {
  const pos = scored.filter((x) => x.y === 1).map((x) => x.s);
  const neg = scored.filter((x) => x.y === 0).map((x) => x.s);
  if (!pos.length || !neg.length) return NaN;
  const all = scored.slice().sort((a, b) => a.s - b.s);
  const rank = new Map();
  for (let i = 0; i < all.length;) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].s === all[i].s) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) rank.set(all[k], r);
    i = j + 1;
  }
  const sp = scored.filter((x) => x.y === 1).reduce((a, x) => a + rank.get(x), 0);
  return (sp - (pos.length * (pos.length + 1)) / 2) / (pos.length * neg.length);
}
// 工作点：砍掉分数最低的 cutFrac 比例 → 误砍率 = 被砍里的正样本 / 全部正样本；命中砍 = 被砍里的负样本 / 全部负样本
function atWorkPoint(scored, cutFrac) {
  const srt = scored.slice().sort((a, b) => a.s - b.s);
  const cut = srt.slice(0, Math.round(srt.length * cutFrac));
  const pos = scored.filter((x) => x.y === 1).length;
  const neg = scored.length - pos;
  const cutPos = cut.filter((x) => x.y === 1).length;
  return { cut: cut.length, cutPos, falseCutRate: cutPos / pos, blockRate: (cut.length - cutPos) / neg, sample: cut };
}
function foldAssign(n, k, seed) {
  const idx = [...Array(n).keys()];
  let x = seed >>> 0;
  const rnd = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  const f = new Array(n);
  idx.forEach((v, i) => { f[v] = i % k; });
  return f;
}
// 分层：正负各自分折，避免某折全是负样本导致训练侧没有正类
function stratifiedFolds(rows, k, seed) {
  const f = new Array(rows.length);
  for (const y of [0, 1]) {
    const ids = rows.map((r, i) => (r.y === y ? i : -1)).filter((i) => i >= 0);
    foldAssign(ids.length, k, seed + y).forEach((g, i) => { f[ids[i]] = g; });
  }
  return f;
}
function runCV(rows, tok, k = 5) {
  const prepared = rows.map((r) => ({ ...r, label: r.y === 1 ? 'leave' : 'cut' }));
  prepared.forEach((r) => { r.tokens = tok(r); });
  const folds = stratifiedFolds(prepared, k, 7);
  const out = {};
  const scoredByArm = {};
  for (const arm of Object.keys(ARMS)) {
    const scored = [];
    for (let g = 0; g < k; g++) {
      const train = prepared.filter((_, i) => folds[i] !== g);
      const test = prepared.filter((_, i) => folds[i] === g);
      if (!train.some((t) => t.y === 1) || !train.some((t) => t.y === 0)) continue;
      const s = scoreWith(arm, train, tok);
      for (const t of test) scored.push({ y: t.y, s: s(t), row: t });
    }
    scoredByArm[arm] = scored;
    out[arm] = { aucV: auc(scored), wp25: atWorkPoint(scored, 0.25), wp50: atWorkPoint(scored, 0.5) };
  }
  // 两个对照：长度单特征（正反两向取强的那一个 = 长度能做到的上界）、随机（地板）
  const lenScored = prepared.map((r) => ({ y: r.y, s: -tok(r).length }));
  const lenFlip = prepared.map((r) => ({ y: r.y, s: tok(r).length }));
  out['长度(单特征)'] = (() => {
    const best = auc(lenScored) >= auc(lenFlip) ? lenScored : lenFlip;
    return { aucV: auc(best), wp25: atWorkPoint(best, 0.25), wp50: atWorkPoint(best, 0.5) };
  })();
  const rnd = foldAssign(prepared.length, 1000, 99);
  out['随机'] = { aucV: 0.5, wp25: atWorkPoint(prepared.map((r, i) => ({ y: r.y, s: rnd[i] })), 0.25), wp50: atWorkPoint(prepared.map((r, i) => ({ y: r.y, s: rnd[i] })), 0.5) };
  return { out, scoredByArm, n: prepared.length };
}
// 决策数：在"误砍率不超过 X%"这个约束下，这一臂最多能砍掉池子的多少（砍得越多越省模型调用）
function maxCutFor(rows, target) {
  let best = 0;
  for (let c = 0.05; c <= 0.95; c += 0.05) {
    if (atWorkPoint(rows, c).falseCutRate <= target) best = c; else break;
  }
  return best;
}
// AUC 的 95% 自助置信区间：测试侧正样本只有几百条，不给区间就等于把噪声当结论
function aucCI(scored, B = 200, seed = 1234) {
  if (!scored || scored.length < 40) return null;
  let x = seed >>> 0;
  const rnd = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
  const vals = [];
  for (let b = 0; b < B; b++) {
    const res = [];
    for (let i = 0; i < scored.length; i++) res.push(scored[Math.floor(rnd() * scored.length)]);
    if (res.some((r) => r.y === 1) && res.some((r) => r.y === 0)) vals.push(auc(res));
  }
  if (vals.length < 20) return null;
  vals.sort((a, b) => a - b);
  return [vals[Math.floor(vals.length * 0.025)], vals[Math.floor(vals.length * 0.975)]];
}
function printArms(title, out, scoredByArm) {
  console.log(`\n──── ${title}`);
  for (const [arm, m] of Object.entries(out)) {
    const s = scoredByArm && scoredByArm[arm];
    const cap5 = s ? maxCutFor(s, 0.05) : NaN;
    const cap3 = s ? maxCutFor(s, 0.03) : NaN;
    const ci = aucCI(s);
    console.log(`    ${arm.padEnd(12)} AUC=${isNaN(m.aucV) ? 'n/a' : m.aucV.toFixed(3)}${ci ? `[${ci[0].toFixed(2)},${ci[1].toFixed(2)}]` : ''}  `
      + `砍25%时误砍=${pct(m.wp25.falseCutRate)}(挡对${pct(m.wp25.blockRate)})  `
      + `砍50%时误砍=${pct(m.wp50.falseCutRate)}(挡对${pct(m.wp50.blockRate)})`
      + (s ? `  ｜误砍≤3%/5% 时最多砍 ${(cap3 * 100).toFixed(0)}% / ${(cap5 * 100).toFixed(0)}%` : ''));
  }
}
function report(title, rows, tok) {
  const { out, scoredByArm, n } = runCV(rows, tok);
  printArms(`${title}（n=${n}，正=${rows.filter((r) => r.y === 1).length} 负=${rows.filter((r) => r.y === 0).length}，五折分层 CV）`, out, scoredByArm);
}

// ── 真·迁移测试：训练侧**完全不含**测试那批条目（分层 CV 做不到这点：读过的条目会进 4/5 折的训练）──
function evalSplit(arm, train, test, tok) {
  const tr = train.map((r) => ({ ...r, label: r.y === 1 ? 'leave' : 'cut', tokens: tok(r) }));
  const s = ARMS[arm](tr);
  return test.map((r) => ({ y: r.y, s: s(tok(r)) }));
}
// 长度对照的符号**只在训练侧定**（在测试侧挑更强的方向＝泄漏，会把对照做虚高）
function lengthControl(train, test, tok) {
  const tr = train.map((r) => ({ y: r.y, s: tok(r).length }));
  const sign = auc(tr) >= 0.5 ? 1 : -1;
  const scored = test.map((r) => ({ y: r.y, s: sign * tok(r).length }));
  return { m: { aucV: auc(scored), wp25: atWorkPoint(scored, 0.25), wp50: atWorkPoint(scored, 0.5) }, scored };
}
function reportSplit(title, train, test, tok) {
  const out = {};
  const scoredByArm = {};
  for (const arm of Object.keys(ARMS)) {
    const sc = evalSplit(arm, train, test, tok);
    scoredByArm[arm] = sc;
    out[arm] = { aucV: auc(sc), wp25: atWorkPoint(sc, 0.25), wp50: atWorkPoint(sc, 0.5) };
  }
  const lc = lengthControl(train, test, tok);
  out['长度(单特征)'] = lc.m; scoredByArm['长度(单特征)'] = lc.scored;
  const rn = foldAssign(test.length, 1000, 55);
  const sc = test.map((r, i) => ({ y: r.y, s: rn[i] }));
  out['随机'] = { aucV: 0.5, wp25: atWorkPoint(sc, 0.25), wp50: atWorkPoint(sc, 0.5) };
  scoredByArm['随机'] = sc;
  printArms(`${title}（训练 ${train.length} 行／测试 ${test.length} 行，测试侧正=${test.filter((r) => r.y === 1).length}）`, out, scoredByArm);
}

(async () => {
  if (!fs.existsSync(FILE)) {
    console.log(`没有语料文件：${FILE}\n先跑只读导出：NODE_PATH=<repo>/node_modules node --env-file=.env tools/_probe-behavior-corpus.cjs`);
    return;
  }
  const rows = fs.readFileSync(FILE, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  rows.forEach((r) => { r.tTitle = tokens(r.title); r.tAll = tokens(`${r.title} ${r.summary || ''}`); });
  console.log(`语料：${FILE}  行=${rows.length}`);
  console.log('判据口径：AUC=阈值无关的信号强度（0.5=随机）；误砍率=在"砍掉全池 X%"这个工作点上，砍掉的量占全部正样本的比例（**越小越好**）；'
    + '挡对率=砍掉的量里负样本占全部负样本的比例（越大越省模型调用）。');

  report('D1 全量五折分层 CV（正样本 = 已读∪稍后读∪精选；特征 = 标题+摘要）', rows, (r) => r.tAll);

  // D2/D3：训练侧**一条"你读过的"都不给**，负样本也切成两半（进训练的那半不再进测试，防止背题）
  const readPos = rows.filter((r) => r.y === 1 && r.why === 'read');
  const otherPos = rows.filter((r) => r.y === 1 && r.why !== 'read');
  const negs = rows.filter((r) => r.y === 0);
  const order = foldAssign(negs.length, 2, 4242);
  const negA = negs.filter((_, i) => order[i] === 0);
  const negB = negs.filter((_, i) => order[i] === 1);
  const train = [...otherPos, ...negA];
  const test = [...readPos, ...negB];
  reportSplit('D2 迁移测试：训练=精选/稍后读+一半未读，测试=**你亲自读过的那批**+另一半未读（特征 = 标题+摘要）', train, test, (r) => r.tAll);
  reportSplit('D3 只看形态：同 D2，但特征 = **仅标题**（排除"有没有 AI 摘要"这种风格泄漏）', train, test, (r) => r.tTitle);

  console.log('\n⚠️ 三条不许忽略的边界：');
  console.log('  ① 标签是**行为代理**不是人的裁决：负样本＝"系统判定可删"，它把"我没点开"也当成"没营养"（薄标题源、长文没读完都算）；');
  console.log('     正样本里的"精选"是**当前 AI 判分的产物** → 用它训练＝蒸馏现有 AI 初筛，学到的上限就是它自己的偏好，不等于你的偏好。');
  console.log('     所以 D2/D3（训练含精选、测试只用你亲自读过的）才是这道题该读的那一行。');
  console.log('  ② 类别比是被抽样决定的（负样本按 3× 抽），线上池子的真实正率更低 —— 工作点上的绝对条数要按真实池重算，这里只给比率。');
  console.log('  ③ 与既有读数的关系：`docs/eval/2026-09-24-prescreen-labels.md`「行为正样本回测」已证**长度类规则**误砍 40.2%/9.8%，');
  console.log('     形态类规则 0/246。本脚本的"长度(单特征)"对照就是那条结论在同一套折上的复现位 —— 两臂若打不过它，就是穿了统计外衣的长度规则。');
})().catch((e) => { console.error('RUN-FAIL', e.message); process.exitCode = 2; });
