import { notify } from "./Notifications";
import { useEffect, useState, useRef, type FormEvent } from "react";
import { api, roles, type Role } from "./auth-api";
import { ArrowLeft, LoaderCircle, Mail } from "./icons";
import { CaretDownIcon, ClockCounterClockwiseIcon, ShieldCheckIcon, UserCircleIcon, BuildingsIcon } from "@phosphor-icons/react";
import { Modal } from "./modal";
import { StationPicker } from "./Stationpicker";

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

/* Composant CustomSelect standard pour le Rôle */
function CustomSelect({
  value,
  options,
  onChange,
  width = "100%",
}: {
  value: string | number;
  options: { label: string; value: string | number }[];
  onChange: (val: any) => void;
  width?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const selectedOption = options.find((o) => o.value === value);

  return (
    <div ref={ref} style={{ position: "relative", width }}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: "100%",
          height: "40px",
          background: "#fff",
          border: "1px solid #cbd5e1",
          borderRadius: "8px",
          padding: "0 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: "13px",
          color: "#0f172a",
          cursor: "pointer",
          boxShadow: "0 1px 2px rgba(0,0,0,0.01)",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selectedOption ? selectedOption.label : "Sélectionner"}
        </span>
        <CaretDownIcon
          size={14}
          style={{
            color: "#64748b",
            marginLeft: "8px",
            flexShrink: 0,
            transform: isOpen ? "rotate(180deg)" : "none",
            transition: "transform 0.15s ease",
          }}
        />
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            width: "100%",
            background: "#fff",
            border: "1px solid #cbd5e1",
            borderRadius: "8px",
            boxShadow: "0 10px 25px -5px rgba(15, 23, 42, 0.12)",
            padding: "4px",
            zIndex: 50,
            display: "grid",
            gap: "2px",
            maxHeight: "220px",
            overflowY: "auto",
          }}
        >
          {options.map((opt) => (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "8px 10px",
                fontSize: "13px",
                background: value === opt.value ? "#f1f5f9" : "transparent",
                color: "#0f172a",
                fontWeight: value === opt.value ? 600 : 400,
                border: 0,
                borderRadius: "6px",
                cursor: "pointer",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
  const [historyModalOpen, setHistoryModalOpen] = useState(false);

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
    <div className="user-detail-wrapper" style={{ display: "grid", gap: "20px", paddingBottom: "40px" }}>
      {/* En-tête de navigation */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button
          type="button"
          onClick={onBack}
          style={{
            background: "transparent",
            border: 0,
            display: "flex",
            alignItems: "center",
            gap: "8px",
            color: "#475569",
            fontSize: "13.5px",
            fontWeight: 600,
            cursor: "pointer",
            padding: 0,
          }}
        >
          <ArrowLeft size={16} />
          <span>Retour aux utilisateurs</span>
        </button>
      </div>

      {error && (
        <div className="error-message" role="alert" style={{ borderRadius: "8px" }}>
          {error}
        </div>
      )}

      {!user || !form ? (
        <div className="admin-card admin-empty" style={{ padding: "60px 0" }}>
          {error ? (
            <button type="button" className="admin-button" onClick={load}>
              Réessayer
            </button>
          ) : (
            <LoaderCircle className="spin" size={28} style={{ color: "#3b82f6" }} />
          )}
        </div>
      ) : (
        <>
          {/* Grille principale : Formulaire à gauche, Sidebar Statut/Actions à droite */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: "20px", alignItems: "start" }}>
            
            {/* Formulaire Informations du profil */}
            <form
              onSubmit={save}
              className="admin-card"
              style={{ padding: "24px", display: "grid", gap: "20px", borderRadius: "12px", background: "#fff", border: "1px solid #e2e8f0" }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #f1f5f9", paddingBottom: "14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ color: "#3b82f6", display: "flex" }}>
                    <UserCircleIcon size={22} weight="fill" />
                  </span>
                  <div>
                    <h3 style={{ fontSize: "15px", fontWeight: 600, color: "#0f172a", margin: 0 }}>
                      {user.fullName}
                    </h3>
                    <span style={{ fontSize: "12px", color: "#64748b" }}>Gestion et paramètres du compte</span>
                  </div>
                </div>

                {/* Bouton d'accès à l'historique en modale */}
                <button
                  type="button"
                  className="admin-button secondary small"
                  onClick={() => setHistoryModalOpen(true)}
                  style={{ display: "flex", alignItems: "center", gap: "6px", height: "34px", borderRadius: "8px", fontSize: "12.5px" }}
                >
                  <ClockCounterClockwiseIcon size={15} style={{ color: "#3b82f6" }} />
                  <span>Historique ({user.audit?.length || 0})</span>
                </button>
              </div>

              <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: "16px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "16px" }}>
                  
                  <div style={{ display: "grid", gap: "6px" }}>
                    <label style={{ fontSize: "12px", fontWeight: 700, color: "#475569" }}>
                      NOM COMPLET <span style={{ color: "#ef4444" }}>*</span>
                    </label>
                    <input
                      required
                      maxLength={120}
                      value={form.fullName}
                      onChange={(e) => set("fullName", e.target.value)}
                      style={{ height: "40px", borderRadius: "8px", border: "1px solid #cbd5e1", padding: "0 14px", fontSize: "13px", color: "#0f172a", outline: "none" }}
                    />
                  </div>

                  <div style={{ display: "grid", gap: "6px" }}>
                    <label style={{ fontSize: "12px", fontWeight: 700, color: "#475569" }}>
                      ADRESSE E-MAIL <span style={{ color: "#ef4444" }}>*</span>
                    </label>
                    <input
                      type="email"
                      required
                      maxLength={254}
                      value={form.email}
                      onChange={(e) => set("email", e.target.value)}
                      style={{ height: "40px", borderRadius: "8px", border: "1px solid #cbd5e1", padding: "0 14px", fontSize: "13px", color: "#0f172a", outline: "none" }}
                    />
                  </div>

                  <div style={{ display: "grid", gap: "6px" }}>
                    <label style={{ fontSize: "12px", fontWeight: 700, color: "#475569" }}>
                      RÔLE <span style={{ color: "#ef4444" }}>*</span>
                    </label>
                    <CustomSelect
                      value={form.role}
                      onChange={(val) => {
                        set("role", val as Role);
                        set("stationId", "");
                      }}
                      options={Object.entries(roles).map(([key, label]) => ({
                        label,
                        value: key,
                      }))}
                    />
                  </div>

                  <div style={{ display: "grid", gap: "6px" }}>
                    <label style={{ fontSize: "12px", fontWeight: 700, color: "#475569" }}>
                      TÉLÉPHONE <span style={{ fontWeight: 400, color: "#94a3b8" }}>(facultatif)</span>
                    </label>
                    <input
                      type="tel"
                      maxLength={30}
                      value={form.phoneNumber || ""}
                      onChange={(e) => set("phoneNumber", e.target.value)}
                      style={{ height: "40px", borderRadius: "8px", border: "1px solid #cbd5e1", padding: "0 14px", fontSize: "13px", color: "#0f172a", outline: "none" }}
                    />
                  </div>

                  <div style={{ gridColumn: "span 2", display: "grid", gap: "6px" }}>
                    <label style={{ fontSize: "12px", fontWeight: 700, color: "#475569" }}>
                      ADRESSE <span style={{ fontWeight: 400, color: "#94a3b8" }}>(facultatif)</span>
                    </label>
                    <input
                      maxLength={250}
                      value={form.address || ""}
                      onChange={(e) => set("address", e.target.value)}
                      style={{ height: "40px", borderRadius: "8px", border: "1px solid #cbd5e1", padding: "0 14px", fontSize: "13px", color: "#0f172a", outline: "none" }}
                    />
                  </div>

                  {/* Intégration du composant StationPicker unifié */}
                  <div style={{ gridColumn: "span 2", display: "grid", gap: "6px" }}>
                    <label style={{ fontSize: "12px", fontWeight: 700, color: "#475569" }}>STATION RATTACHÉE</label>
                    <StationPicker
                      value={form.stationId || ""}
                      onChange={(val) => set("stationId", val || null)}
                      stations={stations}
                      placeholder="Sélectionner une station (Optionnel)"
                    />
                  </div>

                </div>
              </fieldset>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", borderTop: "1px solid #f1f5f9", paddingTop: "16px", marginTop: "4px" }}>
                <button
                  type="button"
                  className="admin-button secondary"
                  disabled={busy}
                  onClick={() => setForm(user)}
                  style={{ height: "38px", borderRadius: "8px", fontSize: "13px" }}
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="admin-button"
                  disabled={busy}
                  style={{ height: "38px", borderRadius: "8px", fontSize: "13px", padding: "0 18px" }}
                >
                  {busy && <LoaderCircle className="spin" size={16} />}
                  Enregistrer les modifications
                </button>
              </div>
            </form>

            {/* Sidebar : Statut, Invitation & Actions de compte */}
            <aside
              className="admin-card"
              style={{ padding: "20px", display: "grid", gap: "16px", borderRadius: "12px", background: "#fff", border: "1px solid #e2e8f0" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", borderBottom: "1px solid #f1f5f9", paddingBottom: "12px" }}>
                <ShieldCheckIcon size={20} style={{ color: "#0f172a" }} />
                <h3 style={{ fontSize: "14px", fontWeight: 600, color: "#0f172a", margin: 0 }}>Accès et sécurité</h3>
              </div>

              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px", display: "grid", gap: "6px" }}>
                <span
                  className={`admin-badge ${
                    user.disabledAt ? "inactive" : user.isActive ? "active" : "pending"
                  }`}
                  style={{ width: "fit-content" }}
                >
                  {statuses[user.invitationStatus] || user.invitationStatus}
                </span>

                {user.invitationSentAt && (
                  <span style={{ fontSize: "11.5px", color: "#64748b" }}>
                    Dernier envoi : {formatDate(user.invitationSentAt)}
                  </span>
                )}

                {!user.isActive && user.invitationExpiresAt && user.invitationSentAt && (
                  <span style={{ fontSize: "11.5px", color: "#64748b" }}>
                    Expiration : {formatDate(user.invitationExpiresAt)}
                  </span>
                )}
              </div>

              <div style={{ display: "grid", gap: "8px" }}>
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
                    style={{ width: "100%", height: "38px", fontSize: "13px", justifyContent: "center" }}
                  >
                    <Mail size={15} />
                    <span>{user.invitationSentAt ? "Renvoyer l’invitation" : "Envoyer l’invitation"}</span>
                  </button>
                )}

                <button
                  type="button"
                  className={`admin-button ${user.disabledAt ? "secondary" : "danger"}`}
                  disabled={busy}
                  onClick={() => setConfirm(true)}
                  style={{ width: "100%", height: "38px", fontSize: "13px", justifyContent: "center" }}
                >
                  {user.disabledAt ? "Réactiver le compte" : "Désactiver le compte"}
                </button>
              </div>

              {confirm && (
                <div
                  style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", padding: "12px", display: "grid", gap: "10px" }}
                >
                  <p style={{ margin: 0, fontSize: "12px", color: "#991b1b", lineHeight: "1.4" }}>
                    {user.disabledAt
                      ? "Voulez-vous rétablir l'accès de ce collaborateur ?"
                      : "Bloquer l'accès de cet utilisateur ? Ses sessions actives seront immédiatement fermées."}
                  </p>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px" }}>
                    <button
                      type="button"
                      className="admin-button secondary small"
                      disabled={busy}
                      onClick={() => setConfirm(false)}
                      style={{ height: "30px", fontSize: "12px" }}
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
                      style={{ height: "30px", fontSize: "12px" }}
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
            <div style={{ display: "grid", gap: "12px", maxHeight: "65vh", overflowY: "auto", paddingRight: "4px" }}>
              {!user.audit || !user.audit.length ? (
                <p style={{ fontSize: "13px", color: "#64748b", textAlign: "center", padding: "30px 0", margin: 0 }}>
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
                    <div
                      key={item.id}
                      style={{
                        background: "#f8fafc",
                        border: "1px solid #e2e8f0",
                        borderRadius: "8px",
                        padding: "14px 16px",
                        display: "grid",
                        gap: "8px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>
                          <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#3b82f6" }} />
                          {item.action === "UPDATE"
                            ? "Mise à jour du profil"
                            : item.action === "DEACTIVATE"
                            ? "Désactivation du compte"
                            : "Réactivation du compte"}
                        </span>
                        <time style={{ fontSize: "11.5px", color: "#64748b", fontFamily: "monospace" }}>
                          {formatDate(item.createdAt)}
                        </time>
                      </div>

                      {changedEntries.length > 0 ? (
                        <div style={{ display: "grid", gap: "6px", marginTop: "4px" }}>
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
                              <div
                                key={key}
                                style={{
                                  background: "#fff",
                                  border: "1px solid #e2e8f0",
                                  borderRadius: "6px",
                                  padding: "8px 12px",
                                  fontSize: "12.5px",
                                  color: "#334155",
                                  lineHeight: "1.4",
                                }}
                              >
                                {narrativeText}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p style={{ fontSize: "12.5px", color: "#64748b", margin: 0, fontStyle: "italic" }}>
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