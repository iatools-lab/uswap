import { translate } from "../../app/i18n";
import { Clock3, LoaderCircle, LogOut } from "../../ui/icons";
import { roles, type User } from "../../api/auth-api";
import { timeGreeting } from "../../utils/greeting";

export function SessionHome({
  user,
  busy,
  warning,
  error,
  onLogout,
  onExtend,
}: {
  user: User;
  busy: boolean;
  warning: boolean;
  error: string;
  onLogout: () => void;
  onExtend: () => void;
}) {
  const initials = user.fullName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return (
    <div className="session-home">
      <span className="section-eyebrow">{translate("MON ESPACE")}</span>
      <h2>
        {timeGreeting()}{translate(",")}{" "}{user.fullName.trim().split(/\s+/)[0]}{translate(".")}</h2>
      <p className="form-description">
        {translate("Retrouvez les informations de votre compte.")}</p>
      <div className="profile-card">
        <div className="profile-header">
          <span className="profile-avatar" aria-hidden="true">
            {initials}
          </span>
          <div>
            <strong>{user.fullName}</strong>
            <span className="profile-status">
              <i />
              {translate("Compte actif")}</span>
          </div>
        </div>
        <dl>
          <div>
            <dt>{translate("Adresse e-mail")}</dt>
            <dd>{user.email}</dd>
          </div>
          <div>
            <dt>{translate("Rôle")}</dt>
            <dd>{translate(roles[user.role])}</dd>
          </div>
        </dl>
      </div>
      {warning && (
        <div className="session-warning" role="alert">
          <Clock3 size={18} />
          <div>
            {translate("Votre session va expirer.")}<button className="text-button" onClick={onExtend} disabled={busy}>
              {translate("Prolonger ma session")}</button>
          </div>
        </div>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <button
        className="submit-button logout-button"
        onClick={onLogout}
        disabled={busy}
      >
        {busy ? (
          <LoaderCircle className="spin" size={18} />
        ) : (
          <LogOut size={18} />
        )}
        {translate("Se déconnecter")}</button>
    </div>
  );
}
