import { notify } from "../../ui/Toast";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, roles, type Role } from "../../api/auth-api";
import { ArrowLeft, LoaderCircle, Mail } from "../../ui/icons";
import { ClockCounterClockwiseIcon, ShieldCheckIcon, UserCircleIcon, BuildingsIcon } from "@phosphor-icons/react";
import { Modal } from "../../ui/Modal";
import { StationPicker } from "../stations/StationPicker";
import { Select } from "../../ui/Select";
import "./user-detail.css";

type AuditItem = {
  id: string;
  action: string;
  createdAt: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};

type Detail = {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  phoneNumber: string | null;
  address: string | null;
  stationId: string | null;
  isActive: boolean;
  pendingActivation?: boolean;
  disabledAt: string | null;
  updatedAt: string;
  invitationStatus: string;
  invitationSentAt: string | null;
  invitationExpiresAt: string | null;
  audit: AuditItem[];
};

const statuses: Record<string, string> = {
  NOT_SENT: "Non envoyée",
  SENT: "Envoyée",
  EXPIRED: "Expirée",
  ACTIVATED: "Compte activé",
  FAILED: "Envoi échoué",
  DISABLED: "Compte désactivé",
};

const labels: Record<string, string> = {
  fullName: "Nom complet",
  email: "Adresse e-mail",
  role: "Rôle",
  phoneNumber: "Téléphone",
  address: "Adresse",
  stationId: "Station rattachée",
  isActive: "Statut actif",
  disabledAt: "Date de désactivation",
};

