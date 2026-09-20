// BL8 重判后的下限保护锁：AI 调用间隔必须由一份带下限的实现算出来。
// 零配置依赖（不读 .env、不碰 db），见坑 #67 对锁文件宿主的要求。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// 惰性取：基线树上还没有 lib/ai-throttle 时，要让**用例**各自报红，而不是整文件加载崩（坑 #64/#67）
const gap = (v) => require('../lib/ai-throttle').gapMs(v);

test('1. 缺键/脏值一律回到 4000 默认，不许退化成 0 间隔', () => {
  // 这组样本是 BL8 的实测面：settings 里 ai.minIntervalMs 这个键**根本不存在**（2026-09-20 直读线上），
  // 而 `Number(null) === 0` —— 任何"直接 Number(设置值)"的写法都会把"缺键"变成"无间隔硬打 15RPM 免费池"。
  assert.equal(gap(null), 4000, '缺键（null）必须回落到默认 4000');
  assert.equal(gap(undefined), 4000, 'undefined 同上');
  assert.equal(gap(''), 4000, '空串按 Number 是 0，必须回落');
  assert.equal(gap(0), 4000, '显式 0 = 无间隔，低于下限即回落默认');
  assert.equal(gap('abc'), 4000, 'NaN 必须回落');
  assert.equal(gap(-5), 4000, '负数必须回落');
  assert.equal(gap(500), 4000, '低于 1000 下限视为无效配置，回落默认');
});

test('2. 合法值原样生效（下限不许变成写死）', () => {
  assert.equal(gap(2000), 2000);
  assert.equal(gap(4000), 4000);
  assert.equal(gap('9000'), 9000, '字符串数字要能用（settings 存的是 JSON，历史上有字符串）');
});

test('3. 负向自证：不带下限保护的写法必须被上面同一组样本判红', () => {
  // 这是产品代码原来那一行的等价实现：Number(getSetting(key, 4000))
  const naive = (v) => Number(v === null || v === undefined || v === '' ? 4000 : v);
  const discriminating = [null, 0, '', 'abc', -5, 500].filter((v) => naive(v) !== gap(v));
  assert.ok(discriminating.length >= 4,
    `样本没有区分力（naive 实现只在 ${discriminating.length} 个值上不同）→ 上面两条断言近似恒真`);
});

test('4. 调用点必须真的用这份实现（不许第二处自己 Number()）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', '_ai.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /require\(['"]\.\.\/lib\/ai-throttle['"]\)/,
    'api/_ai.js 不再引用 lib/ai-throttle → 间隔算术又变成两份');
  const chat = src.slice(src.indexOf('async function aiChat('));
  assert.match(chat.slice(0, 600), /gapMs\(/,
    'aiChat 里的 gap 不是由 gapMs 算出来的（坑 #59：同一算术写两遍必然分叉）');
});
