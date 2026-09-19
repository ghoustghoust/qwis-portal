// 41-8 内容质量评测（Python 侧）与 Node 侧门禁的接缝锁。
// 为什么要 Node 锁：评测器的计分逻辑在 Python 里，但"这次到底算不算跑过"是 Node 门禁说了算——
// 两边各自写一份轴名/权重/域名，就一定会漂（本轮 B60 与 B64 都是同一件事的第 N 份副本）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
require('./helpers');
const { cleanup } = require('./helpers');

const ROOT = path.resolve(__dirname, '..');
const PY_DIR = path.join(ROOT, 'tools', 'eval-content');

function python() {
  for (const c of [process.env.EVAL_PYTHON, 'python3', 'python'].filter(Boolean)) {
    const r = spawnSync(c, ['--version'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) return c;
  }
  return null;
}

test.after(() => cleanup());

test('41-8 正向探针：npm 入口存在且转发到 tools/eval-content.cjs', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['eval:content'], 'node tools/eval-content.cjs', 'eval:content 入口不对');
  for (const f of ['eval-content.cjs']) assert.ok(fs.existsSync(path.join(ROOT, 'tools', f)), `缺 tools/${f}`);
  for (const f of ['schema.py', 'scoring.py', 'judge.py', 'run.py']) {
    assert.ok(fs.existsSync(path.join(PY_DIR, f)), `缺 tools/eval-content/${f}`);
  }
});

test('41-8 Python 侧自检必须全绿（探针数 = 通过数，且不少于 40 项）；没 python 属 fail_env 而不是通过', (t) => {
  const py = python();
  if (!py) {
    // fail_env 不许被写成"通过"：跳过并写明原因（EVAL_GUIDE §3.1）
    t.skip('没找到 python3/python —— eval:content 属 fail_env（环境未就绪），不计为已验收');
    return;
  }
  const r = spawnSync(py, [path.join(PY_DIR, 'run.py'), '--self-test'], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  const out = String(r.stdout || '') + String(r.stderr || '');
  const counts = [...out.matchAll(/自检：(\d+)\/(\d+) 通过/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.ok(counts.length >= 3, '三层自检（scoring/judge/run）没都跑到：\n' + out.slice(-400));
  assert.equal(r.status, 0, '自检退出码非 0：\n' + out.slice(-800));
  for (const [pass, total] of counts) assert.equal(pass, total, `有一层自检没全过（${pass}/${total}）`);
  const probes = counts.reduce((a, [, t2]) => a + t2, 0);
  assert.ok(probes >= 40, `自检探针只有 ${probes} 项，覆盖退化（41-8 要求每轴锚定事故 + stub/真评/对齐三类判据）`);
});

test('41-8 stub 轮次绝不算一次评测：报告必须带 counts_as_judgment=false 与 warnings_advisory=true', () => {
  if (!fs.existsSync(path.join(ROOT, 'docs/eval/content'))) return; // 还没建 golden 集时不判（宁缺毋假）
  const reports = fs.readdirSync(path.join(ROOT, 'docs/eval/content')).filter((f) => /^report-.*\.json$/.test(f)).sort();
  if (!reports.length) return;
  const rep = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/eval/content', reports[reports.length - 1]), 'utf8'));
  if (rep.counts_as_judgment === true) {
    assert.ok(rep.alignment && rep.alignment.usable === true, '真评轮次必须带可用的人工对齐证据才能算数（§5.3 第 5 条）');
    return;
  }
  assert.equal(rep.warnings_advisory, true, 'stub 轮次的告警必须标成 advisory，否则会被当产品告警灌进 ISSUES');
  assert.equal(rep.mean_score, null, 'stub 轮次不许产出均值');
  assert.equal(rep.n_judged, 0);
});

test('41-8 跨语言单一事实源：Python 侧不许写死第二份云端域名（B64 的跨国版）', () => {
  const hits = [];
  for (const f of fs.readdirSync(PY_DIR).filter((x) => x.endsWith('.py'))) {
    const src = fs.readFileSync(path.join(PY_DIR, f), 'utf8');
    for (const m of src.matchAll(/https:\/\/[a-z0-9.-]+\.vercel\.app/g)) hits.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(hits, [], '云端域名只能由 Node 侧 lib/cloud-site.js 经环境变量传给 Python（坑 #42/#B64）');
});

test('41-8 五轴与权重：文档 §5.1/§5.2 与 scoring.py 必须是同一份定义', () => {
  const guide = fs.readFileSync(path.join(ROOT, 'docs/EVAL_GUIDE.md'), 'utf8');
  const sec = guide.slice(guide.indexOf('## 5. 内容质量评测'), guide.indexOf('## 6.'));
  const scoring = fs.readFileSync(path.join(PY_DIR, 'scoring.py'), 'utf8');
  const axes = ['clarity', 'factual_correctness', 'consistency', 'redundancy', 'readability'];
  for (const a of axes) {
    assert.ok(sec.includes('`' + a + '`'), `EVAL_GUIDE §5 缺轴 ${a}`);
    assert.ok(scoring.includes(`"${a}"`), `scoring.py 缺轴 ${a}`);
  }
  for (const w of ['0.30', '0.25', '0.20', '0.15', '0.10']) {
    assert.ok(sec.includes(w) && scoring.includes(w), `权重 ${w} 在文档与代码里不一致`);
  }
  assert.match(sec, /norm\(v\) = \(v - 1\) \/ 4/, '归一化公式必须与 scoring.norm 一致');
});

test('41-8 judge 纪律落进代码：默认不打模型、打模型要记模型与 prompt 版本', () => {
  const judge = fs.readFileSync(path.join(PY_DIR, 'judge.py'), 'utf8');
  assert.match(judge, /allow_network: bool = False/, '默认必须不联网（judge 花 AI 配额，BL8/坑 #A1）');
  assert.match(judge, /"temperature": 0/, 'judge 必须 temperature=0（§5.3 第 1 条）');
  assert.match(judge, /JUDGE_PROMPT_VERSION = /, 'prompt 版本必须是常量并进报告');
  assert.match(judge, /不许退化成 stub 假装评过/, '缺凭据时必须抛错，不许悄悄退回 stub');
  assert.match(judge, /api_fingerprint/, 'Key 只回显指纹');
});
