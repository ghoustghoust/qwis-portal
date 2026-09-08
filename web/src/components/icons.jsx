import React from 'react';

// 内联 SVG 图标库（线性 stroke 风格：1.5px 粗细、currentColor 着色、圆角端点）
// 统一 24×24 viewBox；size 默认 18；不引入任何图标依赖

function Svg({ size = 18, children, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

// 阅读器：RSS 信号
export function RssIcon(props) {
  return (
    <Svg {...props}>
      <path d="M4.5 11a8.5 8.5 0 0 1 8.5 8.5" />
      <path d="M4.5 4.5a15 15 0 0 1 15 15" />
      <circle cx="5.5" cy="18.5" r="1.4" fill="currentColor" stroke="none" />
    </Svg>
  );
}

// 每日情报：日历
export function CalendarIcon(props) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M8 3v4M16 3v4M3.5 10.5h17" />
    </Svg>
  );
}

// 热点榜：火焰
export function FlameIcon(props) {
  return (
    <Svg {...props}>
      <path d="M12 3c.9 2.7 3.6 4.1 3.6 7.1a3.6 3.6 0 0 1-7.2 0c0-1.2.4-2.2 1-3 .4.9 1 1.5 1.9 1.8-.5-2-.3-4.2.7-5.9z" />
    </Svg>
  );
}

// 订阅设置：齿轮
export function GearIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.2 5.2l1.8 1.8M17 17l1.8 1.8M18.8 5.2 17 7M7 17l-1.8 1.8" />
    </Svg>
  );
}

// 主题切换：日月各半（备用通用图标）
export function SunMoonIcon(props) {
  return (
    <Svg {...props}>
      <path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z" />
      <path d="M12 3v2M5.6 5.6l1.4 1.4M3 12h2" />
    </Svg>
  );
}

// 主题：晴（暖色纸张）
export function SunIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5 5l1.6 1.6M17.4 17.4 19 19M19 5l-1.6 1.6M6.6 17.4 5 19" />
    </Svg>
  );
}

// 主题：波浪（蓝白）
export function WavesIcon(props) {
  return (
    <Svg {...props}>
      <path d="M3 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />
      <path d="M3 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />
    </Svg>
  );
}

// 主题：月亮（深色）
export function MoonIcon(props) {
  return (
    <Svg {...props}>
      <path d="M20 13.5A8 8 0 0 1 10.5 4a8 8 0 1 0 9.5 9.5z" />
    </Svg>
  );
}

// 视图导航：全部（文档）
export function DocIcon(props) {
  return (
    <Svg {...props}>
      <path d="M6.5 3.5h7.5l4 4v13h-11.5z" />
      <path d="M14 3.5v4h4M9.5 12h5M9.5 15.5h5" />
    </Svg>
  );
}

// 稍后阅读：心形
export function HeartIcon(props) {
  return (
    <Svg {...props}>
      <path d="M12 20.5C7.5 16.3 3.8 13.2 3.8 9.6A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 8.2 2.6c0 3.6-3.7 6.7-8.2 10.9z" />
    </Svg>
  );
}

// 历史存档：时钟
export function ClockIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5.2l3.2 1.9" />
    </Svg>
  );
}

// 全部视频：播放
export function PlayIcon(props) {
  return (
    <Svg {...props}>
      <path d="M7.5 5.2 18.5 12 7.5 18.8z" />
    </Svg>
  );
}

// 收藏：星
export function StarIcon(props) {
  return (
    <Svg {...props}>
      <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" />
    </Svg>
  );
}

// 折叠箭头（配合 CSS rotate 动画）
export function ChevronDownIcon(props) {
  return (
    <Svg {...props}>
      <path d="m6 9.5 6 6 6-6" />
    </Svg>
  );
}

// 手动刷新
export function RefreshIcon(props) {
  return (
    <Svg {...props}>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M20 3.5v4.3h-4.3" />
    </Svg>
  );
}

// 新建
export function PlusIcon(props) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

// 删除/关闭
export function XIcon(props) {
  return (
    <Svg {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </Svg>
  );
}

// 品牌 logo mark：雷达/信号波（同心圆弧 + 扫描线 + 目标点）
// 悬停时扫描线旋转（动画见 index.css .logo-radar）
export function RadarLogo({ size = 28, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      role="img"
      aria-label="全网情报系统"
      {...rest}
    >
      <circle cx="12" cy="12" r="9.2" />
      <circle cx="12" cy="12" r="5.6" opacity="0.55" />
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      <line className="radar-sweep" x1="12" y1="12" x2="19.6" y2="7.2" />
      <circle cx="16.4" cy="8.4" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

// 外链（新窗口打开）
export function ExternalIcon(props) {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M14 4.5h5.5V10M19.5 4.5 11 13M9 5.5H6.5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V15" />
    </svg>
  );
}

// 铃铛（报警渠道类型卡片）
export function BellIcon(props) {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9z" />
      <path d="M10 20a2.2 2.2 0 0 0 4 0" />
    </svg>
  );
}

// 合并同事件（两条支流汇入一条）
export function MergeIcon(props) {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M5.5 4c0 5.5 4.2 6.7 6.5 8.5 2.3-1.8 6.5-3 6.5-8.5" />
      <path d="M12 12.5V20" />
      <path d="m9 17.5 3 3 3-3" />
    </svg>
  );
}

// 文件夹
export function FolderIcon(props) {
  return (
    <Svg {...props}>
      <path d="M3 7.5V19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9.5a2 2 0 0 0-2-2h-7.5L9 4.5H5a2 2 0 0 0-2 2z" />
    </Svg>
  );
}

// 搜索
export function SearchIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m16.5 16.5 4 4" />
    </Svg>
  );
}

// 筛选
export function FilterIcon(props) {
  return (
    <Svg {...props}>
      <path d="M3 5h18l-7 9v5l-4 2v-7z" />
    </Svg>
  );
}

// 自动分类（闪光星）
export function SparklesIcon(props) {
  return (
    <Svg {...props}>
      <path d="M12 3v4M12 17v4M5 12H1M23 12h-4" />
      <path d="m6.3 6.3 2.1 2.1M15.6 15.6l2.1 2.1M6.3 17.7l2.1-2.1M15.6 8.4l2.1-2.1" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

// 锁定
export function LockIcon(props) {
  return (
    <Svg {...props}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Svg>
  );
}

// 源库（书架）
export function LibraryIcon(props) {
  return (
    <Svg {...props}>
      <path d="M4 4h4v16H4zM10 4h4v16h-4zM16 6l4 1-3 15-4-1z" />
    </Svg>
  );
}

// 我的阅读（打开的书）
export function BookIcon(props) {
  return (
    <Svg {...props}>
      <path d="M4 4.5C6 3.5 8.5 3 12 4c3.5-1 6-.5 8 .5v14c-2-1-4.5-1.5-8-.5-3.5-1-6-.5-8 .5z" />
      <path d="M12 4v14.5" />
    </Svg>
  );
}
