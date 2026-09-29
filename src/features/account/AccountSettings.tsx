import { useEffect, useState } from "react";
import {
  BellIcon,
  CheckCircleIcon,
  EnvelopeSimpleIcon,
  LockKeyIcon,
  MapPinIcon,
  ShieldCheckIcon,
  UserIcon,
} from "@phosphor-icons/react";
import { Link, useSearchParams } from "react-router-dom";
import { api, roles, type User } from "../../api/auth-api";

type Section = "profile" | "notifications" | "security";
type Preferences = {
  userId: string;
  internalEnabled: true;
  emailEnabled: boolean;
  pushEnabled: boolean;
  categories: Record<string, { email: boolean; push: boolean }>;
  updatedAt: string;
};

const categoryLabels: Record<string, { title: string; description: string }> = {
  PLANNING: {
    title: "Planning",
    description: "Publications et modifications d’horaires",
  },
  ATTENDANCE: {
    title: "Présence et pointage",
    description: "Retards, absences et corrections",
  },
  LEAVE: { title: "Congés", description: "Décisions et suivi des demandes" },
  INCIDENT: {
    title: "Incidents",
    description: "Signalements et avancée du traitement",
  },
  REPORT: { title: "Rapports", description: "Exports et rapports périodiques" },
};

export function AccountSettings({ user }: { user: User }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [section, setSection] = useState<Section>(
    searchParams.get("section") === "notifications"
      ? "notifications"
      : "profile",
  );
  const initials = user.fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  function select(next: Section) {
    setSection(next);
    setSearchParams(
      next === "notifications" ? { section: "notifications" } : {},
    );
  }

  return (
    <div className="account-settings">
      <nav className="settings-tabs" aria-label="Rubriques du compte">
        <button
          aria-pressed={section === "profile"}
          onClick={() => select("profile")}
        >
          <UserIcon size={18} />
          Profil
        </button>
        <button
          aria-pressed={section === "notifications"}
          onClick={() => select("notifications")}
        >
          <BellIcon size={18} />
          Notifications
        </button>
        <button
          aria-pressed={section === "security"}
          onClick={() => select("security")}
        >
          <LockKeyIcon size={18} />
          Sécurité
        </button>
      </nav>

      {section === "profile" && (
        <section className="settings-panel settings-profile">
          <header className="settings-panel-heading">
            <div>
              <span className="settings-eyebrow">Compte uSwap</span>
              <h2>Identité et périmètre d’accès</h2>
              <p>
                Les informations utilisées pour personnaliser votre espace de
                travail.
              </p>
            </div>
            <span className="settings-status">
              <span />
              Compte actif
            </span>
          </header>
          <div className="settings-profile-card">
            <span className="settings-avatar" aria-hidden="true">
              {initials || "U"}
            </span>
            <div className="settings-profile-main">
              <strong>{user.fullName}</strong>
              <span>{roles[user.role]}</span>
            </div>
            <div className="settings-profile-meta">
              <span>
                <EnvelopeSimpleIcon size={17} />
                {user.email}
              </span>
              {user.stationName && (
                <span>
                  <MapPinIcon size={17} />
                  {user.stationName}
                </span>
              )}
            </div>
          </div>
          <dl className="settings-fields">
            <div>
              <dt>Nom complet</dt>
              <dd>{user.fullName}</dd>
            </div>
            <div>
              <dt>Adresse e-mail</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt>Rôle</dt>
              <dd>{roles[user.role]}</dd>
            </div>
            <div>
              <dt>Station de rattachement</dt>
              <dd>{user.stationName || "Toutes les stations autorisées"}</dd>
            </div>
          </dl>
          <p className="settings-note">
            Une modification d’identité ou de rattachement doit être réalisée
            par un administrateur.
          </p>
        </section>
      )}

      {section === "notifications" && <NotificationPreferences />}

      {section === "security" && (
        <section className="settings-panel settings-security">
          <div className="settings-security-icon">
            <ShieldCheckIcon size={28} />
          </div>
          <div>
            <span className="settings-eyebrow">Sécurité du compte</span>
            <h2>Mot de passe</h2>
            <p>
              Demandez un lien sécurisé pour choisir un nouveau mot de passe. Le
              lien est envoyé à <strong>{user.email}</strong>.
            </p>
            <Link
              className="admin-button primary-cta"
              to="/auth/forgot-password"
            >
              <LockKeyIcon size={17} />
              Réinitialiser mon mot de passe
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}

function PreferenceSwitch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      className="settings-switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

function NotificationPreferences() {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api<Preferences>("/notifications/preferences")
      .then((value) => active && setPreferences(value))
      .catch((reason: Error) => active && setError(reason.message));
    return () => {
      active = false;
    };
  }, []);
  if (error && !preferences)
    return (
      <section className="settings-panel">
        <p className="error-message">{error}</p>
      </section>
    );
  if (!preferences)
    return (
      <section className="settings-panel">
        <p>Chargement de vos préférences…</p>
      </section>
    );

  async function channel(name: "emailEnabled" | "pushEnabled", value: boolean) {
    if (name === "pushEnabled" && value && "Notification" in window) {
      value = (await Notification.requestPermission()) === "granted";
      if (value)
        new Notification("Notifications uSwap activées", {
          body: "Les alertes autorisées pourront apparaître sur cet appareil.",
          icon: "/icons/app-192.png",
        });
    }
    setPreferences((current) =>
      current ? { ...current, [name]: value } : current,
    );
    setSaved(false);
  }
  function category(
    name: string,
    channelName: "email" | "push",
    value: boolean,
  ) {
    setPreferences((current) =>
      current
        ? {
            ...current,
            categories: {
              ...current.categories,
              [name]: { ...current.categories[name], [channelName]: value },
            },
          }
        : current,
    );
    setSaved(false);
  }
  async function save() {
    setBusy(true);
    setSaved(false);
    setError("");
    try {
      setPreferences(
        await api<Preferences>(
          "/notifications/preferences",
          preferences,
          "PATCH",
        ),
      );
      setSaved(true);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-panel notification-preferences">
      <header className="settings-panel-heading">
        <div>
          <span className="settings-eyebrow">Préférences</span>
          <h2>Notifications</h2>
          <p>
            Choisissez les canaux complémentaires pour chaque type d’alerte.
          </p>
        </div>
        {saved && (
          <span className="settings-saved">
            <CheckCircleIcon size={16} />
            Enregistré
          </span>
        )}
      </header>
      <div className="notification-channels">
        <div className="notification-channel-card">
          <span>
            <EnvelopeSimpleIcon size={20} />
          </span>
          <div>
            <strong>E-mail</strong>
            <small>Recevoir les alertes dans votre messagerie</small>
          </div>
          <PreferenceSwitch
            label="Notifications par e-mail"
            checked={preferences.emailEnabled}
            onChange={(value) => void channel("emailEnabled", value)}
          />
        </div>
        <div className="notification-channel-card">
          <span>
            <BellIcon size={20} />
          </span>
          <div>
            <strong>Notifications push</strong>
            <small>Recevoir les alertes sur cet appareil</small>
          </div>
          <PreferenceSwitch
            label="Notifications push"
            checked={preferences.pushEnabled}
            onChange={(value) => void channel("pushEnabled", value)}
          />
        </div>
      </div>
      <div className="notification-matrix">
        <div className="notification-matrix-head">
          <span>Type d’alerte</span>
          <span>E-mail</span>
          <span>Push</span>
        </div>
        {Object.entries(preferences.categories)
          .filter(([name]) => categoryLabels[name])
          .map(([name, values]) => (
            <div className="notification-matrix-row" key={name}>
              <span>
                <strong>{categoryLabels[name].title}</strong>
                <small>{categoryLabels[name].description}</small>
              </span>
              <PreferenceSwitch
                label={`${categoryLabels[name].title} par e-mail`}
                disabled={!preferences.emailEnabled}
                checked={preferences.emailEnabled && values.email}
                onChange={(value) => category(name, "email", value)}
              />
              <PreferenceSwitch
                label={`${categoryLabels[name].title} par notification push`}
                disabled={!preferences.pushEnabled}
                checked={preferences.pushEnabled && values.push}
                onChange={(value) => category(name, "push", value)}
              />
            </div>
          ))}
      </div>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <footer className="settings-notification-footer">
        <p>
          Les alertes internes indispensables à la sécurité et au suivi
          opérationnel restent actives.
        </p>
        <button
          className="admin-button primary-cta"
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? "Enregistrement…" : "Enregistrer les préférences"}
        </button>
      </footer>
    </section>
  );
}
