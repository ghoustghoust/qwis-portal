import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { relativeTime, formatDateTime } from '../util';
import SourceAvatar from './ui/SourceAvatar.jsx';

// 源详情抽屉（10-05 用户点单②）：点源名弹侧栏——"这个源到底怎么回事"一处看全。
// 内容：身份信息 / 健康（状态+最近错误+连续失败）/ 最近抓取 / 内容样例（最近 5 条）/
// 轴状态（重点·订阅·屏蔽·收录 只读——操作入口各在早报板块）/ 操作（启停·立即抓取·删除）。
const VIDEO_TYPES = new Set(['bilibili', 'douyin', 'youtube']);
const KIND_LABEL = { article: '文章', video: '视频', podcast: '播客', tweet: '推文', hotlist: '热榜', retired: '已退役' };
const TONE_CLS = { green: 'text-[var(--green)]', orange: 'text-[var(--warn)]', red: 'text-[var(--red)]', gray: 't-muted' };

function extraOf(s) {
  try { return JSON.parse(s.extra || '{}'); } catch { return {}; }
}

function healthStatus(s) {
  if (s.type === 'wemp') return { label: '已退役', tone: 'gray', note: '采集引擎已下线（we-mp-rss 退役），非源本身的问题' };
  if (!s.enabled) return (s.fail_count || 0) >= 3
    ? { label: '异常暂停', tone: 'red', note: `连续失败 ${s.fail_count} 次被自动停用` }
    : { label: '已停用', tone: 'gray', note: '人工停用，可随时启用回来' };
  if (s.status === 'error' || (s.fail_count || 0) > 0) return { label: '异常', tone: 'orange', note: '最近抓取有失败记录' };
  return { label: '正常', tone: 'green', note: '采集正常' };
}

