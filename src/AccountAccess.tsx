import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, CheckCheck, Eye, EyeOff, Link2Off, LoaderCircle, MailCheck } from './icons';
import { api, ApiError } from './auth-api';

const initialToken = new URLSearchParams(location.hash.slice(1)).get('token') || '';
// Keep invitation secrets out of the URL and browser persistence.
if (initialToken) history.replaceState(null, '', location.pathname);

export function AccountAccess({ mode }: { mode: 'forgot' | 'activate' | 'reset' }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [done, setDone] = useState(false);
  const [invalidLink, setInvalidLink] = useState(mode !== 'forgot' && !/^[a-f0-9]{64}$/.test(initialToken));
  const heading = useRef<HTMLHeadingElement>(null);
  const validLength = password.length >= 8;
  const tooLong = new TextEncoder().encode(password).length > 72;
  const mismatch = submitted && confirmation !== password;
  const passwordError = submitted && (!validLength || tooLong);
  useEffect(() => { if (done || invalidLink) heading.current?.focus(); }, [done, invalidLink]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSubmitted(true); setError('');
    if (mode !== 'forgot' && (!validLength || tooLong || password !== confirmation)) {
      const field = !validLength || tooLong ? 'new-password' : 'confirm-password';
      (event.currentTarget.elements.namedItem(field) as HTMLInputElement)?.focus();
      return;
    }
    setBusy(true);
    try {
      await api(mode === 'forgot' ? '/auth/forgot-password' : mode === 'activate' ? '/auth/activate-account' : '/auth/reset-password',
        mode === 'forgot' ? { email: email.trim() } : { token: initialToken, password });
      setDone(true); setPassword(''); setConfirmation('');
    } catch (error) {
      if (mode !== 'forgot' && error instanceof ApiError && error.status === 400) setInvalidLink(true);
      else setError(error instanceof Error ? error.message : 'Une erreur est survenue.');
    } finally { setBusy(false); }
  }

  const title = done
    ? mode === 'forgot' ? 'Consultez vos e-mails.' : mode === 'activate' ? 'Votre accès est prêt.' : 'Mot de passe modifié.'
    : invalidLink ? 'Ce lien n’est plus valide.'
    : mode === 'forgot' ? 'Mot de passe oublié\u00a0?' : mode === 'activate' ? 'Bienvenue sur uSwap.' : 'Nouveau mot de passe.';

  return <>
    <a className="text-button account-back" href="/auth/login"><ArrowLeft size={15}/> Retour à la connexion</a>
    {(done || invalidLink) && <div className={`result-icon ${invalidLink ? 'result-icon-warning' : ''}`} aria-hidden="true">
      {invalidLink ? <Link2Off/> : mode === 'forgot' ? <MailCheck/> : <CheckCheck/>}
    </div>}
    <h2 ref={heading} tabIndex={-1}>{title}</h2>
    {done ? <div role="status">
      <p className="form-description result-description">{mode === 'forgot'
        ? 'Si un compte correspond à cette adresse, vous recevrez un lien de réinitialisation.'
        : mode === 'activate' ? 'Votre compte est activé. Connectez-vous pour continuer.'
        : 'Vous pouvez vous reconnecter avec votre nouveau mot de passe.'}</p>
      {mode === 'forgot' && <><div className="recipient-address">{email.trim()}</div><p className="field-hint">Pensez aussi à vérifier vos courriers indésirables.</p></>}
      <a className="submit-button" href="/auth/login">Revenir à la connexion </a>
      {mode === 'forgot' && <button className="text-button account-secondary" onClick={() => { setDone(false); setSubmitted(false); }}>Utiliser une autre adresse</button>}
    </div> : invalidLink ? <>
      <p className="form-description result-description">{mode === 'activate'
        ? 'Ouvrez votre dernière invitation. Si elle a expiré, demandez-en une nouvelle à votre administrateur.'
        : 'Le lien a expiré, a déjà été utilisé ou est incomplet. Demandez-en un nouveau pour continuer.'}</p>
      <a className="submit-button" href={mode === 'activate' ? '/auth/login' : '/auth/forgot-password'}>
        {mode === 'activate' ? 'Revenir à la connexion' : 'Recevoir un nouveau lien'} 
      </a>
    </> : <>
      <p className="form-description">{mode === 'forgot' ? 'Indiquez l’adresse e-mail de votre compte.' : 'Choisissez le mot de passe de votre compte.'}</p>
      <form onSubmit={submit} aria-busy={busy}>
        {mode === 'forgot' ? <div className="field">
          <label htmlFor="recovery-email">Adresse e-mail</label>
          <div className="input-wrap"><input id="recovery-email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} inputMode="email" placeholder="Votre adresse e-mail" required maxLength={254} value={email} onChange={e => { setEmail(e.target.value); setError(''); }} disabled={busy}/></div>
        </div> : <>
          <div className="field">
            <label htmlFor="new-password">{mode === 'activate' ? 'Mot de passe' : 'Nouveau mot de passe'}</label>
            <div className={`input-wrap ${passwordError ? 'invalid' : ''}`}>
              <input id="new-password" name="new-password" type={visible ? 'text' : 'password'} autoComplete="new-password" placeholder="8 caractères minimum" required aria-invalid={passwordError} aria-describedby="password-policy" value={password} onChange={e => { setPassword(e.target.value); setError(''); }} disabled={busy}/>
              <button type="button" className="eye-button" aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={18}/> : <Eye size={18}/>}</button>
            </div>
            <p id="password-policy" className={`field-hint password-policy ${passwordError ? 'field-error' : validLength ? 'policy-valid' : ''}`}><Check size={13} aria-hidden="true"/>{tooLong ? 'Ce mot de passe est trop long. Raccourcissez-le.' : '8 caractères minimum'}</p>
          </div>
          <div className="field">
            <label htmlFor="confirm-password">Confirmer le mot de passe</label>
            <div className={`input-wrap ${mismatch ? 'invalid' : ''}`}><input id="confirm-password" name="confirm-password" type={visible ? 'text' : 'password'} autoComplete="new-password" placeholder="Saisissez-le à nouveau" required value={confirmation} aria-invalid={mismatch} aria-describedby={mismatch ? 'confirmation-error' : undefined} onChange={e => setConfirmation(e.target.value)} disabled={busy}/></div>
            {mismatch && <span id="confirmation-error" className="field-error">Les deux mots de passe doivent être identiques.</span>}
          </div>
        </>}
        {error && <div className="error-message" role="alert">{error}</div>}
        <button className="submit-button" disabled={busy}>{busy ? <><LoaderCircle className="spin" size={18}/> Veuillez patienter…</> : <>{mode === 'forgot' ? 'Envoyer le lien' : mode === 'activate' ? 'Activer mon compte' : 'Enregistrer le mot de passe'}</>}</button>
      </form>
    </>}
  </>;
}
