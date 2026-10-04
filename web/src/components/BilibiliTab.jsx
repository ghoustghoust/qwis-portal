import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import { formatDateTime } from '../util';
import { useSettings, useStatus } from '../useSettings';
import IntervalEditor from './IntervalEditor.jsx';
import StatusCard from './StatusCard.jsx';
import PendingList from './PendingList.jsx';
import SourceTable, { StatusBadge } from './SourceTable.jsx';

// B站 Tab（F28~F35）
export default function BilibiliTab() {
  const { settings, save } = useSettings();
  const { status, reload: reloadStatus } = useStatus();
  const [sources, setSources] = useState([]);
  const [busy, setBusy] = useState('');

  const intervals = settings?.intervals || {};
  const bili = status?.bilibili || {};
  // T48：连续失败被自动暂停的本平台源（status.pausedSources）
  const paused = (status?.pausedSources?.items || []).filter((s) => s.type === 'bilibili');
  const cookieConfigured = !!(
    settings?.bilibili?.cookieConfigured ??
    settings?.bilibili?.cookie_configured ??
    settings?.bilibili_cookie_configured
  );

  const [refreshMin, setRefreshMin] = useState(60);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [input, setInput] = useState('');
  const [name, setName] = useState('');
  const [addError, setAddError] = useState('');
  const [cookie, setCookie] = useState('');
  const [pending, setPending] = useState([]);

  useEffect(() => {
    setRefreshMin(intervals.bilibili_min ?? intervals.bilibili ?? 60);
    setAutoRefresh(!!(intervals.bilibili_auto ?? true));
  }, [settings]);

  const loadSources = useCallback(async () => {
    try {
      const data = await api.get('/api/sources?type=bilibili');
      setSources(Array.isArray(data) ? data : data?.items || data?.sources || []);
    } catch (e) {
      setSources([]);
    }
  }, []);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  // F32：本地待处理订阅列表
  const loadPending = useCallback(async () => {
    try {
      const data = await api.get('/api/queue/pending?type=bilibili');
      setPending(data?.items || []);
    } catch (e) {
      setPending([]);
    }
  }, []);

  useEffect(() => {
    loadPending();
  }, [loadPending]);

  // F32b: 批量刷新已启用的 B 站订阅
  const refreshAllEnabled = async () => {
    if (busy) return;
    const enabledCount = sources.filter((s) => s.enabled !== 0).length;
    if (!enabledCount) {
      toast('没有已启用的 B 站订阅可刷新');
      return;
    }
    setBusy('refreshAll');
    try {
      const r = await api.post(`/api/sources/refresh-all?skipBreaker=1&type=bilibili`);
      toast(`批量刷新完成：成功 ${r.succeeded} / 失败 ${r.failed}`);
      loadSources();
      reloadStatus();
    } catch (e) {
      toast(e.message || '批量刷新失败');
    } finally {
      setBusy('');
    }
  };

  // H55④（10-04 批次4）：批量解冻/批量恢复两按钮摘除而不是修活——批量恢复会把真死源放回，
  // 污染活源计数（H15 判法未走）；自愈落地后由采集批次尾部自动恢复接管（用户拍板形态）。

  const saveInterval = async () => {
    if (busy) return;
    setBusy('save');
    try {
      await save({ intervals: { bilibili: Number(refreshMin) || 60, bilibili_auto: autoRefresh } });
      toast('设置已保存');
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy('');
    }
  };

  // F30：添加 UP 主；失败展示后端原文提示
  const addUp = async () => {
    const url = input.trim();
    if (!url) {
      setAddError('请粘贴 B站主页、视频链接或 uid');
      return;
    }
    setAddError('');
    setBusy('add');
    try {
      await api.post('/api/sources', { type: 'bilibili', url, name: name.trim() || undefined });
      toast('B站订阅已添加');
      setInput('');
      setName('');
      loadSources();
      reloadStatus();
    } catch (e) {
      // 原文透传，如「添加失败：没有识别到 B站 up，请粘贴 space.bilibili.com 的主页链接或直接填写数字 uid」
      setAddError(e.message);
    } finally {
      setBusy('');
    }
  };

  const toggleSource = async (s) => {
    try {
      await api.put(`/api/sources/${s.id}/toggle`);
      loadSources();
    } catch (e) {
      toast(e.message);
    }
  };

  const refreshSource = async (s) => {
    try {
      await api.post(`/api/sources/${s.id}/refresh`);
      toast(`已触发刷新：${s.name}`);
      loadSources();
    } catch (e) {
      toast(e.message);
    }
  };

  const deleteSource = async (s) => {
    if (!window.confirm(`删除订阅「${s.name}」？已抓取的视频会保留在历史存档。`)) return;
    try {
      await api.del(`/api/sources/${s.id}`);
      toast('已删除');
      loadSources();
      reloadStatus();
    } catch (e) {
      toast(e.message);
    }
  };

  // F35：播放 Cookie（留空不覆盖已保存，N2）
  const saveCookie = async () => {
    setBusy('cookie');
    try {
      await save({ bilibili: { cookie: cookie.trim() || undefined } });
      setCookie('');
      toast('Cookie 已保存');
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-6">
      {/* F28：状态卡 + 就绪提示 */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatusCard label="运行模式" value={bili.mode || '—'} />
        <StatusCard label="订阅源数" value={bili.source_count ?? bili.sourceCount ?? sources.length}
          sub={paused.length ? `已自动暂停（连续失败 ≥3 次）：${paused.map((s) => s.name).join('、')}，重新开启开关可恢复` : undefined} />
        <StatusCard label="视频数" value={bili.video_count ?? bili.videoCount} />
      </div>
      <div
        className="rounded-lg px-4 py-3 text-[13px] flex items-center gap-3"
        style={{ background: 'var(--accent-soft)', color: 'var(--text)' }}
      >
        <span style={{ color: 'var(--green)' }}>●</span>
        <span className="flex-1">B 站订阅已就绪，本机模式无需 RSSHub</span>
        <div className="flex items-center gap-2">
          <button
            className="btn-ghost text-xs"
            disabled={!!busy}
            onClick={refreshAllEnabled}
            title="批量刷新所有已启用的 B 站订阅（跳过熔断检查）"
          >
            {busy === 'refreshAll' ? '刷新中…' : '批量刷新已启用'}
          </button>
        </div>
      </div>

      {/* F29：自动刷新 */}
      <section className="card p-5">
        <h3 className="text-sm font-semibold t-text">自动刷新</h3>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px]">
          <label className="t-muted">内容刷新间隔（分钟）</label>
          <input
            type="number"
            min="10"
            className="input !w-24"
            value={refreshMin}
            onChange={(e) => setRefreshMin(e.target.value)}
          />
          <label
            className="flex items-center gap-2 t-muted cursor-pointer"
            onClick={() => setAutoRefresh((v) => !v)}
          >
            <span className={`switch ${autoRefresh ? 'on' : ''}`} />
            启用自动刷新
          </label>
          <div className="flex-1" />
          <button className="btn-primary" disabled={!!busy} onClick={saveInterval}>
            保存设置
          </button>
        </div>
        <p className="mt-3 text-xs t-muted">B站不依赖 RSSHub；有 Cookie 时优先用本机链路。</p>
      </section>

      {/* F30：添加 UP 主 */}
      <section className="card p-5">
        <h3 className="text-sm font-semibold t-text">添加 B站 UP 主</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            className="input flex-1 min-w-[240px]"
            placeholder="粘贴 B站主页、视频链接或 uid"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addUp()}
          />
          <input
            className="input !w-48"
            placeholder="显示名称（可留空）"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="btn-primary" disabled={busy === 'add'} onClick={addUp}>
            {busy === 'add' ? '添加中…' : '添加'}
          </button>
        </div>
        {addError && (
          <div
            className="mt-3 rounded-lg px-3 py-2 text-xs leading-relaxed"
            style={{ color: 'var(--red)', background: 'var(--surface-2)' }}
          >
            {addError}
          </div>
        )}
      </section>

      {/* F31：B站队列同步折叠区 —— H40 收摊（10-04 终裁①）：同步入口已摘，待处理区保留只读展示 */}

      {/* F32：本地待处理订阅列表 */}
      <section>
        <h3 className="text-sm font-semibold t-text mb-2">本地待处理订阅</h3>
        <PendingList items={pending} empty="暂无待处理订阅，可从手机分享链接到云端队列后点「同步队列」" />
      </section>

      {/* F33：已订阅 UP 主列表 */}
      <section>
        <h3 className="text-sm font-semibold t-text mb-2">已订阅 UP 主</h3>
        <SourceTable
          empty="暂无订阅，先添加一个 UP 主"
          columns={[
            {
              key: 'name',
              title: 'UP 主 / URL',
              render: (s) => (
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-medium t-text truncate max-w-[200px]" title={s.name || s.uid || s.url}>
                      {s.name || s.uid || s.url}
                    </span>
                    <span className="pill flex-none">B 站</span>
                  </div>
                  <div className="mt-1 text-[11px] t-muted break-all">
                    条数 {s.video_count ?? s.videoCount ?? s.unread ?? '—'} · 上次 {formatDateTime(s.last_fetched_at)} · 下次 {formatDateTime(s.next_fetch_at)}
                  </div>
                </div>
              )
            },
            {
              key: 'status',
              title: '状态',
              render: (s) => <StatusBadge source={s} />
            },
            {
              key: 'interval',
              title: '间隔',
              render: (s) => <IntervalEditor source={s} onSaved={loadSources} />
            },
            {
              key: 'actions',
              title: '操作',
              render: (s) => (
                <div className="flex items-center gap-1">
                  <button className="icon-btn" title="切换启停" onClick={() => toggleSource(s)}>
                    {s.enabled !== 0 ? '⏸' : '▶'}
                  </button>
                  <button className="icon-btn" title="刷新" onClick={() => refreshSource(s)}>⟳</button>
                  <button className="icon-btn" title="删除" onClick={() => deleteSource(s)}>🗑</button>
                </div>
              )
            }
          ]}
          rows={sources}
          pageSize={20}
          searchPlaceholder="搜索名称、URL、错误消息..."
          enableFilter={true}
        />
      </section>

      {/* F35：B站播放 Cookie 配置 */}
      <section className="card p-5">
        <h3 className="text-sm font-semibold t-text">B站播放 Cookie</h3>
        <p className="mt-1 text-xs t-muted">
          配置后视频详情页可解析直链内嵌播放（对应阅读器 F9）。当前状态：
          {cookieConfigured ? '已配置' : '未配置'}（留空保存不覆盖已保存 Cookie）。
        </p>
        <div className="mt-3 flex gap-2">
          <textarea
            className="input flex-1 font-mono !text-xs"
            rows={2}
            placeholder={cookieConfigured ? '已保存 Cookie，粘贴新值可覆盖' : '粘贴 SESSDATA 等 Cookie 字符串'}
            value={cookie}
            onChange={(e) => setCookie(e.target.value)}
          />
          <button className="btn-primary self-start" disabled={busy === 'cookie' || !cookie.trim()} onClick={saveCookie}>
            保存 Cookie
          </button>
        </div>
      </section>

      {/* F34：高级与诊断折叠区 */}
      <details className="card p-5">
        <summary className="text-sm font-semibold t-text cursor-pointer select-none">高级与诊断</summary>
        <p className="mt-2 text-xs t-muted">运行日志与诊断信息将在此展示。</p>
      </details>
    </div>
  );
}
