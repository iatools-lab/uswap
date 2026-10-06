import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import {
  BellIcon,
  CaretRightIcon,
  SlidersHorizontalIcon,
} from "@phosphor-icons/react";
import { api, usingMock } from "../../api/auth-api";
import { useSession } from "../../app/session";
import { formatDateTime } from "../supervision/format";

/** En dessous de cette largeur, le panneau devient une feuille ancrée en bas. */
const SHEET_MAX_WIDTH = 620;
/** Marge minimale conservée entre le panneau et les bords de la fenêtre. */
const VIEWPORT_GAP = 12;
/** Écart vertical entre le bouton et le panneau. */
const ANCHOR_OFFSET = 10;

type Placement = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

type NotificationItem = {
  id: string;
  kind: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  /** Deep link fourni par l’API vers la ressource à l’origine de l’événement. */
  targetUrl?: string | null;
  targetId?: string | null;
};

type NotificationCategory =
  | "PLANNING"
  | "ATTENDANCE"
  | "OPERATIONS"
  | "LEAVE"
  | "INCIDENT"
  | "ACCESS"
  | "OTHER";

function notificationBodyFor(
  item: NotificationItem,
  userName: string,
  role: string,
) {
  if (role !== "SWAPPER" || !userName.trim()) return item.body;
  const prefix = item.body.slice(0, userName.length);
  if (prefix.toLocaleLowerCase("fr") !== userName.toLocaleLowerCase("fr"))
    return item.body;

  const detail = item.body
    .slice(userName.length)
    .replace(/^\s*[·:–—-]?\s*/, "");
  if (
    item.kind === "AUTOMATIC_ABSENCE" ||
    /^n['’]a pas enregistré sa fin de service/i.test(detail)
  )
    return detail.replace(
      /^n['’]a pas enregistré sa fin de service/i,
      "Vous n'avez pas enregistré votre fin de service",
    );
  if (item.kind === "CHECKIN" && /^a pointé\b/i.test(detail))
    return detail.replace(/^a pointé/i, "Vous avez pointé");
  if (item.kind === "LATE" && /^a pointé\b/i.test(detail))
    return detail.replace(/^a pointé/i, "Vous avez pointé");
  if (item.kind === "CHECKOUT")
    return `Votre fin de service pour le shift ${detail} a été enregistrée.`;
  if (item.kind === "ABSENCE_DECLARED")
    return `Vous avez signalé une absence pour ${detail}.`;

  return detail
    ? `Vous êtes concerné : ${detail}`
    : "Cette notification vous concerne.";
}

const categoryFor = (kind: string): NotificationCategory => {
  if (kind.startsWith("PLANNING_")) return "PLANNING";
  if (kind.includes("LEAVE")) return "LEAVE";
  if (kind.includes("INCIDENT")) return "INCIDENT";
  if (["REPLACEMENT", "REPLACEMENT_NEEDED"].includes(kind)) return "OPERATIONS";
  if (kind === "ACCESS_PENDING") return "ACCESS";
  if (
    [
      "CHECKIN",
      "CHECKOUT",
      "CORRECTION",
      "AUTOMATIC_ABSENCE",
      "ABSENCE_DECLARED",
      "ABSENCE",
      "LATE",
      "CHECKIN_REMINDER",
    ].includes(kind)
  )
    return "ATTENDANCE";
  return "OTHER";
};

const categoryLabels: Record<NotificationCategory, string> = {
  PLANNING: "Plannings",
  ATTENDANCE: "Pointages",
  OPERATIONS: "Opérations",
  LEAVE: "Congés",
  INCIDENT: "Incidents",
  ACCESS: "Accès",
  OTHER: "Autres",
};

export function NotificationBell() {
  const { session } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<NotificationCategory | "ALL">("ALL");
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
        maxHeight: Math.max(
          180,
          vh - rect.bottom - ANCHOR_OFFSET - VIEWPORT_GAP,
        ),
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
  const categoryCounts = items.reduce<Record<NotificationCategory, number>>(
    (counts, item) => {
      counts[categoryFor(item.kind)] += 1;
      return counts;
    },
    {
      PLANNING: 0,
      ATTENDANCE: 0,
      OPERATIONS: 0,
      LEAVE: 0,
      INCIDENT: 0,
      ACCESS: 0,
      OTHER: 0,
    },
  );
  const availableCategories = (
    Object.keys(categoryLabels) as NotificationCategory[]
  ).filter((key) => categoryCounts[key] > 0);
  const visibleItems = items.filter(
    (item) => category === "ALL" || categoryFor(item.kind) === category,
  );

  async function markAllRead() {
    const pending = unread;
    if (usingMock) {
      await api("/notifications/read-all", {}, "PATCH").catch(() => {});
      const readAt = new Date().toISOString();
      setItems((rows) =>
        rows.map((row) => ({ ...row, readAt: row.readAt ?? readAt })),
      );
      return;
    }

    const results = await Promise.allSettled(
      pending.map((item) => api(`/notifications/${item.id}/read`, {}, "PATCH")),
    );
    const readIds = new Set(
      results.flatMap((result, index) =>
        result.status === "fulfilled" ? [pending[index].id] : [],
      ),
    );
    const readAt = new Date().toISOString();
    setItems((rows) =>
      rows.map((row) =>
        readIds.has(row.id) ? { ...row, readAt: row.readAt ?? readAt } : row,
      ),
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
        : "/app/mon-espace";
    const suppliedTarget = item.targetUrl?.trim();
    // N’accepter que des chemins internes ; une notification ne doit jamais
    // pouvoir rediriger vers un site externe.
    const safeTarget =
      suppliedTarget?.startsWith("/") && !suppliedTarget.startsWith("//")
        ? suppliedTarget
        : null;
    const isAttendance = categoryFor(item.kind) === "ATTENDANCE";
    const isPunchReminder = item.kind === "CHECKIN_REMINDER";
    const destination =
      safeTarget ??
      (item.kind === "ACCESS_PENDING"
        ? item.targetId
          ? `/app/admin/utilisateurs/${encodeURIComponent(item.targetId)}`
          : "/app/admin/utilisateurs?status=pending"
        : item.kind.startsWith("PLANNING_") || item.kind === "ASSIGNMENT"
          ? `${basePath}/plannings${item.targetId ? `?planning=${encodeURIComponent(item.targetId)}` : ""}`
          : item.kind.includes("LEAVE")
            ? basePath === "/app/mon-espace"
              ? `${basePath}/conges${item.targetId ? `?leave=${encodeURIComponent(item.targetId)}` : ""}`
              : `${basePath}${item.targetId ? `?leave=${encodeURIComponent(item.targetId)}` : ""}`
            : item.kind.includes("INCIDENT")
              ? `${basePath}${item.targetId ? `?incident=${encodeURIComponent(item.targetId)}` : ""}`
              : categoryFor(item.kind) === "OPERATIONS"
                ? basePath === "/app/supervision"
                  ? `${basePath}${item.targetId ? `?replacement=${encodeURIComponent(item.targetId)}` : ""}`
                  : basePath === "/app/mon-espace"
                    ? `${basePath}${item.targetId ? `?pointage=${encodeURIComponent(item.targetId)}` : ""}`
                    : `${basePath}${item.targetId ? `?shift=${encodeURIComponent(item.targetId)}` : ""}`
                : isAttendance && basePath === "/app/supervision"
                  ? `${basePath}/pointages${item.targetId ? `?shift=${encodeURIComponent(item.targetId)}` : ""}`
                  : isAttendance && basePath === "/app/mon-espace"
                    ? isPunchReminder
                      ? `${basePath}${item.targetId ? `?shift=${encodeURIComponent(item.targetId)}` : ""}`
                      : `${basePath}?historique=pointages${item.targetId ? `&pointage=${encodeURIComponent(item.targetId)}` : ""}`
                    : basePath);
    setOpen(false);
    navigate(destination);
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
                  Tout marquer lu
                </button>
              )}
            </div>
            <div
              className="notification-bell__categories"
              role="group"
              aria-label="Filtrer par catégorie"
            >
              <button
                type="button"
                aria-pressed={category === "ALL"}
                onClick={() => setCategory("ALL")}
              >
                Toutes <span>{items.length}</span>
              </button>
              {availableCategories.map((key) => (
                <button
                  type="button"
                  key={key}
                  aria-pressed={category === key}
                  onClick={() => setCategory(key)}
                >
                  {categoryLabels[key]} <span>{categoryCounts[key]}</span>
                </button>
              ))}
            </div>
            {!visibleItems.length ? (
              <p className="notification-bell__empty">
                {category === "ALL"
                  ? "Aucune notification pour le moment."
                  : `Aucune notification dans ${categoryLabels[category]}.`}
              </p>
            ) : (
              <ul className="notification-bell__list">
                {visibleItems.slice(0, 20).map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={
                        item.readAt
                          ? "notification-bell__item"
                          : "notification-bell__item unread"
                      }
                      aria-label={`Ouvrir ${item.title}`}
                      onClick={() => void openNotification(item)}
                    >
                      <span className="notification-bell__content">
                        <span className="notification-bell__title-row">
                          <strong>{item.title}</strong>
                        </span>
                        <span className="notification-bell__body">
                          {notificationBodyFor(
                            item,
                            session?.user.fullName ?? "",
                            session?.user.role ?? "",
                          )}
                        </span>
                        <span className="notification-bell__meta">
                          <time>{formatDateTime(item.createdAt)}</time>
                          <span>{categoryLabels[categoryFor(item.kind)]}</span>
                        </span>
                        <span className="notification-bell__action">
                          {item.kind === "ACCESS_PENDING"
                            ? "Examiner les accès"
                            : item.kind.startsWith("PLANNING_") ||
                                item.kind === "ASSIGNMENT"
                              ? "Voir le planning"
                              : item.kind.includes("LEAVE")
                                ? "Voir la demande de congé"
                                : item.kind.includes("INCIDENT")
                                  ? "Voir l’incident"
                                  : item.kind === "CHECKIN_REMINDER"
                                    ? "Pointer mon service"
                                    : categoryFor(item.kind) === "ATTENDANCE"
                                      ? "Voir le pointage"
                                      : item.kind === "REPLACEMENT_NEEDED"
                                        ? "Voir le remplacement"
                                        : "Ouvrir le suivi"}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className="notification-bell__preferences"
              onClick={() => {
                setOpen(false);
                const base = location.pathname.startsWith("/app/admin")
                  ? "/app/admin"
                  : location.pathname.startsWith("/app/supervision")
                    ? "/app/supervision"
                    : "/app/mon-espace";
                navigate(`${base}/compte?section=notifications`);
              }}
            >
              <SlidersHorizontalIcon size={15} weight="duotone" /> Gérer mes
              préférences <CaretRightIcon size={15} weight="bold" />
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
