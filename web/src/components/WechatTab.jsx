import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import { formatDateTime } from '../util';
import { useSettings, useStatus } from '../useSettings';
import { copyText } from '../util';
import IntervalEditor from './IntervalEditor.jsx';
import StatusCard from './StatusCard.jsx';
import SourceTable from './SourceTable.jsx';
import QueuePanel from './QueuePanel.jsx';

// 公众号 RSS Tab（F21~F27）
export default function WechatTab() {
  const { settings, save } = useSettings();
  const { status, reload: reloadStatus } = useStatus();
  const [sources, setSources] = useState([]);
  const [backup, setBackup] = useState(null);
  const [busy, setBusy] = useState('');
  const [pending, setPending] = useState([]);
  const [queueError, setQueueError] = useState('');

  // T44：海外源入口（F47/F48）：任意 RSS 地址 / YouTube 频道链接 / X 用户名
  const [extSources, setExtSources] = useState([]);
  const [extInput, setExtInput] = useState('');
  const [extKind, setExtKind] = useState('auto');
  const [extName, setExtName] = useState('');
  const [extError, setExtError] = useState('');

  const intervals = settings?.intervals || {};
  const wx = status?.wechat || status || {};

  const [opmlHours, setOpmlHours] = useState(12);
  const [opmlAuto, setOpmlAuto] = useState(true);
  const [rssHours, setRssHours] = useState(8);
  const [rssAuto, setRssAuto] = useState(true);

  useEffect(() => {
    setOpmlHours(intervals.opml ?? intervals.opml_hours ?? 12);
    setOpmlAuto(!!(settings?.opml?.enabled ?? intervals.opml_auto ?? true));
    setRssHours(intervals.rss ?? intervals.rss_hours ?? 8);
    setRssAuto(!!(intervals.rss_auto ?? true));
  }, [settings]);

  const loadSources = useCallback(async () => {
    try {
      const data = await api.get('/api/sources?type=wechat');
      setSources(Array.isArray(data) ? data : data?.items || data?.sources || []);
    } catch (e) {
      setSources([]);
    }
  }, []);

  const loadBackup = useCallback(async () => {
    try {
      const data = await api.get('/api/backup/latest');
      setBackup(data?.backup === undefined ? data : data.backup);
    } catch (e) {
      setBackup(null);
    }
  }, []);

  // F24：待提交公众号信息（云端队列拉取后保存在本地，仅手动复制）
  const loadPending = useCallback(async () => {
    try {
      const data = await api.get('/api/queue/pending?type=wechat');
      setPending(data?.items || []);
    } catch (e) {
      setPending([]);
    }
  }, []);

  // T44：扩展源列表（rss + x 两类合并）
  const loadExtSources = useCallback(async () => {
    try {
      const pick = (d) => (Array.isArray(d) ? d : d?.items || d?.sources || []);
      const [rss, x] = await Promise.all([
        api.get('/api/sources?type=rss').catch(() => []),
        api.get('/api/sources?type=x').catch(() => []),
      ]);
      setExtSources([...pick(rss), ...pick(x)]);
    } catch (e) {
      setExtSources([]);
    }
  }, []);

  useEffect(() => {
    loadSources();
    loadBackup();
    loadPending();
    loadExtSources();
  }, [loadSources, loadBackup, loadPending, loadExtSources]);

  const onQueueSynced = useCallback(
    (result) => {
      setQueueError(result.ok ? '' : result.message);
      loadPending();
    },
    [loadPending]
  );

  // 自动识别输入类型：X/Twitter 链接走 x 适配器；YouTube 链接走官方 RSS；http(s) 链接按 RSS；否则按 X 用户名
  const detectExtKind = (v) => {
    if (/(?:^|\.)(x\.com|twitter\.com)\//i.test(v)) return 'x';
    if (/youtube\.com|youtu\.be/i.test(v)) return 'youtube';
    if (/^https?:\/\//i.test(v)) return 'rss';
    return 'x';
  };

  const addExtSource = async () => {
    const v = extInput.trim();
    if (!v) {
      setExtError('请粘贴 RSS 地址、YouTube 频道链接或 X 用户名');
      return;
    }
    setExtError('');
    setBusy('addExt');
    try {
      const kind = extKind === 'auto' ? detectExtKind(v) : extKind;
      const body =
        kind === 'x'
          ? { type: 'x', url: v.replace(/^@/, '') }
          : { type: 'rss', url: v };
      await api.post('/api/sources', { ...body, name: extName.trim() || undefined });
      toast('订阅已添加');
      setExtInput('');
      setExtName('');
      loadExtSources();
      reloadStatus();
    } catch (e) {
      // 原文透传后端提示
      setExtError(e.message);
    } finally {
      setBusy('');
    }
  };

  const toggleExt = async (s) => {
    try {
      await api.put(`/api/sources/${s.id}/toggle`);
      loadExtSources();
    } catch (e) {
      toast(e.message);
    }
  };

  const refreshExt = async (s) => {
    try {
      await api.post(`/api/sources/${s.id}/refresh`);
      toast(`已触发刷新：${s.name || s.url}`);
      loadExtSources();
    } catch (e) {
      toast(e.message);
    }
  };

  const deleteExt = async (s) => {
    if (!window.confirm(`删除订阅「${s.name || s.url}」？已抓取的内容会保留在历史存档。`)) return;
    try {
      await api.del(`/api/sources/${s.id}`);
      toast('已删除');
      loadExtSources();
      reloadStatus();
    } catch (e) {
      toast(e.message);
    }
  };

  // type 徽章：rss / x / youtube（YouTube 存为 rss 类型，按 URL 区分）
  const extBadge = (r) => {
    if (r.type === 'x') return { text: 'X', bg: '#000', fg: '#fff' };
    if (/youtube\.com|youtu\.be/i.test(r.url || '')) return { text: 'YouTube', bg: '#f03', fg: '#fff' };
    return { text: 'RSS', bg: '#f26522', fg: '#fff' };
  };

  const run = async (key, fn, okMsg) => {
    if (busy) return;
    setBusy(key);
    try {
      const data = await fn();
      if (okMsg) toast(typeof okMsg === 'function' ? okMsg(data) : okMsg);
      reloadStatus();
      loadSources();
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy('');
    }
  };

  const saveOpml = () =>
    run('saveOpml', () => save({ intervals: { opml: Number(opmlHours) || 12 }, opml: { enabled: opmlAuto } }), 'OPML 设置已保存');
  const saveRss = () =>
    run('saveRss', () => save({ intervals: { rss: Number(rssHours) || 8, rss_auto: rssAuto } }), 'RSS 设置已保存');
  const syncOpml = () =>
    run('syncOpml', () => api.post('/api/opml/sync'), (d) => d?.message || 'OPML 同步已触发');
  const refreshRss = () =>
    run('refreshRss', () => api.post('/api/rss/refresh'), (d) => d?.message || 'RSS 刷新已触发');
  const doBackup = () =>
    run('backup', async () => {
      const d = await api.post('/api/backup');
      await loadBackup();
      return d;
    }, (d) => `备份成功：${d?.file || d?.filename || ''}`);
  const doRestore = () => {
    if (!window.confirm('确定用最新备份覆盖当前订阅与设置？')) return;
    run('restore', async () => {
      const d = await api.post('/api/backup/restore');
      await loadBackup();
      reloadStatus();
      loadSources();
      return d;
    }, '已恢复最新备份');
  };

  const lastResult = wx.opmlLastResult ?? wx.opml_last_result ?? wx.last_result;
  const lastResultText = lastResult
    ? `新增 ${lastResult.added ?? 0}，恢复 ${lastResult.restored ?? 0}，更新 ${lastResult.updated ?? 0}`
    : '—';
  // T48：连续失败被自动暂停的 RSS 类源（status.pausedSources）
  const paused = (status?.pausedSources?.items || []).filter((s) => ['wechat', 'rss', 'x'].includes(s.type));

  return (
    <div className="space-y-6">
      {/* F23：8 张状态卡 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatusCard label="OPML 状态" value={wx.opml_status || wx.opmlStatus || '空闲'} />
        <StatusCard label="OPML 最近同步" value={formatDateTime(wx.opml_last_sync || wx.opmlLastSync)} />
        <StatusCard label="OPML 下次同步" value={formatDateTime(wx.opml_next_sync || wx.opmlNextSync)} />
        <StatusCard label="OPML 最近结果" value={lastResultText} />
        <StatusCard label="RSS 最近刷新" value={formatDateTime(wx.rss_last_fetch || wx.rssLastFetch)} />
        <StatusCard label="RSS 下次刷新" value={formatDateTime(wx.rss_next_fetch || wx.rssNextFetch)} />
        <StatusCard label="文章缓存" value={wx.article_count ?? wx.articleCount} />
        <StatusCard label="刷新异常" value={wx.error_count ?? wx.errorCount}
          sub={paused.length ? `已自动暂停（连续失败 ≥3 次）：${paused.map((s) => s.name).join('、')}` : undefined} />
      </div>

      {/* F21：OPML 配置 */}
      <section className="card p-5">
        <h3 className="text-sm font-semibold t-text">OPML 配置</h3>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px]">
          <label className="t-muted">同步间隔（小时）</label>
          <input
            type="number"
            min="1"
            className="input !w-24"
            value={opmlHours}
            onChange={(e) => setOpmlHours(e.target.value)}
          />
          <label className="flex items-center gap-2 t-muted cursor-pointer" onClick={() => setOpmlAuto((v) => !v)}>
            <span className={`switch ${opmlAuto ? 'on' : ''}`} />
            启用 OPML 自动同步
          </label>
          <div className="flex-1" />
          <button className="btn-ghost" disabled={!!busy} onClick={saveOpml}>
            保存 OPML 设置
          </button>
          <button className="btn-primary" disabled={!!busy} onClick={syncOpml}>
            {busy === 'syncOpml' ? '同步中…' : '同步 OPML'}
          </button>
        </div>
        <div className="mt-3 text-xs t-muted">
          本地记录数 {wx.localCount ?? wx.opml_record_count ?? '—'} · 当前订阅数{' '}
          {wx.subscribedCount ?? wx.subscribe_count ?? sources.length} · 最后同步{' '}
          {formatDateTime(wx.opmlLastSync || wx.opml_last_sync)}
        </div>
      </section>

      {/* F22：RSS 配置 */}
      <section className="card p-5">
        <h3 className="text-sm font-semibold t-text">RSS 配置</h3>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px]">
          <label className="t-muted">文章刷新间隔（小时）</label>
          <input
            type="number"
            min="1"
            className="input !w-24"
            value={rssHours}
            onChange={(e) => setRssHours(e.target.value)}
          />
          <label className="flex items-center gap-2 t-muted cursor-pointer" onClick={() => setRssAuto((v) => !v)}>
            <span className={`switch ${rssAuto ? 'on' : ''}`} />
            启用 RSS 自动刷新
          </label>
          <div className="flex-1" />
          <button className="btn-ghost" disabled={!!busy} onClick={saveRss}>
            保存 RSS 设置
          </button>
          <button className="btn-primary" disabled={!!busy} onClick={refreshRss}>
            {busy === 'refreshRss' ? '刷新中…' : '同步 RSS'}
          </button>
        </div>
      </section>

      {/* F24：待提交公众号信息区 */}
      <section className="card p-5">
        <h3 className="text-sm font-semibold t-text">待提交公众号信息</h3>
        <p className="mt-2 text-xs t-muted">
          手机提交的公众号仅保存在本地供手动复制（不自动提交到第三方网页）；点「同步队列」拉取后出现条目。
        </p>
        {queueError && (
          <div
            className="mt-3 rounded-lg px-3 py-2 text-xs leading-relaxed"
            style={{ color: 'var(--red)', background: 'var(--surface-2)' }}
          >
            同步失败：{queueError}
          </div>
        )}
        <div className="mt-3">
          {pending.length === 0 ? (
            <div className="rounded-lg border border-dashed t-border py-6 text-center text-xs t-muted">
              暂无待提交条目
            </div>
          ) : (
            <div className="card divide-y divide-[var(--border)]">
              {pending.map((it) => (
                <div key={it.id ?? it.url} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium t-text truncate">
                      {it.name || '（未命名公众号）'}
                    </div>
                    <div className="mt-0.5 text-[11px] t-muted break-all">{it.url}</div>
                  </div>
                  <button className="btn-ghost flex-none" onClick={() => copyText(it.url)}>
                    复制链接
                  </button>
                  <button className="btn-ghost flex-none" onClick={() => copyText(it.name || '')}>
                    复制名称
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* F25：公众号队列 API 折叠区 */}
      <QueuePanel
        type="wechat"
        title="公众号队列 API"
        endpointFile="wechat-rss-queue.php"
        onSynced={onQueueSynced}
      />

      {/* F26：数据备份区（配置轻量迁移；整库快照见「数据」Tab） */}
      <section className="card p-5">
        <h3 className="text-sm font-semibold t-text">数据备份（配置轻量迁移）</h3>
        <p className="mt-1 text-xs t-muted">
          仅备份订阅源/分组/设置（JSON 轻量迁移）；整库快照与按天清理见上方「数据」Tab。
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button className="btn-primary" disabled={!!busy} onClick={doBackup}>
            {busy === 'backup' ? '备份中…' : '立即备份'}
          </button>
          <button className="btn-ghost" disabled={!!busy || !backup} onClick={doRestore}>
            恢复最新备份
          </button>
          <span className="text-xs t-muted">
            {backup && (backup.file || backup.filename)
              ? `最新备份：${backup.file || backup.filename} · ${formatDateTime(backup.time || backup.created_at)} · ${backup.count ?? backup.source_count ?? '—'} 条订阅`
              : '暂无备份'}
          </span>
        </div>
      </section>

      {/* F27：公众号订阅列表 */}
      <section>
        <h3 className="text-sm font-semibold t-text mb-2">公众号订阅列表</h3>
        <SourceTable
          empty="暂无公众号订阅，请先同步 OPML"
          columns={[
            {
              key: 'avatar',
              title: '头像',
              render: (r) =>
                r.avatar ? (
                  <img referrerPolicy="no-referrer" src={r.avatar} alt="" className="w-6 h-6 rounded-full object-cover" loading="lazy" />
                ) : (
                  <span className="w-6 h-6 rounded-full inline-flex items-center justify-center text-xs" style={{ background: 'var(--green)', color: '#fff' }}>
                    微
                  </span>
                ),
            },
            { 
              key: 'name', 
              title: '公众号昵称',
              render: (r) => (
                <div className="min-w-0">
                  <span className="font-medium t-text truncate max-w-[200px]" title={r.name}>{r.name}</span>
                  {(r.extra && r.fail_count >= 3 && r.enabled === 0) && (
                    <span className="ml-2 badge-red badge" title="已熔断（连续失败≥3 次）">
                      ⚡ 熔断
                    </span>
                  )}
                </div>
              )
            },
            {
              key: 'status',
              title: '状态',
              render: (r) => (
                <div className="flex items-center gap-2">
                  {r.enabled === 0 ? (
                    <span className="badge-green badge-off" style={{ color: 'var(--muted)', borderColor: 'var(--muted)' }}>
                      已停用
                    </span>
                  ) : (
                    <span className="badge-green badge-on">订阅中</span>
                  )}
                  {r.status === 'error' && (
                    <span className="badge-red badge" title="刷新异常">
                      异常
                    </span>
                  )}
                </div>
              )
            },
            { 
              key: 'created_at', 
              title: '新增时间', 
              render: (r) => formatDateTime(r.created_at) 
            },
            {
              key: 'interval',
              title: '间隔（分钟）',
              render: (r) => <IntervalEditor source={r} onSaved={loadSources} />,
            },
            {
              key: 'url',
              title: 'RSS 链接',
              render: (r) => <span className="text-xs t-muted break-all" title={r.url}>{r.url}</span>,
            },
          ]}
          rows={sources}
          pageSize={20}
          searchPlaceholder="搜索名称、URL..."
          enableFilter={true}
        />
      </section>

      {/* T44（F47/F48）：海外源入口 —— 任意 RSS 地址 / YouTube 频道链接 / X 用户名 */}
      <section className="card p-5">
        <h3 className="text-sm font-semibold t-text">扩展源（RSS / YouTube / X）</h3>
        <p className="mt-1 text-xs t-muted">
          支持任意 RSS 地址、YouTube 频道链接（自动转换为官方频道 RSS）和 X 用户名；X 依赖第三方 RSS 服务（如
          RSSHub）将时间线转为 RSS 订阅。
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <select className="input !w-32" value={extKind} onChange={(e) => setExtKind(e.target.value)}>
            <option value="auto">自动识别</option>
            <option value="rss">RSS 地址</option>
            <option value="youtube">YouTube 频道</option>
            <option value="x">X 用户名</option>
          </select>
          <input
            className="input flex-1 min-w-[240px]"
            placeholder="粘贴 RSS 地址 / YouTube 频道链接 / X 用户名"
            value={extInput}
            onChange={(e) => setExtInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addExtSource()}
          />
          <input
            className="input !w-40"
            placeholder="显示名称（可留空）"
            value={extName}
            onChange={(e) => setExtName(e.target.value)}
          />
          <button className="btn-primary" disabled={busy === 'addExt'} onClick={addExtSource}>
            {busy === 'addExt' ? '添加中…' : '添加'}
          </button>
        </div>
        {extError && (
          <div
            className="mt-3 rounded-lg px-3 py-2 text-xs leading-relaxed"
            style={{ color: 'var(--red)', background: 'var(--surface-2)' }}
          >
            {extError}
          </div>
        )}
      </section>

      {/* T44：扩展源订阅列表（type 徽章区分 rss/x/youtube） */}
      <section>
        <h3 className="text-sm font-semibold t-text mb-2">扩展源订阅列表</h3>
        <SourceTable
          empty="暂无扩展源，先添加一个 RSS / YouTube / X 订阅"
          columns={[
            {
              key: 'avatar',
              title: '',
              render: (s) => (
                s.avatar ? (
                  <img referrerPolicy="no-referrer" src={s.avatar} alt="" className="w-9 h-9 rounded-full object-cover flex-none" loading="lazy" />
                ) : (
                  <span className="w-9 h-9 rounded-full t-surface2 flex-none flex items-center justify-center text-xs t-muted">
                    {(s.name || s.url || '?').slice(0, 1)}
                  </span>
                )
              ),
            },
            {
              key: 'name',
              title: '名称 / URL',
              render: (s) => {
                const b = extBadge(s);
                return (
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-medium t-text truncate max-w-[200px]" title={s.name || s.url}>
                        {s.name || s.url}
                      </span>
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded flex-none"
                        style={{ background: b.bg, color: b.fg }}
                      >
                        {b.text}
                      </span>
                      {s.status === 'error' && (
                        <span 
                          className="badge-green" 
                          style={{ color: 'var(--red)', borderColor: 'var(--red)' }}
                          title={s.lastError || '刷新异常'}
                        >
                          刷新异常
                        </span>
                      )}
                      {s.fail_count >= 3 && s.enabled === 0 && (
                        <span 
                          className="badge-red badge" 
                          title="已熔断（连续失败≥3 次）"
                        >
                          熔断
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-[11px] t-muted break-all">
                      {s.url}
                    </div>
                  </div>
                );
              }
            },
            {
              key: 'status',
              title: '状态',
              render: (s) => (
                <div className="flex items-center gap-2">
                  <span className={`badge-green ${s.enabled !== 0 ? 'badge-on' : 'badge-off'}`}>
                    {s.enabled !== 0 ? '已启用' : '已停用'}
                  </span>
                  {s.last_fetched_at && (
                    <span className="text-xs t-muted" title={`上次刷新：${formatDateTime(s.last_fetched_at)}`}>
                      {formatDateTime(s.last_fetched_at)}
                    </span>
                  )}
                </div>
              )
            },
            {
              key: 'interval',
              title: '间隔',
              render: (s) => (
                <IntervalEditor source={s} onSaved={loadExtSources} />
              )
            },
            {
              key: 'actions',
              title: '操作',
              render: (s) => (
                <div className="flex items-center gap-1">
                  <button className="icon-btn" title="切换启停" onClick={() => toggleExt(s)}>
                    {s.enabled !== 0 ? '⏸' : '▶'}
                  </button>
                  <button className="icon-btn" title="刷新" onClick={() => refreshExt(s)}>⟳</button>
                  <button className="icon-btn" title="删除" onClick={() => deleteExt(s)}>🗑</button>
                </div>
              )
            }
          ]}
          rows={extSources}
          pageSize={20}
          searchPlaceholder="搜索名称、URL、错误消息..."
          enableFilter={true}
        />
      </section>
    </div>
  );
}
