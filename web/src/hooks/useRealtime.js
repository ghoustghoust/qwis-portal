// SSE 实时推送 Hook
// 职责：连接后端 /api/events，新文章到达时触发回调（Toast + 列表刷新）
// 设计：自动重连（指数退避）、页面可见时保持连接、不可见时断开节省资源

import { useCallback, useEffect, useRef, useState } from 'react';

const SSE_URL = '/api/events';
// 重连退避：1s → 2s → 4s → 8s → 最大 30s
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

export function useRealtime() {
  const [newCount, setNewCount] = useState(0); // 未处理的新文章计数
  const [lastEvent, setLastEvent] = useState(null); // 最近一条事件
  const esRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectDelayRef = useRef(RECONNECT_BASE_MS);

  const connect = useCallback(() => {
    // 防止重复连接
    if (esRef.current) return;

    const es = new EventSource(SSE_URL);
    esRef.current = es;

    es.addEventListener('connected', () => {
      reconnectDelayRef.current = RECONNECT_BASE_MS; // 重置退避
    });

    es.addEventListener('new_articles', (e) => {
      try {
        const data = JSON.parse(e.data);
        setNewCount((c) => c + (data.count || 1));
        setLastEvent({ type: 'new_articles', ...data });
      } catch { /* 忽略解析错误 */ }
    });

    es.addEventListener('translation', (e) => {
      try {
        const data = JSON.parse(e.data);
        setLastEvent({ type: 'translation', ...data });
      } catch { /* 忽略解析错误 */ }
    });

    es.addEventListener('source_update', (e) => {
      try {
        const data = JSON.parse(e.data);
        setLastEvent({ type: 'source_update', ...data });
      } catch { /* 忽略解析错误 */ }
    });

    es.onerror = () => {
      es.close();
      esRef.current = null;
      // 指数退避重连
      const delay = reconnectDelayRef.current;
      reconnectTimerRef.current = setTimeout(() => {
        reconnectDelayRef.current = Math.min(delay * 2, RECONNECT_MAX_MS);
        connect();
      }, delay);
    };

    // 页面不可见时断开连接（节省资源），可见时重连
    const onVisibility = () => {
      if (document.hidden) {
        es.close();
        esRef.current = null;
      } else if (!esRef.current) {
        connect();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // 清理函数（组件卸载时调用）
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      es.close();
      esRef.current = null;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const cleanup = connect();
    return cleanup;
  }, [connect]);

  // 消费新文章计数（重置为 0 并返回之前的值）
  const consumeNewCount = useCallback(() => {
    setNewCount(0);
    return newCount;
  }, [newCount]);

  // 清除最近事件
  const clearLastEvent = useCallback(() => setLastEvent(null), []);

  return { newCount, lastEvent, consumeNewCount, clearLastEvent };
}
