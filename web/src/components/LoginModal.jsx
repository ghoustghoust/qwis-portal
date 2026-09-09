import { useState } from 'react';
import { login } from '../auth';
import { useI18n } from '../i18n.jsx';

// 登录弹窗（2026-09-05 P0 鉴权链路）
// blocking=true 时（管理台）不显示关闭按钮，必须登录才能进入
// 2026-09-05 视觉精修：去掉用户名预填 admin（安全点），输入 .input / 登录 btn-primary 全宽 / 暂不登录 btn-ghost 全宽
export default function LoginModal({ blocking = false, onClose, onSuccess }) {
  const { t } = useI18n();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!username.trim() || !password) {
      setError(t('login.inputRequired'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await login(username.trim(), password);
      if (onSuccess) onSuccess();
      if (onClose) onClose();
    } catch (e) {
      setError(e.message || t('login.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={blocking ? undefined : onClose}
    >
      <div className="card w-full max-w-[360px] p-6" onClick={(e) => e.stopPropagation()}>
        {/* 标题区 */}
        <div className="text-center">
          <div className="text-base font-bold t-text">{t('login.title')}</div>
          <div className="mt-1 text-xs t-muted">{t('login.subtitle')}</div>
        </div>
        <div className="mt-5 space-y-3">
          <div>
            <div className="text-xs t-muted mb-1">{t('login.username')}</div>
            <input
              className="input"
              value={username}
              placeholder={t('login.username')}
              autoComplete="username"
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div>
            <div className="text-xs t-muted mb-1">{t('login.password')}</div>
            <input
              className="input"
              type="password"
              value={password}
              placeholder={t('login.password')}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              autoFocus
            />
          </div>
          {error && (
            <div className="text-[12px]" style={{ color: 'var(--red)' }}>
              {error}
            </div>
          )}
          <button className="btn-primary w-full !py-2" disabled={busy} onClick={submit}>
            {busy ? t('login.logging') : t('login.submit')}
          </button>
          {!blocking && (
            <button className="btn-ghost w-full !py-2" onClick={onClose}>
              {t('login.skip')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
