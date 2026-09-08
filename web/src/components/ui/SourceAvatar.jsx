import React, { useState } from 'react';
import { imgUrl } from '../../util.js';

// 源头像（2026-09-05 视觉精修）：有 avatar 图则用图（防盗链域名走 /api/img 代理），
// 无图/加载失败时回退为首字圆角块
export default function SourceAvatar({ name = '', avatar, size = 32, className = '' }) {
  const [broken, setBroken] = useState(false);
  const first = (name || '?').trim().charAt(0) || '?';
  const style = { width: size, height: size, fontSize: Math.round(size * 0.44) };
  if (!avatar || broken) {
    return (
      <span className={`avatar-fallback ${className}`} style={style} aria-hidden="true">
        {first}
      </span>
    );
  }
  return (
    <img
      src={imgUrl(avatar)}
      alt=""
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setBroken(true)}
      className={`rounded-lg object-cover flex-none ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
