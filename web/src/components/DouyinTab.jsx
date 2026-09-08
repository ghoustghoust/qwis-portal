import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import { formatDateTime } from '../util';
import { useSettings, useStatus } from '../useSettings';
import IntervalEditor from './IntervalEditor.jsx';
import StatusCard from './StatusCard.jsx';
import PendingList from './PendingList.jsx';
import QueuePanel from './QueuePanel.jsx';
import SourceTable, { StatusBadge } from './SourceTable.jsx';

// 抖音 Tab（F36~F42），结构同构 BilibiliTab（T20）
// 登录契约：GET /api/auth/douyin/status → {ok:true, loggedIn:bool, updatedAt?}
//          POST /api/auth/douyin/start → 拉起本机浏览器扫码登录（异步），前端轮询 status
export default function DouyinTab() {
  const { settings, save } = useSettings();
  const { status, reload: reloadStatus } = useStatus();
  const [sources, setSources] = useState([]);
  const [pending, setPending] = useState([]);
  const [busy, setBusy] = useState('');

  const intervals = settings?.intervals || {};
  const dy = status?.douyin || {};
  // T48：连续失败被自动暂停的本平台源（status.pausedSources）
  const paused = (status?.pausedSources?.items || []).filter((s) => s.type === 'douyin');

  const [refreshMin, setRefreshMin] = useState(360);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [input, setInput] = useState('');
  const [name, setName] = useState('');
  const [addError, setAddError] = useState('');

  // F37：登录状态
  const [login, setLogin] = useState(null); // {loggedIn, updatedAt} | null（加载失败）
  // F38：扫码登录弹窗
  const [loginModal, setLoginModal] = useState(false);
  const [loginStarting, setLoginStarting] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => {
    setRefreshMin(intervals.douyin_min ?? intervals.douyin ?? 360);
    setAutoRefresh(!!(intervals.douyin_auto ?? true));
  }, [settings]);

  const loadSources = useCallback(async () => {
    try {
      const data = await api.get('/api/sources?type=douyin');
      setSources(Array.isArray(data) ? data : data?.items || data?.sources || []);
    } catch (e) {
      setSources([]);
    }
  }, []);

  // F42：本地待处理订阅
  const loadPending = useCallback(async () => {
    try {
      const data = await api.get('/api/queue/pending?type=douyin');
      setPending(data?.items || []);
    } catch (e) {
      setPending([]);
    }
  }, []);

  const loadLogin = useCallback(async () => {
    try {
      const data = await api.get('/api/auth/douyin/status');
      setLogin({ loggedIn: !!data?.loggedIn, updatedAt: data?.updatedAt || data?.updated_at });
      return !!data?.loggedIn;
    } catch (e) {
      setLogin(null);
      return false;
    }
  }, []);

  useEffect(() => {
    loadSources();
    loadPending();
    loadLogin();
  }, [loadSources, loadPending, loadLogin]);

  // F42b: 批量刷新已启用的抖音订阅
  const refreshAllEnabled = async () => {
    if (busy) return;
    const enabledCount = sources.filter((s) => s.enabled !== 0).length;
    if (!enabledCount) {
      toast('没有已启用的抖音订阅可刷新');
      return;
    }
    setBusy('refreshAll');
    try {
      const r = await api.post(`/api/sources/refresh-all?skipBreaker=1&type=douyin`);
      toast(`批量刷新完成：成功 ${r.succeeded} / 失败 ${r.failed}`);
      loadSources();
      reloadStatus();
    } catch (e) {
      toast(e.message || '批量刷新失败');
    } finally {
      setBusy('');
    }
  };

  // F42c: 批量解冻已熔断的抖音订阅（兼容旧 API）
  const unfreezeAll = async () => {
    const frozenDy = paused.filter((s) => s.type === 'douyin');
    if (!frozenDy.length) {
      toast('没有已熔断的抖音订阅');
      return;
    }
    if (!window.confirm(`确定批量解冻 ${frozenDy.length} 个熔断的抖音订阅？将清零失败计数并重新启用`)) return;
    setBusy('unfreeze');
    try {
      let restored = 0;
      for (const s of frozenDy) {
        await api.put(`/api/sources/${s.id}/toggle`).catch(() => {});
        restored++;
      }
      toast(`已恢复 ${restored} 个抖音订阅`);
      loadSources();
      reloadStatus();
    } catch (e) {
      toast(e.message || '解冻失败');
    } finally {
      setBusy('');
    }
  };

  // ✅ P3: 一键批量恢复（解冻 + 刷新）所有抖音熔断源
  const restoreAllWithRefresh = async () => {
    const frozenDy = paused.filter((s) => s.type === 'douyin');
    if (!frozenDy.length) {
      toast('没有已熔断的抖音订阅可恢复');
      return;
    }
    if (!window.confirm(`确定批量恢复 ${frozenDy.length} 个熔断的抖音订阅？将立即解冻并启动刷新`)) return;
    setBusy('restore');
    try {
      const r = await api.post('/api/sources/restore-all', {
        type: 'douyin',
        refreshImmediately: true,
      });
      toast(`批量恢复完成：解冻 ${r.restored} 个，刷新成功 ${r.refreshed} 个，失败 ${r.failed} 个`);
      loadSources();
      reloadStatus();
    } catch (e) {
      toast(e.message || '批量恢复失败');
    } finally {
      setBusy('');
    }
  };

  // 卸载时停止轮询
  useEffect(() => () => stopPolling(), []);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  // F38：打开本机浏览器登录窗口，随后轮询 status；检测到有效登录态自动关闭弹窗
  const startLogin = async () => {
    if (loginStarting) return;
    setLoginStarting(true);
    try {
      await api.post('/api/auth/douyin/start');
      stopPolling();
      pollRef.current = setInterval(async () => {
        const ok = await loadLogin();
        if (ok) {
          stopPolling();
          setLoginModal(false);
          setLoginStarting(false);
          toast('抖音登录态已保存');
          reloadStatus();
        }
      }, 2000);
      // 5 分钟超时停止轮询（弹窗保留，可重试）
      setTimeout(stopPolling, 5 * 60 * 1000);
    } catch (e) {
      toast(e.message);
      setLoginStarting(false);
    }
  };

  const closeLoginModal = () => {
    stopPolling();
    setLoginModal(false);
    setLoginStarting(false);
    loadLogin();
  };

  // F39：自动刷新设置
  const saveInterval = async () => {
    if (busy) return;
    setBusy('save');
    try {
      await save({ intervals: { douyin: Number(refreshMin) || 360, douyin_auto: autoRefresh } });
      toast('设置已保存');
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy('');
    }
  };

  // F40：添加抖音作者；失败展示后端原文提示
  const addAuthor = async () => {
    const url = input.trim();
    if (!url) {
      setAddError('请粘贴抖音主页、分享链接或 sec_uid');
      return;
    }
    setAddError('');
    setBusy('add');
    try {
      await api.post('/api/sources', { type: 'douyin', url, name: name.trim() || undefined });
      toast('抖音订阅已添加');
      setInput('');
      setName('');
      loadSources();
      reloadStatus();
    } catch (e) {
      // 原文透传，如「添加失败：没有识别到抖音 uid/sec_uid，请粘贴抖音用户主页链接或直接填写 sec_uid」
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
      toast(`已触发刷新：${s.name || s.sec_uid || s.uid}`);
      loadSources();
    } catch (e) {
      toast(e.message);
    }
  };

  const deleteSource = async (s) => {
    if (!window.confirm(`删除订阅「${s.name || s.sec_uid || s.uid}」？已抓取的视频会保留在历史存档。`)) return;
    try {
      await api.del(`/api/sources/${s.id}`);
      toast('已删除');
      loadSources();
      reloadStatus();
    } catch (e) {
      toast(e.message);
    }
  };

  // F42：名称未解析时显示原始 sec_uid
  const displayName = (s) => s.name || s.sec_uid || s.uid || s.url;

  return (
    <div className="space-y-6">
      {/* F36：状态卡 + 就绪提示 */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatusCard label="运行模式" value={dy.mode || '本机模式'} />
        <StatusCard label="订阅源数" value={dy.source_count ?? dy.sourceCount ?? sources.length}
          sub={paused.length ? `已自动暂停（连续失败 ≥3 次）：${paused.map((s) => s.name).join('、')}，重新开启开关可恢复` : undefined} />
        <StatusCard label="视频数" value={dy.video_count ?? dy.videoCount} />
      </div>
      <div
        className="rounded-lg px-4 py-3 text-[13px] flex items-center gap-3"
        style={{ background: 'var(--accent-soft)', color: 'var(--text)' }}
      >
        <span style={{ color: 'var(--green)' }}>●</span>
        <span className="flex-1">抖音订阅已就绪，本机模式无需 RSSHub</span>
        <div className="flex items-center gap-2">
          <button
            className="btn-ghost text-xs"
            disabled={!!busy}
            onClick={refreshAllEnabled}
            title="批量刷新所有已启用的抖音订阅（跳过熔断检查）"
          >
            {busy === 'refreshAll' ? '刷新中…' : '批量刷新已启用'}
          </button>
          <button
            className="btn-ghost text-xs"
            disabled={!!busy || paused.length === 0}
            onClick={unfreezeAll}
            title="逐个解冻所有熔断的抖音订阅（不立即刷新）"
          >
            {busy === 'unfreeze' ? '恢复中…' : `批量解冻（${paused.filter(s => s.type === 'douyin').length}）`}
          </button>
          <button
            className="btn-primary text-xs"
            disabled={!!busy || paused.length === 0}
            onClick={restoreAllWithRefresh}
            title="一键完成解冻 + 刷新一体化管理（推荐）"
          >
            {busy === 'restore' ? '恢复中…' : `⚡ 批量恢复（${paused.filter(s => s.type === 'douyin').length}）`}
          </button>
        </div>
      </div>

      {/* F37：抖音登录状态卡 */}
      <section className="card p-5">
        <h3 className="text-sm font-semibold t-text">抖音登录状态</h3>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px]">
          {login?.loggedIn ? (
            <>
              <span style={{ color: 'var(--green)' }}>●</span>
              <span className="t-text">已保存登录态；添加抖音订阅后会低频使用</span>
              <span className="text-xs t-muted">保存时间 {formatDateTime(login.updatedAt)}</span>
            </>
          ) : (
            <>
              <span style={{ color: 'var(--muted)' }}>●</span>
              <span className="t-muted">未添加抖音订阅/需要时再扫码登录</span>
            </>
          )}
          <div className="flex-1" />
          <button className="btn-ghost" onClick={() => setLoginModal(true)}>
            {login?.loggedIn ? '重新扫码' : '扫码登录'}
          </button>
        </div>
      </section>

      {/* F39：自动刷新 */}
      <section className="card p-5">
        <h3 className="text-sm font-semibold t-text">自动刷新</h3>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px]">
          <label className="t-muted">内容刷新间隔（分钟）</label>
          <input
            type="number"
            min="30"
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
        <p className="mt-3 text-xs t-muted">抖音刷新严格串行，任意两个主页访问之间固定等待 10 秒。</p>
      </section>

      {/* F40：添加抖音作者 */}
      <section className="card p-5">
        <h3 className="text-sm font-semibold t-text">添加抖音作者</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            className="input flex-1 min-w-[240px]"
            placeholder="粘贴抖音主页、分享链接或 sec_uid"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addAuthor()}
          />
          <input
            className="input !w-48"
            placeholder="显示名称（可留空）"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="btn-primary" disabled={busy === 'add'} onClick={addAuthor}>
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

      {/* F41：抖音队列同步折叠区 */}
      <QueuePanel
        type="douyin"
        title="抖音队列同步"
        endpointFile="douyin-video-queue.php"
        note="导入本地后清空云端；处理和刷新都按 10 秒间隔串行。"
        onSynced={loadPending}
      />

      {/* F42：本地待处理订阅列表 */}
      <section>
        <h3 className="text-sm font-semibold t-text mb-2">本地待处理订阅</h3>
        <PendingList items={pending} empty="暂无待处理订阅，可从手机分享链接到云端队列后点「同步队列」" />
      </section>

      {/* F42：已订阅作者列表 */}
      <section>
        <h3 className="text-sm font-semibold t-text mb-2">已订阅作者</h3>
        <SourceTable
          empty="暂无订阅，先添加一个抖音作者"
          columns={[
            {
              key: 'name',
              title: '作者 / URL',
              render: (s) => (
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-medium t-text truncate max-w-[200px]" title={displayName(s)}>
                      {displayName(s)}
                    </span>
                    <span className="pill flex-none">抖音</span>
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

      {/* F42：高级与诊断折叠区 */}
      <details className="card p-5">
        <summary className="text-sm font-semibold t-text cursor-pointer select-none">高级与诊断</summary>
        <p className="mt-2 text-xs t-muted">运行日志与诊断信息将在此展示。</p>
      </details>

      {/* F38：扫码登录弹窗 */}
      {loginModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.35)' }}
          onClick={closeLoginModal}
        >
          <div
            className="card w-full max-w-[480px] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center px-5 h-12 flex-none border-b t-border">
              <div className="text-sm font-bold t-text">需要重新登录抖音</div>
              <div className="flex-1" />
              <button className="icon-btn" title="关闭" onClick={closeLoginModal}>
                ✕
              </button>
            </div>
            <div className="px-5 py-4 text-[13px] t-text leading-relaxed">
              点击「打开抖音登录窗口」后会在本机浏览器打开抖音登录页；扫码或确认登录成功后，系统会自动保存 Cookie
              和浏览器登录态，检测到有效登录态后自动关闭窗口。
              {loginStarting && (
                <div className="mt-3 text-xs t-muted">正在等待扫码登录…检测到有效登录态后此弹窗会自动关闭。</div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 pb-4">
              <button className="btn-ghost" onClick={closeLoginModal}>
                稍后处理
              </button>
              <button className="btn-primary" disabled={loginStarting} onClick={startLogin}>
                {loginStarting ? '等待登录中…' : '打开抖音登录窗口'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