export default function SourceDetailDrawer({ source, groups = [], onClose, onRefresh, onToggle, onDelete }) {
  const [recent, setRecent] = useState(null);
  const [recentError, setRecentError] = useState('');

  const s = source;
  const ex = extraOf(s);
  const hs = healthStatus(s);
  const g = groups.find((x) => x.id === s.group_id);
  const isVideo = VIDEO_TYPES.has(s.type);

  useEffect(() => {
    setRecent(null);
    setRecentError('');
    (async () => {
      try {
        const ep = isVideo
          ? `/api/videos?source_id=${s.id}&limit=5`
          : `/api/articles?source_id=${s.id}&limit=5`;
        const d = await api.get(ep);
        setRecent(d.items || []);
      } catch (e) {
        setRecentError(e.message || '加载失败');
      }
    })();
  }, [s.id, isVideo]);

  const axes = useMemo(() => ([
    { label: '重点（每日早报）', on: !!s.spotlight, home: '报 → 每日早报 · 来源勾选 ★' },
    { label: '订阅（我的早报）', on: !!s.subscribed, home: '报 → 我的早报 · 订阅来源' },
    { label: '屏蔽（热点榜/阅读器隐藏）', on: !!s.muted, home: '行悬停 / 批量条' },
    { label: '收录（进阅读器列表）', on: s.reader_visible !== 0, home: '行悬停 / 批量条' },
  ]), [s]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,.35)' }} />
      <aside
        className="relative w-full max-w-md h-full t-bg border-l t-border overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头：头像+名+组+类型+开关 */}
        <div className="sticky top-0 t-bg border-b t-border p-4 flex items-start gap-3 z-10">
          <SourceAvatar name={s.name} avatar={s.avatar} size={40} />
          <div className="min-w-0 flex-1">
            <div className="font-semibold t-text leading-snug break-all">{s.name || s.url}</div>
            <div className="mt-0.5 text-[11px] t-muted">
              {KIND_LABEL[s.contentKind] || s.type} · {g ? g.name : '未分组'} · 加入 {s.created_at ? relativeTime(s.created_at) : '—'}
            </div>
            <a className="mt-1 block text-[11px] t-accent break-all" href={s.url} target="_blank" rel="noopener noreferrer">{s.url}</a>
          </div>
          <div className="flex flex-col items-end gap-2 flex-none">
            <button className="icon-btn" onClick={onClose} title="关闭">✕</button>
            <button
              className={`switch ${s.enabled ? 'on' : ''}`}
              title={s.enabled ? '点击停用采集' : '点击启用采集'}
              onClick={() => onToggle(s)}
            />
          </div>
        </div>

        <div className="p-4 space-y-4">
          {/* 健康 */}
          <section className="card p-4">
            <div className="flex items-center gap-2">
              <span className={`text-sm font-semibold ${TONE_CLS[hs.tone]}`}>● {hs.label}</span>
              <span className="text-[11px] t-muted">{hs.note}</span>
            </div>
            {ex.lastError && (
              <div className="mt-2 rounded-lg px-3 py-2 text-xs leading-relaxed" style={{ color: 'var(--red)', background: 'var(--surface-2)' }}>
                <div className="font-medium mb-0.5">最近错误{ex.lastErrorAt ? `（${relativeTime(ex.lastErrorAt)}）` : ''}</div>
                {ex.lastError}
              </div>
            )}
            <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="t-surface2 rounded-lg py-2">
                <div className="text-base font-bold tabular-nums t-text">{s.fail_count || 0}</div>
                <div className="t-muted">连续失败</div>
              </div>
              <div className="t-surface2 rounded-lg py-2">
                <div className="text-base font-bold tabular-nums t-text">{s.itemCount ?? '—'}</div>
                <div className="t-muted">内容条目</div>
              </div>
              <div className="t-surface2 rounded-lg py-2">
                <div className="text-[13px] font-bold tabular-nums t-text">{ex.intervalMin ? `${ex.intervalMin} 分钟` : '跟随默认'}</div>
                <div className="t-muted">抓取频率</div>
              </div>
            </div>
          </section>

          {/* 最近抓取 */}
          <section className="card p-4">
            <div className="text-sm font-semibold t-text mb-2">最近抓取</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="t-muted">最近一次</div>
                <div className="t-text mt-0.5">{s.last_fetched_at ? formatDateTime(s.last_fetched_at) : '从未抓到'}</div>
              </div>
              <div>
                <div className="t-muted">下次计划</div>
                <div className="t-text mt-0.5">{s.next_fetch_at ? formatDateTime(s.next_fetch_at) : '—'}</div>
              </div>
            </div>
          </section>

          {/* 内容样例 */}
          <section className="card p-4">
            <div className="text-sm font-semibold t-text mb-2">内容样例（最近 5 条）</div>
            {recentError && <div className="text-xs" style={{ color: 'var(--red)' }}>加载失败：{recentError}</div>}
            {!recent && !recentError && <div className="text-xs t-muted">加载中…</div>}
            {recent && recent.length === 0 && (
              <div className="text-xs t-muted">库里没有内容{isVideo ? '（视频表）' : ''}——抓到但没产出/长期没抓到，可在「清理」视图处理。</div>
            )}
            {recent && recent.length > 0 && (
              <ul className="space-y-1.5 text-xs">
                {recent.map((a) => (
                  <li key={a.id} className="flex items-start gap-2">
                    <span className="t-muted flex-none mt-0.5">{a.published_at ? relativeTime(a.published_at) : '—'}</span>
                    <a className="t-text hover:t-accent leading-snug" href={a.url} target="_blank" rel="noopener noreferrer">
                      {a.title || a.translated_title || '(无标题)'}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 轴状态（只读+指路：功能隔离——操作入口各在早报板块） */}
          <section className="card p-4">
            <div className="text-sm font-semibold t-text mb-2">轴状态</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {axes.map((a) => (
                <div key={a.label} className="t-surface2 rounded-lg px-3 py-2">
                  <div className={`font-medium ${a.on ? 'text-[var(--green)]' : 't-muted'}`}>{a.on ? '● 开' : '○ 关'}</div>
                  <div className="t-muted mt-0.5">{a.label}</div>
                  <div className="t-muted text-[10px] mt-0.5">改在 {a.home}</div>
                </div>
              ))}
            </div>
          </section>

          {/* 操作 */}
          <section className="card p-4">
            <div className="flex items-center gap-2">
              <button className="btn-ghost !py-1.5 !px-4 !text-xs" onClick={() => onRefresh(s)}>立即抓取</button>
              <span className="flex-1" />
              <button
                className="btn-ghost !py-1.5 !px-4 !text-xs hover:text-red-500"
                onClick={() => onDelete(s)}
              >删除源</button>
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
