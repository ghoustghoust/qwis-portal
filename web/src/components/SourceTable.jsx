// 通用订阅表格（F27）：columns = [{key, title, render?}]
// 增强版：支持分页、搜索、状态过滤
// （批量选择功能 2026-09-04 移除：选中后无任何批量操作消费方，属死功能）
// 2026-09-05 视觉精修：表头 text-xs t-muted + hairline；名称列前置 SourceAvatar(24)；导出状态徽章三态
import { useState, useMemo, useEffect } from 'react';
import { formatDateTime } from '../util';
import SourceAvatar from './ui/SourceAvatar.jsx';

// 状态徽章三态（管理台统一）：正常=badge-green、熔断中=badge-red（带 fail_count）、已停用/已退役=badge-gray
export function StatusBadge({ source: s }) {
  if (s.type === 'wemp') return <span className="badge-gray">已退役</span>;
  if (!s.enabled && (s.fail_count || 0) >= 3) {
    return <span className="badge-red" title="已熔断（连续失败≥3 次）">熔断中({s.fail_count})</span>;
  }
  if (!s.enabled) return <span className="badge-gray">已停用</span>;
  if (s.status === 'error') return <span className="badge-red" title={s.lastError || '刷新异常'}>异常</span>;
  return <span className="badge-green">正常</span>;
}

export default function SourceTable({ 
  columns, 
  rows, 
  empty = '暂无数据',
  pageSize: defaultPageSize = 20, // 每页显示数量
  searchPlaceholder = '搜索名称、URL、错误消息...', // 搜索框提示
  enableFilter = true, // 是否启用筛选器
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all, error, frozen, recent-fail
  const [currentPage, setCurrentPage] = useState(1);

  // 前端本地过滤 (优先方案)
  const filteredRows = useMemo(() => {
    let result = rows || [];
    
    // 搜索过滤（模糊匹配 name/url/extra.lastError）
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((r) => {
        const nameMatch = (r.name || '').toLowerCase().includes(q);
        const urlMatch = (r.url || '').toLowerCase().includes(q);
        let errorMatch = false;
        try {
          const extra = JSON.parse(r.extra || '{}');
          errorMatch = (extra.lastError || '').toLowerCase().includes(q);
        } catch {}
        return nameMatch || urlMatch || errorMatch;
      });
    }
    
    // 状态筛选
    if (statusFilter === 'error') {
      result = result.filter((r) => r.status === 'error' || (r.fail_count || 0) >= 3);
    } else if (statusFilter === 'frozen') {
      result = result.filter((r) => (r.fail_count || 0) >= 3 && r.enabled === 0);
    } else if (statusFilter === 'recent-fail') {
      const now = Date.now();
      const dayAgo = now - 24 * 60 * 60 * 1000;
      result = result.filter((r) => {
        try {
          const extra = JSON.parse(r.extra || '{}');
          if (extra.lastErrorAt) {
            const errTime = new Date(extra.lastErrorAt).getTime();
            return errTime > dayAgo;
          }
        } catch {}
        return false;
      });
    }
    
    return result;
  }, [rows, search, statusFilter]);

  // 分页计算
  const total = filteredRows.length;
  const totalPages = Math.ceil(total / defaultPageSize) || 1;
  const startIndex = (currentPage - 1) * defaultPageSize;
  const paginatedRows = filteredRows.slice(startIndex, startIndex + defaultPageSize);

  // 重置到第一页
  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusFilter]);

  return (
    <div className="card overflow-hidden">
      {/* 工具栏 */}
      {enableFilter && (
        <div className="px-4 py-3 border-b hairline t-surface flex items-center gap-3 flex-wrap">
          {/* 搜索框 */}
          <input
            type="text"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input !w-64 text-xs"
          />

          {/* 状态筛选器 */}
          <select
            className="input !w-48 text-xs"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">全部</option>
            <option value="error">刷新异常</option>
            <option value="frozen">已熔断 (N)</option>
            <option value="recent-fail">最近失败</option>
          </select>
        </div>
      )}

      {/* 表格 */}
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b hairline text-left">
            {columns.map((c) => (
              <th key={c.key} className="px-4 py-2.5 font-medium t-muted text-xs">
                {c.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {paginatedRows.map((r, i) => (
            <tr 
              key={r.id ?? i} 
              className="border-t t-border"
            >
              {columns.map((c) => (
                <td 
                  key={c.key} 
                  className="px-4 py-2.5 t-text align-middle"
                  title={c.key === 'name' ? undefined : r[c.key]}
                >
                  {c.key === 'name' ? (
                    <div className="flex items-center gap-2 min-w-0">
                      <SourceAvatar name={r.name} avatar={r.avatar} size={24} />
                      <div className="min-w-0 flex-1">{c.render ? c.render(r) : r[c.key] ?? '—'}</div>
                    </div>
                  ) : (
                    c.render ? c.render(r) : r[c.key] ?? '—'
                  )}
                </td>
              ))}
            </tr>
          ))}
          {paginatedRows.length === 0 && (
            <tr>
              <td 
                colSpan={columns.length} 
                className="px-4 py-8 text-center text-xs t-muted"
              >
                {search || statusFilter !== 'all' ? '暂无匹配的订阅源' : empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* 分页控件 */}
      {totalPages > 1 && (
        <div className="px-4 py-3 border-t t-border flex items-center justify-between text-xs t-muted">
          <span>
            第 {currentPage} 页 / 共 {totalPages} 页，总计 {total} 条
          </span>
          <div className="flex items-center gap-2">
            <button
              className="btn-ghost"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(currentPage - 1)}
            >
              ← 上一页
            </button>
            <span className="min-w-[100px] text-center">
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(n => Math.abs(n - currentPage) <= 2 || n === 1 || n === totalPages)
                .map(n => (
                  <button
                    key={n}
                    className={`inline-block w-8 h-8 text-center rounded ${currentPage === n ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setCurrentPage(n)}
                  >
                    {n}
                  </button>
                ))}
            </span>
            <button
              className="btn-ghost"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(currentPage + 1)}
            >
              下一页 →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
