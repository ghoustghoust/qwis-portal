import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import { formatDateTime, relativeTime } from '../util';
import SourceTable from './SourceTable.jsx';
import IntervalEditor from './IntervalEditor.jsx';

// 源健康度（九期）：运行中(绿) / 异常(红+错误详情) / 已熔断(灰,连失≥3) / 已停用(灰)
function SourceHealth({ s }) {
  const errText = s.lastError ? String(s.lastError) : '';
  const errShort = errText.length > 40 ? errText.slice(0, 40) + '…' : errText;
  if (s.enabled && s.status === 'error') {
    return (
      <div>
        <span className="badge-green" style={{ color: 'var(--red)', borderColor: 'var(--red)' }}>异常</span>
        {errText && (
          <div className="mt-0.5 text-[11px] leading-snug" style={{ color: 'var(--red)' }} title={errText}>
            {errShort}
          </div>
        )}
        {s.lastErrorAt && (
          <div className="text-[10px] t-muted tabular-nums">{relativeTime(s.lastErrorAt)}</div>
        )}
      </div>
    );
  }
  if (s.enabled) return <span className="badge-green">运行中</span>;
  if ((s.fail_count || 0) >= 3) {
    return (
      <span className="badge-green" style={{ color: 'var(--muted)', borderColor: 'var(--muted)' }}>
        已熔断（连失 {s.fail_count} 次）
      </span>
    );
  }
  return (
    <span className="badge-green" style={{ color: 'var(--muted)', borderColor: 'var(--muted)' }}>
      已停用
    </span>
  );
}

