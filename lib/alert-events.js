//
// 「报警事件表」的唯一实现（B109/B45 / spec 37-2 G2a+G2b，2026-09-21）。
//
// 为什么单独成文件：事件表原本有**两份代码 + 两份落库 + 两处前端副本**，四份互不相同：
//   · 云端 `api/_alerts.js DEFAULT_EVENTS` 7 键（含 `ai_failed/frozen_digest/mybrief`，无 `source_slow`）；
//   · 本地 `server/services/alerts.js EVENT_TITLE` 5 键（含 `source_slow`，缺那三个）；
//   · 云端 `GET /api/alerts/config` 的 `eventMeta` 干脆**硬写四个在任何表里都不存在的键**
//     （`fuse/stall/queue/error`，`api/[...slug].js:1587`）→ 云端管理台"报警事件"区显示的是四个
//     根本不存在事件的开关，真事件一个都看不见，勾了也没人读（这就是 B45 的硬根因）；
//   · 前端 `AlertsTab.jsx EVENT_DESC` 第 4 份，只覆盖 3 个事件。
// 对齐方向按 37-2 的边界条款是**取并集**（不许"为了对齐"把本地独有的 `source_slow` 删掉）；
// 云端补 `source_slow` 的 dispatch 属 37-4 覆盖面扩展，不在本文件职责里。
//
// 幽灵键（B109：本地落库里的 `wemp_down`/`wemp_cookie_expired`，代码 09-04 就删了）在这里
// 的处理方式是**读时按表收敛**（`eventsState`），不写配置：
// 假开关的根因是"列表由落库键集派生"，改成"由本表派生"它就渲染不出来了 ——
// 比跑一条 `UPDATE settings` 更保守（那是不可逆的配置写，而收益完全相同）。
// 落库里那两键仍留着（不碍事），真要清是运维动作，不是这条缺陷的必要项。
//
// 本文件同时是白盒 W19 的判据（与 tests/regression-alert-events.test.js 共用一份，坑 #58/#59）。
'use strict';

const fs = require('fs');
const path = require('path');
const { scan } = require('./src-spans');

// title 带 emoji 前缀是历史约定（本地 EVENT_TITLE 一直如此），前端 `cleanTitle()` 会剥掉 ——
// 界面零 emoji 的规则在渲染层，不在数据层，别把两边都改成裸文本还以为丢了东西。
const ALERT_EVENTS = {
  source_error: { title: '⚠️ 源抓取失败', desc: '某个订阅源抓取失败时触发（连续失败≥2 次才算，受冷却时间限制）', defaultOn: true },
  source_paused: { title: '🛑 源已熔断暂停', desc: '源连续失败被自动熔断停用时触发', defaultOn: true },
  source_slow: { title: '🐢 源抓取耗时过长', desc: '单次抓取耗时超过阈值（默认 30s，随 slowThresholdMs 调）时触发', defaultOn: true },
  daily_failed: { title: '📅 日报生成失败', desc: '每日情报生成失败时触发', defaultOn: true },
  collect_stalled: { title: '⏸ 采集停滞', desc: '一小时内 0 次成功刷新时触发', defaultOn: true },
  ai_failed: { title: '🤖 AI 调用失败', desc: '摘要/翻译/周刊等 AI 调用失败时触发', defaultOn: true },
  frozen_digest: { title: '🧊 源冻结盘点', desc: '一批源被同时冻结（系统性故障形态）时的汇总播报', defaultOn: true },
  mybrief: { title: '☀️ 我的早报', desc: '「我的早报」定时推送（19-my-brief）', defaultOn: true },
};

const eventKeys = () => Object.keys(ALERT_EVENTS);
const isKnownEvent = (k) => Object.prototype.hasOwnProperty.call(ALERT_EVENTS, k);

// 开关默认值表（原来两份 DEFAULT_EVENTS 各写一遍，键集还不同）
function defaultEvents() {
  const out = {};
  for (const [k, v] of Object.entries(ALERT_EVENTS)) out[k] = v.defaultOn !== false;
  return out;
}
// 落库的 events 收敛到表上：表内键取存储值，表外键（幽灵键）**不外露**；表内键缺的分发默认值。
function eventsState(stored) {
  const base = defaultEvents();
  const s = (stored && typeof stored === 'object') ? stored : {};
  const out = {};
  for (const k of eventKeys()) {
    out[k] = Object.prototype.hasOwnProperty.call(s, k) ? s[k] !== false : base[k];
  }
  return out;
}
// eventMeta：键集恒等于事件表；标题/说明允许落库覆盖（`storedMeta` 传 `cfg.eventMeta`）。
// 返回 { key: {title, desc} } —— 前端一次拿到标题与说明，不必再自带第 4 份副本。
function eventMetaTable(storedMeta) {
  const o = (storedMeta && typeof storedMeta === 'object') ? storedMeta : {};
  const out = {};
  for (const [k, v] of Object.entries(ALERT_EVENTS)) {
    const s = o[k];
    out[k] = {
      title: (typeof s === 'string' ? s : (s && s.title)) || v.title,
      desc: (s && s.desc) || v.desc,
    };
  }
  return out;
}

