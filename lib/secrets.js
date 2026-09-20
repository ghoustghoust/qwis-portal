// 凭据卫生的唯一实现（B110/B113/B122/B125 同族，2026-06→09-21 三次实咬）。
// 门禁（`tools/doc-lint.cjs` 第 6 条）与回归锁 `tests/regression-secrets.test.js` 共用这一份
// （坑 #58/#59：判据与自证各写一套 = 没有判据）。
//
// 三条病根都是实测过的，不是假想：
//   ① **只掩顶层键等于没掩**（B110）：一次性探针 `node -e` 打印本地 `settings.alerts` 时掩码写在顶层，
//      而真实 webhook 在**嵌套的 `config.url`** 里 → 一条含 token 的飞书 webhook 明文进了会话输出。
//      读层早就修过同一课（`api/[...slug].js` 注释自陈「密钥在 c.config 嵌套层，只在顶层打码等于没打」），
//      我在一次性探针里重犯 —— 所以这条要变成**共享实现 + 坑 #69 的锁**，而不是靠我自觉。
//   ② **未跟踪也没被 ignore 的落盘产物**（B113）：`tools/audit-graph.cjs` 把 `dbState.settings[*].value`
//      原样写进 `docs/eval/audit/schedule.json`，一次 `git add docs/` 就把凭据提交出去。
//      ⇒ 扫描面不能只有 `git ls-files`（已跟踪），必须**加上"未跟踪且未被 ignore"**那一面。
//   ③ **模式表比凭据种类少**（B125 的 §5 第 6 条盲区）：原模式只有 ghp_/sk-/libsql 连接串/libsql.cloud，
//      飞书·钉钉·企微的 webhook URL 一个都不匹配 —— 报警渠道的密钥恰恰长在那里。
'use strict';

const { execFileSync } = require('child_process');

// 名字 → 正则。新增一类凭据必须先有一条能抓住它的样本（锁里），不许只往表里加一行"看着像"。
const SECRET_PATTERNS = [
  ['GitHub PAT', /ghp_[\w]{20,}/],
  ['OpenAI 风格 key', /sk-[\w]{20,}/],
  ['libsql 带口令连接串', /libsql:\/\/[^/\s"']+:[^/\s"']+@/],
  ['Turso 主机名', /tokens\.[\w-]+\.libsql\.cloud/],
  ['飞书 webhook', /open\.feishu\.cn\/open-apis\/bot\/v2\/hook\/[0-9a-f]{16,}(-[0-9a-f]+)*/i],
  ['钉钉 webhook', /oapi\.dingtalk\.com\/robot\/send\?access_token=[a-z0-9]{16,}/i],
  ['企微 webhook', /qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=[a-z0-9-]{16,}/i],
  ['长 Bearer 令牌', /(?:Authorization|authorization)["'\s:]+Bearer\s+[A-Za-z0-9._-]{40,}/],
];

// 键名形态：这些键的**值**一律视为可疑（大小写不敏感、子串匹配）
const SECRET_KEY = /(?:^|[_-])(?:key|token|password|passwd|secret|auth|cookie|credential|apikey|api_key)(?:$|[_-])|^(?:apiKey|token|password|secret|auth|cookie|authorization|webhookUrl|authToken)$/i;

function scanText(text) {
  const hits = [];
  for (const [name, re] of SECRET_PATTERNS) if (re.test(text)) hits.push(name);
  return hits;
}

function scanFiles(files, read) {
  const out = [];
  for (const f of files) {
    if (!/\.(md|json|js|cjs|mjs|jsx|ts|yml|yaml|txt|html|csv)$/i.test(f)) continue;
    let t;
    try { t = read(f); } catch { continue; }
    for (const name of scanText(t)) out.push({ file: f, kind: name });
  }
  return out;
}

/** 已跟踪文件（提交出去的） */
function listTracked(root) {
  return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', maxBuffer: 64e6 }).split('\n').filter(Boolean);
}
/** 未跟踪**且没被 ignore** 的文件 —— B113 的形状：一次 `git add` 就进历史 */
function listUntrackedNotIgnored(root) {
  return execFileSync('git', ['ls-files', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64e6 }).split('\n').filter(Boolean);
}

function maskStr(s) {
  return s.length <= 8 ? '*'.repeat(s.length) : `${s.slice(0, 4)}${'*'.repeat(Math.min(12, s.length - 8))}${s.slice(-4)}`;
}

/**
 * 递归掩码：键名可疑 → 整值打码；值本身命中凭据形态（webhook/token）→ 就地打码。
 * **纯函数**：不改原对象（探针常常拿着它继续断言，就地改会污染后续读数）。
 * 返回 `{ value, masked: 路径列表 }`，调用方要能把"掩了几处、掩了哪些路径"说出来 ——
 * 静默少掩是这条判据最危险的失败方向。
 */
function maskDeep(input, basePath = '', trail) {
  const masked = trail || [];
  if (typeof input === 'string') {
    const hit = SECRET_PATTERNS.some(([, re]) => re.test(input));
    if (hit) { masked.push(`${basePath || '(根)'}#形态`); return { value: maskStr(input), masked }; }
    return { value: input, masked };
  }
  if (Array.isArray(input)) {
    const out = input.map((v, i) => maskDeep(v, `${basePath}[${i}]`, masked).value);
    return { value: out, masked };
  }
  if (input && typeof input === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(input)) {
      const p = `${basePath ? basePath + '.' : ''}${k}`;
      if (SECRET_KEY.test(k)) {
        const s = typeof v === 'string' ? v : JSON.stringify(v);
        masked.push(`${p}#键名`);
        out[k] = maskStr(s || '');
        continue;
      }
      out[k] = maskDeep(v, p, masked).value;
    }
    return { value: out, masked };
  }
  return { value: input, masked };
}

module.exports = { SECRET_PATTERNS, SECRET_KEY, scanText, scanFiles, listTracked, listUntrackedNotIgnored, maskDeep, maskStr };
