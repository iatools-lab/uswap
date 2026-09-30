import { useEffect, useState } from 'react';
import { BellIcon } from '@phosphor-icons/react';
import { api, rolePaths, type User } from '../../api/auth-api';

type Notice = {
  id: string;
  planningId: string;
  readAt: string | null;
};

export function PlanningInbox({ user }: { user: User }) {
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => {
    let active = true;

    const load = () => {
      if (document.visibilityState === 'hidden') return;
      api<Notice[]>('/plannings/notices')
        .then((rows) => {
          if (active) {
            setNotices(rows.filter((n) => !n.readAt));
          }
        })
        .catch(() => {});
    };

    load();

    const timer = setInterval(load, 30000);
    window.addEventListener('focus', load);

    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', load);
    };
  }, [user.id, user.role]);

  if (!notices.length) return null;

  const basePath = rolePaths[user.role] || '';
  const targetUrl = `${basePath}/plannings?planning=${encodeURIComponent(notices[0].planningId)}`;

  return (
    <a
      className="planning-inbox"
      href={targetUrl}
      aria-label={`${notices.length} planning${notices.length > 1 ? 's' : ''} non lu${notices.length > 1 ? 's' : ''}`}
    >
      <BellIcon size={20} weight="regular" />
      <span>
        {notices.length} planning{notices.length > 1 ? 's' : ''} à consulter
      </span>
    </a>
  );
}