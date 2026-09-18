#!/usr/bin/env node
/**
 * 41-7 过程性二值检查器（要求正文 docs/EVAL_GUIDE.md §3.6，小 spec docs/specs/41-e2e-whitebox-eval/41-7-process-binary-checks.md）
 *
 * 它只回答一个问题：**这次评测运行可信吗？** 不判断业务对不对。
 * 为什么先要它而不是先要端到端引擎：41-2 最大的风险不是跑不起来，是"跑绿了却什么都没测"。
 * 本轮实测里两类事故都真发生过（写进 §3.3 / §4.1）：
 *   · 探针把参数名 type= 猜成 tab=，三个 Tab 返回同一批数据，一度被当成"筛选仍失效"；
 *   · `npm test | tail` 把退出码吞成 0，实际 4 条红。
 * 任一不过 → 该次运行判 fail_env：不算交付失败，但**绝不算通过**。
 *
 * 用法：
 *   node tools/eval-process-checks.cjs --report docs/eval/runs/<ts>.json   校验一次真实运行
 *   node tools/eval-process-checks.cjs --self-test                          自检：每个检查都要"坏样本会红、好样本会绿"
 * 退出码：0 全过 / 1 有不过 / 2 用法或输入错误
 */
const fs = require('fs');
const path = require('path');

const STUB_PATTERNS = [
  ['加载中', '占位文案冒充渲染成功（B52 真发生过：翻译 Skill 永远停在「加载中…」）'],
  ['暂无数据', '空态掩盖请求失败'],
  ['not implemented', '桩代码冒充实现'],
  ['未实现', '同上'],
  ['TODO', '交付物里不该出现未完成任务标记'],
  ['xxx', '模板占位没替换（本轮文档自评真实命中过一次）'],
];

