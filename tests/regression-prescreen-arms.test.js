// 零额度初筛三臂的**方向锁**（A1~A4）
// 为什么有这份锁（用户 09-24 原话 + 一个实测数字）：「贝叶斯/TF-IDF……他是把我们需要的文章干掉了还是没营养的
// 垃圾文章干掉了。如果干掉了需要的文章我们应该考虑能不能更改，最后综合考虑是否采用」。
// 要回答这句，三臂的**打分方向**必须先是对的。行为标签回测第一次跑出来时，互补 NB 的 AUC = 0.082
// （随机是 0.50）—— 不是数据的问题，是脚手架把 CNB 的 argmax 写成了 argmin。改号后 0.918。
// 那条反号在"只看硬标签"的合成自测里是可以长期隐形的（全判留也能自圆其说成"小样本不可信"），
// 所以这里钉的是**方向**本身：给定一个词表上有 separable 信号的数据集，三臂都不许把它排反。
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { tokens, fitNB, fitCNB, fitTfidf } = require('../tools/eval-prescreen-learning.cjs');

// 合成语料：只有一条规则 —— 含 "麒麟" 系列词 = 留，含 "验证码" 系列词 = 砍；两边各 12 条、长度分布**刻意相同**
// （否则"方向对了"可能只是长度偏置顺手做对的，见 A3 单独钉这条）
const LEAVE_WORDS = ['麒麟', '瑞兽', '图腾', '祥云', '琉璃', '琥珀'];
const CUT_WORDS = ['验证码', '领取', '限时', '免费', '点击', '转发'];
function mk(seed, words) {
  const out = [];
  for (let i = 0; i < 12; i++) {
    const a = words[i % words.length];
    const b = words[(i + seed) % words.length];
    out.push({ label: i % 2 ? 'leave' : 'cut', tokens: tokens(`${a} ${b} 一段等长的中性描述文字用于平衡长度分布`) });
  }
  return out;
}
const leaveSet = mk(1, LEAVE_WORDS).map((s) => ({ ...s, label: 'leave' }));
const cutSet = mk(3, CUT_WORDS).map((s) => ({ ...s, label: 'cut' }));
const SAMPLES = [...leaveSet, ...cutSet];

function rankMargin(fit) {
  const f = fit(SAMPLES);
  // 全部正样本的最低分 与 全部负样本的最高分 之间有没有间隔（有＝方向对且可分）
  const lo = Math.min(...leaveSet.map((s) => f(s.tokens)));
  const hi = Math.max(...cutSet.map((s) => f(s.tokens)));
  return { lo, hi, separable: lo > hi };
}

test('A1 三臂方向：约定"分数越高越该留"，可分数据上不许排反（CNB 反号 bug 的回归锁）', () => {
  for (const [name, fit] of [['NB', fitNB], ['CNB', fitCNB], ['TF-IDF', fitTfidf]]) {
    const m = rankMargin(fit);
    assert.ok(m.separable, `${name} 方向错或不可分：正样本最低分 ${m.lo} 没超过负样本最高分 ${m.hi}`
      + ' —— 判据是"分数越高越该留"，写反会让误砍率变成 100%（互补 NB 反号实测 AUC=0.082）');
  }
});

test('A2 判定与分数同向：>=0 判留，且每条样本自身两侧一致', () => {
  for (const [name, fit] of [['NB', fitNB], ['CNB', fitCNB], ['TF-IDF', fitTfidf]]) {
    const f = fit(SAMPLES);
    for (const s of SAMPLES) {
      const score = f(s.tokens);
      assert.equal(typeof score, 'number', `${name} 必须返回**分数**而不是硬标签（工作点扫描要在分数上做）`);
      assert.equal(score >= 0 ? 'leave' : 'cut', s.label, `${name} 在合成可分语料上判错了一条：分数 ${score}`);
    }
  }
});

test('A3 多项式 NB 的长度归一仍在（去掉 /tokens.length 就会把长文系统性判砍）', () => {
  const f = fitNB(SAMPLES);
  // 同一条正样本，重复内容加长 5 倍后仍必须判"留"——这是当年 100% 误砍的那条偏置的正面断言
  const base = leaveSet[0].tokens;
  const long = [...base, ...base, ...base, ...base, ...base];
  assert.ok(f(long) >= 0, `NB 长度归一失效：同内容加长 5 倍后被判砍（分数 ${f(long)}）`);
  const src = require('node:fs').readFileSync(require.resolve('../tools/eval-prescreen-learning.cjs'), 'utf8');
  assert.match(src, /sum \/ \(tokens\.length \|\| 1\)/, 'NB 的归一分母被删 —— 那正是"越长越像短类"的偏置来源');
});

test('A4 脚手架被 require 时不许跑标注集评测（否则任何测试导入它都会去读 .env/连库）', () => {
  // 判据取可观测面：直接跑一次"被 require"，标准输出必须为空（main() 只在 require.main === module 时执行）
  const { execFileSync } = require('node:child_process');
  const out = execFileSync(process.execPath, ['-e', "require(require('node:path').resolve('tools/eval-prescreen-learning.cjs'))"], {
    cwd: require('node:path').join(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(out.trim(), '', `导入脚手架就打印了内容，说明驱动没被守卫住：\n${out.slice(0, 200)}`);
});
