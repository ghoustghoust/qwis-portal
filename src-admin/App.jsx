import { useState, useEffect, useRef, useCallback } from 'react';

// ---------- API ----------
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(j.error || `HTTP ${res.status}`), { status: res.status });
  return j;
}

const fmtTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const CHANNEL_TYPES = [
  { id: 'dingtalk', label: '钉钉', fields: [['url', 'Webhook URL'], ['secret', '加签密钥(可选)']] },
  { id: 'wecom', label: '企业微信', fields: [['url', 'Webhook URL']] },
  { id: 'feishu', label: '飞书', fields: [['url', 'Webhook URL'], ['secret', '签名密钥(可选)']] },
  { id: 'serverchan', label: 'Server酱', fields: [['sendkey', 'SendKey']] },
  { id: 'bark', label: 'Bark', fields: [['deviceKey', 'Device Key'], ['server', '服务器(可选,默认 api.day.app)']] },
  { id: 'telegram', label: 'Telegram', fields: [['token', 'Bot Token'], ['chatId', 'Chat ID']] },
  { id: 'webhook', label: '自定义 Webhook', fields: [['url', 'URL']] },
];
const EVENT_LABELS = {
  source_error: '源抓取失败',
  source_paused: '源熔断暂停',
  wemp_down: '公众号引擎离线',
  daily_failed: '日报生成失败',
  wemp_cookie_expired: '微信读书 Cookie 失效',
};

// ---------- 登录 / 首次设置 ----------
function Login({ setupRequired, onDone }) {
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api('admin/login', { method: 'POST', body: { password } });
      onDone();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>全网情报 · 管理后台</h1>
        <div className="hint">{setupRequired ? '首次访问,请设置管理口令(至少 6 位)' : '请输入管理口令'}</div>
        <form onSubmit={submit}>
          <div className="field">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="管理口令"
              autoFocus
            />
          </div>
          {err && <div className="error-text">{err}</div>}
          <button className="btn" disabled={busy || password.length < 6}>
            {setupRequired ? '设置并进入' : '登录'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ---------- 订阅源管理 ----------
function SourcesTab({ toast }) {
  const [items, setItems] = useState(null);
  const [form, setForm] = useState({ type: 'rss', name: '', url: '', intervalMin: '' });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const r = await api('admin/sources');
    setItems(r.items);
  }, []);
  useEffect(() => { load().catch((e) => toast(e.message)); }, [load]);

  async function toggle(s) {
    try {
      await api(`admin/sources/${s.id}/toggle`, { method: 'PUT' });
      await load();
    } catch (e) { toast(e.message); }
  }
  async function del(s) {
    if (!window.confirm(`删除源「${s.name}」及其全部文章?`)) return;
    try {
      await api(`admin/sources/${s.id}`, { method: 'DELETE' });
      toast(`已删除「${s.name}」`);
      await load();
    } catch (e) { toast(e.message); }
  }
  async function add(e) {
    e.preventDefault();
    try {
      await api('admin/sources', {
        method: 'POST',
        body: { ...form, intervalMin: Number(form.intervalMin) || undefined },
      });
      toast(`已添加「${form.name}」,下轮采集生效`);
      setForm({ type: 'rss', name: '', url: '', intervalMin: '' });
      await load();
    } catch (e2) { toast(e2.message); }
  }
  async function refreshAll() {
    setRefreshing(true);
    try {
      const r = await api('admin/refresh-all', { method: 'POST' });
      const ok = r.results.filter((x) => x.ok).length;
      const added = r.results.reduce((n, x) => n + (x.added || 0), 0);
      toast(`本批处理 ${r.processed} 源:${ok} 成功,新增 ${added} 篇(每批最多 8 源)`);
      await load();
    } catch (e) { toast(e.message); }
    setRefreshing(false);
  }

  if (!items) return <div className="card muted">加载中…</div>;
  return (
    <>
      <div className="card">
        <div className="form-row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>订阅源({items.length})</h3>
          <button className="btn" onClick={refreshAll} disabled={refreshing}>
            {refreshing ? '采集运行中…' : '全部刷新(采集一批)'}
          </button>
        </div>
        <form className="form-row" onSubmit={add} style={{ marginTop: 14 }}>
          <div className="field">
            <label>类型</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="rss">RSS / Atom</option>
              <option value="hotlist">热榜(newsnow)</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 140 }}>
            <label>名称</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="field" style={{ flex: 2, minWidth: 220 }}>
            <label>{form.type === 'hotlist' ? 'newsnow 源 id(如 zhihu)' : 'Feed 地址'}</label>
            <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} required />
          </div>
          <div className="field" style={{ width: 100 }}>
            <label>间隔(分钟)</label>
            <input value={form.intervalMin} onChange={(e) => setForm({ ...form, intervalMin: e.target.value })} placeholder="60" />
          </div>
          <button className="btn" type="submit">添加</button>
        </form>
      </div>
      <OpmlCard toast={toast} onDone={load} />
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="adm-table">
          <thead>
            <tr>
              <th>源</th><th>类型</th><th>状态</th><th>启用</th><th>间隔</th>
              <th>上次采集</th><th>文章</th><th>健康度</th><th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id}>
                <td>
                  <div>{s.name}</div>
                  <div className="muted small mono" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.url}</div>
                </td>
                <td className="small">{s.type}</td>
                <td>
                  {!s.enabled ? <span className="badge off">已停用</span>
                    : s.status === 'error' ? <span className="badge error">异常</span>
                    : <span className="badge ok">正常</span>}
                </td>
                <td>
                  <label className="switch">
                    <input type="checkbox" checked={s.enabled} onChange={() => toggle(s)} />
                    <span />
                  </label>
                </td>
                <td className="small">{s.intervalMin}m</td>
                <td className="small">{fmtTime(s.last_fetched_at)}</td>
                <td className="small">{s.articleCount}</td>
                <td className="small">
                  {s.failCount > 0 && <span className="error-text">连败 {s.failCount}</span>}
                  {s.lastError && <div className="muted" style={{ maxWidth: 200 }} title={s.lastError}>{s.lastError}</div>}
                </td>
                <td><button className="btn-danger" onClick={() => del(s)}>删除</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------- 报警管理 ----------
