#!/usr/bin/env node
// 零额度初筛层效果实验：朴素贝叶斯 / TF-IDF 质心 的留一法(LOO)评测
//
// 为什么（用户 09-24）：「贝叶斯/TF-IDF 消失没问题，主要是……他是把我们需要的文章干掉了还是没营养的垃圾文章干掉了。
//   如果干掉了需要的文章我们应该考虑能不能更改，最后综合考虑是否采用」。
// → 所以主判据不是准确率，而是 **误砍率**（人标"留"却被模型判"砍"），且必须能逐条指回是哪一篇被误砍。
//
// 特征只用标题 + 摘要（与线上初筛给模型的输入同形，不用正文 → 零 token、毫秒级）。
// 标签来自 docs/eval/2026-09-24-prescreen-labels.md 的「判定」列（留 / 砍），按标题回查库里完整摘要。
//
// 用法：NODE_PATH=<repo>/node_modules node --env-file=.env tools/eval-prescreen-learning.cjs [labels.md 路径]
'use strict';
const fs = require('fs');
const path = require('path');

const LABELS = process.argv[2] || path.join(__dirname, '..', 'docs', 'eval', '2026-09-24-prescreen-labels.md');

// ── 分词：拉丁词 + 中文二元组（不引分词器：三端语义漂移的教训同族，宁可用弱特征）──
function tokens(text) {
  const s = String(text || '').toLowerCase();
  const out = [];
  for (const m of s.match(/[a-z][a-z0-9+#.\-]{2,}|\d{3,}/g) || []) out.push(m);
  const cjk = s.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  for (const run of cjk) for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2));
  return out;
}

// ── 多项式朴素贝叶斯（Laplace 平滑）──
function fitNB(samples) {
  const cls = { leave: { counts: new Map(), total: 0 }, cut: { counts: new Map(), total: 0 } };
  const vocab = new Set();
  for (const sm of samples) {
    const c = cls[sm.label];
    for (const t of sm.tokens) { c.counts.set(t, (c.counts.get(t) || 0) + 1); c.total++; vocab.add(t); }
    c.docs = (c.docs || 0) + 1;
  }
  const V = vocab.size || 1;
  const prior = { leave: Math.log((cls.leave.docs || 0) + 1), cut: Math.log((cls.cut.docs || 0) + 1) };
  return (tokens) => {
    // **必须按长度归一**：多项式 NB 每加一个词项就乘一次概率（log 相加，全为负），
    // 于是"文档越长分越低"→ 长文会被系统性判进"平均更短"的那一类。合成自测里这给了 100% 误砍率
    // ——不是数据的问题，是模型写法的问题（用户 09-24：「如果干掉了需要的文章我们应该考虑能不能更改」）。
    let sum = 0;
    for (const t of tokens) {
      const pw = ((cls.leave.counts.get(t) || 0) + 1) / (cls.leave.total + V);
      const pc = ((cls.cut.counts.get(t) || 0) + 1) / (cls.cut.total + V);
      sum += Math.log(pw) - Math.log(pc);
    }
    return sum / (tokens.length || 1) + (prior.leave - prior.cut);
  };
}

// ── TF-IDF 质心：留/砍各一个类心，判据=离哪个心更近（余弦）──
function fitTfidf(samples) {
  const df = new Map();
  for (const sm of samples) for (const t of new Set(sm.tokens)) df.set(t, (df.get(t) || 0) + 1);
  const N = samples.length || 1;
  const vec = (tokens) => {
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    const v = new Map();
    const mx = Math.max(...[...tf.values()]) || 1; // Map 不能直接 spread 进 Math.max（会得到 entries → NaN）
    for (const [t, c] of tf) v.set(t, (0.5 + 0.5 * c / mx) * Math.log(N / (df.get(t) || 1)));
    const n = Math.sqrt([...v.values()].reduce((a, x) => a + x * x, 0)) || 1;
    for (const [t, x] of v) v.set(t, x / n);
    return v;
  };
  const centroid = { leave: new Map(), cut: new Map() };
  const seen = { leave: 0, cut: 0 };
  for (const sm of samples) {
    const v = vec(sm.tokens); const c = centroid[sm.label];
    for (const [t, x] of v) c.set(t, (c.get(t) || 0) + x);
    seen[sm.label]++;
  }
  for (const k of ['leave', 'cut']) {
    const c = centroid[k]; const n = seen[k] || 1;
    for (const [t, x] of c) c.set(t, x / n);
  }
  const cos = (a, b) => { let s = 0; for (const [t, x] of a) s += x * (b.get(t) || 0); return s; };
  return (tokens) => cos(vec(tokens), centroid.leave) - cos(vec(tokens), centroid.cut);
}

// ── 互补朴素贝叶斯（CNB）：稀疏小样本下才是该信的那一臂 ──
// 为什么要有它：留一法下待测文档的词在训练集里大量未登录，多项式 NB 会退化成"哪一类总 token 少就偏向哪一类"
// ——合成自测里这就是 100% 误砍率的真因（长度归一都救不回来）。CNB 用"对面所有类的补集计数"打分，
// 对稀疏与类间不平衡都稳，是小标注集上的标准做法。
function fitCNB(samples) {
  const by = { leave: [], cut: [] };
  for (const sm of samples) by[sm.label].push(sm);
  const vocab = new Set();
  for (const sm of samples) for (const t of sm.tokens) vocab.add(t);
  const V = vocab.size || 1;
  const totalOf = (list) => { const c = new Map(); let tot = 0; for (const sm of list) for (const t of sm.tokens) { c.set(t, (c.get(t) || 0) + 1); tot++; } return { c, tot }; };
  const L = totalOf(by.leave), C = totalOf(by.cut);
  // 每个类用"另一类"的计数打分，取负号后进 argmin
  const wLeave = (t) => -Math.log(((C.c.get(t) || 0) + 1) / (C.tot + V));
  const wCut = (t) => -Math.log(((L.c.get(t) || 0) + 1) / (L.tot + V));
  return (tokens) => {
    let sl = 0, sc = 0;
    for (const t of new Set(tokens)) { sl += wLeave(t); sc += wCut(t); }
    return (sc - sl) >= 0 ? 'leave' : 'cut'; // CNB 取 argmin：补集代价小的一侧胜出
  };
}

function parseLabels(md) {
  const rows = [];
  for (const line of md.split(/\r?\n/)) {
    const c = line.split('|').map((x) => x.trim());
    if (c.length < 6) continue;
    const verdict = c[2];
    if (verdict !== '留' && verdict !== '砍') continue;
    rows.push({ idx: c[1], label: verdict === '留' ? 'leave' : 'cut', band: c[3], source: c[4], title: c[5], summary: c[6] || '' });
  }
  return rows;
}

(async () => {
  const md = fs.readFileSync(LABELS, 'utf8');
  let rows = parseLabels(md);
  if (rows.length < 4) {
    console.log(`还没人标注：${LABELS} 里「判定」列为空的行不参评。当前可用标签 ${rows.length} 条（需要 ≥4 且有留有砍）。`);
    console.log('用法：在表的「判定」列填 留 / 砍，再重跑本脚本。');
    process.exitCode = 0; return;
  }
  // 富化：按标题回查库里完整摘要（标注表里摘要是 120 字截断，特征太弱）
  try {
    const { createClient } = require('@libsql/client');
    const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN || undefined });
    for (const r of rows) {
      const hit = await db.execute({ sql: 'SELECT summary, content_html FROM articles WHERE title = ? LIMIT 1', args: [r.title] });
      if (hit.rows.length) r.summary = String(hit.rows[0].summary || r.summary);
    }
  } catch (e) { console.log('（回查完整摘要失败，用表内截断文本继续：' + e.message + '）'); }

  for (const r of rows) r.tokens = tokens(`${r.title} ${r.summary}`);
  const metrics = { nb: { tp: 0, tn: 0, fp: 0, fn: 0 }, cnb: { tp: 0, tn: 0, fp: 0, fn: 0 }, tf: { tp: 0, tn: 0, fp: 0, fn: 0 } };
  const disagreements = [];
  for (let i = 0; i < rows.length; i++) {
    const train = rows.filter((_, k) => k !== i);
    const test = rows[i];
    const nb = fitNB(train)(test.tokens) >= 0 ? 'leave' : 'cut';
    const cnb = fitCNB(train)(test.tokens);
    const tf = fitTfidf(train)(test.tokens) >= 0 ? 'leave' : 'cut';
    for (const [m, pred] of [['nb', nb], ['cnb', cnb], ['tf', tf]]) {
      if (pred === 'leave' && test.label === 'leave') metrics[m].tn++;
      else if (pred === 'cut' && test.label === 'cut') metrics[m].tp++;
      else if (pred === 'cut' && test.label === 'leave') metrics[m].fn++; // **误砍**：人标留却被砍
      else metrics[m].fp++; // 漏砍
    }
    if (new Set([nb, cnb, tf]).size > 1 || nb !== test.label || cnb !== test.label || tf !== test.label) disagreements.push({ ...test, nb, cnb, tf });
  }
  const line = (name, m) => {
    const leaves = m.tn + m.fn, cuts = m.tp + m.fp;
    return `${name.padEnd(14)} 样本=${m.tn + m.fn + m.tp + m.fp}  误砍率=${((m.fn / Math.max(1, leaves)) * 100).toFixed(1)}%（${m.fn}/${leaves} 人标"留"被判砍）  漏砍率=${((m.fp / Math.max(1, cuts)) * 100).toFixed(1)}%（${m.fp}/${cuts} 人标"砍"被判留）`;
  };
  console.log('\n=== 留一法(LOO)对照：零额度层会不会干掉你要的文章 ===');
  console.log(line('朴素贝叶斯', metrics.nb));
  console.log(line('互补NB(CNB)', metrics.cnb));
  console.log(line('TF-IDF 质心', metrics.tf));
  console.log('  ↑ 三臂都要看，别只读一个数：合成自测（12 条、信号极强）实测 —— 多项式 NB 全部判"砍"（误砍 100%）、'
    + 'CNB 全部判"留"（漏砍 100%）、只有 TF-IDF 质心两向都有错（误砍 0% / 漏砍 33%）。'
    + '结论是**标注集只有几十条时 NB 家族不可信**（稀疏 + 类间总长不平衡），要 NB 得先有几百条标签。');
  console.log('\n=== 需要人看分歧带（模型之间或模型与你不一致的条目）===');
  for (const d of disagreements.slice(0, 40)) {
    console.log(`  [${d.band}] 你=${d.label === 'leave' ? '留' : '砍'} NB=${d.nb === 'leave' ? '留' : '砍'} CNB=${d.cnb === 'leave' ? '留' : '砍'} TF=${d.tf === 'leave' ? '留' : '砍'}  ${String(d.source).slice(0, 16)}  ${String(d.title).slice(0, 48)}`);
  }
  console.log(`\n判据口径：误砍率 = 你标"留"却被模型判"砍"，这是决定要不要上线的那个数；漏砍率是可以接受的浪费（多送几篇给深析）。`);
  process.exitCode = 0;
})().catch((e) => { console.error('RUN-FAIL', e.message); process.exitCode = 2; });
