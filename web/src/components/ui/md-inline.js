// spec 32 markdown 内联解析器（纯 JS 无 JSX——node:test 可直接锁行为）
// 输出类型化片段数组：[{ t: 'text'|'bold'|'em'|'mark'|'code'|'del', v: string }]
// 无标记 → 单元素 text 数组（纯文本旧数据零变化）；<script> 等 HTML 永远只当文本
// 标记内容首尾必须非空白（markdown 惯例："* 增速 *" 不解析），标记不跨行
const INLINE_RE = /(\*\*(?=\S)[^*\n]+?(?<=\S)\*\*|\*(?!\*)(?=\S)[^*\n]+?(?<=\S)\*(?!\*)|==(?=\S)[^=\n]+?(?<=\S)==|~~(?=\S)[^~\n]+?(?<=\S)~~|`[^`\n]+?`)/g;

// 正文/摘要两种来源的分流判据（B8）：采集到的原文是 HTML，AI 摘要是带内联标记的纯文本。
// 放在这里而不是写在组件里：纯函数才能被 node:test 直接锁行为（组件里的内联正则只能做文本断言，
// 2026-09-19 独立对抗审查就是查出 I9 那样的"文本锁"——把判据改成"全都走 safeHtml"它照样全绿）。
// 已知边界（诚实记录）：① 纯文本里若恰好出现 `<word…>` 形态会被判成 HTML（线上实测 0 例，
// 唯一近似样本是模型残留的 `</think>` 标签，判 HTML 也无害——标签本就要被消毒剥掉）；
// ② 反过来，含实体但无标签的正文仍走 markdown 分支，不丢内容。
const HTML_TAG_RE = /<[a-z][\s\S]*>/i;

export function looksLikeHtml(text) {
  return HTML_TAG_RE.test(String(text == null ? '' : text));
}

export function mdInlineParse(text) {
  const s = String(text ?? '');
  if (!s) return [{ t: 'text', v: s }];
  const parts = s.split(INLINE_RE);
  const out = [];
  for (const seg of parts) {
    if (!seg) continue;
    if (seg.startsWith('**') && seg.endsWith('**') && seg.length > 4) out.push({ t: 'bold', v: seg.slice(2, -2) });
    else if (seg.startsWith('*') && seg.endsWith('*') && seg.length > 2) out.push({ t: 'em', v: seg.slice(1, -1) });
    else if (seg.startsWith('==') && seg.endsWith('==') && seg.length > 4) out.push({ t: 'mark', v: seg.slice(2, -2) });
    else if (seg.startsWith('`') && seg.endsWith('`') && seg.length > 2) out.push({ t: 'code', v: seg.slice(1, -1) });
    else if (seg.startsWith('~~') && seg.endsWith('~~') && seg.length > 4) out.push({ t: 'del', v: seg.slice(2, -2) });
    else out.push({ t: 'text', v: seg });
  }
  return out.length ? out : [{ t: 'text', v: s }];
}