function AlertsTab({ toast }) {
  const [cfg, setCfg] = useState(null);
  useEffect(() => {
    api('admin/alerts').then((r) => setCfg(r.config)).catch((e) => toast(e.message));
  }, []);
  if (!cfg) return <div className="card muted">加载中…</div>;

  const setChannel = (i, patch) => {
    const channels = cfg.channels.slice();
    channels[i] = { ...channels[i], ...patch };
    setCfg({ ...cfg, channels });
  };
  const setChannelConf = (i, k, v) => setChannel(i, { config: { ...cfg.channels[i].config, [k]: v } });

  async function save() {
    try {
      await api('admin/alerts', { method: 'PUT', body: cfg });
      toast('报警配置已保存');
    } catch (e) { toast(e.message); }
  }
  async function test() {
    try {
      const r = await api('admin/alerts/test', { method: 'POST' });
      toast(r.skipped ? `未发送:${r.skipped}` : `测试报警已发送:${r.sent} 个渠道成功`);
      const rr = await api('admin/alerts');
      setCfg(rr.config);
    } catch (e) { toast(e.message); }
  }

  return (
    <>
      <div className="card">
        <h3>报警事件开关</h3>
        <div className="form-row">
          {Object.keys(EVENT_LABELS).map((k) => (
            <label key={k} className="small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={cfg.events[k] !== false}
                onChange={(e) => setCfg({ ...cfg, events: { ...cfg.events, [k]: e.target.checked } })}
              />
              {EVENT_LABELS[k]}
            </label>
          ))}
          <div className="field" style={{ width: 120 }}>
            <label>冷却(分钟)</label>
            <input value={cfg.cooldownMin} onChange={(e) => setCfg({ ...cfg, cooldownMin: e.target.value })} />
          </div>
        </div>
      </div>
      <div className="card">
        <div className="form-row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>通知渠道({cfg.channels.length})</h3>
          <button
            className="btn-ghost"
            onClick={() => setCfg({ ...cfg, channels: [...cfg.channels, { id: String(Date.now()), type: 'dingtalk', name: '', enabled: true, config: {} }] })}
          >
            + 添加渠道
          </button>
        </div>
        <div style={{ marginTop: 12 }}>
          {cfg.channels.map((c, i) => {
            const t = CHANNEL_TYPES.find((x) => x.id === c.type) || CHANNEL_TYPES[0];
            return (
              <div className="channel-item" key={c.id || i}>
                <div className="form-row">
                  <div className="field">
                    <label>类型</label>
                    <select value={c.type} onChange={(e) => setChannel(i, { type: e.target.value, config: {} })}>
                      {CHANNEL_TYPES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                    </select>
                  </div>
                  <div className="field" style={{ flex: 1, minWidth: 120 }}>
                    <label>名称</label>
                    <input value={c.name || ''} onChange={(e) => setChannel(i, { name: e.target.value })} placeholder={t.label} />
                  </div>
                  <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="checkbox" checked={c.enabled !== false} onChange={(e) => setChannel(i, { enabled: e.target.checked })} />
                    启用
                  </label>
                  <button className="btn-danger" onClick={() => setCfg({ ...cfg, channels: cfg.channels.filter((_, j) => j !== i) })}>删除</button>
                </div>
                <div className="form-row" style={{ marginTop: 8 }}>
                  {t.fields.map(([k, label]) => (
                    <div className="field" style={{ flex: 1, minWidth: 180 }} key={k}>
                      <label>{label}</label>
                      <input value={(c.config && c.config[k]) || ''} onChange={(e) => setChannelConf(i, k, e.target.value)} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {!cfg.channels.length && <div className="muted small">暂无渠道,添加后源熔断/抓取失败会推送提醒</div>}
        </div>
        <div className="form-row" style={{ marginTop: 12 }}>
          <button className="btn" onClick={save}>保存配置</button>
          <button className="btn-ghost" onClick={test}>发送测试报警</button>
        </div>
      </div>
      {!!(cfg.recentLog || []).length && (
        <div className="card">
          <h3>最近报警</h3>
          {cfg.recentLog.slice(0, 10).map((l, i) => (
            <div className="log-item" key={i}>
              {fmtTime(l.at)} · {l.title} · {(l.results || []).map((r) => `${r.channel}:${r.ok ? '✓' : '✗'}`).join(' ')}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ---------- 微信读书扫码授权 ----------
function WereadTab({ toast }) {
  const [qr, setQr] = useState(null); // {qr, uid, session}
  const [status, setStatus] = useState('');
  const timer = useRef(null);
  const qrRef = useRef(null);
  qrRef.current = qr;

  useEffect(() => () => clearInterval(timer.current), []);

  async function getQr() {
    setStatus('正在获取二维码…');
    setQr(null);
    try {
      const r = await api('admin/weread/qrcode');
      setQr(r);
      setStatus('请用微信扫码,并在手机上确认登录');
      clearInterval(timer.current);
      timer.current = setInterval(poll, 3000);
    } catch (e) {
      setStatus('');
      toast(e.message);
    }
  }
  const polling = useRef(false);
  async function poll() {
    const cur = qrRef.current;
    if (!cur || polling.current) return; // 上一次长轮询未返回时不并发
    polling.current = true;
    try {
      const r = await api(`admin/weread/status?uid=${encodeURIComponent(cur.uid)}&session=${encodeURIComponent(cur.session || '')}`);
      if (r.status === 'success') {
        clearInterval(timer.current);
        setStatus(`登录成功!Cookie 已保存(vid=${r.vid}),被停用的公众号源已自动恢复`);
        setQr(null);
      } else if (r.status === 'error') {
        clearInterval(timer.current);
        setStatus(r.error || '登录失败,请重新扫码');
        setQr(null);
      } else if (r.status === 'need_otp') {
        setStatus('账号需要验证码,暂不支持 OTP 登录');
      }
    } catch { /* 单次轮询失败忽略,继续 */ }
    polling.current = false;
  }

  return (
    <div className="card">
      <h3>微信读书扫码授权</h3>
      <p className="muted small" style={{ marginTop: 0 }}>
        公众号(wemp)采集走微信读书通道,Cookie 有效期有限。失效后 65 个公众号源会陆续熔断停用,在此重新扫码即可恢复。
      </p>
      <button className="btn" onClick={getQr}>获取登录二维码</button>
      {qr && (
        <div className="qr-box">
          <img src={qr.qr} alt="微信读书登录二维码" />
        </div>
      )}
      {status && <p className={status.startsWith('登录成功') ? 'ok-text' : 'muted small'}>{status}</p>}
    </div>
  );
}

// ---------- OPML 导入 ----------
function OpmlCard({ toast, onDone }) {
  const [url, setUrl] = useState('');
  const [xml, setXml] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api('admin/opml', { method: 'POST', body: { url: url || undefined, xml: xml || undefined } });
      toast(`OPML 导入完成:新增 ${r.added}、恢复 ${r.restored}、重命名 ${r.updated}(共 ${r.total})`);
      setUrl('');
      setXml('');
      onDone && onDone();
    } catch (e2) { toast(e2.message); }
    setBusy(false);
  }
  return (
    <div className="card">
      <h3>OPML 批量导入</h3>
      <form onSubmit={submit} className="form-row">
        <div className="field" style={{ flex: 2, minWidth: 240 }}>
          <label>OPML 地址</label>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/subscriptions.opml" />
        </div>
        <div className="field" style={{ flex: 3, minWidth: 260 }}>
          <label>或直接粘贴 OPML 内容</label>
          <textarea rows={2} value={xml} onChange={(e) => setXml(e.target.value)} placeholder="<opml>…</opml>" />
        </div>
        <button className="btn" type="submit" disabled={busy || (!url && !xml)}>导入</button>
      </form>
    </div>
  );
}

// ---------- 日报设置 ----------
function DailyTab({ toast }) {
  const [s, setS] = useState(null);
  useEffect(() => {
    api('admin/daily-settings').then((r) => setS(r.settings)).catch((e) => toast(e.message));
  }, []);
  if (!s) return <div className="card muted">加载中…</div>;
  const set = (patch) => setS({ ...s, ...patch });
  async function save() {
    try {
      await api('admin/daily-settings', { method: 'PUT', body: s });
      toast('日报设置已保存');
    } catch (e) { toast(e.message); }
  }
  async function regen() {
    try {
      toast('正在重新生成日报…');
      const r = await api('daily/regenerate', { method: 'POST' });
      toast(`日报已生成:${r.report.stats.candidates} 候选,${r.report.stats.sortMode} 排序`);
    } catch (e) { toast(e.message); }
  }
  return (
    <>
      <div className="card">
        <h3>日报生成</h3>
        <div className="form-row">
          <div className="field" style={{ width: 120 }}>
            <label>统计窗口(小时)</label>
            <input value={s.windowHours} onChange={(e) => set({ windowHours: e.target.value })} />
          </div>
        </div>
        <p className="muted small">排序为关键词规则模式(AI 摘要已下线)。</p>
        <div className="form-row" style={{ marginTop: 12 }}>
          <button className="btn" onClick={save}>保存</button>
          <button className="btn-ghost" onClick={regen}>立即重新生成日报</button>
        </div>
      </div>
    </>
  );
}


// ---------- 主壳 ----------
export default function App() {
  const [session, setSession] = useState(null);
  const [tab, setTab] = useState('sources');
  const [toastMsg, setToastMsg] = useState('');
  const toastTimer = useRef(null);

  const toast = useCallback((msg) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 3000);
  }, []);

  const checkSession = useCallback(() => {
    api('admin/session').then(setSession).catch(() => setSession({ authenticated: false, setupRequired: false, error: true }));
  }, []);
  useEffect(checkSession, [checkSession]);

  if (!session) return <div className="login-wrap muted">加载中…</div>;
  if (!session.authenticated) {
    return <Login setupRequired={session.setupRequired} onDone={checkSession} />;
  }

  const tabs = [
    { id: 'sources', label: '订阅源管理' },
    { id: 'alerts', label: '报警管理' },
    { id: 'weread', label: '微信读书授权' },
    { id: 'daily', label: '日报设置' },
  ];
  return (
    <div className="adm-shell">
      <div className="adm-header">
        <h1>全网情报 · 管理后台</h1>
        <span className="badge ok">云端</span>
        <span className="spacer" />
        <a className="btn-ghost" href="/reader/">返回阅读器</a>
        <button
          className="btn-ghost"
          onClick={() => api('admin/logout', { method: 'POST' }).then(checkSession)}
        >
          退出
        </button>
      </div>
      <div className="adm-tabs">
        {tabs.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'sources' && <SourcesTab toast={toast} />}
      {tab === 'alerts' && <AlertsTab toast={toast} />}
      {tab === 'weread' && <WereadTab toast={toast} />}
      {tab === 'daily' && <DailyTab toast={toast} />}
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  );
}
