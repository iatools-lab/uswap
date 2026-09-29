import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ClockIcon,
  FloppyDiskIcon,
  KeyIcon,
  PaperclipIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";
import { api } from "../../api/auth-api";
import { notify } from "../../ui/Toast";
import "../../styles/global-settings.css";

type Settings = {
  sessionMinutes: number;
  invitationValidityHours: number;
  maxAttachmentMb: number;
  notificationRetentionDays: number;
  supportEmail: string;
  webhookSecretConfigured: boolean;
  revision: number;
  updatedAt: string;
};
type Revision = {
  id: string;
  revision: number;
  createdAt: string;
  actorId: string;
};
type Response = { settings: Settings; history: Revision[] };

export function GlobalSettingsPage() {
  const [form, setForm] = useState<Settings | null>(null);
  const [history, setHistory] = useState<Revision[]>([]);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api<Response>("/admin/settings")
      .then((data) => {
        setForm(data.settings);
        setHistory(data.history);
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);
  const set = (key: keyof Settings, value: string | number) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setBusy(true);
    setError("");
    try {
      const data = await api<Response>(
        "/admin/settings",
        { ...form, webhookSecret: secret },
        "PATCH",
      );
      setForm(data.settings);
      setHistory(data.history);
      setSecret("");
      notify("Paramètres globaux enregistrés.");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!form)
    return (
      <div className="admin-loading">
        {error || "Chargement des paramètres…"}
      </div>
    );
  return (
    <form className="global-settings" onSubmit={save}>
      <section className="global-settings__intro">
        <div>
          <span>Configuration de la plateforme</span>
          <h2>Règles communes à tous les espaces</h2>
          <p>
            Les règles propres aux stations restent configurées depuis la fiche
            de chaque station.
          </p>
        </div>
        <span className="global-settings__revision">
          Révision {form.revision}
        </span>
      </section>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <div className="global-settings__grid">
        <SettingCard
          icon={<ClockIcon />}
          title="Session et invitations"
          description="Durées appliquées à l’authentification et aux liens d’activation."
        >
          <NumberField
            label="Durée d’une session"
            suffix="minutes"
            min={15}
            max={720}
            value={form.sessionMinutes}
            onChange={(value) => set("sessionMinutes", value)}
          />
          <NumberField
            label="Validité d’une invitation"
            suffix="heures"
            min={1}
            max={168}
            value={form.invitationValidityHours}
            onChange={(value) => set("invitationValidityHours", value)}
          />
        </SettingCard>
        <SettingCard
          icon={<PaperclipIcon />}
          title="Fichiers et conservation"
          description="Limites communes pour les justificatifs et le centre de notifications."
        >
          <NumberField
            label="Taille maximale d’un fichier"
            suffix="Mo"
            min={1}
            max={25}
            value={form.maxAttachmentMb}
            onChange={(value) => set("maxAttachmentMb", value)}
          />
          <NumberField
            label="Conservation des notifications"
            suffix="jours"
            min={7}
            max={365}
            value={form.notificationRetentionDays}
            onChange={(value) => set("notificationRetentionDays", value)}
          />
        </SettingCard>
        <SettingCard
          icon={<ShieldCheckIcon />}
          title="Support et intégrations"
          description="Coordonnées techniques utilisées par les messages de la plateforme."
        >
          <label>
            Adresse de support
            <input
              type="email"
              required
              value={form.supportEmail}
              onChange={(e) => set("supportEmail", e.target.value)}
            />
          </label>
          <label>
            Secret webhook{" "}
            <small>
              {form.webhookSecretConfigured
                ? "Un secret est déjà enregistré. Laissez vide pour le conserver."
                : "Facultatif"}
            </small>
            <span className="secret-field">
              <KeyIcon />
              <input
                type="password"
                autoComplete="new-password"
                value={secret}
                placeholder={
                  form.webhookSecretConfigured
                    ? "••••••••••••"
                    : "Nouveau secret"
                }
                onChange={(e) => setSecret(e.target.value)}
              />
            </span>
          </label>
        </SettingCard>
      </div>
      <footer className="global-settings__footer">
        <div>
          <strong>Historique des modifications</strong>
          <span>
            {history.length
              ? `Dernière mise à jour le ${new Date(history[0].createdAt).toLocaleString("fr-FR")}`
              : "Aucune modification enregistrée"}
          </span>
        </div>
        <button className="admin-button primary-cta" disabled={busy}>
          <FloppyDiskIcon />
          {busy ? "Enregistrement…" : "Enregistrer les paramètres"}
        </button>
      </footer>
      {history.length > 0 && (
        <section className="global-settings__history">
          <h3>Versions récentes</h3>
          {history.map((item) => (
            <div key={item.id}>
              <span>Révision {item.revision}</span>
              <time>{new Date(item.createdAt).toLocaleString("fr-FR")}</time>
              <small>Administrateur</small>
            </div>
          ))}
        </section>
      )}
    </form>
  );
}

function SettingCard({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="global-settings__card">
      <header>
        <span>{icon}</span>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </header>
      <div className="global-settings__fields">{children}</div>
    </section>
  );
}
function NumberField({
  label,
  suffix,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  suffix: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      {label}
      <span className="number-field">
        <input
          type="number"
          required
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <small>{suffix}</small>
      </span>
    </label>
  );
}