// dispatch 便捷入口只要标题字符串（`EVENT_TITLE.source_paused` 这种调用形状保持不动）
function eventTitles(storedMeta) {
  const out = {};
  for (const [k, v] of Object.entries(eventMetaTable(storedMeta))) out[k] = v.title;
  return out;
}

// ── 白盒 W19 判据：出现第二份手写事件表即红 ───────────────────
const SCAN_DIRS = ['server', 'api', 'web/src', 'lib', 'tools'];
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'data', 'archive', 'trash', '.next', 'coverage']);
const SCAN_EXT = /\.(js|cjs|mjs|jsx)$/;
const ALLOWED = new Map([['lib/alert-events.js', '事件表唯一实现']]);
const SKIP_TOOL = /^tools\/(?:eval-|_|doc-lint)/;
// 手写表的形状 = 「事件键: 值」的对象字面量成员。只在**代码视图**里判（字符串里的 dispatch 参数不算）。
const KEY_IN_TABLE = new RegExp(
  `^\\s*(?:${eventKeys().join('|')})\\s*:`, 'm'
);
// 相邻两行成员之间允许的最大行距（注释与空行算在内）：超过就当作两份互不相干的代码。
const TABLE_GAP_LINES = 6;

function walk(root, dir, out) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (SKIP_DIR.has(e.name)) continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) walk(root, rel, out);
    else if (SCAN_EXT.test(e.name)) out.push(rel);
  }
  return out;
}

// → { copies:[{file,line,key}], scanned, allowed, consumers }
function findAlertEventCopies(root) {
  const files = [];
  for (const top of SCAN_DIRS) {
    if (fs.existsSync(path.join(root, top))) walk(root, top, files);
  }
  const targets = files.filter((rel) => !ALLOWED.has(rel) && !SKIP_TOOL.test(rel));
  const copies = [];
  const consumers = [];
  for (const rel of targets) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    // **masked** 视图（与原文等长：注释与字符串内容抹成空格）：
    //  ① `dispatch('source_error')` 这类字符串参数不算手写表成员；
    //  ② 行号必须仍对得上原文 —— 用 `code` 视图会压缩长度、行号整体错位（`lib/time-caliber.js` 里
    //     踩过并写了警告的那条：判"接线"的字符串内容已被抹平，而行号不能变）。
    const { masked } = scan(src);
    const at = (idx) => src.slice(0, idx).split('\n').length;
    const hits = [];
    for (const m of masked.matchAll(new RegExp(KEY_IN_TABLE.source, 'gm'))) {
      hits.push({ file: rel, line: at(m.index), key: m[0].trim().replace(/\s*:$/, '') });
    }
    // 分组：只有**挨在一起**的 ≥2 个不同事件键才是一份表。
    // 按"整份文件计数"判会误伤 —— 实测 `api/[...slug].js` 有两处 `mybrief:` 但那是 settings 命名空间
    // 的响应字段（:1039 与 :1749，相距 700 行），不是事件表；第一版就是这么假红了 2 处。
    hits.sort((a, b) => a.line - b.line);
    let group = [];
    const flush = () => {
      const distinct = new Set(group.map((h) => h.key));
      if (distinct.size >= 2) copies.push(...group);
      group = [];
    };
    for (const h of hits) {
      if (group.length && h.line - group[group.length - 1].line > TABLE_GAP_LINES) flush();
      group.push(h);
    }
    flush();
    if (/lib\/alert-events/.test(src)) consumers.push(rel);
  }
  return {
    copies,
    consumers,
    scanned: targets.length,
    allowed: [...ALLOWED.entries()].map(([f, why]) => `${f}（${why}）`),
  };
}

module.exports = {
  ALERT_EVENTS, eventKeys, isKnownEvent, defaultEvents, eventsState, eventMetaTable, eventTitles,
  findAlertEventCopies,
};
