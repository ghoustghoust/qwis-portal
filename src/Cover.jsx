import { useState } from 'react';

// 封面图：加载失败自动隐藏；mmbiz 等微信图需 no-referrer
export function Cover({ src, alt = '', className = '' }) {
  const [hide, setHide] = useState(false);
  if (!src || hide) return null;
  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      loading="lazy"
      className={className}
      onError={() => setHide(true)}
    />
  );
}
