// 无感刷新 Hook（2026-09-11 重写：SSE → 增量轮询）
// 背景：原实现连本地 Express 的 /api/events（SSE），但 Vercel serverless 无法维持长连
// （Hobby 10s 硬限、不支持 WebSocket），线上 EventSource 一直在静默失败重连。
// 现改为 60s 轮询轻量端点 GET /api/articles/since?ts=（返回仅几十字节）。
// 语义：newCount = 自基线以来的新文章数；用户点击提示条后 consumeNewCount() 重置基线。
// 页面不可见时暂停轮询（省资源），恢复可见时立即补一次。

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

const POLL_INTERVAL_MS = 60000;

export function useRealtime(filters = {}) {
  const [newCount, setNewCount] = useState(0); // 自基线以来的新文章数
  const [lastEvent, setLastEvent] = useState(null); // 最近一次发现新内容
  const sinceRef = useRef(null);      // 基线时间戳（ISO）
  const latestRef = useRef(null);     // 最近一次探测到的最新 sortKey
  const timerRef = useRef(null);
  // 筛选条件变化（切组/切源/切 tab）时重建基线
  const filterKey = `${filters.tab || ''}|${filters.groupId || ''}|${filters.sourceId || ''}`;
  const filterKeyRef = useRef(filterKey);
  filterKeyRef.current = filterKey;

  const buildQuery = useCallback((ts) => {
    const p = new URLSearchParams();
    if (ts) p.set('ts', ts);
    const f = filtersRef.current;
    if (f.tab) p.set('tab', f.tab);
    if (f.groupId) p.set('group_id', f.groupId);
    if (f.sourceId) p.set('source_id', f.sourceId);
    const s = p.toString();
    return `/api/articles/since${s ? '?' + s : ''}`;
  }, []);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const poll = useCallback(async () => {
    try {
      const d = await api.get(buildQuery(sinceRef.current));
      if (!d) return;
      if (d.latest) latestRef.current = d.latest;
      if (!sinceRef.current) {
        // 首次调用：建立基线，不计数
        sinceRef.current = d.latest || new Date().toISOString();
        return;
      }
      const n = d.newCount || 0;
      setNewCount((prev) => {
        if (n > prev) setLastEvent({ type: 'new_articles', count: n - prev });
        return n;
      });
    } catch { /* 网络失败静默，下轮再试 */ }
  }, [buildQuery]);

  useEffect(() => {
    // 筛选变化 → 基线清零重新探测
    sinceRef.current = null;
    latestRef.current = null;
    setNewCount(0);

    const tick = () => { if (!document.hidden) poll(); };
    poll(); // 立即建立基线
    timerRef.current = setInterval(tick, POLL_INTERVAL_MS);
    const onVisible = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  // 消费新文章计数：基线推进到已探测到的最新位置
  const consumeNewCount = useCallback(() => {
    if (latestRef.current) sinceRef.current = latestRef.current;
    setNewCount(0);
    return newCount;
  }, [newCount]);

  const clearLastEvent = useCallback(() => setLastEvent(null), []);

  return { newCount, lastEvent, consumeNewCount, clearLastEvent };
}
