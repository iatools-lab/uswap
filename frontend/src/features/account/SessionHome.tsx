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
      <span className="section-eyebrow">MON ESPACE</span>
      <h2>
        {timeGreeting()}, {user.fullName.trim().split(/\s+/)[0]}.
      </h2>
      <p className="form-description">
        Retrouvez les informations de votre compte.
      </p>
      <div className="profile-card">
        <div className="profile-header">
          <span className="profile-avatar" aria-hidden="true">
            {initials}
          </span>
          <div>
            <strong>{user.fullName}</strong>
            <span className="profile-status">
              <i />
              Compte actif
            </span>
          </div>
        </div>
        <dl>
          <div>
            <dt>Adresse e-mail</dt>
            <dd>{user.email}</dd>
          </div>
          <div>
            <dt>Rôle</dt>
            <dd>{roles[user.role]}</dd>
          </div>
        </dl>
      </div>
      {warning && (
        <div className="session-warning" role="alert">
          <Clock3 size={18} />
          <div>
            Votre session va expirer.
            <button className="text-button" onClick={onExtend} disabled={busy}>
              Prolonger ma session
            </button>
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
        Se déconnecter
      </button>
    </div>
  );
}
