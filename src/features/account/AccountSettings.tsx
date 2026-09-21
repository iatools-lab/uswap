import { useState } from 'react';
import { LockKeyIcon, UserIcon } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { roles, type User } from '../../api/auth-api';

export function AccountSettings({user}:{user:User}) {
  const [section,setSection]=useState<'profile'|'security'>('profile');
  return <div className="account-settings">
    <div className="settings-tabs" aria-label="Rubriques des paramètres">
      <button aria-pressed={section==='profile'} onClick={()=>setSection('profile')}><UserIcon size={19}/>Profil</button>
      <button aria-pressed={section==='security'} onClick={()=>setSection('security')}><LockKeyIcon size={19}/>Sécurité</button>
    </div>
    {section==='profile'?<section className="settings-panel">
      <h2>Informations personnelles</h2>
      <div className="settings-identity"><span className="settings-avatar">{user.fullName.trim().charAt(0).toUpperCase()}</span><div><strong>{user.fullName}</strong><span>{roles[user.role]}</span></div></div>
      <dl className="settings-fields"><div><dt>Nom complet</dt><dd>{user.fullName}</dd></div><div><dt>Adresse e-mail</dt><dd>{user.email}</dd></div></dl>
      <p className="settings-note">Les informations du compte sont gérées par votre administrateur.</p>
    </section>:<section className="settings-panel"><h2>Mot de passe</h2><p>Recevez un lien par e-mail pour définir un nouveau mot de passe.</p><Link className="admin-button" to="/auth/forgot-password">Réinitialiser mon mot de passe</Link></section>}
  </div>;
}
