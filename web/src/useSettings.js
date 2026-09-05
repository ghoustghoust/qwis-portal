import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

// 设置读写（GET/PUT /api/settings，分区读写；PUT 敏感字段留空不覆盖）
export function useSettings() {
  const [settings, setSettings] = useState(null);
  const load = useCallback(async () => {
    try {
      const data = await api.get('/api/settings');
      setSettings(data?.settings || data || {});
    } catch (e) {
      setSettings({});
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const save = useCallback(
    async (section) => {
      await api.put('/api/settings', section);
      await load();
    },
    [load]
  );
  return { settings, save, reload: load };
}

// 状态汇总（GET /api/status，三 Tab 状态卡数据）
export function useStatus() {
  const [status, setStatus] = useState(null);
  const load = useCallback(async () => {
    try {
      const data = await api.get('/api/status');
      setStatus(data || {});
    } catch (e) {
      setStatus(null);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  return { status, reload: load };
}
