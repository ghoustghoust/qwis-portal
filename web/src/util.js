import { toast } from './toast';

// 图片代理：这些域名在国内直连不可达(YouTube/FB CDN 等)或有防盗链校验(微信 mmbiz)，走服务端代理
const PROXY_IMG_HOSTS = /(^|\.)(ytimg\.com|ggpht\.com|fbcdn\.net|fbcdn\.com|youtube\.com|twitter\.com|twimg\.com|qpic\.cn|qlogo\.cn)$/i;
export function imgUrl(url) {
  if (!url || typeof url !== 'string') return url;
  try {
    const u = new URL(url);
    if (PROXY_IMG_HOSTS.test(u.hostname)) return `/api/img?u=${encodeURIComponent(url)}`;
  } catch { /* 原样返回 */ }
  return url;
}

// 相对时间（与后端 server/util/time.js 口径一致）：8h / 1天 / N天前
export function relativeTime(iso) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Date.now() - t;
  if (diff < 0) return '刚刚';
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min}分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 2) return '1天';
  return `${d}天前`;
}

// 纯日期：2026/8/15
export function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

// 完整日期时间：2026/8/15 08:00
export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 视频时长：秒 → mm:ss / h:mm:ss
export function formatDuration(sec) {
  if (sec === undefined || sec === null || Number.isNaN(Number(sec))) return '';
  const s = Math.max(0, Math.floor(Number(sec)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

// 复制到剪贴板 + toast「已添加到剪贴板」（F20）
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  toast('已添加到剪贴板');
}
