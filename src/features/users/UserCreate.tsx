import { notify } from "../../ui/Toast";
import { useState, type FormEvent } from 'react';
import { api, roles, type Role } from '../../api/auth-api';
import { ArrowLeft, CheckCheck, Eye, EyeOff, LoaderCircle } from '../../ui/icons';

export function UserCreate({
  stations,
  onBack,
  onCreated,
}: {
  stations: { id: string; name: string }[];
  onBack: () => void;
  onCreated: () => void;
}) {
  const [fullName, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('SWAPPER');
  const [phoneNumber, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [stationId, setStation] = useState('');
  const [status, setStatus] = useState('PENDING');
  const [sendInvite, setInvite] = useState(false);
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ invitationStatus?: string; isActive: boolean } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');

    if (!fullName.trim()) {
      setError('Renseignez le nom du collaborateur.');
      return;
    }
    if (
      status === 'ACTIVE' &&
      (password.length < 8 || new TextEncoder().encode(password).length > 72)
    ) {
      setError('Utilisez un mot de passe de 8 caractères minimum, sans dépasser 72 octets.');
      return;
    }

    setBusy(true);

    try {
      const created = await api<{ invitationStatus?: string; isActive: boolean }>('/auth/register', {
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        role,
        accountStatus: status,
        sendInvite: status === 'PENDING' && sendInvite,
        ...(status === 'ACTIVE' ? { password } : {}),
        ...(phoneNumber.trim() ? { phoneNumber: phoneNumber.trim() } : {}),
        ...(address.trim() ? { address: address.trim() } : {}),
        ...(stationId ? { stationId } : {}),
      });

      setPassword('');
      setResult(created);
      onCreated();

      if (created.invitationStatus !== 'DELIVERY_FAILED') {
        notify('Utilisateur créé.');
        onBack();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Création impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-card user-create-card">
      <div className="user-create-header">
        <button type="button" className="text-button back-link" onClick={onBack}>
          <ArrowLeft size={16} />
          <span>Utilisateurs</span>
        </button>
        <h2>Nouveau collaborateur</h2>
        <p className="editor-subtitle">
          Renseignez les informations personnelles et configurez les droits d'accès au compte.
        </p>
      </div>

      {result ? (
        <div className="admin-empty user-create-success" role="status">
          <span className="success-icon-wrap">
            <CheckCheck size={36} />
          </span>
          <h2>Utilisateur créé</h2>
          <p>
            {result.isActive
              ? 'Le compte est actif.'
              : result.invitationStatus === 'SENT'
              ? 'L’invitation a été envoyée par e-mail.'
              : result.invitationStatus === 'DELIVERY_FAILED'
              ? 'Le compte est créé, mais l’envoi de l’invitation a échoué. Il reste en attente d’activation.'
              : 'Le compte est en attente d’activation. L’invitation pourra être envoyée ensuite.'}
          </p>
          <button type="button" className="admin-button" onClick={onBack}>
            Voir les utilisateurs
          </button>
        </div>
      ) : (
        <form onSubmit={submit} aria-busy={busy} className="user-create-form">
          <fieldset disabled={busy} className="editor-fieldset">
            {/* Section 1 : Informations personnelles & Rôle */}
            <div className="form-section">
              <h3 className="form-section-title">Informations du collaborateur</h3>
              <div className="user-form-grid-2">
                <label className="form-group">
                  <span>Nom complet <mark>*</mark></span>
                  <input
                    autoComplete="name"
                    required
                    maxLength={120}
                    placeholder="ex: Dylane Tchassem"
                    value={fullName}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>

                <label className="form-group">
                  <span>Adresse e-mail <mark>*</mark></span>
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                    placeholder="ex: dylane@uswap.cm"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>

                <label className="form-group">
                  <span>Rôle <mark>*</mark></span>
                  <select
                    aria-label="Rôle"
                    value={role}
                    onChange={(event) => {
                      setRole(event.target.value as Role);
                      setStation('');
                    }}
                  >
                    {Object.entries(roles).map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="form-group">
                  <span>Téléphone <small>(facultatif)</small></span>
                  <input
                    type="tel"
                    maxLength={30}
                    placeholder="ex: 699000000"
                    value={phoneNumber}
                    onChange={(event) => setPhone(event.target.value)}
                  />
                </label>

                <label className="form-group span-2">
                  <span>Adresse <small>(facultatif)</small></span>
                  <input
                    maxLength={250}
                    placeholder="ex: Douala, Akwa"
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                  />
                </label>

                {role === 'STATION_CHIEF' && (
                  <label className="form-group span-2">
                    <span>Station rattachée</span>
                    <select
                      aria-label="Station rattachée"
                      value={stationId}
                      onChange={(event) => setStation(event.target.value)}
                    >
                      <option value="">À définir</option>
                      {stations.map((station) => (
                        <option value={station.id} key={station.id}>
                          {station.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </div>

            <hr className="form-divider" />

            {/* Section 2 : Accès au compte */}
            <div className="form-section">
              <h3 className="form-section-title">Accès au compte & Sécurité</h3>
              <div className="user-form-grid-2">
                <label className="form-group">
                  <span>Statut initial</span>
                  <select
                    aria-label="Statut initial"
                    value={status}
                    onChange={(event) => {
                      setStatus(event.target.value);
                      setPassword('');
                    }}
                  >
                    <option value="PENDING">En attente d’activation</option>
                    <option value="ACTIVE">Actif</option>
                  </select>
                </label>

                {status === 'ACTIVE' && (
                  <label className="form-group">
                    <span>Mot de passe <mark>*</mark></span>
                    <div className="input-wrap">
                      <input
                        type={visible ? 'text' : 'password'}
                        autoComplete="new-password"
                        minLength={8}
                        required
                        placeholder="••••••••"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                      />
                      <button
                        type="button"
                        className="eye-button"
                        onClick={() => setVisible(!visible)}
                        aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                      >
                        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </label>
                )}
              </div>

              {status === 'PENDING' && (
                <div className="user-form-options">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={sendInvite}
                      onChange={(event) => setInvite(event.target.checked)}
                    />
                    <span>Envoyer l’invitation par e-mail maintenant</span>
                  </label>
                </div>
              )}
            </div>
          </fieldset>

          {error && (
            <div className="error-message" role="alert">
              {error}
            </div>
          )}

          <div className="modal-form-actions">
            <button
              type="button"
              className="admin-button secondary"
              onClick={onBack}
              disabled={busy}
            >
              Annuler
            </button>
            <button type="submit" className="admin-button" disabled={busy}>
              {busy && <LoaderCircle className="spin" size={16} />}
              Créer l’utilisateur
            </button>
          </div>
        </form>
      )}
    </section>
  );
}