// 2026-09-19 第 3 批页面批注（B84/B85/B72）的 F2P 锁
// 运行：node --test tests/regression-20260919i.test.js
// 改前基线：node tools/eval-f2p.cjs --base d679167 --tests tests/regression-20260919i.test.js --cases I
// 三条缺陷的可见面在浏览器里（已由 eval:e2e E3/E6/E10 打线上取证）；本文件钉的是**离线可判的契约**：
// 布局下限/上界是否写进组件、三份媒体栏实现是否同步带出兜底字段、路由是否有白名单外分支。
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
// 文本型锁的函数边界唯一实现（坑 #57/#58 的两类假结果都出在手写边界上）
const { spans, ownerAt } = require('../lib/src-spans');

// 抽出一个组件函数的函数体（从声明到下一个顶层 ^function / ^export 之前）
function bodyOf(src, decl) {
  const at = src.indexOf(decl);
  if (at < 0) return null;
  const next = src.slice(at + decl.length).search(/^\w/m);
  return next < 0 ? src.slice(at) : src.slice(at, at + decl.length + next);
}

// 渲染某字段的元素，其**开标签**是否带宽度上界。
// 逐行匹配会误杀：界写在包裹层、字段在内层是合法写法（B85 的修法正是这样）。
function openingTagBounding(body, fieldExpr) {
  const at = body.indexOf(fieldExpr);
  if (at < 0) return { found: false };
  const open = body.lastIndexOf('<span', at);
  if (open < 0) return { found: false };
  const close = body.indexOf('>', at);
  const head = body.slice(open, close < 0 ? undefined : close);
  // 只认开标签自身的 class（内层再套一层时 head 会含内层，但界必须在其中出现才可能生效）
  return { found: true, bounded: /max-w-\[/.test(head), tag: head.replace(/\s+/g, ' ').slice(0, 180) };
}

test('I1 B85：CompactRow 标题列必须有宽度下限，来源列必须有宽度上界', () => {
  const file = read('web', 'src', 'components', 'ColumnSection.jsx');
  const row = bodyOf(file, 'function CompactRow');
  assert.ok(row, '找不到 CompactRow，本条会退化成恒真');
  // 坑 #54：flex-1 = flex:1 1 0%，基准 0 让标题列在收缩阶段永远抢不到宽度，必须有 min-w 下限
  const title = row.match(/<span className="([^"]*flex-1[^"]*)"/);
  assert.ok(title, '标题列（flex-1）不存在');
  assert.ok(/min-w-\[\d/.test(title[1]), `标题列没有 min-width 下限（只有 min-w-0 会被挤到 0 宽）：${title[1]}`);
  assert.ok(!/\bmin-w-0\b/.test(title[1]), `标题列仍是 min-w-0：${title[1]}`);
  // 渲染 source_name 的元素必须有宽度上界：无界的 flex-none 兄弟能把基准宽之和顶过整行宽
  const src = openingTagBounding(row, 'item.source_name');
  assert.ok(src.found, 'CompactRow 里没有渲染来源名的列，判据失去对象');
  assert.ok(src.bounded, `来源列未设宽度上界：${src.tag}`);
});

test('I2 B85：MyBriefPage 列表行同族缺陷一并设界（同一 source 字段，不能只修一处）', () => {
  const file = read('web', 'src', 'pages', 'MyBriefPage.jsx');
  const row = bodyOf(file, 'function RestRow');
  assert.ok(row, '找不到 RestRow');
  const title = row.match(/<span className="([^"]*flex-1[^"]*)"/);
  assert.ok(title && /min-w-\[\d/.test(title[1]), `RestRow 标题列缺 min-width 下限：${title && title[1]}`);
  const srcCol = openingTagBounding(row, 'item.source');
  assert.ok(srcCol.found, 'RestRow 没有渲染来源的列');
  assert.ok(srcCol.bounded, `RestRow 来源列未设界：${srcCol.tag}`);
});

test('I3 B84：三份媒体栏实现（api 日报 / runner 日报 / runner 我的早报）都要带出 source_avatar', () => {
  const files = [['api', '[...slug].js'], ['tools', 'collect-turso.js']];
  let pushes = 0;
  for (const f of files) {
    const src = read(...f);
    const lines = src.split('\n').filter((l) => /mediaItems\.push\(/.test(l));
    assert.ok(lines.length >= 2, `${f.join('/')} 只找到 ${lines.length} 处 mediaItems.push，判据对象不对`);
    const bad = lines.filter((l) => !/source_avatar:/.test(l));
    assert.ok(bad.length === 0, `${f.join('/')} 有媒体项没带兜底头像字段：\n${bad.join('\n').slice(0, 240)}`);
    pushes += lines.length;
    const selects = src.split('\n').filter((l) => /AS source_avatar/.test(l) && /SELECT (v|a)\.id/.test(l));
    assert.ok(selects.length >= 2, `${f.join('/')} 只有 ${selects.length} 条媒体查询取 s.avatar（视频+播客各一条）`);
  }
  assert.ok(pushes >= 6, `媒体项 push 总数=${pushes}（api 2 + runner 日报 2 + runner 我的早报 2）——新增了副本却没同步本锁`);
});

test('I4 B84：MediaRow 无封面分支渲染 SourceAvatar，不再用 emoji 冒充图标', () => {
  const src = read('web', 'src', 'pages', 'MyBriefPage.jsx');
  const row = bodyOf(src, 'function MediaRow');
  assert.ok(row, '找不到 MediaRow');
  assert.ok(!/[🎧]/.test(row) && !/▶/.test(row), `MediaRow 仍有 emoji 角标：${(row.match(/[🎧▶]/g) || []).join('')}`);
  assert.ok(/<SourceAvatar /.test(row), 'MediaRow 无封面分支没有渲染 SourceAvatar（源头像兜底是 lib/media.js 写死的契约）');
  assert.ok(/source_avatar/.test(row), 'MediaRow 没有把 source_avatar 传给兜底头像');
  // 契约文档与实现必须同口径，否则下一轮又会"文档说有、实现没有"
  const lib = read('lib', 'media.js');
  assert.ok(/source_avatar/.test(lib), 'lib/media.js 的兜底口径没写明承载字段，读的人仍会以为只是"源头像"');
});

test('I5 B72：未知路径必须有白名单外分支，else 不得无条件渲染阅读器', () => {
  const src = read('web', 'src', 'main.jsx');
  assert.ok(/function NotFoundPage/.test(src), 'main.jsx 没有 NotFoundPage');
  assert.ok(/data-e2e="notfound"/.test(src), '404 兜底缺 data-e2e 锚点（E10 靠它定位）');
  assert.ok(!/else page = <ReaderPage \/>;/.test(src), '路由末尾仍是无条件 else → ReaderPage（B72 原样）');
  assert.ok(/else page = <NotFoundPage/.test(src), '未知路径没有落到 NotFoundPage 分支');
  assert.ok(/KNOWN_PREFIXES/.test(src), '缺白名单：无法区分"阅读器"和"打错的路径"');
});

test('I6 B72：评测接线同步——E10 从 known_gap 回到门禁位，剧本仍在', () => {
  const src = read('tools', 'eval-e2e.cjs');
  assert.ok(/id: 'E10'/.test(src), 'E10 剧本被删了（禁止用删剧本逃门禁）');
  const gaps = src.match(/const KNOWN_GAPS = \{[^}]*\}/);
  assert.ok(gaps, '找不到 KNOWN_GAPS 声明');
  assert.ok(!/E10/.test(gaps[0]), `B72 已修，E10 仍挂在 KNOWN_GAPS 上不进门禁：${gaps[0]}`);
  assert.ok(/notfound/.test(src), 'E10 没有用 404 锚点做判据（还在只判"页面有没有阅读器文案"）');
});

test('I8 坑 #55/B10：栏目表只许一份实现，且写回 settings 的默认值必须来自它', () => {
  const lib = read('lib', 'daily-columns.js');
  assert.ok(/DEFAULT_COLUMNS/.test(lib) && /培训课程发布/.test(lib), 'lib/daily-columns.js 不再是那份唯一实现');
  // desc 是给人看的说明，不是关键词数组的复述（B10 的可见症状）。
  // 判据取「desc 覆盖了该栏目的全部关键词」——按"出现≥3个"会误杀合法中文文案（本轮就误杀过一次：
  // 「新公开的课程、训练营与社群招募」本就自然含 3 个词），而两份历史脏值恰好都是全量复述。
  const isEcho = (desc, kws) => kws.length > 0 && kws.every((k) => desc.includes(k));
  const cols = [...lib.matchAll(/\{\s*id:\s*'[^']+',\s*name:\s*'[^']+',\s*desc:\s*'([^']*)',\s*keywords:\s*\[([^\]]*)\]/g)]
    .map((m) => ({ desc: m[1], kws: [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]) }));
  assert.ok(cols.length >= 2, `从唯一实现里解析出的带 desc 栏目只有 ${cols.length} 个，判据失去对象`);
  const echoed = cols.filter((c) => isEcho(c.desc, c.kws));
  assert.ok(echoed.length === 0, `栏目 desc 又在复述全部关键词（B10 原症状）：${JSON.stringify(echoed.map((e) => e.desc).slice(0, 2))}`);
  // 正向探针：两条历史脏 desc 必须被同一判据抓红（抓不到=判据写松了，等于假门禁）
  assert.ok(isEcho('Codex、Claude、豆包、Agent、模型、自动化、RAG、MCP 等动向',
    ['Codex', 'Claude', '豆包', 'Agent', '模型', '自动化', 'RAG', 'MCP']), '探针：旧 AI技术 desc 该被抓出');
  assert.ok(isEcho('课程/训练营/社群招募/项目培训/技术培训发布或预告',
    ['课程', '训练营', '社群', '招募', '培训']), '探针：旧 c1 desc 该被抓出');
  // 「恢复默认栏目」写进 settings 的那份，必须是同一个 require（副本漂了会把脏默认值落库）
  const slug = read('api', '[...slug].js');
  assert.ok(/require\('\.\.\/lib\/daily-columns'\)/.test(slug), '读层没有引用唯一实现');
  assert.ok(/restoreDefaultColumns[\s\S]{0,160}DAILY_DEFAULT_COLUMNS/.test(slug), '「恢复默认栏目」不再写 DAILY_DEFAULT_COLUMNS，本锁需同步改判');
  // "全仓库只许一份"由白盒 W13 负责（它按内容特征扫，能抓到新增副本）；这里只钉读层这一处的接线
});

test('I9 B8：两种正文来源的分流必须是可测行为（不是文本断言）', () => {
  // 2026-09-19 独立对抗审查把旧版 I9 判成假锁：它只查组件源码里有没有那几个字面量，
  // 把判据改成"什么都走 safeHtml"（= B8 原样复发）仍然 12/12 全绿。所以判据挪进
  // web/src/components/ui/md-inline.js#looksLikeHtml（纯函数，require(esm) 可直接跑），
  // 这里钉的是**行为**，两个方向都要钉：只钉一侧，"全走 HTML"和"全走 markdown"都能蒙过去。
  const { looksLikeHtml, mdInlineParse } = require('../web/src/components/ui/md-inline.js');
  assert.equal(looksLikeHtml('<p>正文<strong>粗</strong></p>'), true, '真 HTML 正文必须走消毒分支');
  assert.equal(looksLikeHtml('这是**重点**，涨幅==5%=='), false, 'AI 摘要必须走 markdown 分支（B8 症状本体）');
  assert.equal(looksLikeHtml('今日发布 A 与 B，涨幅 <5% 以内'), false, '小于号后不是字母，不许误判成 HTML');
  assert.equal(looksLikeHtml(''), false, '空串不许判 HTML');
  assert.equal(looksLikeHtml(null), false, 'null 不许抛也不许判 HTML');
  assert.deepEqual(mdInlineParse('这是**重点**').map((s) => s.t), ['text', 'bold'],
    'markdown 分支要真产出标记，不是接了组件却不解析');
  const rt = read('web', 'src', 'components', 'ui', 'RichText.jsx');
  assert.ok(/looksLikeHtml/.test(rt), 'RichText 没引用唯一判据实现');
  assert.ok(!/<\[a-z\]/.test(rt), 'RichText 里又留了一份正则副本（判据必须只有一处）');
  assert.ok(/safeHtml/.test(rt) && /MdText/.test(rt), 'RichText 缺任一分支都不成立');
  for (const [f, mark] of [
    ['web/src/components/ArticleView.jsx', 'article.translated_content || article.content_html || article.summary'],
    ['web/src/components/QuickStudyModal.jsx', 'contentHtml || intro'],
  ]) {
    const src = read(...f.split('/'));
    assert.ok(/<RichText/.test(src), `${f} 没有改用 RichText`);
    assert.ok(src.replace(/\s+/g, ' ').includes(mark), `${f} 的取值链变了，本锁需同步改判`);
  }
  const hot = read('web', 'src', 'components', 'HotDetail.jsx');
  assert.ok(/<MdText text=\{summary\}/.test(hot) && /<MdText text=\{reason\}/.test(hot),
    '热点详情的 AI 导读/推荐理由仍是裸文本（B8 的"重点标注丢失"面）');
});

test('I10 B26：/api/status 首屏不得内联重统计，重统计走独立端点（两端都要有）', () => {
  const slug = read('api', '[...slug].js');
  // 函数切分用 lib/src-spans 唯一实现（坑 #57/#58：自己手写边界 = 一次假红 + 一次假绿）
  const fns = Object.fromEntries(spans(slug).map((s) => [s.name, s.body]));
  const H = 'handleStatus', D = 'handleStatusDailySources';
  assert.ok(fns[H] && fns[D], '云端 handleStatus / handleStatusDailySources 定位失败');

  // 反规避：不变量是「首屏这条链路碰不到 daily_reports」。handleDaily/handleDailyRegenerate
  // 合法读 daily_reports，所以不能全文要求"必须在按需端点内"（旧版判据本身错了）；
  // 改成从 handleStatus 出发做调用闭包——把重统计藏进任何被它调到的辅助函数一样红。
  const calls = new Map(Object.keys(fns).map((n) => [n, new RegExp(`\\b${n}\\s*\\(`)]));
  const seen = new Set([H]);
  const queue = [H];
  while (queue.length) {
    const cur = queue.shift();
    for (const name of Object.keys(fns)) {
      if (!seen.has(name) && calls.get(name).test(fns[cur])) { seen.add(name); queue.push(name); }
    }
  }
  const pulled = [...seen].filter((n) => /daily_reports/.test(fns[n]));
  assert.deepEqual(pulled, [], `首屏调用闭包里出现 daily_reports（= 重统计换了个函数名躲回冷路径）：${pulled}`);
  assert.ok(!/case\s+when/i.test(fns[H]),
    'B26 根因复发：多条计数被合并成一条 CASE 全扫（实测 11.8s，索引全被打掉）');
  // require 面：闭包里任何一处 require 解析到的本地文件，只要自己碰 daily_reports 就算把重统计捞回来
  // （旧判据按路径里有没有 "daily" 字样猜，换个文件名即绕过 —— 对抗审查查出的逃逸）
  const hits = [];
  for (const name of seen) {
    for (const rq of (fns[name] || '').matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = rq[1];
      if (!spec.startsWith('.')) continue;
      const abs = path.resolve(ROOT, name === H ? 'api' : '.', spec);
      const cands = [abs, `${abs}.js`, `${abs}.json`, path.join(abs, 'index.js')];
      const file = cands.find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
      if (!file) continue;
      const body = spans(fs.readFileSync(file, 'utf8')).map((s) => s.body).join('\n');
      if (/daily_reports/.test(body) || /daily_reports/.test(fs.readFileSync(file, 'utf8'))) {
        hits.push(`${name} → ${spec}`);
      }
    }
  }
  assert.deepEqual(hits, [], `首屏调用闭包 require 到了碰 daily_reports 的模块：${JSON.stringify(hits)}`);

  // 拆出去的东西必须真接在按需端点上，否则「拆了没接上」同样隐身
  const heavySql = (fns[D].match(/SELECT [^`']*FROM daily_reports/) || [''])[0];
  assert.ok(heavySql, '按需端点里没有 daily_reports 查询（来源榜被拆没了）');
  assert.ok(!/\bstats\b/.test(heavySql),
    `按需端点的 SQL 又捞了从未消费的 stats 列（坑 H11 同型）：${heavySql}`);
  assert.ok(slug.includes("path === '/api/status/daily-sources'"), '云端新端点没接进路由表');
  // 白名单判据过去用"500 字窗口"，把条目挪远一点就会假红：改成解析 Set 里的字面量
  const setLit = (slug.match(/const PUBLIC_GET_PATHS = new Set\(\[([\s\S]*?)\]\)/) || [])[1] || '';
  assert.ok(setLit.includes("'/api/status/daily-sources'"),
    '新端点未进公开白名单 PUBLIC_GET_PATHS → 线上 401（坑 #56：路由接上≠能访问）');
  // 本地端必须有同名端点：前端两端共用，缺一个就是本地永远显示"加载失败"
  const local = read('server', 'routes', 'status.js');
  assert.ok(local.includes("router.get('/daily-sources'"), '本地端缺 GET /api/status/daily-sources');
  assert.ok(/7 \* 86400e3/.test(local), 'B89：本地来源榜的窗口不再是近 7 天');
  const rail = read('web', 'src', 'components', 'OverviewRail.jsx');
  assert.ok(rail.includes('/api/status/daily-sources'), '统计轨没有懒加载新端点');
  assert.ok(!/ov\?\.dailyTopSources/.test(rail), '统计轨仍从首屏 overview 读来源榜（拆了没接上）');
  assert.ok(/loadError/.test(rail), '来源榜加载失败必须显示得出口，不许静默成"本期暂无"（坑 #38 同族）');
});

test('I11 B11：后台 Tab 冷加载必须是骨架屏，不是一行文字', () => {
  const src = read('web', 'src', 'pages', 'AdminPage.jsx');
  const at = src.indexOf('function TabLoader');
  assert.ok(at > 0, '找不到 TabLoader');
  const body = src.slice(at, src.indexOf('\n}', at));
  assert.ok(/<SkeletonList/.test(body), `TabLoader 又退回文字占位：${body.replace(/\s+/g, ' ').slice(0, 90)}`);
  // 光"用了 SkeletonList"不够：n=0 会渲染一张空卡，视觉上和不处理没区别（对抗审查查出的绕过路径）
  const n = Number((body.match(/<SkeletonList[^>]*n=\{(\d+)\}/) || [])[1]);
  assert.ok(Number.isFinite(n) && n >= 3, `骨架屏占位数必须≥3（现在 n=${body.match(/n=\{(\d+)\}/)?.[1]}）`);
  assert.ok(!/加载中/.test(body), '文字占位与前台骨架屏不同语言（B11 的批注点）');
  assert.ok(/SkeletonList/.test(src.match(/^import[^\n]*Skeleton[^\n]*$/m)?.[0] || ''), '没 import SkeletonList，上面那条会白测');
});

test('I7 B85 追加：设了上界的列必须同时可收缩，否则行尾会被裁（800px 实测 6/37 行溢出）', () => {
  const file = read('web', 'src', 'components', 'ColumnSection.jsx');
  const row = bodyOf(file, 'function CompactRow');
  assert.ok(row, '找不到 CompactRow');
  // 「有 max-w 上界」只保证不撑爆主列；不可收缩（flex-none）时溢出会落到行尾被 overflow-hidden 剪掉。
  const bounded = [...row.matchAll(/className="([^"]*max-w-[^"]*)"/g)].map((m) => m[1]);
  assert.ok(bounded.length >= 3, `带宽度上界的列只有 ${bounded.length} 个（理由/标签/来源），判据对象不对`);
  const stiff = bounded.filter((c) => /flex-none/.test(c) && !/min-w-0/.test(c));
  assert.ok(stiff.length === 0, `这些列设了上界却不可收缩，窄档会裁掉行尾：${JSON.stringify(stiff).slice(0, 200)}`);
  // 判据必须存在于端到端：只看单一视口抓不到"只在 800px 裁切"这一类
  const e2e = read('tools', 'eval-e2e.cjs');
  const a0 = e2e.indexOf("id: 'E3'"); const a1 = e2e.indexOf("id: 'E4'");
  assert.ok(a0 > 0 && a1 > a0, 'E3 剧本段定位失败');
  assert.ok(/setViewportSize/.test(e2e.slice(a0, a1)), 'E3 没有做多视口扫描（单视口跑不出断点级裁切）');
});

test('I12 坑 #56 同源面：巡检必须走统一代理出口，并把"拿不到响应"判成环境红', () => {
  const site = read('lib', 'cloud-site.js');
  assert.ok(/CLOUD_PROXY/.test(site) && /function cloudFetch/.test(site), 'lib/cloud-site.js 没同时管基址与代理出口');
  assert.ok(/ProxyAgent/.test(site) && /fetch: uFetch/.test(site),
    'cloudFetch 必须用 undici 自己的 fetch 配 ProxyAgent——全局 fetch 会静默忽略 dispatcher（本轮 19/19 fetch failed 的成因）');

  const audit = read('tools', 'audit-cloud.js');
  const at = audit.indexOf('async function probe(');
  assert.ok(at > 0, '找不到 probe 函数');
  const body = audit.slice(at, audit.indexOf('\n}', at));
  assert.ok(/cloudFetch\(/.test(body), '巡检仍用全局 fetch → 代理被忽略，整支脚本会"看起来像云端全挂"');
  assert.ok(!/await fetch\(/.test(body), 'probe 里还留着裸 fetch 调用');
  // B26 的两条长期观测位：轻投影 + 按需重统计，缺一侧就漏判一种回退
  assert.ok(audit.includes("'/api/status'") && audit.includes("'/api/status/daily-sources'"),
    '巡检未覆盖 B26 的两端（只验一侧会漏掉另一种回退形态）');

  // 环境红判据是行为，不是字面量（同 B65 的教训：只 grep 源码 = 等价重构假红、字面量在而逻辑坏假绿）
  const { tally, isEnvOutage } = require('../tools/audit-cloud.js');
  const rows = (st) => st.map((s) => ({ pass: false, skip: '', status: s }));
  assert.equal(isEnvOutage(tally(rows([0, 0, 0])), rows([0, 0, 0])), true, '全是"没拿到响应"应判环境红');
  assert.equal(isEnvOutage(tally(rows([0, 401, 0])), rows([0, 401, 0])), false, '有一条真拿到 HTTP 响应就不是环境红');
  assert.equal(isEnvOutage(tally(rows([200]).concat([{ pass: true, skip: '', status: 200 }])),
    rows([200]).concat([{ pass: true, skip: '', status: 200 }])), false, '有通过就不许判环境红');
});

test('I14 B93：字面串 \'null\' 的 last_fetched_at 不得毒掉「最后同步」', () => {
  // 迁移期污染（与 B15 同族）：库里 1 行 last_fetched_at 是字符串 'null'。文本序 'null' > '2026-…'
  // → 裸 MAX() 取到它，读层归一化后又变 null，于是后台「RSS 最后同步」自上线起恒显示"从未同步"（线上实测）。
  // 判据是行为不是字面量：种一个真时间戳 + 一个 'null'，端点必须回那个真时间戳。
  const { execFileSync } = require('child_process');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i14-b93-'));
  const driver = path.join(ROOT, `.i14-driver-${process.pid}.cjs`);
  fs.writeFileSync(driver, `
    const express = require('express');
    const { db } = require(${JSON.stringify(path.join(ROOT, 'server', 'db.js'))}); // 按 APP_DATA_DIR 建表
    const REAL = '2026-09-19T10:00:00.000Z';
    const ins = db.prepare("INSERT INTO sources(type,name,url,enabled,last_fetched_at,created_at) VALUES('rss',?,?,1,?,?)");
    ins.run('I14 正常源', 'https://i14a.example/f', REAL, REAL);
    ins.run('I14 脏值源', 'https://i14b.example/f', 'null', REAL); // 迁移期写进去的字面串
    const app = express();
    app.use('/api/status', require(${JSON.stringify(path.join(ROOT, 'server', 'routes', 'status.js'))}));
    const srv = app.listen(0, '127.0.0.1', async () => {
      const data = await (await fetch('http://127.0.0.1:' + srv.address().port + '/api/status')).json();
      console.log('OUT ' + JSON.stringify({
        rss: data.wechat.rssLastFetch,
        srcs: db.prepare('SELECT COUNT(*) c FROM sources').get().c, // 前提探针：两条源真进了库
        dirty: db.prepare("SELECT COUNT(*) c FROM sources WHERE last_fetched_at='null'").get().c,
      }));
      srv.close(); process.exit(0);
    });
  `);
  try {
    const out = execFileSync(process.execPath, [driver],
      { cwd: ROOT, encoding: 'utf8', env: { ...process.env, APP_DATA_DIR: tmpDir }, timeout: 120000 });
    const m = /^OUT (.+)$/m.exec(out);
    assert.ok(m, '子进程没打印读数：\n' + out.slice(-400));
    const got = JSON.parse(m[1]);
    assert.equal(got.srcs, 2, '前提：两条源都要真进统计（否则是空库假绿）');
    assert.equal(got.dirty, 1, "前提：库里要真有一行字面串 'null'（否则本用例什么都没测）");
    assert.equal(got.rss, '2026-09-19T10:00:00.000Z',
      "B93 复发：MAX() 又被字面串 'null' 毒掉（要在 SQL 层 NULLIF 排掉，不是在 JS 里补兜底）");
  } finally {
    try { fs.unlinkSync(driver); } catch { /* 已清 */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('I13 坑 #57/#58：函数边界切分必须 EOL 无关、注释不参与判据（文本锁的地基）', () => {
  // 本轮两次假结果都出在"手写函数边界"：① 拿第一个行首 '}' 当右边界 → 被函数内 catch 截断（假红）；
  // ② 探针用 replace('{\n') 注入，而仓库是 CRLF → 模式永不命中，"注入失败"被读成"锁没拦住"（假绿）。
  // 所以这里钉的是 lib/src-spans 的**行为**，两个方向都要钉。
  const lines = [
    'async function heavy(req) {',
    '  try { read();',
    '  } catch { /* 忽略坏行 */ }',
    '  // 说明：SELECT sections FROM daily_reports 已移出本函数',
    "  const sql = 'SELECT * FROM daily_reports';",
    '  return sql;',
    '}',
    '',
    'function nextFn() { return 2; }',
  ];
  const crlf = lines.join('\r\n');
  const lf = lines.join('\n');

  const cut = (src) => {
    const fns = Object.fromEntries(spans(src).map((f) => [f.name, f.body]));
    return { names: spans(src).map((f) => f.name), heavy: fns.heavy, next: fns.nextFn };
  };
  const a = cut(crlf), b = cut(lf);

  assert.deepEqual(a.names, ['heavy', 'nextFn'], '顶层函数清单不对');
  assert.deepEqual(b.names, a.names, 'CRLF 与 LF 切出的清单不一致（判据会随行尾风格变绿变红）');
  assert.deepEqual(b.heavy, a.heavy, '同上：body 也要一致');
  assert.ok(a.heavy.includes('return sql'), '边界被函数内的 } 截断了 → 合法 SQL 会被误判成逃逸');
  assert.ok(!/已移出本函数/.test(a.heavy), '整行注释没剥掉 → 自己写的说明文字会把自己判红');
  assert.ok(/FROM daily_reports/.test(a.heavy), '真代码里的 daily_reports 必须留在 body 里（剥注释不许连代码一起剥）');
  assert.ok(!/FROM daily_reports/.test(a.next), '边界越界到下一个函数 = 逃逸能隐身');

  const at = crlf.indexOf('SELECT * FROM daily_reports');
  assert.equal(ownerAt(crlf, at), 'heavy', '写入点归属判错宿主（W14 会把 A 函数的门槛算给 B 函数）');
  assert.equal(ownerAt(crlf, crlf.indexOf('return 2;')), 'nextFn');
  assert.equal(ownerAt(crlf, crlf.indexOf('function nextFn')), 'nextFn', '边界按"下一个声明"切：声明自身归自己');
  assert.equal(ownerAt(crlf, crlf.indexOf('function nextFn') - 1), 'heavy', '上一个函数的尾部区段仍归上一个函数');

  // 链路：判据/锁 → lib/daily-writers → lib/src-spans，任何一环换成手写边界都算漂移
  // （W14 现在不直接 require src-spans，它拿的是 lib/daily-writers 派生出的写入点清单）
  const chain = [
    ['tests/regression-20260919i.test.js', '../lib/src-spans'],
    ['lib/daily-writers.js', './src-spans'],
    ['tools/eval-whitebox.cjs', '../lib/daily-writers'],
  ];
  for (const [f, dep] of chain) {
    assert.ok(read(...f.split('/')).includes(dep), `${f} 丢了 ${dep} —— 又回到各自手写边界/自己列清单`);
  }
});

test('I15 坑 #58/#59：日报写入点清单必须由事实派生（目录白名单、按函数去重、字面量存在都不算）', () => {
  const os = require('os');
  const { findDailyReportWriters } = require('../lib/daily-writers');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'i15-writers-'));
  const put = (rel, text) => {
    const p = path.join(tmp, ...rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text.replace(/\n/g, '\r\n')); // 故意用 CRLF 造样本：判据不许依赖行尾风格（坑 #57）
  };
  try {
    // ① 老判据的目录白名单之外（scripts/）也能看见
    put('scripts/w1.js', [
      'async function makeReport() {',
      "  const g = guards.applyDailyQualityGate(valid, 30, log);",
      '  valid = g.kept;',
      "  await qRun('INSERT INTO daily_reports(generated_at,sections) VALUES(?,?)', []);",
      '}',
    ].join('\n'));
    // ② 调用了但扔掉返回值 = 没接上
    put('tools/w2.js', [
      'async function makeReport2() {',
      "  guards.applyDailyQualityGate(valid, 30, log);",
      "  await qRun('INSERT INTO daily_reports(generated_at,sections) VALUES(?,?)', []);",
      '}',
    ].join('\n'));
    // ③ 只在注释里提一句 = 既不算写入点，也不算接上门槛
    put('tools/w3.js', [
      'async function makeReport3() {',
      '  // 以后要接 INSERT INTO daily_reports 的门槛',
      '  return 1;',
      '}',
    ].join('\n'));
    // ④ 归档与测试夹具不参与（各自一条理由，写在 lib/daily-writers.js）
    put('archive/w4.js', [
      'async function old() {',
      "  await qRun('INSERT INTO daily_reports(generated_at,sections) VALUES(?,?)', []);",
      '}',
    ].join('\n'));
    put('tests/w5.test.js', [
      'function seed() {',
      "  db.prepare('INSERT INTO daily_reports(generated_at) VALUES(1)').run();",
      '}',
    ].join('\n'));

    const found = findDailyReportWriters(tmp);
    const byFile = Object.fromEntries(found.map((w) => [w.file, w]));
    assert.ok(byFile['scripts/w1.js'], 'scripts/ 下的写入点没被看见（还是在按目录白名单扫）');
    assert.equal(byFile['scripts/w1.js'].ok, true);
    assert.ok(byFile['tools/w2.js'], 'tools/ 下的写入点没被看见');
    assert.equal(byFile['tools/w2.js'].ok, false, '扔掉返回值的调用被判成"已接门槛"（B20 那类假绿的评测版）');
    assert.ok(!byFile['tools/w3.js'], '注释里的字面量被当成写入点（判据会被说明文字骗）');
    assert.ok(!byFile['archive/w4.js'], 'archive/ 不该参与（排除项要显式，不要靠巧合）');
    assert.ok(!byFile['tests/w5.test.js'], 'tests/ 夹具不该参与');

    // 真仓库侧：派生清单必须非空且全接（防"扫不到东西也算过"——同 W12/W13 的数量断言）
    const real = findDailyReportWriters(ROOT);
    assert.ok(real.length >= 5, `真仓库只派生出 ${real.length} 处写入点，比实测的 5 处少 = 扫描面坏了`);
    assert.deepEqual(real.filter((w) => !w.ok).map((w) => `${w.fn}@${w.file}`), [],
      '真仓库里有日报写入点没接门槛');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
