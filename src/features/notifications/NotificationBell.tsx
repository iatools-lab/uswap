import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { BellIcon } from "@phosphor-icons/react";
import { api } from "../../api/auth-api";
import { formatDateTime } from "../supervision/format";

/** En dessous de cette largeur, le panneau devient une feuille ancrée en bas. */
const SHEET_MAX_WIDTH = 620;
/** Marge minimale conservée entre le panneau et les bords de la fenêtre. */
const VIEWPORT_GAP = 12;
/** Écart vertical entre le bouton et le panneau. */
const ANCHOR_OFFSET = 10;

type Placement = { top: number; left: number; width: number; maxHeight: number };

type NotificationItem = {
  id: string;
  kind: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
};

export function NotificationBell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const sheet = useRef(false);

  /**
   * Le panneau est rendu dans un portail et positionné d'après la position
   * réelle du bouton à l'écran : il ne peut donc jamais être rogné par un
   * conteneur parent (barre supérieure, zone de contenu…) et reste toujours
   * entièrement visible, quel que soit la taille de l'écran.
   */
  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Petit écran : panneau en feuille fixée en bas, pleine largeur.
    if (vw <= SHEET_MAX_WIDTH) {
      sheet.current = true;
      setPlacement({
        top: rect.bottom + ANCHOR_OFFSET,
        left: VIEWPORT_GAP,
        width: vw - VIEWPORT_GAP * 2,
        maxHeight: Math.max(180, vh - rect.bottom - ANCHOR_OFFSET - VIEWPORT_GAP),
      });
      return;
    }

    // Grand écran : panneau ancré au bouton, aligné à droite, borné au viewport.
    sheet.current = false;
    const width = Math.min(360, vw - VIEWPORT_GAP * 2);
    const left = Math.min(
      Math.max(VIEWPORT_GAP, rect.right - width),
      vw - width - VIEWPORT_GAP,
    );
    setPlacement({
      top: rect.bottom + ANCHOR_OFFSET,
      left,
      width,
      maxHeight: Math.max(200, vh - rect.bottom - ANCHOR_OFFSET - VIEWPORT_GAP),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    place();
    const onScrollOrResize = () => place();
    window.addEventListener("resize", onScrollOrResize);
    // Le défilement se propage depuis la zone de contenu : on écoute en capture
    // pour repositionner le panneau même lorsque l'événement vient d'un enfant.
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, place]);

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
      const target = event.target as Node;
      if (ref.current?.contains(target)) return;
      // Le panneau vit dans un portail : il faut tester les deux racines.
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
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

  async function openNotification(item: NotificationItem) {
    if (!item.readAt) {
      await api(`/notifications/${item.id}/read`, {}, "PATCH").catch(() => {});
      setItems((rows) =>
        rows.map((row) =>
          row.id === item.id
            ? { ...row, readAt: new Date().toISOString() }
            : row,
        ),
      );
    }
    const basePath = location.pathname.startsWith("/app/admin")
      ? "/app/admin"
      : location.pathname.startsWith("/app/supervision")
        ? "/app/supervision"
        : location.pathname.startsWith("/app/station")
          ? "/app/station"
          : "/app/mon-espace";
    const destination =
      item.kind === "ACCESS_PENDING"
        ? "/app/admin/utilisateurs?status=pending"
        : item.kind.startsWith("PLANNING_")
          ? `${basePath}/plannings`
          : basePath;
    if (destination) {
      setOpen(false);
      navigate(destination);
    }
  }

  return (
    <div className="notification-bell" ref={ref}>
      <button
        type="button"
        ref={triggerRef}
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
      {open &&
        placement &&
        createPortal(
          <div
            ref={menuRef}
            className={
              "notification-bell__menu" + (sheet.current ? " is-sheet" : "")
            }
            role="dialog"
            aria-label="Notifications"
            style={{
              top: placement.top,
              left: placement.left,
              width: placement.width,
              maxHeight: placement.maxHeight,
            }}
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
                  <button
                    type="button"
                    className="notification-bell__action"
                    onClick={() => void openNotification(item)}
                  >
                    {item.kind === "ACCESS_PENDING"
                      ? "Examiner les comptes"
                      : item.kind.startsWith("PLANNING_")
                        ? "Ouvrir le planning"
                        : location.pathname.startsWith("/app/admin")
                          ? "Revenir à l’accueil"
                          : "Ouvrir les opérations"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          </div>,
          document.body,
        )}
    </div>
  );
}