// 每个检查都是纯函数：({ ok, code, why })；code 用于分类（fail_product / fail_env）
const CHECKS = {
  // F1 截图必须真的拍了：有 screenshot 事件，且落盘文件字节 > 0、mtime 在本次运行窗口内
  check_screenshot_taken(run) {
    const shots = (run.events || []).filter((e) => e && e.type === 'screenshot');
    if (!shots.length) return { ok: false, code: 'fail_env', why: '整轮没有 screenshot 事件' };
    const bad = shots.filter((s) => !s.path || !fs.existsSync(s.path) || fs.statSync(s.path).size === 0);
    if (bad.length) return { ok: false, code: 'fail_env', why: `${bad.length}/${shots.length} 张截图路径不存在或 0 字节` };
    const stale = shots.filter((s) => {
      const m = fs.statSync(s.path).mtimeMs;
      return !run.startedAt || m < new Date(run.startedAt).getTime() - 5000;
    });
    if (stale.length) return { ok: false, code: 'fail_env', why: `${stale.length} 张截图 mtime 早于本次运行窗口（旧图冒充新证据）` };
    return { ok: true, why: `${shots.length} 张截图均可解析且落在运行窗口内` };
  },

  // F2 报告必须真的生成：可解析、用例数与剧本清单一致（漏跑即红）
  check_report_generated(run) {
    if (!run.reportPath || !fs.existsSync(run.reportPath)) return { ok: false, code: 'fail_env', why: '报告文件不存在' };
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(run.reportPath, 'utf8')); } catch (e) { return { ok: false, code: 'fail_env', why: '报告不是合法 JSON：' + e.message }; }
    const planned = Array.isArray(run.plan) ? run.plan.length : null;
    const got = Array.isArray(parsed.cases) ? parsed.cases.length : null;
    if (planned !== null && got !== planned) return { ok: false, code: 'fail_product', why: `剧本清单 ${planned} 条，报告只有 ${got} 条（漏跑）` };
    if (!got) return { ok: false, code: 'fail_product', why: '报告里 cases 为空' };
    return { ok: true, why: `报告 ${got} 条用例，与剧本清单一致` };
  },

  // F3 断言必须真的执行：0 断言的用例 = 空跑
  check_assertions_executed(run) {
    const cases = run.cases || [];
    const empty = cases.filter((c) => !c || Number(c.assertions) <= 0);
    if (empty.length) return { ok: false, code: 'fail_product', why: `${empty.length} 条用例断言数为 0（空跑）：${empty.slice(0, 5).map((c) => c.id).join(', ')}` };
    const skipped = cases.filter((c) => c && c.status === 'pass' && c.assertions === undefined);
    if (skipped.length) return { ok: false, code: 'fail_product', why: `${skipped.length} 条用例报 pass 却没记 assertions 数` };
    return { ok: true, why: `${cases.length} 条用例均有断言` };
  },

  // F4 不得拿占位文案当通过
  check_no_stub_text(run) {
    const hits = [];
    const allow = new Set(run.stubAllowlist || []);
    for (const c of run.cases || []) {
      const text = String(c.renderedText || c.text || '');
      for (const [pat, why] of STUB_PATTERNS) {
        if (text.includes(pat) && !allow.has(c.id + '|' + pat)) hits.push(`${c.id}: 「${pat}」${why}`);
      }
    }
    if (hits.length) return { ok: false, code: 'fail_product', why: hits.slice(0, 6).join(' / ') };
    return { ok: true, why: '无占位/桩文案命中' };
  },

  // F5 报告引用的证据路径必须真实存在（"见截图"而截图不存在 = B50 类漂移的评测版）
  // 只收 evidence/artifacts 这类**证据字段**，不能全对象乱走：
  // 自检第一版就是全走字符串，把 F7 的 file:line 参数出处（api/[...slug].js:1021）当证据查，误报。
  check_evidence_paths_resolve(run) {
    const paths = [];
    const collect = (v) => {
      for (const item of Array.isArray(v) ? v : [v]) {
        if (typeof item !== 'string') continue;
        const p = item.includes(':') ? item.slice(0, item.lastIndexOf(':')) : item;
        if (/^(docs|tests|tools|web|server|api)\//.test(p)) paths.push(p);
      }
    };
    if (run.evidence) collect(run.evidence);
    if (run.artifacts) collect(run.artifacts);
    for (const c of run.cases || []) { if (c.evidence) collect(c.evidence); }
    const root = run.root || process.cwd();
    const missing = paths.filter((p) => !fs.existsSync(path.resolve(root, p)));
    if (missing.length) return { ok: false, code: 'fail_product', why: `${missing.length} 个被引用的证据路径不存在：${missing.slice(0, 5).join(', ')}` };
    return { ok: true, why: `${paths.length} 个引用路径均可解析` };
  },

  // F6 外部命令退出码不得被管道吞掉（`npm test | tail` 真发生过）
  check_exit_code_honest(run) {
    const cmds = run.commands || [];
    const bad = [];
    for (const c of cmds) {
      if (!c || typeof c.exitCode !== 'number') { bad.push(`${(c || {}).cmd || '?'}（没记退出码）`); continue; }
      if (/\|/.test(String(c.cmd || '')) && !c.exitCodeSource) bad.push(`${c.cmd}（管道命令，退出码可能是管道尾部的）`);
    }
    if (bad.length) return { ok: false, code: 'fail_product', why: `退出码不诚实：${bad.slice(0, 4).join(' / ')}` };
    return { ok: true, why: `${cmds.length} 条命令都记了自己的退出码` };
  },

  // F7 请求参数必须抄自被检代码并写明出处（把 type= 当 tab= 打真发生过）
  check_probe_params_sourced(run) {
    const bad = [];
    for (const c of run.cases || []) {
      for (const req of (c.requests || [])) {
        for (const [k, v] of Object.entries((req && req.params) || {})) {
          if (!v || typeof v !== 'object' || !/:[0-9]+$/.test(String(v.source || ''))) bad.push(`${c.id} 参数 ${k} 未注明代码出处`);
        }
      }
    }
    if (bad.length) return { ok: false, code: 'fail_product', why: `探针参数来自猜测：${bad.slice(0, 5).join(' / ')}` };
    const n = (run.cases || []).reduce((a, c) => a + Object.keys((c.requests || [])[0]?.params || {}).length, 0);
    return { ok: true, why: `参数均带 file:line 出处（抽样计数 ${n}）` };
  },
};