const formatDate = (value: string) => {
  if (!value) return "—";
  const date = new Date(value);
  if (isNaN(date.getTime())) return String(value);
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export function UserDetail({
  id,
  stations,
  onBack,
  onChanged,
}: {
  id: string;
  stations: { id: string; name: string }[];
  onBack: () => void;
  onChanged: () => void;
}) {
  const [user, setUser] = useState<Detail | null>(null);
  const [form, setForm] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [confirmActivate, setConfirmActivate] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);

  // Le formulaire a-t-il des modifications non enregistrées
  const isDirty = useMemo(() => {
    if (!user || !form) return false;
    return (
      form.fullName !== user.fullName ||
      form.email !== user.email ||
      form.role !== user.role ||
      (form.phoneNumber || "") !== (user.phoneNumber || "") ||
      (form.address || "") !== (user.address || "") ||
      (form.stationId || "") !== (user.stationId || "")
    );
  }, [user, form]);

  const cancelChanges = () => {
    if (!user) return;
    setForm(user);
    notify("Modifications annulées.", "info");
  };

  async function load() {
    try {
      const data = await api<Detail>("/users/" + id);
      setUser(data);
      setForm(data);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    setUser(null);
    setForm(null);
    void load();
  }, [id]);

  async function action(run: () => Promise<unknown>, successMessage: string) {
    setBusy(true);
    setError("");

    try {
      await run();
      await load();
      notify(successMessage);
      setConfirm(false);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    void action(
      () =>
        api(
          "/users/" + id,
          {
            fullName: form.fullName,
            email: form.email,
            role: form.role,
            phoneNumber: form.phoneNumber || "",
            address: form.address || "",
            stationId: form.stationId || null,
            updatedAt: form.updatedAt,
          },
          "PATCH"
        ),
      "Modifications enregistrées avec succès."
    );
  }

  const set = (field: keyof Detail, value: unknown) =>
    setForm((old) => (old ? { ...old, [field]: value } : old));

  const formatCleanValue = (key: string, val: unknown): string => {
    if (val === null || val === undefined || val === "" || val === "—") return "Aucun";
    if (key === "stationId") {
      const found = stations.find((s) => s.id === String(val));
      return found ? found.name : String(val);
    }
    if (key === "role") {
      return roles[val as Role] || String(val);
    }
    if (key === "disabledAt") {
      return val ? formatDate(String(val)) : "Actif";
    }
    if (typeof val === "boolean") {
      return val ? "Oui" : "Non";
    }
    if (typeof val === "string" && val.includes("T") && val.endsWith("Z")) {
      return formatDate(val);
    }
    return String(val);
  };

  return (
    <div className="user-detail-wrapper">
      {/* En-tête de navigation */}
      <div className="user-detail-topbar">
        <button type="button" className="user-detail-back" onClick={onBack}>
          <ArrowLeft size={16} />
          <span>Retour aux utilisateurs</span>
        </button>
      </div>

      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}

      {!user || !form ? (
        <div className="admin-card admin-empty user-detail-loading">
          {error ? (
            <button type="button" className="admin-button" onClick={load}>
              Réessayer
            </button>
          ) : (
            <LoaderCircle className="spin" size={28} />
          )}
        </div>
      ) : (
        <>
          {/* Grille principale : Formulaire à gauche, panneau latéral à droite */}
          <div className="user-detail-layout">

            {/* Formulaire Informations du profil */}
            <form onSubmit={save} className="admin-card user-detail-card">
              <div className="user-detail-card-head">
                <div className="user-detail-head-left">
                  <span className="icon">
                    <UserCircleIcon size={22} weight="fill" />
                  </span>
                  <div>
                    <h3>{user.fullName}</h3>
                    <span>Gestion et paramètres du compte</span>
                  </div>
                </div>

                {/* Bouton d'accès à l'historique en modale */}
                <button
                  type="button"
                  className="admin-button secondary small user-detail-history-btn"
                  onClick={() => setHistoryModalOpen(true)}
                >
                  <ClockCounterClockwiseIcon size={15} />
                  <span>Historique ({user.audit?.length || 0})</span>
                </button>
              </div>

              <fieldset disabled={busy} className="user-detail-fieldset">
                <div className="user-detail-grid">

                  <div className="user-detail-field">
                    <label htmlFor="fullName">
                      NOM COMPLET <span className="required">*</span>
                    </label>
                    <input
                      id="fullName"
                      required
                      maxLength={120}
                      value={form.fullName}
                      onChange={(e) => set("fullName", e.target.value)}
                    />
                  </div>

                  <div className="user-detail-field">
                    <label htmlFor="email">
                      ADRESSE E-MAIL <span className="required">*</span>
                    </label>
                    <input
                      id="email"
                      type="email"
                      required
                      maxLength={254}
                      value={form.email}
                      onChange={(e) => set("email", e.target.value)}
                    />
                  </div>

                  <div className="user-detail-field">
                    <label>
                      RÔLE <span className="required">*</span>
                    </label>
                    <Select
                      value={form.role}
                      onChange={(value) => {
                        set("role", value as Role);
                        set("stationId", "");
                      }}
                      options={Object.entries(roles).map(([key, label]) => ({
                        label,
                        value: key,
                      }))}
                    />
                  </div>

                  <div className="user-detail-field">
                    <label htmlFor="phoneNumber">
                      TÉLÉPHONE <span className="optional">(facultatif)</span>
                    </label>
                    <input
                      id="phoneNumber"
                      type="tel"
                      maxLength={30}
                      value={form.phoneNumber || ""}
                      onChange={(e) => set("phoneNumber", e.target.value)}
                    />
                  </div>

                  <div className="user-detail-field is-wide">
                    <label htmlFor="address">
                      ADRESSE <span className="optional">(facultatif)</span>
                    </label>
                    <input
                      id="address"
                      maxLength={250}
                      value={form.address || ""}
                      onChange={(e) => set("address", e.target.value)}
                    />
                  </div>

                  {/* Intégration du composant StationPicker unifié */}
                  <div className="user-detail-field is-wide">
                    <label>STATION RATTACHÉE</label>
                    <StationPicker
                      value={form.stationId || ""}
                      onChange={(val) => set("stationId", val || null)}
                      stations={stations}
                      placeholder="Sélectionner une station (Optionnel)"
                    />
                  </div>

                </div>
              </fieldset>

              <div className="user-detail-footer">
                {isDirty && !busy && (
                  <span className="user-detail-dirty-hint" role="status">
                    Modifications non enregistrées
                  </span>
                )}
                <div className="user-detail-footer-actions">
                  <button
                    type="button"
                    className="admin-button secondary"
                    disabled={busy || !isDirty}
                    onClick={cancelChanges}
                  >
                    Annuler
                  </button>
                  <button type="submit" className="admin-button" disabled={busy || !isDirty}>
                    {busy && <LoaderCircle className="spin" size={16} />}
                    Enregistrer les modifications
                  </button>
                </div>
              </div>
            </form>

            {/* Panneau latéral : Statut, Invitation & Actions de compte */}
            <aside className="admin-card user-detail-aside">
              <div className="user-detail-aside-head">
                <ShieldCheckIcon size={20} />
                <h3>Accès et sécurité</h3>
              </div>

              <div className="user-detail-status-box">
                <span
                  className={`admin-badge ${
                    user.disabledAt ? "inactive" : user.isActive ? "active" : "pending"
                  }`}
                >
                  {statuses[user.invitationStatus] || user.invitationStatus}
                </span>

                {user.invitationSentAt && (
                  <time>Dernier envoi : {formatDate(user.invitationSentAt)}</time>
                )}

                {!user.isActive && user.invitationExpiresAt && user.invitationSentAt && (
                  <time>Expiration : {formatDate(user.invitationExpiresAt)}</time>
                )}
              </div>

              <div className="user-detail-actions">
                {!user.isActive && !user.disabledAt && (
                  <button
                    type="button"
                    className="admin-button secondary"
                    disabled={busy}
                    onClick={() =>
                      action(
                        () => api("/auth/invitations/" + id + "/resend", {}),
                        "Invitation renvoyée avec succès."
                      )
                    }
                  >
                    <Mail size={15} />
                    <span>{user.invitationSentAt ? "Renvoyer l’invitation" : "Envoyer l’invitation"}</span>
                  </button>
                )}

                {!user.isActive && !user.disabledAt && user.pendingActivation && (
                  <button
                    type="button"
                    className="admin-button"
                    disabled={busy}
                    onClick={() => setConfirmActivate(true)}
                  >
                    Activer le compte manuellement
                  </button>
                )}

                <button
                  type="button"
                  className={`admin-button ${user.disabledAt ? "secondary" : "danger"}`}
                  disabled={busy}
                  onClick={() => setConfirm(true)}
                >
                  {user.disabledAt ? "Réactiver le compte" : "Désactiver le compte"}
                </button>
              </div>

              {confirmActivate && (
                <div className="user-detail-confirm is-info">
                  <p>
                    Activer le compte de «&nbsp;{user.fullName}&nbsp;» sans que le collaborateur ait ouvert
                    le lien reçu par e-mail ? Un lien pour définir son mot de passe lui sera envoyé.
                  </p>
                  <div className="user-detail-confirm-actions">
                    <button
                      type="button"
                      className="admin-button secondary small"
                      disabled={busy}
                      onClick={() => setConfirmActivate(false)}
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      className="admin-button small"
                      disabled={busy}
                      onClick={() => {
                        setConfirmActivate(false);
                        void action(
                          () => api("/users/" + id + "/activate", {}),
                          "Compte activé. Un lien de définition du mot de passe a été envoyé."
                        );
                      }}
                    >
                      Activer le compte
                    </button>
                  </div>
                </div>
              )}

              {confirm && (
                <div className="user-detail-confirm">
                  <p>
                    {user.disabledAt
                      ? "Voulez-vous rétablir l'accès de ce collaborateur ?"
                      : "Bloquer l'accès de cet utilisateur ? Ses sessions actives seront immédiatement fermées."}
                  </p>
                  <div className="user-detail-confirm-actions">
                    <button
                      type="button"
                      className="admin-button secondary small"
                      disabled={busy}
                      onClick={() => setConfirm(false)}
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      className="admin-button small danger"
                      disabled={busy}
                      onClick={() =>
                        action(
                          () =>
                            api(
                              "/users/" + id + "/status",
                              {
                                enabled: !!user.disabledAt,
                                updatedAt: user.updatedAt,
                              },
                              "PATCH"
                            ),
                          "Statut du compte mis à jour."
                        )
                      }
                    >
                      Confirmer
                    </button>
                  </div>
                </div>
              )}
            </aside>

          </div>

          {/* Modal dédiée à l'historique de modification avec rendu narratif et explicatif */}
          <Modal
            open={historyModalOpen}
            onClose={() => setHistoryModalOpen(false)}
            title={`Historique des modifications (${user.audit?.length || 0})`}
          >
            <div className="user-detail-history">
              {!user.audit || !user.audit.length ? (
                <p className="user-detail-history-empty">
                  Aucune modification enregistrée pour ce profil.
                </p>
              ) : (
                user.audit.map((item) => {
                  const changedEntries = Object.entries(labels).filter(
                    ([key]) =>
                      JSON.stringify(item.before[key]) !==
                      JSON.stringify(item.after[key])
                  );

                  return (
                    <div key={item.id} className="user-detail-history-entry">
                      <div className="user-detail-history-entry-head">
                        <span>
                          <span className="user-detail-history-dot" />
                          {item.action === "UPDATE"
                            ? "Mise à jour du profil"
                            : item.action === "DEACTIVATE"
                            ? "Désactivation du compte"
                            : item.action === "ACTIVATE"
                            ? "Activation manuelle du compte"
                            : "Réactivation du compte"}
                        </span>
                        <time>{formatDate(item.createdAt)}</time>
                      </div>

                      {changedEntries.length > 0 ? (
                        <div className="user-detail-history-changes">
                          {changedEntries.map(([key]) => {
                            const oldVal = formatCleanValue(key, item.before[key]);
                            const newVal = formatCleanValue(key, item.after[key]);

                            let narrativeText = "";
                            if (key === "stationId") {
                              narrativeText = `La station rattachée est passée de « ${oldVal} » à « ${newVal} ».`;
                            } else if (key === "role") {
                              narrativeText = `Le rôle de l'utilisateur a été défini sur « ${newVal} » (anciennement : ${oldVal}).`;
                            } else if (key === "isActive" || key === "disabledAt") {
                              narrativeText = newVal === "Oui" || newVal !== "Actif"
                                ? "Le compte a été activé / rétabli."
                                : "Le compte a été désactivé.";
                            } else {
                              narrativeText = `Le champ « ${labels[key] || key} » a été modifié de « ${oldVal} » à « ${newVal} ».`;
                            }

                            return (
                              <div key={key} className="user-detail-history-change">
                                {narrativeText}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="user-detail-history-note">
                          {item.action === "DEACTIVATE"
                            ? "L'accès au compte a été bloqué par un administrateur."
                            : item.action === "ACTIVATED"
                            ? "L'accès au compte a été rétabli."
                            : "Aucun détail de modification spécifique enregistré."}
                        </p>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </Modal>
        </>
      )}
    </div>
  );
}
