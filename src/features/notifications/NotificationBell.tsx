import { useEffect, useRef, useState } from "react";
import { BellIcon } from "@phosphor-icons/react";
import { api } from "../../api/auth-api";
import { formatDateTime } from "../supervision/format";

type NotificationItem = {
  id: string;
  kind: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
};

export function NotificationBell() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const load = () => {
      if (document.visibilityState === "hidden") return;
      api<NotificationItem[]>("/notifications")
        .then((rows) => {
          if (active) setItems(rows);
        })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 30_000);
    window.addEventListener("focus", load);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, []);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const unread = items.filter((item) => !item.readAt);

  async function markAllRead() {
    await Promise.all(
      unread.map((item) =>
        api(`/notifications/${item.id}/read`, {}, "PATCH").catch(() => {}),
      ),
    );
    setItems((rows) =>
      rows.map((row) => ({
        ...row,
        readAt: row.readAt ?? new Date().toISOString(),
      })),
    );
  }

  return (
    <div className="notification-bell" ref={ref}>
      <button
        type="button"
        className="notification-bell__trigger"
        aria-label={
          unread.length
            ? `${unread.length} notification${unread.length > 1 ? "s" : ""} non lue${unread.length > 1 ? "s" : ""}`
            : "Notifications"
        }
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <BellIcon size={20} weight={unread.length ? "fill" : "regular"} />
        {!!unread.length && (
          <span className="notification-bell__count">{unread.length}</span>
        )}
      </button>
      {open && (
        <div
          className="notification-bell__menu"
          role="dialog"
          aria-label="Notifications"
        >
          <div className="notification-bell__head">
            <strong>Notifications</strong>
            {!!unread.length && (
              <button
                type="button"
                className="text-button"
                onClick={() => void markAllRead()}
              >
                Tout marquer comme lu
              </button>
            )}
          </div>
          {!items.length ? (
            <p className="notification-bell__empty">Aucune notification.</p>
          ) : (
            <ul className="notification-bell__list">
              {items.slice(0, 20).map((item) => (
                <li
                  key={item.id}
                  className={
                    item.readAt
                      ? "notification-bell__item"
                      : "notification-bell__item unread"
                  }
                >
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                  <time>{formatDateTime(item.createdAt)}</time>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