// 简单 spinner（等待态，refresh-all 无进度推送，转圈等响应即可）
function Spinner({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" className="animate-spin" aria-hidden>
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}

// 运维状态面板（P1）：实时轮询 /api/health/status，展示熔断源清单 + 一键解冻 + Cookie 失效提醒 + B 站诊断
function OpsHealthPanel({ onUnfroze }) {
  const [health, setHealth] = useState(null);
  const [busy, setBusy] = useState('');
  const [diag, setDiag] = useState(null);

  const load = useCallback(async () => {
    try { setHealth(await api.get('/api/health/status')); } catch { setHealth(null); }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 30e3); // 30s 轮询
    return () => clearInterval(t);
  }, [load]);

  const unfreezeAll = async () => {
    if (!health?.sources?.frozen) return;
    if (!window.confirm(`确定批量解冻 ${health.sources.frozen} 个熔断源？将清零失败计数并重新启用`)) return;
    setBusy('unfreeze');
    try {
      const r = await api.post('/api/health/unfreeze-all');
      toast(`已恢复 ${r.restored} 个熔断源`);
      await load();
      onUnfroze && onUnfroze();
    } catch (e) {
      toast(e.message || '解冻失败');
    } finally {
      setBusy('');
    }
  };

  const diagnoseBili = async () => {
    setBusy('diag');
    setDiag(null);
    try {
      setDiag(await api.post('/api/health/bilibili-diagnose'));
    } catch (e) {
      setDiag({ message: e.message || '诊断失败' });
    } finally {
      setBusy('');
    }
  };

  const frozen = health?.sources?.frozen || 0;
  const errCount = health?.sources?.error || 0;
  const hasBiliFrozen = (health?.frozenList || []).some((s) => s.type === 'bilibili');
  const noIssue = health && frozen === 0 && errCount === 0 && health.wemp?.up;

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm font-medium t-text">运维状态面板</div>
        <div className="flex items-center gap-3 text-xs">
          {/* WeRSS 连接态指示灯 */}
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: health?.wemp?.up ? '#22c55e' : health ? '#ef4444' : '#9ca3af' }}
            />
            <span className={health?.wemp?.up ? 'text-green-600' : 'text-red-500'}>
              WeRSS {health ? (health.wemp?.up ? '在线' : '离线') : '检测中'}
            </span>
          </span>
          <span className="t-muted">异常源 {errCount}</span>
          <span style={{ color: frozen ? 'var(--red)' : undefined }}>熔断 {frozen}</span>
        </div>
      </div>

      {noIssue && (
        <div className="mt-2 text-xs text-green-600">✅ 所有源运行正常，无需干预</div>
      )}

      {/* Cookie 失效特征提醒 */}
      {health?.cookieIssues?.length > 0 && (
        <div className="mt-2 text-xs rounded-lg border t-border p-2.5" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>
          ⚠️ 检测到 {health.cookieIssues.length} 个源存在 Cookie/登录态失效特征（-2012/401/-101），
          请重新扫码授权或更新 Cookie 后解冻：{health.cookieIssues.map((s) => s.name).join('、')}
        </div>
      )}

      {/* 熔断源清单（点击展开详细错误） */}
      {frozen > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium" style={{ color: 'var(--red)' }}>熔断源清单（连失≥3 次已自动停用）</div>
            <button
              onClick={unfreezeAll}
              disabled={busy === 'unfreeze'}
              className="px-2.5 py-1 text-[11px] rounded-md bg-[var(--accent)] text-white disabled:opacity-50"
            >
              {busy === 'unfreeze' ? '恢复中…' : `一键解冻全部（${frozen}）`}
            </button>
          </div>
          <div className="mt-1.5 space-y-1 max-h-48 overflow-auto">
            {health.frozenList.map((s) => (
              <div key={s.id} className="text-[11px] leading-snug border t-border rounded-md px-2 py-1.5">
                <span className="t-text font-medium">{s.name}</span>
                <span className="t-muted"> · {s.type} · 连失 {s.failCount} 次</span>
                {s.lastError && (
                  <div className="mt-0.5 break-all" style={{ color: 'var(--red)' }} title={s.lastError}>
                    {s.lastError}
                  </div>
                )}
                {s.lastErrorAt && <div className="text-[10px] t-muted">{relativeTime(s.lastErrorAt)}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* B 站专项诊断（仅当有 B 站源熔断时展示） */}
      {hasBiliFrozen && (
        <div className="mt-3 border t-border rounded-lg p-2.5">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium t-text">B 站专项诊断（WBI 密钥 + Cookie 登录态）</div>
            <button
              onClick={diagnoseBili}
              disabled={busy === 'diag'}
              className="px-2.5 py-1 text-[11px] rounded-md border t-border t-accent disabled:opacity-50 inline-flex items-center gap-1"
            >
              {busy === 'diag' ? <Spinner size={11} /> : null}开始诊断
            </button>
          </div>
          {diag && (
            <div className="mt-1.5 text-[11px] space-y-0.5">
              <div>Cookie 已配置：{diag.cookieConfigured ? '✅' : '❌ 未配置（匿名模式易被风控）'}</div>
              <div>WBI 密钥刷新：{diag.wbiKeyRefreshed ? '✅ 成功' : '❌ 失败'}</div>
              <div>登录态：{diag.loginOk ? `✅ 已登录（${diag.uname || ''}）` : '❌ 无效（-101 = SESSDATA 过期）'}</div>
              {diag.message && <div style={{ color: 'var(--red)' }}>{diag.message}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// 公众号订阅 Tab（WeRSS 集成）：微信读书扫码授权 + 订阅同步 + wemp 源管理
export default function WempTab() {
  const [status, setStatus] = useState(null);
  const [sources, setSources] = useState([]);
  const [busy, setBusy] = useState('');
  const [refreshingId, setRefreshingId] = useState(null); // 单源刷新中
  const [refreshFails, setRefreshFails] = useState(null); // 全刷失败明细 [{name,error}]

  // 扫码授权状态机：idle → showing(等待扫码) → success / expired / error
  const [qrState, setQrState] = useState('idle');
  const [qrUrl, setQrUrl] = useState('');
  const [qrMsg, setQrMsg] = useState('');
  const pollRef = useRef(null);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api.get('/api/wemp/status'));
    } catch (e) {
      setStatus(null);
    }
  }, []);

  const loadSources = useCallback(async () => {
    try {
      // 只列 wemp 类型源（we-mp-rss 同步的公众号）；rss/wechat 公众号在「公众号 RSS」Tab，bilibili/douyin 各有专属 Tab
      const data = await api.get('/api/sources?type=wemp');
      const all = Array.isArray(data) ? data : data?.items || data?.sources || [];
      setSources(all.filter((s) => s.type === 'wemp'));
    } catch (e) {
      setSources([]);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    loadSources();
  }, [loadStatus, loadSources]);

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };
  useEffect(() => stopPoll, []); // 卸载时停止轮询

  const startPoll = useCallback(() => {
    stopPoll();
    pollRef.current = setInterval(async () => {
      try {
        const st = await api.get('/api/wemp/weread/status');
        if (st.loginStatus) {
          stopPoll();
          setQrState('success');
          setQrMsg('授权成功，Cookie 已保存');
          await api.post('/api/wemp/weread/complete').catch(() => {});
          toast('微信读书授权成功');
          return;
        }
        if (st.cookieInvalid) {
          stopPoll();
          setQrState('error');
          setQrMsg('登录成功但 Cookie 无效，请重新扫码');
          return;
        }
        if (st.expired) {
          stopPoll();
          setQrState('expired');
          setQrMsg('二维码已过期，请重新获取');
          return;
        }
        setQrMsg(st.msg || '等待扫码...');
      } catch (e) {
        // 单次轮询失败不中断
      }
    }, 2000);
  }, []);

  const getQrcode = async () => {
    setBusy('qr');
    setQrState('idle');
    setQrMsg('');
    try {
      const r = await api.get('/api/wemp/weread/qrcode');
      setQrUrl(r.qrUrl);
      setQrState('showing');
      setQrMsg('等待扫码...');
      startPoll();
    } catch (e) {
      setQrState('error');
      setQrMsg(e.message || '获取二维码失败');
    } finally {
      setBusy('');
    }
  };

  const doSync = async () => {
    setBusy('sync');
    try {
      const r = await api.post('/api/wemp/sync');
      toast(`同步完成：远端 ${r.feeds} 个订阅，新增 ${r.added} 个源`);
      await Promise.all([loadStatus(), loadSources()]);
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy('');
    }
  };

  const toggle = async (s) => {
    try {
      await api.put(`/api/sources/${s.id}/toggle`);
      loadSources();
    } catch (e) {
      toast(e.message);
    }
  };

  // 单源刷新（POST /api/sources/:id/refresh）
  const refreshOne = async (s) => {
    setRefreshingId(s.id);
    try {
      await api.post(`/api/sources/${s.id}/refresh`);
      toast(`已刷新：${s.name}`);
      loadSources();
    } catch (e) {
      toast(e.message || '刷新失败');
      loadSources(); // 失败也要刷新状态（fail_count/lastError 可能已更新）
    } finally {
      setRefreshingId(null);
    }
  };

  // ✅ P3: 一键批量恢复所有熔断源（解冻 + 刷新一体化）
  const restoreAllWithRefresh = async () => {
    if (busy) return;
    
    // 先加载最新状态
    const health = await api.get('/api/health/status');
    const frozenCount = health.sources.frozen;
    
    if (!frozenCount) {
      toast('没有已熔断的订阅源可恢复');
      return;
    }
    
    if (!window.confirm(`确定批量恢复 ${frozenCount} 个熔断的订阅源？将立即解冻并启动刷新（可能需要几分钟）`)) return;
    setBusy('restore');
    try {
      const r = await api.post('/api/sources/restore-all', {
        refreshImmediately: true,
      });
      toast(`批量恢复完成：解冻 ${r.restored} 个，刷新成功 ${r.refreshed} 个，失败 ${r.failed} 个`);
      setRefreshFails((r.results || []).filter((x) => !x.ok).length ? (r.results || []).filter((x) => !x.ok) : null);
      loadSources();
    } catch (e) {
      toast(e.message || '批量恢复失败');
    } finally {
      setBusy('');
    }
  };

  const remove = async (s) => {
    if (!window.confirm(`确定删除源「${s.name}」？`)) return;
    try {
      await api.del(`/api/sources/${s.id}`);
      toast('已删除');
      loadSources();
    } catch (e) {
      toast(e.message);
    }
  };

  const reachable = status?.remote?.reachable;

  return (
    <div className="space-y-5">
      {/* 运维状态面板（P1）：实时连接态指示器 + 熔断源一键解冻 */}
      <OpsHealthPanel onUnfroze={loadSources} />
      {/* 服务状态卡 */}
      <div className="card p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-sm font-medium t-text">WeRSS 服务（公众号采集引擎）</div>
            <div className="mt-1 text-xs t-muted">
              {status ? (
                <>
                  {reachable ? '✅ 已连接' : '❌ 不可达'} · {status.base} · 远端订阅 {status?.remote?.totalFeeds ?? '—'} 个 · 本地源 {status?.localSources ?? 0} 个
                  {status?.lastSyncAt ? ` · 上次同步 ${formatDateTime(status.lastSyncAt)}` : ''}
                </>
              ) : '状态加载中...'}
            </div>
            {status && !reachable && (
              <div className="mt-1 text-xs text-red-500">
                {status.remote?.error}（请先启动 D:\tools\we-mp-rss 服务）
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={restoreAllWithRefresh}
              disabled={busy === 'refreshAll' || busy === 'restore'}
              className="btn-primary inline-flex items-center gap-1.5 disabled:opacity-50"
              title="一键批量解冻并刷新所有熔断的订阅源（推荐）"
            >
              {busy === 'restore' ? (
                <>
                  <Spinner />
                  正在恢复全部…
                </>
              ) : (
                '⚡ 批量恢复所有'
              )}
            </button>
            <button
              onClick={() => api.post('/api/sources/refresh-all?skipBreaker=1').then(r => toast(`刷新完成：成功 ${r.succeeded} / 失败 ${r.failed}`)).catch(e => toast(e.message))}
              disabled={busy === 'refreshAll'}
              className="btn-ghost inline-flex items-center gap-1.5 disabled:opacity-50"
              title="仅刷新已启用的源（跳过熔断检查）"
            >
              {busy === 'refreshAll' ? (
                <>
                  <Spinner />
                  正在刷新…
                </>
              ) : (
                '🔄 刷新已启用'
              )}
            </button>
            <button
              onClick={doSync}
              disabled={busy === 'sync' || !reachable}
              className="px-4 py-2 text-[13px] rounded-lg bg-[var(--accent)] text-white disabled:opacity-50"
            >
              {busy === 'sync' ? '同步中...' : '同步订阅源'}
            </button>
          </div>
        </div>
        {(busy === 'restore' || busy === 'refreshAll') && (
          <div className="mt-3 text-xs t-muted inline-flex items-center gap-1.5">
            {busy === 'restore' ? (
              <>
                <Spinner />
                正在批量恢复熔断源（可能需要几分钟）…
              </>
            ) : (
              <>
                <Spinner />
                串行刷新中，风控平台较慢，可能需要几分钟，请保持页面打开…
              </>
            )}
          </div>
        )}
        {refreshFails && (
          <div className="mt-3 border t-border rounded-lg p-3">
            <div className="text-xs font-medium" style={{ color: 'var(--red)' }}>
              {refreshFails.length} 个源刷新失败：
            </div>
            <ul className="mt-1.5 space-y-1">
              {refreshFails.map((f) => (
                <li key={f.id} className="text-xs leading-snug">
                  <span className="t-text font-medium">{f.name}</span>
                  <span className="t-muted">：{f.error || '未知错误'}</span>
                  {f.autoPaused ? <span className="t-muted">（已自动熔断停用）</span> : null}
                </li>
              ))}
            </ul>
            <button className="mt-2 text-[11px] t-muted hover:t-text" onClick={() => setRefreshFails(null)}>
              收起
            </button>
          </div>
        )}
      </div>

      {/* 微信读书扫码授权 */}
      <div className="card p-4">
        <div className="text-sm font-medium t-text">微信读书授权（采集凭据）</div>
        <div className="mt-1 text-xs t-muted">
          文章抓取走微信读书通道，Cookie 过期时文章会停止更新，重新扫码即可恢复。
        </div>
        <div className="mt-3 flex items-start gap-5 flex-wrap">
          <div>
            {qrState === 'showing' || qrState === 'expired' || qrState === 'success' ? (
              <div className="relative w-[180px] h-[180px] border t-border rounded-lg overflow-hidden bg-white">
                <img src={qrUrl} alt="微信读书授权二维码" className="w-full h-full object-contain" />
                {qrState === 'expired' && (
                  <div className="absolute inset-0 bg-white/90 flex items-center justify-center text-xs t-muted">已过期</div>
                )}
                {qrState === 'success' && (
                  <div className="absolute inset-0 bg-white/90 flex items-center justify-center text-sm text-green-600">✓ 授权成功</div>
                )}
              </div>
            ) : (
              <div className="w-[180px] h-[180px] border t-border rounded-lg flex items-center justify-center text-xs t-muted">
                {qrState === 'error' ? '获取失败' : '尚未取码'}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-[220px]">
            <button
              onClick={getQrcode}
              disabled={busy === 'qr' || !reachable}
              className="px-4 py-2 text-[13px] rounded-lg bg-[var(--accent)] text-white disabled:opacity-50"
            >
              {busy === 'qr' ? '获取中...' : qrState === 'idle' ? '获取扫码二维码' : '重新获取二维码'}
            </button>
            {qrMsg && (
              <div className={`mt-2 text-xs ${qrState === 'error' ? 'text-red-500' : qrState === 'success' ? 'text-green-600' : 't-muted'}`}>
                {qrMsg}
              </div>
            )}
            <div className="mt-2 text-xs t-muted">用微信「扫一扫」扫码，手机上确认登录微信读书网页版。</div>
          </div>
        </div>
      </div>

      {/* 已同步源列表 */}
      <div>
        <div className="mb-2 text-sm font-medium t-text">已同步的公众号源（{sources.length}）</div>
        <SourceTable
          columns={[
            { key: 'name', title: '公众号' },
            { key: 'status', title: '状态', render: (s) => <SourceHealth s={s} /> },
            { key: 'interval', title: '刷新间隔', render: (s) => <IntervalEditor source={s} onSaved={loadSources} /> },
            {
              key: 'ops',
              title: '操作',
              render: (s) => (
                <span className="inline-flex items-center gap-3 text-xs">
                  <button
                    onClick={() => refreshOne(s)}
                    disabled={refreshingId === s.id}
                    className="t-accent hover:underline disabled:opacity-50 inline-flex items-center gap-1"
                  >
                    {refreshingId === s.id ? <Spinner size={11} /> : null}刷新
                  </button>
                  <button onClick={() => toggle(s)} className="t-accent hover:underline">
                    {s.enabled ? '停用' : '启用'}
                  </button>
                  <button onClick={() => remove(s)} className="text-red-500 hover:underline">删除</button>
                </span>
              ),
            },
          ]}
          rows={sources}
          empty="暂无源，点上方「同步订阅源」从 WeRSS 拉取"
        />
      </div>
    </div>
  );
}
