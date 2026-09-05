import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import { formatDateTime, relativeTime } from '../util';
import { PlusIcon, XIcon, ExternalIcon, BellIcon, RefreshIcon } from './icons.jsx';

// 垃圾桶图标（删除单条日志）
function TrashIcon(props) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

// 报警管理 Tab（九期）：渠道卡片 + 添加渠道两步向导 + 事件开关 + 冷却时长 + 最近报警记录
// 接口：GET/PUT /api/alerts/config、POST /api/alerts/test {channelId?}、GET /api/alerts/log

// 六种渠道类型：tagline 一句定位（第 1 步卡片）+ steps 编号指引 / doc 文档链接 / note 特别提示（第 2 步表单页）
// dingtalk/feishu 的 config.secret 为可选加签密钥（九期后端补丁）
const CHANNEL_TYPES = {
  dingtalk: {
    label: '钉钉', tagline: '推送到钉钉群',
    steps: [
      '钉钉群 → 群设置 → 智能群助手 → 添加机器人 → 自定义',
      '安全设置选「自定义关键词」填「情报」（最省事）；或选「加签」，把密钥填到下方密钥栏',
      '复制 Webhook 地址粘贴到下方',
    ],
    doc: 'https://open.dingtalk.com/document/orgapp/custom-robot-access',
    fields: [
      { key: 'url', label: 'Webhook URL', placeholder: 'https://oapi.dingtalk.com/robot/send?access_token=…', note: '添加机器人后复制的完整地址' },
      { key: 'secret', label: '密钥', optional: true, placeholder: 'SEC 开头', note: '仅开启「加签」时必填；用「自定义关键词」则留空' },
    ],
  },
  wecom: {
    label: '企业微信', tagline: '推送到企业微信群',
    steps: [
      '群聊右上角「…」→ 添加群机器人 → 新创建一个',
      '复制 Webhook 地址粘贴到下方',
    ],
    doc: 'https://work.weixin.qq.com/help?doc_id=13376',
    fields: [
      { key: 'url', label: 'Webhook URL', placeholder: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…', note: '群机器人的完整 Webhook 地址' },
    ],
  },
  feishu: {
    label: '飞书', tagline: '推送到飞书群',
    steps: [
      '群设置 → 机器人 → 添加机器人 → 自定义机器人',
      '复制 Webhook 地址粘贴到下方',
      '若安全设置开了「签名校验」，把签名密钥填到下方密钥栏；没开就留空',
    ],
    doc: 'https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot',
    note: '不需要 App ID / App Secret —— 那是应用机器人才要的，这里用的是群自定义机器人。',
    fields: [
      { key: 'url', label: 'Webhook URL', placeholder: 'https://open.feishu.cn/open-apis/bot/v2/hook/…', note: '自定义机器人的完整 Webhook 地址' },
      { key: 'secret', label: '签名密钥', optional: true, placeholder: '签名校验密钥', note: '仅开启「签名校验」时必填' },
    ],
  },
  serverchan: {
    label: 'Server酱', tagline: '推送到微信（推荐）',
    steps: [
      '打开 sct.ftqq.com，微信扫码登录',
      '复制 SendKey 粘贴到下方',
    ],
    doc: 'https://sct.ftqq.com',
    fields: [
      { key: 'sendkey', label: 'SendKey', placeholder: 'SCT 开头的 SendKey', note: '登录后在「SendKey」页面复制' },
    ],
  },
  bark: {
    label: 'Bark', tagline: '推送到 iPhone',
    steps: [
      'App Store 装 Bark',
      '打开 App 复制你的设备 Key（首页那串）',
      '服务器默认 https://api.day.app，不用改',
    ],
    doc: 'https://bark.day.app',
    fields: [
      { key: 'deviceKey', label: '设备 Key', placeholder: 'Bark App 首页的那串 Key', note: '打开 Bark App 首页即可复制' },
      { key: 'server', label: '服务器', optional: true, placeholder: 'https://api.day.app', default: 'https://api.day.app', note: '默认官方服务器，自建才需要改' },
    ],
  },
  telegram: {
    label: 'Telegram', tagline: '推送到 Telegram',
    steps: [
      'Telegram 里找 @BotFather，发 /newbot 创建机器人拿 Token',
      '找 @userinfobot 发任意消息拿你的 chat_id',
    ],
    doc: 'https://t.me/BotFather',
    note: '国内网络需代理才能收到推送。',
    fields: [
      { key: 'token', label: 'Bot Token', placeholder: '123456:ABC-DEF…', note: 'BotFather 创建机器人后给出' },
      { key: 'chatId', label: 'Chat ID', placeholder: '会话或群组 ID', note: '@userinfobot 会告诉你' },
    ],
  },
  webhook: {
    label: '自定义 Webhook', tagline: '你自己的 HTTP 接口',
    steps: ['你的 HTTP 接口会收到 POST JSON：{title, text, event, time}'],
    doc: null,
    fields: [
      { key: 'url', label: 'URL', placeholder: 'https://…', note: '接收报警的接口地址' },
    ],
  },
};

// 官网链接（新窗口，带外链小图标）；无官网的（webhook）只显示说明
function HomeLink({ url, help, className = '' }) {
  if (!url) return <span className={`t-muted ${className}`}>{help}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`t-accent hover:underline inline-flex items-center gap-0.5 ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      {help} <ExternalIcon width={10} height={10} />
    </a>
  );
}

// 事件含义补充说明（eventMeta 只有标题）
const EVENT_DESC = {
  source_error: '某个订阅源抓取失败时触发（受冷却时间限制）',
  source_paused: '源连续失败被自动熔断停用时触发',
  daily_failed: '每日情报生成失败时触发',
};

// eventMeta 标题可能带 emoji 前缀，剥掉保持界面零 emoji
function cleanTitle(t) {
  return String(t || '').replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, '');
}

function typeMeta(type) {
  return CHANNEL_TYPES[type] || { label: type, tagline: '', steps: [], doc: null, fields: [] };
}

function Spinner({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" className="animate-spin" aria-hidden>
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}

// 添加渠道弹窗（两步向导）：
// 第 1 步：类型卡片（图标+名称+一句定位，无链接）
// 第 2 步：表单页（顶部编号指引区块 + 文档链接 + 特别提示，然后才是字段）
function AddChannelModal({ onClose, onSave }) {
  const [type, setType] = useState('');
  const [name, setName] = useState('');
  const [config, setConfig] = useState({});
  const [saving, setSaving] = useState(false);
  const meta = type ? typeMeta(type) : null;

  const pick = (t) => {
    const m = typeMeta(t);
    setType(t);
    setName(m.label);
    // 带 default 的字段预填（如 bark 服务器）
    const pre = {};
    for (const f of m.fields) if (f.default) pre[f.key] = f.default;
    setConfig(pre);
  };

  const submit = async () => {
    if (!type) return;
    const cfg = { ...config };
    for (const f of meta.fields) {
      if (!f.optional && !String(cfg[f.key] || '').trim()) {
        toast(`请填写 ${f.label}`);
        return;
      }
      if (typeof cfg[f.key] === 'string') cfg[f.key] = cfg[f.key].trim();
      if (f.optional && !cfg[f.key]) delete cfg[f.key]; // 可选留空则不提交该字段
    }
    if (!name.trim()) {
      toast('请填写渠道名称');
      return;
    }
    setSaving(true);
    try {
      await onSave({ type, name: name.trim(), enabled: true, config: cfg });
      onClose();
    } catch (e) {
      toast(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.35)' }}
      onClick={onClose}
    >
      <div
        className="card w-full max-w-[520px] max-h-[86vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center">
          <div className="text-sm font-bold t-text">
            添加报警渠道{meta ? ` · ${meta.label}` : ''}
          </div>
          <span className="flex-1" />
          <button className="icon-btn !w-7 !h-7" title="关闭" onClick={onClose}>
            <XIcon size={14} />
          </button>
        </div>

        {!type ? (
          /* 第 1 步：类型选择（极简：图标+名称+一句定位，无链接） */
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {Object.entries(CHANNEL_TYPES).map(([t, m]) => (
              <button
                key={t}
                className="border t-border rounded-lg p-3 text-left transition-colors hover:border-[var(--accent)] flex items-center gap-2.5"
                onClick={() => pick(t)}
              >
                <span className="t-muted flex-none">
                  <BellIcon size={17} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium t-text">{m.label}</span>
                  <span className="block mt-0.5 text-[11px] t-muted leading-snug">{m.tagline}</span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          /* 第 2 步：指引区块 + 表单 */
          <div className="mt-4 space-y-3">
            <button className="text-xs t-muted hover:t-text" onClick={() => setType('')}>
              ← 重选类型
            </button>

            {/* 配置指引：编号步骤 + 文档链接 + 特别提示 */}
            <div className="t-accent-soft rounded-lg p-3.5">
              <div className="text-[12px] font-semibold t-accent">配置步骤</div>
              <ol className="mt-1.5 space-y-1">
                {meta.steps.map((s, i) => (
                  <li key={i} className="flex gap-2 text-[12px] leading-relaxed t-text">
                    <span className="flex-none t-accent font-bold tabular-nums">{i + 1}.</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
              {meta.doc && (
                <a
                  href={meta.doc}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-[12px] t-accent hover:underline"
                >
                  官方文档 <ExternalIcon width={11} height={11} />
                </a>
              )}
              {meta.note && (
                <div className="mt-2 text-[11.5px] leading-relaxed" style={{ color: 'var(--red)' }}>
                  {meta.note}
                </div>
              )}
            </div>

            <div>
              <div className="text-xs t-muted mb-1">渠道名称</div>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            {meta.fields.map((f) => (
              <div key={f.key}>
                <div className="text-xs t-muted mb-1">
                  {f.label}
                  {f.optional ? '（可选）' : ''}
                </div>
                <input
                  className="input"
                  placeholder={f.placeholder}
                  value={config[f.key] || ''}
                  onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}
                />
                {f.note && <div className="mt-1 text-[11px] t-muted leading-snug">{f.note}</div>}
              </div>
            ))}
            <div className="pt-1 flex justify-end gap-2">
              <button className="btn-ghost" onClick={onClose}>取消</button>
              <button className="btn-primary inline-flex items-center gap-1.5" disabled={saving} onClick={submit}>
                {saving && <Spinner size={11} />} 保存
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AlertsTab() {
  const [cfg, setCfg] = useState(null); // {channels, events, cooldownMin, recentLog, eventMeta}
  const [adding, setAdding] = useState(false);
  const [testingId, setTestingId] = useState(null);
  const [cooldown, setCooldown] = useState('');
  const [page, setPage] = useState(0); // 报警日志分页（每页 10 条）
  const [loading, setLoading] = useState(false); // 刷新加载状态

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get('/api/alerts/config');
      setCfg(d);
      setCooldown(String(d.cooldownMin ?? ''));
    } catch (e) {
      toast(e.message || '报警配置加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  // P1: 清空冷却记录
  const clearCooldowns = async () => {
    if (!window.confirm('确认清空所有报警冷却记录吗？之后相同事件可能再次触发报警')) return;
    try {
      await api.post('/api/alerts/clear-cooldowns');
      toast('已清空所有报警冷却记录');
      await load();
    } catch (e) {
      toast('清空失败：' + e.message);
    }
  };

  // P2: 删除单条报警日志（真删除：后端 DELETE /api/alerts/log/:index，带 at 指纹防错位）
  const deleteLogEntry = async (index, entry) => {
    if (!window.confirm('确认删除这条报警记录吗？此操作不可恢复')) return;
    try {
      await api.del(`/api/alerts/log/${index}?at=${encodeURIComponent(entry?.at || '')}`);
      toast('已删除该条报警记录');
      await load();
    } catch (e) {
      toast('删除失败：' + e.message);
    }
  };

  // P1: 清空报警日志
  const clearLog = async () => {
    if (!window.confirm('确认清空报警历史记录吗？此操作不可恢复')) return;
    try {
      await api.del('/api/alerts/log');
      toast('已清空报警历史记录');
      await load();
    } catch (e) {
      toast('清空失败：' + e.message);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  // PUT 部分字段保存，成功后本地状态以返回值无关（后端不回读），直接重载
  const save = async (patch, okMsg) => {
    await api.put('/api/alerts/config', patch);
    if (okMsg) toast(okMsg);
    await load();
  };

  const toggleChannel = (c) =>
    save(
      { channels: cfg.channels.map((x) => (x.id === c.id ? { ...x, enabled: !(c.enabled !== false) } : x)) },
      c.enabled !== false ? `已停用「${c.name}」` : `已启用「${c.name}」`
    ).catch((e) => toast(e.message));

  const removeChannel = (c) => {
    if (!window.confirm(`删除渠道「${c.name}」？`)) return;
    save({ channels: cfg.channels.filter((x) => x.id !== c.id) }, '已删除').catch((e) => toast(e.message));
  };

  const addChannel = (ch) =>
    save({ channels: [...cfg.channels, ch] }, `已添加渠道「${ch.name}」`);

  const testChannel = async (c) => {
    setTestingId(c.id);
    try {
      const d = await api.post('/api/alerts/test', { channelId: c.id });
      const r = (d.results || [])[0];
      if (r?.ok) toast(`「${c.name}」测试成功，消息已送达`);
      else toast(`「${c.name}」测试失败：${r?.error || '未知错误'}`);
    } catch (e) {
      toast(e.message || '测试失败');
    } finally {
      setTestingId(null);
    }
  };

  const toggleEvent = (key) =>
    save({ events: { [key]: !cfg.events?.[key] } }).catch((e) => toast(e.message));

  const saveCooldown = () => {
    const n = Number(cooldown);
    if (!Number.isFinite(n) || n < 5) {
      toast('冷却时长最小 5 分钟');
      setCooldown(String(cfg?.cooldownMin ?? ''));
      return;
    }
    save({ cooldownMin: n }, '冷却时长已保存').catch((e) => toast(e.message));
  };

  if (!cfg) return <div className="py-10 text-center text-xs t-muted">加载中…</div>;

  const channels = cfg.channels || [];
  const events = cfg.events || {};
  const meta = cfg.eventMeta || {};
  const log = cfg.recentLog || [];

  // 分页：每页 10 条，避免一次性渲染过多 DOM
  const PAGE_SIZE = 10;
  const totalPages = Math.max(1, Math.ceil(log.length / PAGE_SIZE));
  const curPage = Math.min(page, totalPages - 1);
  const pageLog = log.slice(curPage * PAGE_SIZE, curPage * PAGE_SIZE + PAGE_SIZE);
  
  // 当前页索引偏移（用于正确引用删除操作的 index）
  const pageIndexOffset = curPage * PAGE_SIZE;

  return (
    <div className="space-y-5">
      {/* 渠道卡片列表 */}
      <div>
        <div className="flex items-center mb-2">
          <div className="text-sm font-medium t-text">报警渠道（{channels.length}）</div>
          <span className="flex-1" />
          <button className="btn-ghost inline-flex items-center gap-1" onClick={() => setAdding(true)}>
            <PlusIcon size={13} /> 添加渠道
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {channels.map((c) => {
            const m = typeMeta(c.type);
            const on = c.enabled !== false;
            return (
              <div key={c.id} className="card p-4">
                <div className="flex items-center gap-2">
                  <span className="badge-green">{m.label}</span>
                  <span className="text-[13px] font-medium t-text truncate">{c.name}</span>
                  <span className="flex-1" />
                  <button
                    className={`switch ${on ? 'on' : ''}`}
                    title={on ? '已启用' : '已停用'}
                    onClick={() => toggleChannel(c)}
                  />
                </div>
                <div className="mt-1 text-[11px] t-muted truncate" title={m.tagline}>{m.tagline}</div>
                {m.doc && (
                  <div className="mt-0.5 text-[11px] leading-snug">
                    <HomeLink url={m.doc} help="官方文档" />
                  </div>
                )}
                <div className="mt-3 flex items-center gap-3 text-xs">
                  <button
                    className="t-accent hover:underline disabled:opacity-50 inline-flex items-center gap-1"
                    disabled={testingId === c.id}
                    onClick={() => testChannel(c)}
                  >
                    {testingId === c.id && <Spinner size={11} />} 测试
                  </button>
                  <button className="text-red-500 hover:underline" onClick={() => removeChannel(c)}>
                    删除
                  </button>
                </div>
              </div>
            );
          })}
          {channels.length === 0 && (
            <div className="card px-4 py-10 text-center text-xs t-muted sm:col-span-2">
              暂无渠道，点右上角「添加渠道」配置钉钉/企业微信/飞书/Server酱/Bark/Telegram/Webhook
            </div>
          )}
        </div>
      </div>

      {/* 事件开关 + 冷却时长 */}
      <div className="card p-4">
        <div className="text-sm font-medium t-text">报警事件</div>
        <div className="mt-1 text-xs t-muted">勾选哪些事件需要推送报警；同一事件在冷却期内只发一次。</div>
        <div className="mt-3 space-y-2.5">
          {Object.entries(meta).map(([key, title]) => (
            <label key={key} className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 accent-[var(--accent)]"
                checked={!!events[key]}
                onChange={() => toggleEvent(key)}
              />
              <span>
                <span className="text-[13px] t-text">{cleanTitle(title)}</span>
                {EVENT_DESC[key] && (
                  <span className="block text-[11px] t-muted mt-0.5">{EVENT_DESC[key]}</span>
                )}
              </span>
            </label>
          ))}
        </div>
        <div className="mt-4 pt-3 border-t t-border flex items-center gap-2 text-[13px]">
          <span className="t-text">冷却时长</span>
          <input
            type="number"
            min="5"
            className="input !w-24"
            value={cooldown}
            onChange={(e) => setCooldown(e.target.value)}
            onBlur={saveCooldown}
            onKeyDown={(e) => e.key === 'Enter' && saveCooldown()}
          />
          <span className="t-muted text-xs">分钟（同一事件冷却期内不重复推送，最小 5）</span>
        </div>
      </div>

      {/* 最近报警记录 */}
      <div>
        <div className="flex items-center mb-2">
          <div className="text-sm font-medium t-text">最近报警记录</div>
          <span className="flex-1" />
          <div className="inline-flex gap-2">
            <button
              className={`btn-ghost inline-flex items-center gap-1 !px-2.5 ${loading ? 'animate-spin' : ''}`}
              onClick={load}
              disabled={loading}
              title="刷新报警记录"
            >
              <RefreshIcon size={13} /> {loading ? '刷新中…' : '刷新'}
            </button>
            <span className="text-xs t-muted whitespace-nowrap">•</span>
            <button className="text-xs text-orange-600 hover:underline font-medium" onClick={() => clearCooldowns()} title="清除所有报警源的冷却状态，避免重复报警被抑制">
              清空冷却
            </button>
            <button className="text-xs text-red-600 hover:underline font-medium" onClick={() => clearLog()} title="清除所有历史报警记录">
              清空全部日志
            </button>
          </div>
        </div>
        {log.length > 0 ? (
          <div className="card divide-y divide-[var(--border)]">
            {pageLog.map((r, i) => (
              <div key={r.at + i} className="px-4 py-2.5 relative group">
                {/* 行操作按钮（悬停时显示） */}
                <button
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => deleteLogEntry(pageIndexOffset + i, r)}
                  title="删除这条报警记录"
                  style={{ color: 'var(--red)' }}
                >
                  <TrashIcon size={14} />
                </button>
                
                <div className="flex items-start gap-2 flex-wrap">
                  <div className="flex-1 min-w-0">
                    {/* 格式化时间显示（主）+ 相对时间（title 悬停） */}
                    <span 
                      className="text-[11px] t-accent-soft tabular-nums font-medium mr-2" 
                      title={`${relativeTime(r.at)}\uff08原始：${r.at}\uff09`}
                    >
                      {formatDateTime(r.at)}
                    </span>
                    <span className="badge-green">{cleanTitle(meta[r.event]) || r.event}</span>
                    <span className="flex-1" />
                    {(r.results || []).map((rr, j) => (
                      <span
                        key={j}
                        className="badge-green inline-flex items-center gap-1"
                        style={rr.ok
                          ? { color: 'var(--green)', borderColor: 'var(--green)' }
                          : { color: 'var(--red)', borderColor: 'var(--red)' }}
                        title={rr.ok ? rr.channel : `${rr.channel}：${rr.error || '发送失败'}`}
                      >
                        {rr.ok ? '\u2713' : '\u2717'} {rr.channel}
                        {!rr.ok && rr.error && <span className="ml-1 opacity-80">\uff08{rr.error}\uff09</span>}
                      </span>
                    ))}
                  </div>
                </div>
                {r.title && <div className="mt-1.5 text-[13px] t-text leading-snug pl-6 border-l-2 border-[var(--accent)]">{r.title}</div>}
              </div>
            ))}
          </div>
        ) : (
          <div className="card px-4 py-10 text-center text-xs t-muted">暂无报警记录</div>
        )}
        {log.length > PAGE_SIZE && (
          <div className="mt-3 flex items-center justify-center gap-3 text-xs">
            <button
              className="btn-ghost !px-2.5 !py-1 disabled:opacity-40"
              disabled={curPage === 0}
              onClick={() => setPage(curPage - 1)}
            >
              ← 上一页
            </button>
            <span className="t-muted tabular-nums">第 {curPage + 1} / {totalPages} 页 · 共 {log.length} 条</span>
            <button
              className="btn-ghost !px-2.5 !py-1 disabled:opacity-40"
              disabled={curPage >= totalPages - 1}
              onClick={() => setPage(curPage + 1)}
            >
              下一页 →
            </button>
          </div>
        )}
      </div>

      {adding && <AddChannelModal onClose={() => setAdding(false)} onSave={addChannel} />}
    </div>
  );
}
