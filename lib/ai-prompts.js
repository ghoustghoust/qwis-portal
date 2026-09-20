//
// AI prompt 的**唯一加载实现**（B111 / spec 39-6，2026-09-21）。
//
// 收口前这条链路上有 5 份"翻译提示词"（逐份字节数与取法记在 `docs/ISSUES.md` B111 行）：
//   ① `prompts/translate.md` —— 云端 `_ai.translateText` 与 runner 现役真正读的那份；
//   ② `api/_ai.js` 的 `EMBEDDED_PROMPTS.translate` —— "Vercel 包里可能没有 prompts/" 的兜底，
//      而且它一次兜了**全部 7 份** prompt（= 7 对文本，每对都会各自漂移）；
//   ③ `server/services/ai/translate-skill.js` 的 `DEFAULT_PROMPT` —— 本地精翻模块自己那份；
//   ④ `tools/collect-turso.js` 的 `TRANSLATE_DEFAULT_PROMPT` —— 与 ③ **字对字相同**（本轮 `diff` 实测：
//      两段只有声明行的变量名不同，函数体零差异），且**全文件只有声明处 1 处命中 = 死常量**，
//      runner 的翻译实际走 `_ai.translateText` → 读的是 ①；
//   ⑤ `server/routes/ai.js` 的 `DEFAULT_TRANSLATE_PROMPT` —— 与 ① 同义、措辞更短的第三变体。
// 键名还互不相通：云端读 `prompt.<name>`，本地端点读 `ai.prompt.translate` / `ai.prompt.summary`，
// 唯一有后台写入口的精翻模块读 `translate.prompt` → 后台改 prompt 对主链路无效（H10/B51 假开关同族）。
//
// 收口后的三条规则（本文件是它们唯一的地方）：
//   1. 优先级写死一次：`settings['ai.prompt.'+name]` → `prompts/<name>.md` → 本文件 `EMBEDDED` 兜底；
//   2. 兜底仍保留 —— 它挡的是"Vercel 打包到底带不带 `prompts/`"这一件**没有实测过**的事，
//      摘掉它等于拿一次线上翻译故障去验证假设。它只留一份（就是这里），不在 `api/` `tools/` 各留一份；
//   3. prompt 的**身份按名字分**：`translate`（主链路，带 `{{glossary}}`）与 `translate-skill`
//      （精翻模块那份七条要求）是两个名字、两份默认，不再互相冒充；第三个变体（⑤）删掉，
//      本地单次端点改吃 `translate` —— 它本来就是同一件事的更弱版本，
//      而 `prompts/translate.md` 在术语表为空时自带"按你的专业判断翻译"的分支，兜得住。
//
// 本文件同时是白盒 **W20** 的判据（与 `tests/regression-ai-prompts.test.js` 共用一份，
// 坑 #58/#59/#63：判据与自证各写一套 = 没有判据）。
'use strict';

const fs = require('fs');
const path = require('path');
const { scan } = require('./src-spans');

// 名称白名单：新增 prompt 必须先在这里挂号（白名单外 = 判据红），防止"键写错没人读"复发
const PROMPT_NAMES = [
  'translate',
  'translate-refine',
  'translate-polish',
  'translate-skill',
  'term-extract',
  'filter',
  'daily-analyze',
  'daily-theme',
];

// 落库键：三端只认这一种写法（收口前 `prompt.<name>` / `translate.prompt` / `ai.prompt.translate` 三种并存）
const settingKey = (name) => `ai.prompt.${name}`;
const promptsDir = () => path.join(__dirname, '..', 'prompts');
const promptFilePath = (name) => path.join(promptsDir(), `${name}.md`);