// ── 自检：每个检查都要"坏样本会红、好样本会绿"（EVAL_GUIDE §4.1 的负向验证）──
function selfTest() {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'proc-check-'));
  const goodImg = path.join(tmp, 'good.png');
  fs.writeFileSync(goodImg, Buffer.alloc(128, 1));
  const goodReport = path.join(tmp, 'report.json');
  fs.writeFileSync(goodReport, JSON.stringify({ cases: [{ id: 'a' }, { id: 'b' }] }));

  const good = {
    startedAt: new Date(Date.now() - 1000).toISOString(),
    events: [{ type: 'screenshot', path: goodImg }],
    reportPath: goodReport, plan: ['a', 'b'],
    cases: [{ id: 'a', assertions: 3, renderedText: '正常标题', requests: [{ params: { type: { value: 'podcast', source: 'api/[...slug].js:1021' } } }] },
      { id: 'b', assertions: 2, renderedText: '别的正常文本' }],
    commands: [{ cmd: 'npm test', exitCode: 0 }],
    root: process.cwd(),
  };
  const results = [];
  for (const [name, fn] of Object.entries(CHECKS)) {
    const goodR = fn(good);
    const broken = JSON.parse(JSON.stringify({ ...good, _skip: 1 })); delete broken._skip;
    // 逐检查造一个"该检查必须抓到"的坏样本
    if (name === 'check_screenshot_taken') broken.events = [{ type: 'screenshot', path: path.join(tmp, 'nope.png') }];
    if (name === 'check_report_generated') broken.plan = ['a', 'b', 'c', 'd'];
    if (name === 'check_assertions_executed') broken.cases = [{ id: 'a', assertions: 0 }];
    if (name === 'check_no_stub_text') broken.cases = [{ id: 'a', assertions: 1, renderedText: '加载中…' }];
    if (name === 'check_evidence_paths_resolve') broken.cases = [{ id: 'a', assertions: 1, evidence: 'docs/eval/never-written.md' }];
    if (name === 'check_exit_code_honest') broken.commands = [{ cmd: 'npm test | tail' }];
    if (name === 'check_probe_params_sourced') broken.cases = [{ id: 'a', assertions: 1, requests: [{ params: { tab: { value: 'article' } } }] }];
    const badR = fn(broken);
    const pass = goodR.ok && !badR.ok;
    results.push({ name, goodOk: goodR.ok, badCaught: !badR.ok, pass, goodWhy: goodR.why, badWhy: badR.why });
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const r of results) {
    console.log(`  ${r.pass ? '✓' : '✗'} ${r.name}${r.pass ? '' : ` — 好样本 ok=${r.goodOk} 坏样本被抓住=${r.badCaught}`}`);
    if (!r.pass) console.log(`      好样本: ${r.goodWhy}\n      坏样本: ${r.badWhy}`);
  }
  const failed = results.filter((r) => !r.pass);
  console.log(`自检：${results.length - failed.length}/${results.length} 通过` +
    (failed.length ? '（未通过的检查等于假门禁，必须修）' : ''));
  return failed.length ? 1 : 0;
}

function runReport(p) {
  let run;
  try { run = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { console.error('报告读取失败：' + e.message); return 2; }
  let failEnv = false, failProduct = false;
  for (const [name, fn] of Object.entries(CHECKS)) {
    const r = fn(run);
    if (!r.ok) console.log(`  ✗ ${name} [${r.code}] — ${r.why}`);
    else console.log(`  ✓ ${name} — ${r.why}`);
    if (!r.ok) { if (r.code === 'fail_env') failEnv = true; else failProduct = true; }
  }
  // 过程层不过 → 整次运行不算通过：产品缺陷优先，其次环境
  if (failProduct) { console.log('过程检查：不通过（fail_product）'); return 1; }
  if (failEnv) { console.log('过程检查：不通过（fail_env，重跑环境后再判）'); return 1; }
  console.log('过程检查：全过');
  return 0;
}

// 只在**直接运行**时才跑 CLI：被 require 时不能顺手设置 process.exitCode，
// 否则引入它的测试进程会被带出非零退出码（本文件第一版就踩了这个）
if (require.main === module) {
  if (process.argv.includes('--self-test')) process.exitCode = selfTest();
  else {
    const i = process.argv.indexOf('--report');
    if (i < 0 || !process.argv[i + 1]) {
      console.error('用法：--report <run.json> | --self-test');
      process.exitCode = 2;
    } else process.exitCode = runReport(process.argv[i + 1]);
  }
}

module.exports = { CHECKS, STUB_PATTERNS };
