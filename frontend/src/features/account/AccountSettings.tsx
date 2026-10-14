import { useEffect, useState } from "react";
import {
  BellIcon,
  CheckCircleIcon,
  EnvelopeSimpleIcon,
  LockKeyIcon,
  MapPinIcon,
  ShieldCheckIcon,
  UserIcon,
} from "../../ui/icons";
import { Link, useSearchParams } from "react-router-dom";
import { api, roles, type User } from "../../api/auth-api";
import {translate,  useI18n } from "../../app/i18n";

type Section = "profile" | "notifications" | "security";
type Preferences = {
  inApp: boolean;
  email: boolean;
  push: boolean;
  digest: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  retentionDays: number;
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
  const { t } = useI18n();
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
      <nav className="settings-tabs" aria-label={t("Rubriques du compte")}>
        <button
          aria-pressed={section === "profile"}
          onClick={() => select("profile")}
        >
          <UserIcon size={18} />
          {t("Profil")}
        </button>
        <button
          aria-pressed={section === "notifications"}
          onClick={() => select("notifications")}
        >
          <BellIcon size={18} />
          {t("Notifications")}
        </button>
        <button
          aria-pressed={section === "security"}
          onClick={() => select("security")}
        >
          <LockKeyIcon size={18} />
          {t("Sécurité")}
        </button>
      </nav>

      {section === "profile" && (
        <section className="settings-panel settings-profile">
          <header className="settings-panel-heading">
            <div>
              <span className="settings-eyebrow">{t("Compte uSwap")}</span>
              <h2>{t("Identité et périmètre d’accès")}</h2>
              <p>
                {t(
                  "Les informations utilisées pour personnaliser votre espace de travail.",
                )}
              </p>
            </div>
            <span className="settings-status">
              <span />
              {t("Compte actif")}
            </span>
          </header>
          <div className="settings-profile-card">
            <span className="settings-avatar" aria-hidden="true">
              {initials || "U"}
            </span>
            <div className="settings-profile-main">
              <strong>{user.fullName}</strong>
              <span>{translate(roles[user.role])}</span>
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
              <dt>{t("Nom complet")}</dt>
              <dd>{user.fullName}</dd>
            </div>
            <div>
              <dt>{t("Adresse e-mail")}</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt>{t("Rôle")}</dt>
              <dd>{translate(roles[user.role])}</dd>
            </div>
            <div>
              <dt>{t("Station de rattachement")}</dt>
              <dd>{user.stationName || t("Toutes les stations autorisées")}</dd>
            </div>
          </dl>
          <p className="settings-note">
            {t(
              "Une modification d’identité ou de rattachement doit être réalisée par un administrateur.",
            )}
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
            <span className="settings-eyebrow">{t("Sécurité du compte")}</span>
            <h2>{t("Mot de passe")}</h2>
            <p>
              {t(
                "Demandez un lien sécurisé pour choisir un nouveau mot de passe. Le lien est envoyé à",
              )}{" "}
              <strong>{user.email}</strong>{translate(".")}</p>
            <Link
              className="admin-button primary-cta"
              to="/auth/forgot-password"
            >
              <LockKeyIcon size={17} />
              {t("Réinitialiser mon mot de passe")}
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

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
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

  if (error && !preferences) {
    return (
      <section className="settings-panel">
        <p className="error-message">{error}</p>
      </section>
    );
  }

  if (!preferences) {
    return (
      <section className="settings-panel">
        <p>{translate("Chargement de vos préférences…")}</p>
      </section>
    );
  }

  async function togglePush(value: boolean) {
    setError("");
    if (value) {
      if (!("Notification" in window) || !("serviceWorker" in navigator)) {
        setError(
          "Les notifications push ne sont pas prises en charge par ce navigateur.",
        );
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError(
          "L’autorisation des notifications a été refusée dans le navigateur.",
        );
        return;
      }
      const vapidKey = (
        import.meta as unknown as { env: Record<string, string | undefined> }
      ).env.VITE_VAPID_PUBLIC_KEY;
      if (vapidKey) {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        });
        await api("/notifications/push-subscription", {
          ...subscription.toJSON(),
          userAgent: navigator.userAgent,
        });
      }
    } else if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await api(
          "/notifications/push-subscription?endpoint=" +
            encodeURIComponent(subscription.endpoint),
          undefined,
          "DELETE",
        ).catch(() => undefined);
        await subscription.unsubscribe();
      }
    }
    setPreferences((current) =>
      current ? { ...current, push: value } : current,
    );
    setSaved(false);
  }

  function patch<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setPreferences((current) =>
      current ? { ...current, [key]: value } : current,
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
          <span className="settings-eyebrow">{translate("Préférences")}</span>
          <h2>{translate("Notifications")}</h2>
          <p>{translate("Gérez directement les canaux de notification de votre compte.")}</p>
        </div>
        {saved && (
          <span className="settings-saved">
            <CheckCircleIcon size={16} /> {" "}{translate("Enregistré")}</span>
        )}
      </header>

      <div className="notification-channels">
        <div className="notification-channel-card">
          <span>
            <BellIcon size={20} />
          </span>
          <div>
            <strong>{translate("Dans l’application")}</strong>
            <small>{translate("Alertes visibles dans votre espace uSwap.")}</small>
          </div>
          <PreferenceSwitch
            label={translate("Notifications dans l’application")}
            checked={preferences.inApp}
            onChange={(value) => patch("inApp", value)}
          />
        </div>
        <div className="notification-channel-card">
          <span>
            <EnvelopeSimpleIcon size={20} />
          </span>
          <div>
            <strong>{translate("E-mail")}</strong>
            <small>
              {translate("Recevoir les communications opérationnelles par e-mail.")}</small>
          </div>
          <PreferenceSwitch
            label={translate("Notifications par e-mail")}
            checked={preferences.email}
            onChange={(value) => patch("email", value)}
          />
        </div>
        <div className="notification-channel-card">
          <span>
            <BellIcon size={20} />
          </span>
          <div>
            <strong>{translate("Notifications push")}</strong>
            <small>
              {translate("Alertes sur cet appareil. Le refus du navigateur ne bloque pas uSwap.")}</small>
          </div>
          <PreferenceSwitch
            label={translate("Notifications push")}
            checked={preferences.push}
            onChange={(value) => void togglePush(value)}
          />
        </div>
      </div>

      <div className="notification-matrix">
        <div className="notification-matrix-head">
          <span>{translate("Réglage")}</span>
          <span>{translate("Valeur")}</span>
        </div>
        <div className="notification-matrix-row">
          <span>
            <strong>{translate("Résumé périodique")}</strong>
            <small>{translate("Autoriser les notifications regroupées.")}</small>
          </span>
          <PreferenceSwitch
            label={translate("Résumé périodique")}
            checked={preferences.digest}
            onChange={(value) => patch("digest", value)}
          />
        </div>
        <div className="notification-matrix-row">
          <span>
            <strong>{translate("Heures silencieuses")}</strong>
            <small>
              {translate("Ne pas envoyer les notifications non critiques pendant la plage choisie.")}</small>
          </span>
          <PreferenceSwitch
            label={translate("Heures silencieuses")}
            checked={preferences.quietHoursEnabled}
            onChange={(value) => patch("quietHoursEnabled", value)}
          />
        </div>
        {preferences.quietHoursEnabled && (
          <div className="notification-matrix-row">
            <label>
              {translate("Début")}{" "}
              <input
                type="time"
                value={preferences.quietHoursStart || "22:00"}
                onChange={(e) => patch("quietHoursStart", e.target.value)}
              />
            </label>
            <label>
              {translate("Fin")}{" "}
              <input
                type="time"
                value={preferences.quietHoursEnd || "07:00"}
                onChange={(e) => patch("quietHoursEnd", e.target.value)}
              />
            </label>
          </div>
        )}
      </div>

      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <footer className="settings-notification-footer">
        <p>
          {translate("Les alertes internes indispensables au suivi opérationnel peuvent rester actives.")}</p>
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
