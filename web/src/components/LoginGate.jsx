import { useEffect, useState } from 'react';
import LoginModal from './LoginModal.jsx';
import { isLoggedIn } from '../auth';

// 全局登录门槛（2026-09-05 P0 鉴权链路）
// - blocking（管理台）：挂载时无 token 立即强制登录，登录成功后刷新页面重放全部数据加载
// - 非 blocking（读者端）：监听 api.js 广播的 'qwis:unauthorized'（写操作 401）按需弹出，可关闭继续只读
export default function LoginGate({ blocking = false }) {
  const [show, setShow] = useState(() => blocking && !isLoggedIn());

  useEffect(() => {
    const onUnauth = () => setShow(true);
    window.addEventListener('qwis:unauthorized', onUnauth);
    return () => window.removeEventListener('qwis:unauthorized', onUnauth);
  }, []);

  if (!show) return null;
  return (
    <LoginModal
      blocking={blocking}
      onClose={() => setShow(false)}
      onSuccess={() => {
        setShow(false);
        if (blocking) window.location.reload(); // 管理台：登录后整页重放，避免逐组件补刷
      }}
    />
  );
}
