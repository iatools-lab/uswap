import { useState } from "react";
import { Link } from "react-router-dom";
import { Eye, EyeOff, LoaderCircle, Mail, X } from "../ui/icons";
import { useSession } from "../app/session";
import { mockPeople, roles } from "../api/auth-api";
import { AuthLayout } from "./AuthLayout";
import { RouteFallback } from "../app/RouteFallback";

/** Format d'adresse e-mail attendu, partagé par la validation et les messages d'erreur. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginPage() {
  const { session, checking, busy, error, setError, signIn } = useSession();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [help, setHelp] = useState<"invite" | null>(null);
  const [capsLock, setCapsLock] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitted(true);
    setError("");
    const emailInput = e.currentTarget.elements.namedItem("username") as HTMLInputElement;
    if (!EMAIL_PATTERN.test(identifier.trim()) || !emailInput.validity.valid) {
      emailInput.focus();
      return;
    }
    if (!password) {
      (e.currentTarget.elements.namedItem("password") as HTMLInputElement).focus();
      return;
    }
    if (new TextEncoder().encode(password).length > 72) {
      setError("Ce mot de passe est trop long.");
      return;
    }
    setSubmitting(true);
    try {
      await signIn(identifier.trim(), password);
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connexion impossible.");
    } finally {
      setSubmitting(false);
    }
  }

  const locked = busy || submitting;

  return (
    <AuthLayout>
      {checking || session ? (
        <RouteFallback label="Vérification de votre session…" />
      ) : (
        <>
          <h2 className="login-title">Connexion</h2>
          <form onSubmit={submit} noValidate>
            <div className="field">
              <label htmlFor="demo-profile">Profil à ouvrir</label>
              <div className="input-wrap">
                <select id="demo-profile" value={identifier} onChange={(e) => { setIdentifier(e.target.value); setError(""); }} disabled={locked} aria-label="Choisir un profil">
                  <option value="">Choisir un compte</option>
                  {mockPeople.map((person) => <option key={person.id} value={person.email}>{roles[person.role]} · {person.fullName}</option>)}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="identifier">Adresse e-mail</label>
              <div className={`input-wrap ${submitted && !EMAIL_PATTERN.test(identifier.trim()) ? "invalid" : ""}`}>
                <input
                  id="identifier"
                  name="username"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  type="email"
                  inputMode="email"
                  required
                  maxLength={254}
                  placeholder="Votre adresse e-mail"
                  value={identifier}
                  onChange={(e) => {
                    setIdentifier(e.target.value);
                    setError("");
                  }}
                  aria-invalid={submitted && !EMAIL_PATTERN.test(identifier.trim())}
                  aria-describedby={
                    submitted && !EMAIL_PATTERN.test(identifier.trim()) ? "identifier-error" : undefined
                  }
                  disabled={locked}
                />
              </div>
              {submitted && !EMAIL_PATTERN.test(identifier.trim()) && (
                <span id="identifier-error" className="field-error">
                  Saisissez une adresse e-mail valide.
                </span>
              )}
            </div>
            <div className="field">
              <div className="label-row">
                <label htmlFor="password">Mot de passe</label>
                <Link className="text-button" to="/auth/forgot-password">
                  Mot de passe oublié ?
                </Link>
              </div>
              <div className={`input-wrap ${submitted && !password ? "invalid" : ""}`}>
                <input
                  id="password"
                  name="password"
                  type={visible ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Votre mot de passe"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError("");
                  }}
                  onKeyUp={(e) => setCapsLock(e.getModifierState("CapsLock"))}
                  onBlur={() => setCapsLock(false)}
                  aria-invalid={submitted && !password}
                  aria-describedby={submitted && !password ? "password-error" : undefined}
                  disabled={locked}
                />
                <button
                  className="eye-button"
                  type="button"
                  onClick={() => setVisible(!visible)}
                  aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                  aria-pressed={visible}
                >
                  {visible ? <EyeOff size={19} /> : <Eye size={19} />}
                </button>
              </div>
              {submitted && !password && (
                <span id="password-error" className="field-error">
                  Saisissez votre mot de passe.
                </span>
              )}
              {capsLock && (
                <span className="field-hint" role="status">
                  La touche Verr. Maj est activée.
                </span>
              )}
            </div>
            {error && (
              <div className="error-message" role="alert">
                {error}
              </div>
            )}
            <button className="submit-button" disabled={locked} type="submit">
              {submitting ? (
                <>
                  <LoaderCircle className="spin" size={19} />
                  Connexion en cours…
                </>
              ) : (
                <>Se connecter</>
              )}
            </button>
          </form>
          <div className="invite-note">
            Première connexion ?{" "}
            <button className="text-button" onClick={() => setHelp("invite")}>
              Activer mon accès
            </button>
          </div>
        </>
      )}
      {help && (
        <div className="dialog-backdrop" onClick={() => setHelp(null)}>
          <dialog
            open
            aria-modal="true"
            aria-labelledby="help-title"
            ref={(el) => el?.focus()}
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === "Escape") setHelp(null);
              if (e.key === "Tab") {
                e.preventDefault();
                e.currentTarget.querySelector("button")?.focus();
              }
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button className="dialog-close" autoFocus aria-label="Fermer" onClick={() => setHelp(null)}>
              <X />
            </button>
            <div className="form-icon">
              <Mail />
            </div>
            <h2 id="help-title">Activez votre accès</h2>
            <p>
              Ouvrez le lien d’activation reçu par e-mail pour définir votre mot de passe. Si vous n’avez pas reçu
              d’invitation, contactez votre administrateur.
            </p>
          </dialog>
        </div>
      )}
    </AuthLayout>
  );
}
