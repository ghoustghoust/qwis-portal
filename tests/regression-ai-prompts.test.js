// B111 翻译 prompt 单源回归锁（spec 39-6 的 AC1~AC3，2026-09-21）。
//
// 一句话病根：同一条翻译链路上有 **5 份** prompt 文本 + **3 个互不相通**的 settings 键名 ——
//   ① prompts/translate.md（云端与 runner 现役读的）② api/_ai.js 的 EMBEDDED_PROMPTS（7 条内嵌兜底）
//   ③ 本地精翻模块 DEFAULT_PROMPT ④ runner 里与 ③ **字对字相同**却无人引用的死常量
//   ⑤ 本地单次端点那份更短的变体；键名分别是 `prompt.<name>` / `translate.prompt` / `ai.prompt.translate`。
// 后果：后台改 prompt 只对其中一条链生效 = 第二个假开关（H10/B51 同族），而副本之间迟早漂移
// （③④ 已经漂到"只差变量名"，⑤ 与 ① 已经不同字）。
//
// 锁的形状：判据与门禁共用 lib/ai-prompts#findPromptViolations（坑 #58/#59）；
// 关键断言是**行为锁**（PR4/PR5 真读写两端 settings 层），不是文本比对；
// 每条禁写法配负向样本，每个形状配反向样本（坑 #62/#63/#71）。
'use strict';
require('./helpers'); // 先于任何 server/*：给它临时 APP_DATA_DIR，绝不碰 data/app.db
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
// 惰性取（坑 #64/#67）：F2P 会在"基线树里还没有 lib/ai-prompts.js"的 worktree 里跑本文件，
// 顶层 require 会让它崩在加载期，读成"锁假了"而不是"改前红"。
const AP = () => require('../lib/ai-prompts');

const write = (dir, rel, text) => {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};
const tmp = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), tag));

test('PR1 prompt 判据在活代码里只剩一份：违规 0、分母够大、三个消费点真接上了（#71）', () => {
  const r = AP().findPromptViolations(ROOT);
  assert.ok(r.scanned >= 100, `扫描面只有 ${r.scanned} 个文件 —— 分母不足时"0 份副本"没有意义`);
  assert.deepEqual(
    r.violations.map((v) => `${v.file}:${v.line} ${v.label}`), [],
    `又出现手写翻译 prompt（第二份必然漂）：\n${r.violations.map((v) => `  ${v.file}:${v.line} ${v.label}`).join('\n')}`);
  for (const f of AP().MUST_IMPORT) {
    assert.ok(!r.missingImport.includes(f), `${f} 没引用 lib/ai-prompts —— "唯一实现"成了空话`);
  }
  assert.equal(r.consumed, AP().MUST_IMPORT.length, '消费点数量与挂号表不一致');
});

test('PR2 负向自证（#71）：塞一份手写翻译 prompt 必须红并点名；注释里的同句不许红', () => {
  const dir = tmp('b111-bad-');
  try {
    write(dir, 'server/services/x.js',
      'const P = `你是一位资深科技翻译专家，擅长将英文新闻资讯、技术论文和工程类文章翻译为高质量中文。\\n'
      + '1. 【准确性】忠实原文\\n2. 【流畅性】符合中文表达习惯`;\nmodule.exports = P;\n');
    const r = AP().findPromptViolations(dir);
    assert.ok(r.violations.length >= 2, `手写 prompt 没被判出来（恒真判据）：${JSON.stringify(r.violations)}`);
    assert.equal(r.violations[0].file, 'server/services/x.js', `没点名文件：${JSON.stringify(r.violations[0])}`);
    assert.equal(r.violations[0].line, 1, `没点名行号（应 1，实得 ${r.violations[0].line}）`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }

  const dir2 = tmp('b111-ok-');
  try {
    write(dir2, 'server/services/y.js', [
      '// 注释里抄一份默认 prompt：你是一位资深科技翻译专家，【准确性】【流畅性】—— 注释不算实现（坑 #63）',
      "const label = 'AI 翻译（由资深科技翻译专家模型生成）'; // 文案里出现同类词不算 prompt 实现",
      "const other = '你是一位专业的内容分析师。请从以下文章中提取核心要点。'; // 摘要 prompt：不在本判据的翻译家族里",
      'module.exports = { label, other };',
    ].join('\n'));
    const r2 = AP().findPromptViolations(dir2);
    assert.deepEqual(r2.violations, [], `反向样本被误判成手写 prompt：${JSON.stringify(r2.violations)}`);
  } finally { fs.rmSync(dir2, { recursive: true, force: true }); }
});

test('PR3 优先级只有一份实现：覆盖 > 文件 > 兜底，空白覆盖等于没覆盖', () => {
  const { promptText, defaultPrompt, EMBEDDED } = AP();
  assert.equal(promptText('translate', { override: '本轮测试覆盖文本' }), '本轮测试覆盖文本');
  assert.equal(defaultPrompt('translate'), fs.readFileSync(path.join(ROOT, 'prompts', 'translate.md'), 'utf8'),
    '默认文本必须来自 prompts/translate.md（不是内嵌那份）');
  for (const blank of [undefined, null, '', '   \n ']) {
    assert.equal(promptText('translate', { override: blank }), defaultPrompt('translate'),
      `空白覆盖（${JSON.stringify(blank)}）不该顶掉文件文本`);
  }
  assert.ok(EMBEDDED.translate.includes('{{glossary}}'), '内嵌兜底也要带术语占位，否则 fillGlossary 会静默失配');
  assert.throws(() => defaultPrompt('no-such-prompt'), /未挂号的 prompt 名/, '白名单外的名字必须出声');
});

test('PR4 跨端行为锁（39-6 AC1）：一条落库覆盖键改的是云端与 runner 同一条链路的 system prompt', async () => {
  const dir = tmp('b111-db-');
  const url = 'file:' + path.join(dir, 'p.db').replace(/\\/g, '/');
  const prev = { url: process.env.TURSO_DATABASE_URL, tok: process.env.TURSO_AUTH_TOKEN };
  process.env.TURSO_DATABASE_URL = url;
  process.env.TURSO_AUTH_TOKEN = '';
  delete require.cache[require.resolve('../api/_ai.js')];
  try {
    const { createClient } = require('@libsql/client');
    const c = createClient({ url });
    await c.execute('CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)');
    const _ai = require('../api/_ai.js');
    const before = await _ai.loadPrompt('translate');
    assert.equal(before, fs.readFileSync(path.join(ROOT, 'prompts', 'translate.md'), 'utf8'),
      '没有覆盖键时应取 prompts/translate.md');
    // 统一后的键名（三端都读这一个）：写进去 → 同一条链路立刻变
    await c.execute({
      sql: 'INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)',
      args: [AP().settingKey('translate'), JSON.stringify('覆盖后的翻译 prompt')],
    });
    assert.equal(await _ai.loadPrompt('translate'), '覆盖后的翻译 prompt',
      '写统一键不生效 = 后台的 prompt 编辑器仍是假开关');
    // 收口前的键名不再有人读（正向探针：上一句已经证明新键生效）
    await c.execute({
      sql: 'INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)',
      args: ['prompt.translate', JSON.stringify('旧键文本，不该被读到')],
    });
    assert.equal(await _ai.loadPrompt('translate'), '覆盖后的翻译 prompt', '旧键 `prompt.<name>` 仍在参与读取');
    await c.close();
  } finally {
    process.env.TURSO_DATABASE_URL = prev.url;
    process.env.TURSO_AUTH_TOKEN = prev.tok;
    delete require.cache[require.resolve('../api/_ai.js')];
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows 句柄未放，留着由系统清 */ }
  }
});

