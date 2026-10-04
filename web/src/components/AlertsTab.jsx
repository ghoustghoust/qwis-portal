import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import { relativeTime, cleanTitle } from '../util';
import InfoTip from './InfoTip.jsx';
import { PlusIcon, XIcon, ExternalIcon, BellIcon } from './icons.jsx';

// 报警管理（T3-8 批次3 改造：配置面——渠道 + 添加渠道两步向导 + 报警覆盖矩阵 + 事件开关 + 冷却时长）
// 报警记录（观测面）已迁至 LogsTab；接口：GET/PUT /api/alerts/config、POST /api/alerts/test {channelId?}、POST /api/alerts/clear-cooldowns

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

// B109/B45（spec 37-2 第 3 条）：事件说明原来在这里写死第 4 份（还只覆盖 3 个事件）。
// 现在 title/desc 都由 GET /api/alerts/config 的 eventMeta 一次带来 —— 一份事实一次传输。
// cleanTitle 已收编进 web/src/util.js（LogsTab 消费同一份）。

// B109：eventMeta 的值从"标题字符串"升级成"{title, desc}"，两个消费点都从这里取值，
// 免得再写两份 typeof 判断（日志列那里历史上传进来的一直是字符串，所以两种形状都要吃）。
const metaTitle = (m) => cleanTitle(typeof m === 'string' ? m : (m && m.title) || '');

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
  const [loading, setLoading] = useState(false); // 刷新加载状态

  // force=true 绕 90s 缓存强拉（刷新按钮用；挂载首渲染吃缓存瞬时呈现）
  const load = useCallback(async (force) => {
    setLoading(true);
    try {
      const d = await api.get('/api/alerts/config', force);
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
      if (d.skipped === 'channel-disabled') toast(`「${c.name}」已停用——先启用再测试`);
      else if (d.skipped === 'channel-not-found') toast(`「${c.name}」不存在（可能已被删除）`);
      else if (r?.ok) toast(`「${c.name}」测试成功，消息已送达`);
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
                  <button className="hover:underline" style={{ color: 'var(--red)' }} onClick={() => removeChannel(c)}>
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
          {Object.entries(meta).map(([key, m]) => (
            <label key={key} className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 accent-[var(--accent)]"
                checked={!!events[key]}
                onChange={() => toggleEvent(key)}
              />
              <span>
                <span className="text-[13px] t-text">{metaTitle(m)}</span>
                {typeof m !== 'string' && m && m.desc && (
                  <span className="block text-[11px] t-muted mt-0.5">{m.desc}</span>
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
          <button className="text-xs t-muted hover:underline font-medium" onClick={() => clearCooldowns()} title="清除所有报警源的冷却状态，避免重复报警被抑制">清空冷却</button>
        </div>
      </div>

      {/* 报警覆盖矩阵（T3-8 批次3：治"有的模块根本没在报警"——判据/启用/最近触发/送达一览） */}
      <section className="card p-4">
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium t-text">报警覆盖矩阵</div>
          <InfoTip
            what="全部报警判据一览：管什么、启用与否、最近一次触发时刻、最近一次送达结果。"
            how="无需设置；启用/停用用上面的「报警事件」开关。"
            effect="只读。'配了但哑'在这里一眼可见——渠道发不出去时，每行的送达列会一直挂红。"
          />
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="t-surface2 text-left">
                <th className="px-3 py-2 font-medium t-muted text-xs">判据</th>
                <th className="px-3 py-2 font-medium t-muted text-xs">启用</th>
                <th className="px-3 py-2 font-medium t-muted text-xs">最近触发</th>
                <th className="px-3 py-2 font-medium t-muted text-xs">送达</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(meta).map(([key, m]) => {
                const last = log.find((r) => r.event === key);
                const ok = last ? (last.results || []).some((rr) => rr.ok) : null;
                return (
                  <tr key={key} className="border-t t-border">
                    <td className="px-3 py-2 t-text">
                      {metaTitle(m)}
                      {typeof m !== 'string' && m && m.desc && <span className="block text-[11px] t-muted">{m.desc}</span>}
                    </td>
                    <td className="px-3 py-2">{events[key] ? <span className="badge-green">开</span> : <span className="badge-gray">关</span>}</td>
                    <td className="px-3 py-2 t-muted tabular-nums">{last ? relativeTime(last.at) : '从未触发'}</td>
                    <td className="px-3 py-2">{last ? (ok ? <span className="badge-green">成功</span> : <span className="badge-red">失败/哑</span>) : <span className="t-muted text-xs">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {adding && <AddChannelModal onClose={() => setAdding(false)} onSave={addChannel} />}
    </div>
  );
}
