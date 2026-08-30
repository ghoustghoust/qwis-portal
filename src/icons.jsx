import React from 'react';

// 内联 SVG 图标（与主系统 web/src/components/icons.jsx 同一风格）：
// 线性 stroke、1.5px 粗细、currentColor 着色、24×24 viewBox，无任何依赖

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

// 品牌 logo mark：雷达/信号波（同心圆弧 + 扫描线 + 目标点）
export function RadarLogo({ size = 24, ...rest }) {
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

// 今日日报：报纸
export function NewspaperIcon(props) {
  return (
    <Svg {...props}>
      <path d="M4 6.5h13v11a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2z" />
      <path d="M17 10.5h2.5a1 1 0 0 1 1 1v6a2 2 0 0 1-2 2" />
      <path d="M7.5 10h6M7.5 13.5h6M7.5 17h3.5" />
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

// 折叠箭头（配合 rotate 过渡动画）
export function ChevronDownIcon(props) {
  return (
    <Svg {...props}>
      <path d="m6 9.5 6 6 6-6" />
    </Svg>
  );
}

// 返回
export function ArrowLeftIcon(props) {
  return (
    <Svg {...props}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </Svg>
  );
}

// 外链
export function ExternalIcon(props) {
  return (
    <Svg {...props}>
      <path d="M14 4.5h5.5V10M19.5 4.5 11 13M9 5.5H6.5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V15" />
    </Svg>
  );
}

// 主题：太阳（浅色）
export function SunIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5 5l1.6 1.6M17.4 17.4 19 19M19 5l-1.6 1.6M6.6 17.4 5 19" />
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

// 合并同事件（两条支流汇入一条）
export function MergeIcon(props) {
  return (
    <Svg {...props}>
      <path d="M5.5 4c0 5.5 4.2 6.7 6.5 8.5 2.3-1.8 6.5-3 6.5-8.5" />
      <path d="M12 12.5V20" />
      <path d="m9 17.5 3 3 3-3" />
    </Svg>
  );
}

// 搜索
export function SearchIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </Svg>
  );
}
