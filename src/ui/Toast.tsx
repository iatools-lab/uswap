import { useCallback, useEffect, useState } from "react";
import { CheckCircleIcon, InfoIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import "./ui.css";

export type NotificationType = "success" | "error" | "info";

type ToastItem = { id: number; message: string; type: NotificationType };

/** Durée d'affichage d'une notification (ms) avant disparition automatique. */
const TOAST_DURATION = 3200;
/** Nombre maximum de notifications empilées simultanément. */
const MAX_TOASTS = 3;

let nextToastId = 0;

/** Émet une notification. API conservée à l'identique (événement global). */
export function notify(message: string, type: NotificationType = "success") {
  window.dispatchEvent(new CustomEvent("uswap-notification", { detail: { message, type } }));
}

/** Région de notifications unique de l'application (montée dans main.tsx). */
export function Notifications() {
  const [items, setItems] = useState<ToastItem[]>([]);

  const receive = useCallback((event: Event) => {
    const detail = (event as CustomEvent<{ message: string; type: NotificationType }>).detail;
    // Rétrocompatibilité si un simple string est passé
    const message = typeof detail === "string" ? detail : detail?.message;
    const type = typeof detail === "string" ? "success" : detail?.type || "success";
    if (!message) return;

    setItems((prev) => {
      // On empile (la plus récente en haut) et on plafonne le nombre affiché.
      const next = [{ id: nextToastId++, message, type }, ...prev];
      return next.slice(0, MAX_TOASTS);
    });
  }, []);

  useEffect(() => {
    window.addEventListener("uswap-notification", receive as EventListener);
    return () => window.removeEventListener("uswap-notification", receive as EventListener);
  }, [receive]);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  if (!items.length) return null;

  return (
    <div className="ui-toast-region" aria-live="polite" aria-atomic="false">
      {items.map((item) => (
        <Toast key={item.id} item={item} onDismiss={dismiss} />
      ))}
    </div>
  );
}

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const isError = item.type === "error";

  const close = useCallback(() => {
    setLeaving(true);
    // Laisse jouer l'animation de sortie avant de retirer du DOM.
    window.setTimeout(() => onDismiss(item.id), 180);
  }, [item.id, onDismiss]);

  // Compte à rebours, mis en pause au survol / au focus.
  useEffect(() => {
    if (paused || leaving) return;
    const timer = window.setTimeout(close, TOAST_DURATION);
    return () => window.clearTimeout(timer);
  }, [paused, leaving, close]);

  return (
    <div
      className={`ui-toast ui-toast--${item.type}${leaving ? " is-leaving" : ""}`}
      role={isError ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="ui-toast__icon">
        {isError ? (
          <WarningCircleIcon size={20} weight="fill" />
        ) : item.type === "info" ? (
          <InfoIcon size={20} weight="fill" />
        ) : (
          <CheckCircleIcon size={20} weight="fill" />
        )}
      </span>
      <span className="ui-toast__message">{item.message}</span>
      <button type="button" className="ui-toast__close" aria-label="Fermer la notification" onClick={close}>
        <XIcon size={16} />
      </button>
      <span
        className="ui-toast__progress"
        style={{ animationDuration: `${TOAST_DURATION}ms`, animationPlayState: paused ? "paused" : "running" }}
        aria-hidden="true"
      />
    </div>
  );
}