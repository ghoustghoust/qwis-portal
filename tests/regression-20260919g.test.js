// 2026-09-19 深夜轮（41-2 端到端引擎 + B71/B72/B73）回归锁
// 覆盖：
//   G1 B71 后台入口必须挂 LanguageProvider（端到端首轮实测抓到裸 key）
//   G2 字典与调用点同时存在（防止"把键删掉"造成假修好）
//   G3 白盒新增 W11（入口 Provider 完整性）真的在跑
//   G4 端到端引擎自检必须全绿（41-2 的判据本身不能是坏的）
//   G5 端到端剧本的**参数出处必须真实存在**——path:line 指向的文件要有那一行
//      （这条是防"出处是我编的"：本轮 F7 判据第一次有了机器可查的后盾）
//   G6 端到端剧本必须覆盖 6 个前台页 + 后台登录门，且 known_gap 都带 ISSUES 编号
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
require('../tests/helpers');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

// ── G1/G2 B71：后台入口漏挂 Provider → 登录门显示 login.title/username/password/submit ──
test('G1 后台独立入口必须挂 LanguageProvider（B71 根因）', () => {
  const src = read('web/src/admin.jsx');
  assert.match(src, /import\s*\{[^}]*LanguageProvider[^}]*\}\s*from\s*'\.\/i18n\.jsx'/, 'admin.jsx 没 import LanguageProvider');
  assert.match(src, /<LanguageProvider>/, 'admin.jsx 没把根包在 <LanguageProvider> 里（useI18n 会静默退回 t:(k)=>k）');
  // 只挂 Provider 不够——必须在用到 t() 的组件祖先位置上，AdminPage/LoginGate 都要在 provider 之内
  const inside = src.slice(src.indexOf('<LanguageProvider>'));
  assert.match(inside, /<AdminPage/, '<AdminPage> 不在 LanguageProvider 内');
  assert.match(inside, /<LoginGate/, '<LoginGate> 不在 LanguageProvider 内（裸 key 就是从登录门出来的）');
});