// 兜底文本（全库唯一一份）。前 7 条逐字来自原 `api/_ai.js#EMBEDDED_PROMPTS`，
// `translate-skill` 逐字来自原 `server/services/ai/translate-skill.js#DEFAULT_PROMPT`。
const EMBEDDED = {
  translate: '你是资深科技翻译专家。只输出译文，保留 Markdown 结构，代码/产品名不译，中英文间加空格。术语对照（必须严格遵循）：\n{{glossary}}\n',
  filter: '你是初筛编辑。按 内容深度30/相关性30/写作质量20/实用创新20 打分。强制压分负例（命中即 ≤15 且 ignore=true）：标题党钩子（震惊/不看后悔/必看）、纯广告导购、荐股荐币拉人头、无信源八卦、内容农场空洞文。严格输出 JSON：{"score":0-100,"ignore":bool,"reason":"30字内"}\n',
  'term-extract': '从中英对照文本提取专业术语对，置信度<0.7丢弃。严格输出 JSON 数组 [{"en","zh","domain","confidence"}]\n',
  'translate-refine': '你是术语校对专家。只修正译文中与术语表不一致处，其余一字不动，只输出修正后全文。术语表：\n{{glossary}}\n',
  'translate-polish': '你是资深科技出版编辑。从术语/表达/文化适应/格式四维改进译文，只输出最终稿。\n',
  'daily-analyze': '你是科技媒体主编。按 选题/内容/深度/实用/创新/表达（各0-10）评分，给出 totalScore(0-100)/reason/summary/quote/points/tags。只输出严格 JSON。\n',
  'daily-theme': '你是科技媒体主编。用一句话（≤60字，样式「从X，到Y，再到Z，判断W」）概括今日内容主线。只输出导语。\n',
  'translate-skill': '你是一位资深科技翻译专家，擅长将英文新闻资讯、技术论文和工程类文章翻译为高质量中文。\n'
    + '\n'
    + '翻译要求：\n'
    + '1. 【准确性】忠实原文，不遗漏关键信息，不添加原文没有的内容\n'
    + '2. 【流畅性】符合中文表达习惯，避免翻译腔（如"被...所"、"对于...来说"过多使用）\n'
    + '3. 【专业性】技术术语首次出现时采用「中文（英文原文）」格式，如"大语言模型（LLM）"\n'
    + '4. 【结构保持】保留原文的段落结构、列表、标题层级\n'
    + '5. 【数字与单位】保留原始数字，单位按中文习惯转换（如 "10 million" → "1000 万"）\n'
    + '6. 【专有名词】公司名/产品名/人名保留英文或通用译名，不强行音译\n'
    + '7. 【语境适配】新闻体用简洁明快的语言，论文体用严谨正式的措辞\n'
    + '\n'
    + '请翻译以下内容，只输出翻译结果，不要添加任何解释或注释。',
};

function isKnownPrompt(name) {
  return PROMPT_NAMES.includes(name);
}

// 文件优先，缺文件才用兜底（不抛：拿不到兜底时返回空串，由调用方的模型调用自然出声）
function defaultPrompt(name) {
  if (!isKnownPrompt(name)) throw new Error(`未挂号的 prompt 名：${name}`);
  try {
    return fs.readFileSync(promptFilePath(name), 'utf8');
  } catch {
    return EMBEDDED[name] || '';
  }
}

// 唯一优先级实现。`override` 由调用方从各自的 settings 层取来（libsql 异步 / better-sqlite3 同步，
// 两端取法不同但**顺序只在这里定义一次**），空串/纯空白都算"没覆盖"。
function promptText(name, { override } = {}) {
  const o = override == null ? '' : String(override);
  if (o.trim()) return o;
  return defaultPrompt(name);
}

// `{{glossary}}` 占位：给空就替换成空串 —— prompts/translate.md 自己写了"若为空则按专业判断翻译"，
// 所以空术语表不需要特殊分支，也不需要为此再留一份变体。
function fillGlossary(text, note) {
  return String(text).replace(/\{\{glossary\}\}/g, String(note || ''));
}

