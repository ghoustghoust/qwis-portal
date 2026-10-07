// 本期内容索引（用户 10-07：周刊右侧"本期索引"同款，给每日早报与我的早报加上）——
// 按分组列出条目编号+标题，点击滚动到正文对应条目。样式与周刊 aside 同一语言
// （11px、accent 编号、truncate、sticky + 85vh 滚动），不复制周刊实现（那边绑死周刊数据结构）。
// groups: [{ key, title, items: [{ id, anchor, title }] }]；点击交给父级 onJump（每日早报要先展开折叠栏再滚）。
export default function IssueIndex({ groups, onJump }) {
  if (!groups || !groups.length) return null;
  return (
    <aside className="hidden xl:block w-56 flex-none">
      <div className="sticky top-8 max-h-[85vh] overflow-y-auto pr-1">
        <div className="text-[11px] tracking-widest t-muted font-medium mb-2">本期索引</div>
        {groups.map((g) => (
          <div key={g.key} className="mb-3">
            <div className="text-[11px] t-accent font-medium truncate" title={g.title}>{g.title}</div>
            <div className="mt-1 space-y-0.5">
              {g.items.map((it, i) => (
                <a
                  key={it.anchor ?? it.id ?? i}
                  href={`#${it.anchor}`}
                  onClick={(e) => { e.preventDefault(); onJump?.(it); }}
                  className="block text-[11px] leading-snug t-muted hover:t-accent truncate no-underline"
                  title={it.title}
                >
                  <span className="tabular-nums t-accent">{i + 1}.</span> {it.title}
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