test('G2 login.* 字典键与调用点必须同时存在（防止删键造成"看起来修好了"）', () => {
  const dict = read('web/src/i18n.jsx');
  for (const k of ['login.submit', 'login.title', 'login.username', 'login.password']) {
    assert.ok(dict.includes(`'${k}'`), `字典里 ${k} 被删了：界面不显示裸 key 也可能只是因为没人调用它了`);
  }
  assert.match(read('web/src/components/LoginModal.jsx'), /t\(['"]login\.submit['"]\)/, 'LoginModal 不再用 t("login.submit")，G1 的锁要跟着改判据');
  // 兜底值就是 t:(k)=>k —— 这条把"漏挂 Provider 必然显示裸 key"的因果钉在锁里，不留口舌
  // 注意别用 [^}]* 去跨：setLang: () => {} 里就有 }，那样永远匹配不上（第一版就假红在这里）
  assert.ok(/createContext\(\{[^\n]*t:\s*\(k\)\s*=>\s*k/.test(dict), 'i18n 兜底值变了，B71 的机理描述要同步');
});

// ── G3 白盒 W11 在跑（通用判据，不只盯 admin 一个文件）──
test('G3 eval-whitebox 必须有 W11 入口 Provider 检查且当前全过', () => {
  const tool = read('tools/eval-whitebox.cjs');
  assert.match(tool, /ok\('W11'/, 'W11 没注册进白盒清单');
  assert.match(tool, /useI18n\(/, 'W11 必须按"模块图里有人用 useI18n"判，而不是只看入口文件');
  const out = execFileSync(process.execPath, ['tools/eval-whitebox.cjs'], { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /whitebox：全过/, '白盒门禁当前应全过：\n' + out.slice(-600));
});

// ── G4/G5/G6 端到端引擎自身 ──
const e2e = require('../tools/eval-e2e.cjs');

test('G4 端到端引擎自检必须全绿（判据坏了就等于整轮结果不可信）', () => {
  const out = execFileSync(process.execPath, ['tools/eval-e2e.cjs', '--self-test'], { cwd: ROOT, encoding: 'utf8' });
  const m = /自检：(\d+)\/(\d+) 通过/.exec(out);
  assert.ok(m, '没打印自检计数：\n' + out.slice(-500));
  assert.strictEqual(m[1], m[2], '端到端引擎自检未全绿：\n' + out);
});

test('G5 剧本里每个 file:line 出处都必须真实指到那一行（防"出处是编的"）', () => {
  const table = Object.assign({}, e2e.SRC, e2e.QUERY_SRC);
  const bad = [];
  for (const [k, v] of Object.entries(table)) {
    const m = /^(.+?):(\d+)$/.exec(v);
    if (!m) { bad.push(`${k}→${v}（不是 file:line 形态）`); continue; }
    const [, f, ln] = m;
    if (!exists(f)) { bad.push(`${k}→${v}（文件不存在）`); continue; }
    const lines = read(f).split('\n');
    if (Number(ln) > lines.length) { bad.push(`${k}→${v}（文件只有 ${lines.length} 行）`); continue; }
    bad.length === 0 || null;
    const hit = lines[Number(ln) - 1];
    // 出处那一行必须真的含相关 token（参数名 / 路径名 / PAGE_SIZE / 白名单），否则等于指向别处
    const tok = /(pageSize|PAGE_SIZE)/.test(k) ? /PAGE_SIZE|const\s/ :
      /(readingTab|readingType|hotTab|articlesTab|articlesSort|videosTab)/.test(k) ? /tab|type|sort|PAGE_SIZE|\|\|/ :
      /^\/api\//.test(k) || /^fe/.test(k) ? /api\/|\bps\b|qs\(|useEffect|fetch|=>/ : /.*/;
    if (!tok.test(hit)) bad.push(`${k}→${v} 指向的行不含预期 token：「${hit.trim().slice(0, 70)}」`);
  }
  assert.deepStrictEqual(bad, [], '参数出处表有问题：\n' + bad.join('\n'));
});

test('G6 剧本覆盖六个前台页 + 后台登录门，known_gap 必须带 ISSUES 编号', () => {
  const ids = e2e.SCENARIOS.map((s) => s.id);
  assert.ok(ids.length >= 10, `剧本数 ${ids.length}，比建成的覆盖面少了（删剧本逃门禁是禁止的）`);
  const body = e2e.SCENARIOS.map((s) => String(s.run)).join('\n');
  for (const p of ['/reader/', '/daily/', '/hot/', '/reading/', '/weekly/', '/mybrief/', '/admin/']) {
    assert.ok(body.includes(p), `没有剧本访问 ${p}`);
  }
  for (const [id, ref] of Object.entries(e2e.KNOWN_GAPS)) {
    assert.match(ref, /^B\d+$/, `${id} 的 known_gap 没挂 ISSUES 编号（${ref}）——登记缺口必须可追溯`);
    assert.ok(ids.includes(id), `${id} 不在剧本表里（删了剧本又留了缺口登记）`);
  }
});

test('G7 端到端证据链格式：每轮跑完必须留下 report.json + env_lock.json + 截图', () => {
  // 不重新跑浏览器（那由 npm run eval:e2e 负责），只锁"证据目录结构"这条契约不被改松
  const tool = read('tools/eval-e2e.cjs');
  assert.match(tool, /screens/, '没有截图目录约定');
  assert.match(tool, /env_lock\.json/, '没有 env_lock（§3.1/§3.6 要求）');
  assert.match(tool, /report\.json/, '没有 report.json');
  assert.match(tool, /bytes < 10240/, '截图小于 10KB 必须判 fail_env（空白截图当证据是 B50 类漂移的评测版）');
  assert.match(tool, /CHECKS/, '必须复用 §3.6 的过程检查器，而不是自成一派');
});

test('G9 B73 阅读页必须有"晚到的旧响应不得覆盖新筛选"的序号守卫', () => {
  const src = read('web/src/pages/MyReadingPage.jsx');
  // 判的是行为，不是某个字面量：①每次请求领一个序号 ②落地前比对"我还是最新的那次吗"
  // ③筛选切换（reset=true）不许被"正在加载"吞掉——这三条缺任何一条，B73 就会复发
  assert.match(src, /const seq = \+\+seqRef\.current/, '没有请求序号自增（B73 复发的第一步）');
  assert.match(src, /if \(seq !== seqRef\.current\) return;/, '响应落地前没有比对序号（旧响应会覆盖新筛选）');
  assert.match(src, /if \(!reset && loadingRef\.current\) return;/, '筛选切换被"正在加载"吞掉（点了没反应）');
  // 反向探针（坑 #45：断言必须"坏代码在场时会红"）：序号守卫要在成功与失败两条路径各一处，
  // 只比一处会让"删掉另一处"仍然通过——第一版就错在这里。
  const GUARD = 'if (seq !== seqRef.current) return;';
  const guards = src.split(GUARD).length - 1;
  assert.equal(guards, 2, `成功/失败两条路径各需一处序号守卫，现在 ${guards} 处`);
  assert.ok(!src.split(GUARD).join('').includes(GUARD), '探针失效：删掉守卫后模式仍在（等于恒真断言）');
  assert.ok(src.replace('if (!reset && loadingRef.current) return;', 'if (loadingRef.current) return;').includes('if (loadingRef.current) return;'),
    '探针失效：把 reset 例外去掉的坏写法没被还原出来');
});

test('G8 B72/B73 已登记且判据没有反向迁就现状', () => {
  const iss = read('docs/ISSUES.md');
  for (const id of ['B71', 'B72', 'B73']) {
    assert.ok(iss.includes('**' + id + '**'), `docs/ISSUES.md 缺 ${id}`);
  }
  // B73：/api/reading 慢（实测 26s）导致筛选后 DOM 与响应错配——判据不许改成"只看接口"
  const tool = read('tools/eval-e2e.cjs');
  assert.match(tool, /params\.type \|\| \{\}\)\.value === 'article'/, 'E5 必须等"参数对得上的那条响应"，不能拿任意一条凑数');
});
