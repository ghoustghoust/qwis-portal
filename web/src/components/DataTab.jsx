import { useCallback, useEffect, useState, useRef } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import { formatDateTime } from '../util';

// 数据管理 Tab（七期 T11/F6）：整库快照/恢复/列表 + 保留天数清理（预览→确认执行）+ 库体积与条目数
// 与一期「配置轻量迁移」备份（WechatTab 底部，sources/groups/settings JSON）并存不混：本页管整库搬迁
// 接口未就绪时整区优雅降级（禁用 + 提示）

const TABLE_LABELS = {
  sources: '订阅源',
  groups: '分组',
  articles: '文章',
  videos: '视频',
  pending_items: '待处理',
  daily_reports: '日报',
  settings: '设置',
  credentials: '登录态',
};

function fmtSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

// 快照条目字段兼容：file/name/filename、created_at/time/mtime、size/bytes
function snapName(s) {
  return s.file || s.name || s.filename || '';
}
function snapTime(s) {
  return s.created_at || s.time || s.mtime || null;
}

export default function DataTab() {
  const [ready, setReady] = useState(true); // /api/data 是否就绪
  const [stats, setStats] = useState(null);
  const [snaps, setSnaps] = useState([]);
  const [busy, setBusy] = useState(''); // snapshot | restore:file | preview | cleanup
  const [days, setDays] = useState(7);  // F6 Bug#1: 默认 7 天而非 90（符合 spec 要求）
  const [preview, setPreview] = useState(null); // 清理预览计数
  const [settings, setSettings] = useState(null); // 加载当前设置

  const loadStats = useCallback(async () => {
    try {
      const d = await api.get('/api/data/stats');
      setStats(d?.stats || d);
      setReady(true);
    } catch {
      setReady(false); // 后端接口施工中
    }
  }, []);

  // F6 Bug#2: 加载数据保留天数配置
  const loadRetentionSettings = useCallback(async () => {
    try {
      const d = await api.get('/api/settings');
      const retentionDays = d?.data?.retentionDays ?? 7;  // 默认 7 天
      setSettings(d);
      setDays(retentionDays);  // 用用户上次设置的值
    } catch (e) {
      console.error('加载保留天数配置失败:', e);
      setDays(7);  // 降级为默认值
    }
  }, []);

  const loadSnaps = useCallback(async () => {
    try {
      const d = await api.get('/api/data/list');
      const list = Array.isArray(d) ? d : d?.backups || d?.files || d?.items || d?.snapshots || [];
      setSnaps(list);
      setReady(true);
    } catch {
      setReady(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
    loadSnaps();
    loadRetentionSettings();  // F6 Bug#1: 初始化时加载用户设置的保留天数
  }, [loadStats, loadSnaps, loadRetentionSettings]);

  const doSnapshot = async () => {
    if (busy) return;
    setBusy('snapshot');
    try {
      const d = await api.post('/api/data/snapshot');
      toast(`快照已生成：${d?.file || d?.filename || 'app-*.db'}`);
      // F6 Bug#2: 生成成功后自动刷新统计
      await Promise.all([loadSnaps(), loadStats()]);
    } catch (e) {
      toast(e.message || '快照生成失败');
    } finally {
      setBusy('');
    }
  };

  // F6 问题#3: 新增快照导入功能（文件选择器）
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importingFile, setImportingFile] = useState(null);
  const fileInputRef = useRef(null);

  const openImportModal = () => {
    setImportModalOpen(true);
    // 强制重绘以支持多次点击
    setTimeout(() => {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }, 0);
  };

  const handleFileSelect = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !file.name.endsWith('.db')) {
      toast('请选择 .db 格式的快照文件');
      return;
    }
    // 验证文件名格式（与后端 datamgr.restore 的白名单一致）
    if (!/^app-[\w-]*\.db$/.test(file.name)) {
      toast('文件格式不正确，应为 app-YYYYMMDD-HHMMSS.db 格式');
      return;
    }
    await performImport(file);
  };

  // 真实导入：上传文件到 data/backups/ → 二次确认 → 调 /api/data/restore 整库回滚
  const performImport = async (file) => {
    if (busy) return;
    setBusy('import');
    setImportingFile(file.name);
    try {
      // 第一步：上传快照文件（application/octet-stream 原始字节流）
      const res = await fetch(`/api/data/upload?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
      });
      const up = await res.json().catch(() => null);
      if (!res.ok || !up || up.ok === false) throw new Error((up && up.error) || `上传失败 HTTP ${res.status}`);

      // 第二步：二次确认后执行整库恢复
      if (!window.confirm(`快照「${file.name}」已上传。\n\n确定用它覆盖当前整库数据？\n（订阅源/文章/视频/设置全部回滚到快照时点，操作不可撤销）`)) {
        await loadSnaps(); // 文件已在列表中，刷新即可
        return;
      }
      const r = await api.post('/api/data/restore', { file: file.name });
      toast(`快照恢复成功！已回滚 ${Object.keys(r?.restored || {}).length} 张表的数据`);
      setImportModalOpen(false);
      await Promise.all([loadSnaps(), loadStats(), loadRetentionSettings()]);
    } catch (e) {
      toast(e.message || '导入失败');
    } finally {
      setBusy('');
      setImportingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const doRestore = async (s) => {
    const file = snapName(s);
    if (!file || busy) return;
    if (!window.confirm(`确定用快照「${file}」覆盖当前整库数据？\n（订阅源/文章/视频/设置全部回滚到快照时点，操作不可撤销）`)) return;
    setBusy(`restore:${file}`);
    try {
      const r = await api.post('/api/data/restore', { file });
      toast(`快照恢复成功！已回滚 ${Object.keys(r?.restored || {}).length} 张表的数据`);
      // F6 Bug#2: 恢复成功后自动刷新统计和快照列表
      await Promise.all([loadSnaps(), loadStats(), loadRetentionSettings()]);
    } catch (e) {
      toast(e.message || '恢复失败');
    } finally {
      setBusy('');
    }
  };

  const doPreview = async () => {
    if (busy || !days) return;
    setBusy('preview');
    try {
      const d = await api.post('/api/data/cleanup/preview', { days: Number(days) });
      setPreview(d?.willDelete || d?.preview || d);
    } catch (e) {
      toast(e.message || '预览失败');
    } finally {
      setBusy('');
    }
  };

  const previewTotal = preview
    ? ['articles', 'videos', 'pending_items', 'daily_reports'].reduce((acc, k) => acc + (Number(preview[k]) || 0), 0)
    : 0;

  const doCleanup = async () => {
    if (busy || !days) return;
    if (!window.confirm(`确定删除 ${days} 天前的内容（共 ${previewTotal} 条）？\n订阅源、设置、日报记录、登录态不受影响。`)) return;
    setBusy('cleanup');
    try {
      const d = await api.post('/api/data/cleanup', { days: Number(days), confirm: true });
      const r = d?.deleted || d;
      const n = typeof r === 'number' ? r : ['articles', 'videos', 'pending_items', 'daily_reports'].reduce((acc, k) => acc + (Number(r?.[k]) || 0), 0);
      toast(`清理完成，共删除 ${n} 条`);
      setPreview(null);
      // F6 Bug#2: 清理成功后自动刷新统计和保存设置
      await loadStats();
      // 同步保存新的保留天数到后端
      await api.put('/api/settings', { 
        data: { retentionDays: Number(days) }
      });
    } catch (e) {
      toast(e.message || '清理失败');
    } finally {
      setBusy('');
    }
  };

  const dbSize = stats?.sizeBytes ?? stats?.size ?? stats?.bytes ?? stats?.size_bytes ?? stats?.dbSize;
  const tables = stats?.tables || stats?.counts || null;

  return (
    <div>
      {!ready && (
        <div className="card px-4 py-3 mb-4 text-[13px] t-muted">
          数据管理接口尚未就绪（后端施工中），以下为预览界面，操作暂不可用。
        </div>
      )}

      {/* 整库快照 */}
      <section className="card p-5">
        <h3 className="text-sm font-semibold t-text">整库快照</h3>
        <p className="mt-1 text-xs t-muted">
          一键生成 app.db 带 WAL 的安全拷贝（data/backups/app-*.db），用于整库搬迁/部署迁移；拷贝快照文件到新机器同目录启动即用。
          订阅源/分组/设置的「配置轻量迁移」备份在「公众号 RSS」Tab 底部，两者用途不同。
        </p>
        <div className="mt-3 flex items-center gap-3">
          <button className="btn-primary" disabled={!ready || !!busy} onClick={doSnapshot}>
            {busy === 'snapshot' ? '生成中…' : '生成快照'}
          </button>
          <button className="btn-ghost" disabled={!ready || !!busy} onClick={openImportModal}>
            导入快照
          </button>
          <span className="text-xs t-muted">恢复快照会整库回滚，需二次确认</span>
        </div>
        <div className="mt-4 card overflow-hidden">
          {snaps.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs t-muted">
              {ready ? '暂无快照' : '快照列表不可用（接口未就绪）'}
            </div>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="t-surface2 text-left">
                  <th className="px-4 py-2 font-medium t-muted text-xs">快照文件</th>
                  <th className="px-4 py-2 font-medium t-muted text-xs">时间</th>
                  <th className="px-4 py-2 font-medium t-muted text-xs">大小</th>
                  <th className="px-4 py-2 font-medium t-muted text-xs w-24">操作</th>
                </tr>
              </thead>
              <tbody>
                {snaps.map((s) => (
                  <tr key={snapName(s)} className="border-t t-border">
                    <td className="px-4 py-2 t-text font-mono text-xs">{snapName(s)}</td>
                    <td className="px-4 py-2 t-muted tabular-nums">{snapTime(s) ? formatDateTime(snapTime(s)) : '—'}</td>
                    <td className="px-4 py-2 t-muted tabular-nums">{fmtSize(s.sizeBytes ?? s.size ?? s.bytes)}</td>
                    <td className="px-4 py-2">
                      <button
                        className="btn-ghost !py-1 !px-2.5"
                        disabled={!ready || !!busy}
                        onClick={() => doRestore(s)}
                      >
                        {busy === `restore:${snapName(s)}` ? '恢复中…' : '恢复'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* 内容清理 */}
      <section className="card p-5 mt-6">
        <h3 className="text-sm font-semibold t-text">内容清理</h3>
        <p className="mt-1 text-xs t-muted">
          按保留天数清理老内容（文章/视频/待处理/日报候选）；订阅源、设置、日报记录、登录态不删。执行前先预览将删条数。
          <br />
          <span className="text-[12px]">💡 提示：此处设置的保留天数会自动保存到配置中，下次打开页面时自动恢复。</span>
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px]">
          <span className="t-muted">保留最近</span>
          <input
            type="number"
            min="1"
            className="input !w-24"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
          <span className="t-muted">天</span>
          <button className="btn-ghost" disabled={!ready || !!busy || !days} onClick={doPreview}>
            {busy === 'preview' ? '统计中…' : '预览将删条数'}
          </button>
        </div>
        {preview && (
          <div className="mt-3 card t-surface2 px-4 py-3 text-[13px]">
            <div className="t-text">
              保留 {days} 天：将删除
              {['articles', 'videos', 'pending_items', 'daily_reports']
                .filter((k) => Number(preview[k]) > 0)
                .map((k) => ` ${TABLE_LABELS[k] || k} ${preview[k]} 条`)
                .join('、') || ' 0 条'}
              ，共 <b>{previewTotal}</b> 条。
            </div>
            <button
              className="btn-primary mt-3"
              disabled={!!busy || previewTotal === 0}
              onClick={doCleanup}
            >
              {busy === 'cleanup' ? '清理中…' : '确认执行清理'}
            </button>
          </div>
        )}
      </section>

      {/* 存储统计 */}
      <section className="card p-5 mt-6">
        <h3 className="text-sm font-semibold t-text">存储统计</h3>
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
          <span className="t-muted">
            库体积：<b className="t-text tabular-nums">{fmtSize(dbSize)}</b>
          </span>
          <button className="btn-ghost !py-1 !px-2.5" disabled={!ready || !!busy} onClick={() => { loadStats(); loadSnaps(); }}>
            刷新
          </button>
        </div>
        {tables && (
          <div className="mt-3 card overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="t-surface2 text-left">
                  <th className="px-4 py-2 font-medium t-muted text-xs">表</th>
                  <th className="px-4 py-2 font-medium t-muted text-xs">条目数</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(tables).map(([k, v]) => (
                  <tr key={k} className="border-t t-border">
                    <td className="px-4 py-2 t-text">{TABLE_LABELS[k] || k}</td>
                    <td className="px-4 py-2 t-muted tabular-nums">{Number(v).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!tables && ready && <p className="mt-2 text-xs t-muted">暂无统计数据</p>}
      </section>

      {/* F6 问题#3: 快照导入模态框 */}
      {importModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="card rounded-xl shadow-2xl max-w-lg w-full mx-4 p-6">
            <h3 className="text-lg font-bold t-text mb-4">导入快照文件</h3>
            <div className="space-y-4">
              <div className="text-sm t-muted">
                <p className="mb-2">📋 使用说明：</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>选择本机的 <code className="t-surface2 px-1 rounded">app-YYYYMMDD-HHMMSS.db</code> 快照文件</li>
                  <li>文件会上传到服务器 <code className="t-surface2 px-1 rounded">data/backups/</code> 目录</li>
                  <li>二次确认后执行整库恢复（数据回滚）</li>
                </ol>
              </div>

              <div className="border-2 border-dashed t-border rounded-lg p-6 text-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".db"
                  className="hidden"
                  onChange={handleFileSelect}
                />
                <button
                  className="btn-primary w-full py-3"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!!busy}
                >
                  {importingFile ? `正在处理：${importingFile}` : '📂 选择快照文件'}
                </button>
                <p className="text-xs t-muted mt-2">仅支持 app-*.db 格式的快照文件</p>
              </div>

              <div className="flex gap-3">
                <button
                  className="btn-ghost flex-1"
                  onClick={() => {
                    setImportModalOpen(false);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  disabled={!!busy}
                >
                  取消
                </button>
                <button
                  className="btn-primary flex-1"
                  onClick={() => handleFileSelect({ target: { files: fileInputRef.current?.files || [] } })}
                  disabled={!fileInputRef.current?.files?.length || !!busy}
                >
                  {importingFile ? '恢复中…' : '💾 确认恢复'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
