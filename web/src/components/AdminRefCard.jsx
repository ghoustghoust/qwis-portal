import { useEffect, useState } from 'react';
import { api } from '../api';

// spec30 对照原则 C1：每个后台 Tab 顶部的「前台对照卡」——
// 它管理的前台页面入口（一键跳转）+ 当前生效配置摘要 + C2 作用对象标注。
// 各 Tab 的摘要数据在卡内自取（api.js 5s 缓存去重，成本可忽略）。
const REF_CONFIG = {
  library: {
    title: '源库',
    links: [{ href: '/reader/', label: '阅读器' }, { href: '/hot/', label: '热点榜' }],
    note: '四轴语义：上架=能否采集 → 采集层；收录 → 阅读器列表；订阅 → 我的早报；重点 → 每日早报重点栏+智能排序；屏蔽 → 热点榜/阅读器排除',
  },
  brief: {
    title: '早报中心',
    links: [{ href: '/daily/', label: '每日早报' }, { href: '/mybrief/', label: '我的早报' }, { href: '/weekly/', label: '精选周刊' }],
    note: '此处全部配置 → 每晚 21:30（北京）runner 生成批次，次日界面可见',
  },
  hot: {
    title: '热点榜策展',
    links: [{ href: '/hot/', label: '热点榜' }],
    note: '开关与门槛 → 热点榜「AI 信息实时流 / AI 精选 / 热搜」三视图',
  },
  ai: {
    title: 'AI 能力',
    links: [{ href: '/daily/', label: '每日早报' }],
    note: '模型与配额 → 早报策展 / 六维评分 / 翻译管线（作用于全部 AI 产出页）',
  },
  system: {
    title: '系统',
    links: [{ href: '/reader/', label: '阅读器' }],
    note: '数据/监控/报警 → 全站健康；配置改动即写云端 Turso，15 分钟内反映到信息流',
  },
};

export default function AdminRefCard({ tab }) {
  const cfg = REF_CONFIG[tab];
  const [summary, setSummary] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (tab === 'library') {
          const d = await api.get('/api/sources/library');
          const items = d.items || [];
          const enabled = items.filter((s) => s.enabled).length;
          const breaker = items.filter((s) => !s.enabled && (s.fail_count || 0) >= 3).length;
          if (alive) setSummary(`${items.length} 源 · 启用 ${enabled} · 熔断 ${breaker}`);
        } else if (tab === 'brief') {
          const s = await api.get('/api/settings');
          const subN = s?.subscription?.count ?? 0;
          if (alive) setSummary(`订阅源 ${subN} 个 · 每日早报 ${s?.daily?.time || '08:00'} · 晚间主批 21:30`);
        } else if (tab === 'hot') {
          const s = await api.get('/api/settings');
          if (alive) setSummary(s?.hot?.enabled === false ? '热点榜当前停用（前台导航已隐藏）' : '热点榜已启用');
        } else if (tab === 'ai') {
          const s = await api.get('/api/settings');
          if (alive) setSummary(`模型 ${s?.ai?.model || '—'} · API Key ${s?.ai?.apiKeyConfigured ? '已配置' : '未配置'}`);
        } else if (tab === 'system') {
          const h = await api.get('/api/health/status');
          const last = h?.collect?.lastRunAt || h?.lastRunAt;
          if (alive) setSummary(last ? `最近采集心跳：${new Date(last).toLocaleString('zh-CN', { hour12: false })}` : '心跳读取失败');
        }
      } catch { /* 摘要失败不阻塞 Tab 本体 */ }
    })();
    return () => { alive = false; };
  }, [tab]);

  if (!cfg) return null;
  return (
    <div className="card p-4 mb-5" style={{ borderLeft: '3px solid var(--accent)' }}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[13px] font-semibold t-text">管理前台：{cfg.title}</span>
        {cfg.links.map((l) => (
          <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="pill on !no-underline" title={`新窗口打开 ${l.label}`}>
            {l.label} ↗
          </a>
        ))}
        <span className="flex-1" />
        {summary && <span className="text-[11px] t-muted tabular-nums">{summary}</span>}
      </div>
      <div className="mt-1.5 text-[11px] t-muted leading-relaxed">{cfg.note}</div>
    </div>
  );
}
