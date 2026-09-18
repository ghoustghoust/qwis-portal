// spec 32 markdown 内联解析器（纯 JS 无 JSX——node:test 可直接锁行为）
// 输出类型化片段数组：[{ t: 'text'|'bold'|'em'|'mark'|'code'|'del', v: string }]
// 无标记 → 单元素 text 数组（纯文本旧数据零变化）；<script> 等 HTML 永远只当文本
// 标记内容首尾必须非空白（markdown 惯例："* 增速 *" 不解析），标记不跨行
const INLINE_RE = /(\*\*(?=\S)[^*\n]+?(?<=\S)\*\*|\*(?!\*)(?=\S)[^*\n]+?(?<=\S)\*(?!\*)|==(?=\S)[^=\n]+?(?<=\S)==|~~(?=\S)[^~\n]+?(?<=\S)~~|`[^`\n]+?`)/g;

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
