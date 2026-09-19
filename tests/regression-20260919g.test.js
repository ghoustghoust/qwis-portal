// 2026-09-19 深夜轮（41-2 端到端引擎 + B71/B72/B73）回归锁
// 覆盖：
//   G1 B71 后台入口必须挂 LanguageProvider（端到端首轮实测抓到裸 key）
//   G2 字典与调用点同时存在（防止"把键删掉"造成假修好）
//   G3 白盒新增 W11（入口 Provider 完整性）真的在跑
//   G4 端到端引擎自检必须全绿（41-2 的判据本身不能是坏的）
//   G5 端到端剧本的**参数出处必须真实存在**——path:line 指向的文件要有那一行
//      （这条是防"出处是我编的"：本轮 F7 判据第一次有了机器可查的后盾）
//   G6 端到端剧本必须覆盖 6 个前台页 + 后台登录门，且 known_gap 都带 ISSUES 编号
//   G10 独立对抗审查 #2/#3：验收轮门（跑过≠验收过）与"探针响应不进对账"必须真的接进运行器
//   G11 独立对抗审查 #6：剧本里不许存在"永远不会红"的判据（写死真 / 两侧恒等 / 空集合兜底）
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

// 坑 #46~#51 的回归锁就落在本文件：#46→G4/G5/G10（对账对象、出处表、探针响应不进对账）、#47→G5/G6（选择
// 器与覆盖表）、#48→G8（按参数等响应）、#49→G9（晚到响应守卫）、#50→G11（空判据）、#51→G10（验收轮门）。
// W9 门禁要求坑编号必须被测试引用。
test('G4 端到端引擎自检必须全绿（判据坏了就等于整轮结果不可信；坑 #46）', () => {
  const out = execFileSync(process.execPath, ['tools/eval-e2e.cjs', '--self-test'], { cwd: ROOT, encoding: 'utf8' });
  const m = /自检：(\d+)\/(\d+) 通过/.exec(out);
  assert.ok(m, '没打印自检计数：\n' + out.slice(-500));
  assert.strictEqual(m[1], m[2], '端到端引擎自检未全绿：\n' + out);
});

