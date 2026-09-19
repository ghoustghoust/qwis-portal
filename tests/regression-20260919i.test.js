// 2026-09-19 第 3 批页面批注（B84/B85/B72）的 F2P 锁
// 运行：node --test tests/regression-20260919i.test.js
// 改前基线：node tools/eval-f2p.cjs --base d679167 --tests tests/regression-20260919i.test.js --cases I
// 三条缺陷的可见面在浏览器里（已由 eval:e2e E3/E6/E10 打线上取证）；本文件钉的是**离线可判的契约**：
// 布局下限/上界是否写进组件、三份媒体栏实现是否同步带出兜底字段、路由是否有白名单外分支。
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

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

test('I9 B8：正文/摘要的两种来源必须分流渲染（纯文本回退不再走 safeHtml）', () => {
  const rt = read('web', 'src', 'components', 'ui', 'RichText.jsx');
  assert.ok(/HTML_RE/.test(rt) && /MdText/.test(rt) && /safeHtml/.test(rt), 'RichText 缺 HTML/纯文本分流');
  // 三个回退点都必须改走分流：把纯文本塞进 safeHtml 会让 **加粗** ==重点== 变成裸星号
  for (const [f, mark] of [
    ['web/src/components/ArticleView.jsx', 'article.translated_content || article.content_html || article.summary'],
    ['web/src/components/QuickStudyModal.jsx', 'contentHtml || intro'],
  ]) {
    const src = read(...f.split('/'));
    assert.ok(/<RichText/.test(src), `${f} 没有改用 RichText`);
    assert.ok(new RegExp(mark.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace('\\\\ ', '\\\\s+')).test(src.replace(/\s+/g, ' ')) || src.includes(mark), `${f} 的取值链变了，本锁需同步改判`);
  }
  const hot = read('web', 'src', 'components', 'HotDetail.jsx');
  assert.ok(/<MdText text=\{summary\}/.test(hot) && /<MdText text=\{reason\}/.test(hot),
    '热点详情的 AI 导读/推荐理由仍是裸文本（B8 的"重点标注丢失"面）');
});

test('I10 B26：/api/status 首屏不得内联重统计，重统计走独立端点（两端都要有）', () => {
  const slug = read('api', '[...slug].js');
  const a0 = slug.indexOf('async function handleStatus(');
  const a1 = slug.indexOf('async function handleStatusDailySources(');
  assert.ok(a0 > 0 && a1 > a0, '云端 handleStatus / handleStatusDailySources 定位失败');
  const body = slug.slice(a0, a1);
  assert.ok(!/FROM daily_reports/.test(body),
    'B26 复发：/api/status 又把 daily_reports 的 BLOB 聚合塞进首屏（实测 214KB/2.0s）');
  assert.ok(!/SELECT\s+stats/.test(body), '又 SELECT 了从未消费的 stats 列（坑 H11 同型）');
  assert.ok(!/CASE WHEN/.test(body),
    'B26 根因复发：多条计数被合并成一条无 WHERE 的 CASE 全扫（实测 11.8s，索引全被打掉）');
  assert.ok(slug.includes("path === '/api/status/daily-sources'"), '云端新端点没接进路由表');
  // 路由接了不等于能访问：漏进 PUBLIC_GET_PATHS 的话线上直接 401，右栏永远拿不到来源榜
  // （坑 #56：本轮实测踩过——静态判据全绿、curl 一打就是 401。两条断言成对，只断一条就是假绿）
  assert.ok(/PUBLIC_GET_PATHS[\s\S]{0,500}'\/api\/status\/daily-sources'/.test(slug),
    '新端点未进公开白名单 PUBLIC_GET_PATHS → 线上 401');
  // 本地端必须有同名端点：前端两端共用，缺一个就是本地永远显示"加载失败"
  const local = read('server', 'routes', 'status.js');
  assert.ok(local.includes("router.get('/daily-sources'"), '本地端缺 GET /api/status/daily-sources');
  assert.ok(/近 7 天|7 \* 86400e3/.test(local) && !/ORDER BY generated_at DESC LIMIT 1/.test(local),
    'B89：本地来源榜又退回"只算最新一期"，与界面文案「近7天」和云端都不一致');
  // 前端确实拆开了：概览栏不再从 status 读 heavy 字段
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
