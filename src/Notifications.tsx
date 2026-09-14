import { useEffect, useState } from 'react';
import { CheckCircleIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react';

export type NotificationType = 'success' | 'error';

export function notify(message: string, type: NotificationType = 'success') {
  window.dispatchEvent(
    CustomEvent ? new CustomEvent('uswap-notification', { detail: { message, type } }) : ({} as any)
  );
}

export function Notifications() {
  const [item, setItem] = useState<{ message: string; type: NotificationType; id: number } | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ message: string; type: NotificationType }>).detail;
      // Rétrocompatibilité si un simple string est passé
      const msg = typeof detail === 'string' ? detail : detail?.message;
      const type = typeof detail === 'string' ? 'success' : detail?.type || 'success';
      
      setItem({ message: msg, type, id: Date.now() });
    };

    window.addEventListener('uswap-notification', receive as EventListener);
    return () => window.removeEventListener('uswap-notification', receive as EventListener);
  }, []);

  useEffect(() => {
    if (!item || paused) return;
    const timer = setTimeout(() => setItem(null), 4000);
    return () => clearTimeout(timer);
  }, [item, paused]);

  if (!item) return null;

  const isError = item.type === 'error';

  return (
    <div className="notification-region" aria-live="polite" aria-atomic="true">
      <div
        className={`notification-toast ${item.type}`}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
        style={{
          borderLeftColor: isError ? '#dc2626' : '#22c55e',
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderLeftWidth: '4px',
          borderRadius: '8px',
          padding: '12px 16px',
          boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.12)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '12px',
          fontSize: '13px',
          fontWeight: 500,
          color: '#0f172a',
          pointerEvents: 'auto',
          width: 'fit-content',
          maxWidth: '420px',
        }}
      >
        <span className="toast-icon" style={{ color: isError ? '#dc2626' : '#22c55e', display: 'flex', alignItems: 'center' }}>
          {isError ? <WarningCircleIcon size={20} weight="fill" /> : <CheckCircleIcon size={20} weight="fill" />}
        </span>
        <span 
          className="toast-message" 
          style={{ whiteSpace: 'nowrap' }} // Empêche le texte de se couper sur deux lignes
        >
          {item.message}
        </span>
        <button
          type="button"
          className="toast-close"
          aria-label="Fermer la notification"
          onClick={() => {
            setItem(null);
            setPaused(false);
          }}
          style={{
            border: 0,
            background: 'transparent',
            color: '#94a3b8',
            cursor: 'pointer',
            padding: '4px',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
            marginLeft: '4px',
          }}
        >
          <XIcon size={16} />
        </button>
      </div>
    </div>
  );
}