test('G5 剧本里每个 file:line 出处都必须真实指到那一行（防"出处是编的"；坑 #46/#47）', () => {
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

test('G6 剧本覆盖六个前台页 + 后台登录门，known_gap 必须带 ISSUES 编号（坑 #47）', () => {
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

test('G9 B74 阅读页必须有"晚到的旧响应不得覆盖新筛选"的序号守卫（坑 #49）', () => {
  const src = read('web/src/pages/MyReadingPage.jsx');
  // 判的是行为，不是某个字面量：①每次请求领一个序号 ②落地前比对"我还是最新的那次吗"
  // ③筛选切换（reset=true）不许被"正在加载"吞掉——这三条缺任何一条，B74 就会复发
  assert.match(src, /const seq = \+\+seqRef\.current/, '没有请求序号自增（B74 复发的第一步）');
  assert.match(src, /if \(seq !== seqRef\.current\) return;/, '响应落地前没有比对序号（旧响应会覆盖新筛选）');
  assert.match(src, /if \(!reset && loadingRef\.current\) return;/, '筛选切换被"正在加载"吞掉（点了没反应）');
  // 反向探针（坑 #45：断言必须"坏代码在场时会红"）：序号守卫要在成功与失败两条路径各一处，
  // 只比一处会让"删掉另一处"仍然通过——第一版就错在这里。
  const GUARD = 'if (seq !== seqRef.current) return;';
  const guards = src.split(GUARD).length - 1;
  assert.equal(guards, 2, `成功/失败两条路径各需一处序号守卫，现在 ${guards} 处（少于两处 B74 就会复发）`);
  // 反向自证要"删掉一处就失败"——写成"全删掉后模式匹配不到"是恒真的假探针（坑 #45 的锁版本）
  const oneRemoved = src.replace(GUARD + '\n', '');
  assert.equal(oneRemoved.split(GUARD).length - 1, 1, '探针失效：删掉一处守卫后数量判据竟没变化');
  assert.notEqual(oneRemoved.split(GUARD).length - 1, guards, '探针失效：只剩一处守卫时锁仍能通过（等于没锁住"两处"）');
  assert.ok(src.replace('if (!reset && loadingRef.current) return;', 'if (loadingRef.current) return;').includes('if (loadingRef.current) return;'),
    '探针失效：把 reset 例外去掉的坏写法没被还原出来');
});

test('G8 B71~B81 已登记且判据没有反向迁就现状（坑 #48）', () => {
  const iss = read('docs/ISSUES.md');
  for (const id of ['B71', 'B72', 'B73', 'B74', 'B75', 'B76', 'B77', 'B78', 'B79', 'B80', 'B81']) {
    assert.ok(iss.includes('**' + id + '**'), `docs/ISSUES.md 缺 ${id}`);
  }
  // B73：/api/reading 慢（实测 26s）；B74：前端缺晚到响应守卫——判据不许改成"只看接口"
  const tool = read('tools/eval-e2e.cjs');
  assert.match(tool, /params\.type \|\| \{\}\)\.value === 'article'/, 'E5 必须等"参数对得上的那条响应"，不能拿任意一条凑数');
});

// ── G10/G11 独立对抗审查（2026-09-19 第二轮）落账：这四条是 reviewer 查出来的，不是我自己发现的 ──
test('G10 验收轮门必须接进运行器：跑子集/单轮/本地站全绿也不许 exit 0（坑 #51）', () => {
  const t = e2e.acceptanceOf;
  assert.equal(typeof t, 'function', 'acceptanceOf 没导出，验收轮口径无处复用');
  const N = e2e.SCENARIOS.length;
  assert.equal(t(N, N, 3, true).ok, true, '全剧本 ×3 轮 ×云端应是验收轮');
  assert.equal(t(1, N, 3, true).ok, false, '--only 一条也当验收（假绿入口）');
  assert.equal(t(N, N, 1, true).ok, false, '--fast 单轮也当验收（判不出 flaky）');
  assert.equal(t(N, N, 3, false).ok, false, '打本地站也当验收（AGENTS §3 第 8 条只认云端）');
  assert.ok(t(1, N, 1, false).reasons.length === 3, '三条理由必须全部列出，不许只报第一条就停');
  // 接线证明：光有纯函数不等于生效，必须确认 main() 里真的拿它改了退出码
  const src = read('tools/eval-e2e.cjs');
  assert.match(src, /const acceptance = acceptanceOf\(/, 'main() 没调用 acceptanceOf（判据悬空）');
  assert.match(src, /if \(!acceptance\.ok && final === 0\) final = 2;/, '非验收轮没被强制退出非 0（全绿仍会 exit 0）');
  assert.match(src, /viewport: VIEWPORT, repeat, scenarios:.*acceptance/m, 'env_lock 没落 acceptance 字段（交付说明无从核对）');
  // 反向探针（坑 #45）：把那条强制改写删掉，本锁必须红
  assert.notEqual(src.replace('if (!acceptance.ok && final === 0) final = 2;', ''), src,
    '反向探针失效：删掉退出码改写后源码没变化（这条锁是恒真的）');
  // known_gap 必须登记在 ISSUES：未登记的豁免等于删剧本
  for (const g of e2e.gapIssues()) {
    assert.ok(g.ok, `known_gap ${g.id}→${g.ref} 没在 docs/ISSUES.md 登记`);
  }
});

test('G11 探针响应不得进"页面自己发出的"对账，剧本里不得有永远不红的判据（坑 #46 补刀、#50）', () => {
  // ① 行为：script 记录必须被排除，page 记录必须保留（两向都判，防"全排除"式假修好）
  const s = [{ url: '/api/reading', by: 'script', json: { items: [{ id: 1 }] }, params: {}, at: 1, status: 200 }];
  assert.equal(e2e.collected(s, '/api/reading').size, 0, '探针响应进了对账（脚本自己发、自己证明页面发过）');
  s.push({ url: '/api/reading', by: 'page', json: { items: [{ id: 2 }] }, params: {}, at: 2, status: 200 });
  assert.equal(e2e.collected(s, '/api/reading').size, 1, '页面响应被一起排除了（对账会全线拿不到数据）');
  assert.equal(e2e.byPage({ by: 'script' }), false);
  assert.equal(e2e.byPage({}), true, '没标 by 的旧记录要默认算页面发出，否则历史剧本全变假绿');
  // ② 静默判据：只有探针发过时不许判"页面已静"
  const only = [{ url: '/api/reading', by: 'script', at: Date.now(), params: {} }];
  return e2e.waitQuiet(only, '/api/reading', 8000, 200).then((r) => {
    assert.equal(r.quiet, false, '探针响应被当成"页面发过请求"（waitQuiet 被伪造）');
  });
});

test('G11b 剧本表里不许有写死真/两侧恒等的判据，字典读不到不许兜底成空集（坑 #50）', () => {
  const src = read('tools/eval-e2e.cjs');
  const a0 = src.indexOf('const SCENARIOS = ['), a1 = src.indexOf('const KNOWN_GAPS');
  const table = src.slice(a0, a1);
  assert.ok(a0 > 0 && a1 > a0, '取不到剧本表区间，本锁会退化成恒真');
  assert.ok(!/assert\(c,\s*'[a-z]+',\s*'[^']*',\s*true[,)]/.test(table), '剧本里有写死真的判据（永远不会红）');
  assert.ok(!/dictKeys\(\)[\s\S]{0,200}catch \{ return \[\]; \}/.test(src), '字典读失败兜底成空集 → E8 的裸 key 判据变常绿');
  assert.ok(e2e.dictKeys().length >= 50, '真实字典必须解析得出来，否则 E8 无依据');
});

test('G12 E4 不许在断言前清掉本轮已拦到的响应，E9 不许用绝对长度门槛（坑 #53）', () => {
  const src = read('tools/eval-e2e.cjs');
  const e4 = src.slice(src.indexOf("id: 'E4'"), src.indexOf("id: 'E5'"));
  const e9 = src.slice(src.indexOf("id: 'E9'"), src.indexOf("id: 'E10'"));
  // ① E4 的坑：点 tab 前 net.length=0 → 首屏已经取回的那条响应被扔掉，"页面自己的请求"永远拦不到
  assert.ok(!/net\.length = 0;\s*\n\s*assert\(c, 'render', `点得到/.test(e4),
    'E4 又在点击前清了 net（会把首屏那条真实响应扔掉；坑 #53）');
  assert.match(e4, /waitForApiWhere\(net,[\s\S]{0,160}params\.tab/, 'E4 必须按 tab 参数筛整轮记录，而不是"清点后等一条新的"');
  // ② E9 的坑：pane.len > 300 这种绝对门槛把薄正文条目判成缺陷（实测 112 字正文 / 297 字面板）
  assert.ok(!/pane\.len > 300/.test(e9), 'E9 又用绝对长度当门槛（坑 #53 的第二个症状）');
  assert.match(e9, /pane\.len >= Math\.ceil\(plain\.length \/ 2\)/, 'E9 必须用相对判据：面板长度要接得住正文明文的一半');
  // 反向自证：把两条坏写法还原回去，判据必须能抓到（否则这两行锁是恒真的）
  assert.ok(e4.replace("const own = await waitForApiWhere(net,", "net.length = 0;\n        const own = await waitForApiWhere(net,")
    .includes('net.length = 0;'), '探针失效：坏写法没能被还原出来');
  assert.notEqual(e9.replace('pane.len >= Math.ceil(plain.length / 2)', 'pane.len > 300'), e9,
    '探针失效：绝对门槛的写法没能被还原出来');
});
