import { notify } from "../../ui/Toast";
import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DotsThreeIcon, PencilSimpleIcon, PowerIcon } from "../../ui/icons";
import { api } from "../../api/auth-api";
import { useAppPath } from "../../app/appBase";

export function UserActions({
  user,
  onChanged,
}: {
  user: { id: string; fullName: string; disabledAt?: string | null };
  onChanged: () => void;
}) {
  const path = useAppPath();
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [position, setPosition] = useState({ top: 0, left: 0 });
  async function change() {
    setBusy(true);
    setError("");
    try {
      const current = await api<{
        updatedAt: string;
        disabledAt: string | null;
      }>("/users/" + user.id);
      if (!!current.disabledAt !== !!user.disabledAt)
        throw new Error(
          "Le statut a changé. Fermez ce menu puis rouvrez la liste.",
        );
      const enable = !!current.disabledAt;
      const response = await api<{ message?: string }>(
        "/users/" + user.id + "/status",
        { enabled: enable, updatedAt: current.updatedAt },
        "PATCH",
      );
      // Relecture : le message de succès n'apparaît que si la base a vraiment
      // changé d'état (c'était le symptôme « réactivé » alors que le compte
      // restait bloqué).
      const saved = await api<{ disabledAt: string | null }>(
        "/users/" + user.id,
      );
      if (!!saved.disabledAt === enable)
        throw new Error(
          "La mise à jour n'a pas été enregistrée. Rechargez la page et réessayez.",
        );
      panel.current?.hidePopover();
      notify(
        response.message ??
          (enable ? "Compte réactivé." : "Compte désactivé."),
      );
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="row-actions-trigger"
        aria-label={"Actions pour " + user.fullName}
        popoverTarget={id}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setPosition({
            top: Math.max(12, Math.min(rect.bottom + 6, innerHeight - 300)),
            left: Math.max(12, Math.min(rect.right - 280, innerWidth - 292)),
          });
          setConfirm(false);
          setError("");
        }}
      >
        <DotsThreeIcon size={24} />
      </button>
      {createPortal(
        <div
          id={id}
          ref={panel}
          popover="auto"
          className="row-actions-popover"
          style={position}
        >
          <strong>{user.fullName}</strong>
          {confirm ? (
            <>
              <p>
                {user.disabledAt
                  ? "Rétablir l’accès de ce collaborateur ?"
                  : "Désactiver ce compte et fermer ses sessions ? Son historique sera conservé."}
              </p>
              <div className="user-toolbar">
                <button
                  className="admin-button secondary"
                  disabled={busy}
                  onClick={() => setConfirm(false)}
                >
                  Annuler
                </button>
                <button
                  className="admin-button"
                  disabled={busy}
                  onClick={change}
                >
                  Confirmer
                </button>
              </div>
            </>
          ) : (
            <>
              <a href={path("/app/admin/utilisateurs/" + user.id)}>
                <PencilSimpleIcon size={18} />
                Modifier
              </a>
              <button onClick={() => setConfirm(true)}>
                <PowerIcon size={18} />
                {user.disabledAt ? "Réactiver" : "Désactiver"}
              </button>
            </>
          )}
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
