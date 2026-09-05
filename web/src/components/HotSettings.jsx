import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import { useSettings } from '../useSettings';
import IntervalEditor from './IntervalEditor.jsx';

// 热点榜设置区（T16/F8）：AIHOT 专属刷新间隔 + 分类规则表（只读）+ 热榜页启用开关
const DEFAULT_MAP = {
  模型: ['模型发布', '评测/基准'],
  产品: ['产品更新'],
  行业: ['行业动态'],
  论文: ['论文'],
  教程: ['教程/实践'],
  观点: ['大佬观点', '现象/趋势'],
};

function isAggregator(s) {
  if (/aihot/i.test(s?.name || '') || /aihot/i.test(s?.url || '')) return true;
  try {
    const extra = typeof s?.extra === 'string' ? JSON.parse(s.extra) : s?.extra;
    return !!extra?.aggregator;
  } catch {
    return false;
  }
}

export default function HotSettings() {
  const { settings, save } = useSettings();
  const [aihot, setAihot] = useState(null);
  const [catMap, setCatMap] = useState(DEFAULT_MAP);
  const [busy, setBusy] = useState(false);
  const [backfill, setBackfill] = useState(null); // {running,total,done,failed}
  const [backfillReady, setBackfillReady] = useState(true); // /api/hot/backfill 是否就绪

  const hotEnabled = settings?.hot?.enabled !== false;

  const loadAihot = useCallback(async () => {
    try {
      const data = await api.get('/api/sources?type=rss');
      const items = Array.isArray(data) ? data : data?.items || data?.sources || [];
      setAihot(items.find(isAggregator) || null);
    } catch (e) {
      setAihot(null);
    }
  }, []);

  useEffect(() => {
    loadAihot();
    api
      .get('/api/hot/categories')
      .then((d) => {
        if (d?.map && Object.keys(d.map).length) setCatMap(d.map);
      })
      .catch(() => {}); // 接口未就绪 → 展示内置默认规则表
  }, [loadAihot]);

  // 回填状态轮询（running 时 2s 一次）
  useEffect(() => {
    let timer = null;
    let stopped = false;
    const poll = async () => {
      try {
        const d = await api.get('/api/hot/backfill');
        const st = d?.status || d;
        if (stopped) return;
        setBackfillReady(true);
        setBackfill(st);
        if (st?.running) timer = setTimeout(poll, 2000);
      } catch {
        if (!stopped) setBackfillReady(false); // 接口未就绪 → 按钮降级禁用
      }
    };
    poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const startBackfill = async () => {
    if (backfill?.running) return;
    try {
      await api.post('/api/hot/backfill');
      setBackfill((b) => ({ ...(b || {}), running: true, done: b?.done ?? 0, total: b?.total ?? 0, failed: b?.failed ?? 0 }));
      // 立刻重新开始轮询
      const poll = async () => {
        try {
          const d = await api.get('/api/hot/backfill');
          const st = d?.status || d;
          setBackfill(st);
          if (st?.running) setTimeout(poll, 2000);
          else toast(`回填完成：${st?.done ?? 0}/${st?.total ?? 0}${st?.failed ? `，失败 ${st.failed}` : ''}`);
        } catch { /* 忽略轮询错误 */ }
      };
      setTimeout(poll, 2000);
    } catch (e) {
      toast(e.message || '回填启动失败');
    }
  };

  const toggleEnabled = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await save({ hot: { enabled: !hotEnabled } });
      toast(!hotEnabled ? '热点榜已启用' : '热点榜已停用（导航入口已隐藏）');
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-5 mt-6">
      <h3 className="text-sm font-semibold t-text">热点榜</h3>
      <p className="mt-1 text-xs t-muted">
        /hot/ 页面以 AIHOT 为数据源，提供分类精选、全部动态与中英对照阅读。
      </p>

      {/* 启用开关 */}
      <div className="mt-3 flex items-center gap-3 text-[13px]">
        <label
          className="flex items-center gap-2 t-muted cursor-pointer"
          onClick={toggleEnabled}
        >
          <span className={`switch ${hotEnabled ? 'on' : ''}`} />
          启用热点榜页面（导航栏 🔥 入口）
        </label>
      </div>

      {/* AIHOT 间隔 */}
      <div className="mt-4 flex flex-wrap items-center gap-3 text-[13px]">
        <span className="t-muted">AIHOT 专属刷新间隔（分钟，默认 30）</span>
        {aihot ? (
          <IntervalEditor source={aihot} onSaved={loadAihot} />
        ) : (
          <span className="text-xs t-muted">未找到 AIHOT 源（扩展源列表中添加后可见）</span>
        )}
      </div>

      {/* 回填历史（七期 F2）：sitemap 历史条目一次性补抓，进度轮询 */}
      <div className="mt-4">
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          <span className="t-muted">历史内容回填（AIHOT sitemap，一次性补抓入库）</span>
          <button
            className="btn-ghost"
            disabled={!backfillReady || !!backfill?.running}
            onClick={startBackfill}
            title={backfillReady ? '抓取 sitemap 中尚未入库的历史条目' : '回填接口尚未就绪（后端施工中）'}
          >
            {backfill?.running ? '回填中…' : '回填历史'}
          </button>
          {!backfillReady && <span className="text-xs t-muted">回填接口尚未就绪</span>}
        </div>
        {backfill && (backfill.running || backfill.total > 0) && (
          <div className="mt-2">
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
              <div
                className="h-full t-accent-bg transition-all"
                style={{ width: `${backfill.total ? Math.min(100, Math.round(((backfill.done || 0) / backfill.total) * 100)) : 0}%` }}
              />
            </div>
            <div className="mt-1 text-xs t-muted tabular-nums">
              {backfill.done ?? 0}/{backfill.total ?? 0}
              {backfill.failed ? `（失败 ${backfill.failed}）` : ''}
              {backfill.running ? ' · 每条约 2s，回填期间不影响正常刷新' : ' · 已完成'}
            </div>
          </div>
        )}
      </div>

      {/* 分类规则表（只读） */}
      <div className="mt-4">
        <div className="text-[13px] t-muted mb-2">分类归类规则（只读）</div>
        <div className="card overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="t-surface2 text-left">
                <th className="px-4 py-2 font-medium t-muted text-xs">胶囊分类</th>
                <th className="px-4 py-2 font-medium t-muted text-xs">AIHOT 分类映射</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(catMap).map(([cat, sources]) => (
                <tr key={cat} className="border-t t-border">
                  <td className="px-4 py-2 t-text">
                    <span
                      className="badge-green"
                      style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}
                    >
                      {cat}
                    </span>
                  </td>
                  <td className="px-4 py-2 t-muted">
                    {Array.isArray(sources) ? sources.join('、') : String(sources)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs t-muted">
          未命中映射的条目按标题关键词兜底；仍不归类的条目仅出现在「全部」胶囊下。
        </p>
      </div>
    </section>
  );
}