// ── 白盒 W20 判据 ────────────────────────────────────────────────
// 只认**字符串字面量**（坑 #58/#59：注释里写 prompt 不算实现，判据也不该被它骗）。
// 长度下界 40 字：判据抓的是"提示词正文"，而 `资深…翻译专家` 这类人设短语也会出现在界面文案里
// （实测反向样本：`'AI 翻译（由资深科技翻译专家模型生成）'` 18 字被误判）。
// 代价要说清：短到 40 字以下的 prompt 会漏（现存的 8 份都在 60 字以上），漏的方向是假绿，
// 所以同一族的"七条要求"那条形态不设长度下界之外的依赖 —— 两条 BANNED 是**或**的关系，不是与。
const MIN_PROMPT_CHARS = 40;
const SCAN_DIRS = ['api', 'server', 'tools', 'lib'];
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'data', 'archive', 'trash', '.next', 'coverage', 'tests']);
const SCAN_EXT = /\.(js|cjs|mjs|jsx)$/;
const ALLOWED = new Map([['lib/ai-prompts.js', 'prompt 加载与兜底唯一实现']]);
const SKIP_TOOL = /^tools\/(?:eval-|_|doc-lint)/;
const BANNED = [
  { re: /资深[\s\S]{0,12}翻译专家/, label: '手写翻译 prompt 人设串（该走 lib/ai-prompts.js）' },
  { re: /【准确性】[\s\S]{0,80}【流畅性】/, label: '手写翻译 prompt 七条要求（该走 lib/ai-prompts.js）' },
];
// "唯一实现"不能是空话：这三个消费点必须真的引用本文件
// （runner 不在列内 —— 它经 `_ai.loadPrompt` 生效，行为锁 PR4 钉的就是这一条）
const MUST_IMPORT = ['api/_ai.js', 'server/routes/ai.js', 'server/services/ai/translate-skill.js'];
const IMPORT_RE = /require\(\s*'\.\.?\/(?:.*\/)?(?:lib\/)?ai-prompts'\s*\)/;

function walk(root, dir, out) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (SKIP_DIR.has(e.name)) continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) walk(root, rel, out);
    else if (SCAN_EXT.test(e.name)) out.push(rel);
  }
  return out;
}

// → { violations:[{file,line,label,code}], missingImport:[], scanned, allowed }
function findPromptViolations(root) {
  const files = [];
  for (const top of SCAN_DIRS) {
    if (fs.existsSync(path.join(root, top))) walk(root, top, files);
  }
  const targets = files.filter((rel) => !ALLOWED.has(rel) && !SKIP_TOOL.test(rel));
  const violations = [];
  for (const rel of targets) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    // `strings` 的偏移是**原文**偏移（与 masked 等长同坐标系，坑 #62/#57：拿 code 视图换算行号会整体左移）
    for (const s of scan(src).strings) {
      if (s.s.length < MIN_PROMPT_CHARS) continue;
      for (const b of BANNED) {
        if (!b.re.test(s.s)) continue;
        violations.push({
          file: rel,
          line: src.slice(0, s.from).split('\n').length,
          label: b.label,
          code: s.s.trim().slice(0, 70),
        });
      }
    }
  }
  const missingImport = MUST_IMPORT.filter((f) => {
    const p = path.join(root, f);
    return !fs.existsSync(p) || !IMPORT_RE.test(fs.readFileSync(p, 'utf8'));
  });
  return {
    violations,
    missingImport,
    consumed: MUST_IMPORT.length - missingImport.length,
    scanned: targets.length,
    allowed: [...ALLOWED.entries()].map(([f, why]) => `${f}（${why}）`),
  };
}

module.exports = {
  PROMPT_NAMES, EMBEDDED,
  settingKey, promptsDir, promptFilePath, isKnownPrompt,
  defaultPrompt, promptText, fillGlossary,
  findPromptViolations, BANNED, ALLOWED, MUST_IMPORT,
};