test('PR5 本地精翻模块读写同一个统一键：setPrompt → getPrompt → resetPrompt 回默认', () => {
  const skill = require('../server/services/ai/translate-skill.js');
  const key = AP().settingKey('translate-skill');
  const { getSetting, setSetting } = require('../server/db');
  setSetting(key, '');
  assert.equal(skill.getPrompt(), AP().defaultPrompt('translate-skill'), '清空覆盖后必须回默认（默认=文件那份）');
  skill.setPrompt('本轮测试：只输出译文，不许解释');
  assert.equal(skill.getPrompt(), '本轮测试：只输出译文，不许解释');
  assert.equal(getSetting(key, ''), '本轮测试：只输出译文，不许解释', '写的不是统一键 → 另一端读不到');
  assert.equal(getSetting('translate.prompt', ''), '', '收口前的旧键 translate.prompt 不该再被写');
  skill.resetPrompt();
  assert.equal(skill.getPrompt(), AP().defaultPrompt('translate-skill'), '「恢复默认」必须回到同一份默认');
});

test('PR6 旧键名与旧常量必须绝迹（禁写法配正向探针，坑 #45 第④条）', () => {
  const hits = [];
  const OLD = [
    /getSetting\(\s*['"]translate\.prompt['"]/,
    /setSetting\(\s*['"]translate\.prompt['"]/,
    /getSetting\(\s*`prompt\.\$\{/,
    /TRANSLATE_DEFAULT_PROMPT/,
    /EMBEDDED_PROMPTS/,
  ];
  const files = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p);
      else if (/\.(js|cjs|jsx)$/.test(e.name)) files.push(p);
    }
  };
  for (const top of ['api', 'server', 'tools', 'lib']) {
    if (fs.existsSync(path.join(ROOT, top))) walk(top);
  }
  for (const rel of files) {
    if (/^tools\/(?:eval-|_|doc-lint)/.test(rel)) continue;
    // 剥注释、保留字符串（坑 #63/#67/#71）：本轮各文件头部都**写了**被删掉的旧常量名作为来历说明，
    // 用原文判会让自己的注释变成假红；而旧键的字符串形态必须仍然算（它才是真读写的证据）
    const src = require('../lib/src-spans').sqlText(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    for (const re of OLD) if (re.test(src)) hits.push(`${rel} ${re}`);
  }
  assert.deepEqual(hits, [], `旧键名/旧常量还在：\n${hits.join('\n')}`);
  // 正向：统一键确实由 lib 一处生成，且消费点真在用它
  assert.equal(AP().settingKey('translate'), 'ai.prompt.translate');
  const aiSrc = fs.readFileSync(path.join(ROOT, 'api', '_ai.js'), 'utf8');
  assert.match(aiSrc, /promptSettingKey\(name\)/, 'api/_ai.js 不再经统一键名取覆盖 → PR4 的行为就没人保证了');
});

test('PR7 挂号双向：每个名字有文件也有兜底，每个文件都有人 load', () => {
  const { PROMPT_NAMES, promptFilePath, EMBEDDED } = AP();
  for (const n of PROMPT_NAMES) {
    assert.ok(fs.existsSync(promptFilePath(n)), `prompt 名 ${n} 挂号了但没有 prompts/${n}.md`);
    assert.ok((EMBEDDED[n] || '').length > 10, `prompt 名 ${n} 没有内嵌兜底（Vercel 缺文件时会静默变空串）`);
  }
  const files = fs.readdirSync(path.join(ROOT, 'prompts'))
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((f) => f.replace(/\.md$/, ''));
  for (const f of files) {
    assert.ok(PROMPT_NAMES.includes(f), `prompts/${f}.md 没人 load（白名单外）—— README 明令"别加没人 load 的模板"`);
  }
});
