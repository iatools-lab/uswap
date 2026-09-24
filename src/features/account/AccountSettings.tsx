import { useEffect, useState } from 'react';
import { BellIcon, CheckCircleIcon, LockKeyIcon, UserIcon } from '@phosphor-icons/react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, roles, type User } from '../../api/auth-api';

type Preferences={userId:string;internalEnabled:true;emailEnabled:boolean;pushEnabled:boolean;categories:Record<string,{email:boolean;push:boolean}>;updatedAt:string};
const categoryLabels:Record<string,{title:string;description:string}>={PLANNING:{title:"Planning",description:"Publications et modifications de vos horaires"},ATTENDANCE:{title:"Présence et pointage",description:"Retards, absences et corrections"},LEAVE:{title:"Congés",description:"Décisions et synchronisation des demandes"},INCIDENT:{title:"Incidents",description:"Signalements et évolution des traitements"},REPORT:{title:"Rapports",description:"Exports et rapports périodiques disponibles"}};

export function AccountSettings({user}:{user:User}) {
  const [searchParams,setSearchParams]=useSearchParams();
  const requested=searchParams.get('section');
  const [section,setSection]=useState<'profile'|'security'|'notifications'>(requested==='notifications'?'notifications':'profile');
  function select(next:'profile'|'security'|'notifications'){setSection(next);if(next==='notifications')setSearchParams({section:'notifications'});else setSearchParams({});}
  return <div className="account-settings">
    <div className="settings-tabs" aria-label="Rubriques des paramètres">
      <button aria-pressed={section==='profile'} onClick={()=>select('profile')}><UserIcon size={19}/>Profil</button>
      <button aria-pressed={section==='notifications'} onClick={()=>select('notifications')}><BellIcon size={19}/>Notifications</button>
      <button aria-pressed={section==='security'} onClick={()=>select('security')}><LockKeyIcon size={19}/>Sécurité</button>
    </div>
    {section==='profile'?<section className="settings-panel">
      <h2>Informations personnelles</h2>
      <div className="settings-identity"><span className="settings-avatar">{user.fullName.trim().charAt(0).toUpperCase()}</span><div><strong>{user.fullName}</strong><span>{roles[user.role]}</span></div></div>
      <dl className="settings-fields"><div><dt>Nom complet</dt><dd>{user.fullName}</dd></div><div><dt>Adresse e-mail</dt><dd>{user.email}</dd></div></dl>
      <p className="settings-note">Les informations du compte sont gérées par votre administrateur.</p>
    </section>:section==='notifications'?<NotificationPreferences/>:<section className="settings-panel"><h2>Mot de passe</h2><p>Recevez un lien par e-mail pour définir un nouveau mot de passe.</p><Link className="admin-button" to="/auth/forgot-password">Réinitialiser mon mot de passe</Link></section>}
  </div>;
}

function NotificationPreferences(){
 const [preferences,setPreferences]=useState<Preferences|null>(null);const [busy,setBusy]=useState(false);const [saved,setSaved]=useState(false);
 useEffect(()=>{let active=true;api<Preferences>('/notifications/preferences').then(v=>active&&setPreferences(v));return()=>{active=false}},[]);
 if(!preferences)return <section className="settings-panel"><p>Chargement de vos préférences…</p></section>;
 function channel(channel:'emailEnabled'|'pushEnabled',value:boolean){setPreferences(current=>current?{...current,[channel]:value}:current);setSaved(false)}
 function category(name:string,channel:'email'|'push',value:boolean){setPreferences(current=>current?{...current,categories:{...current.categories,[name]:{...current.categories[name],[channel]:value}}}:current);setSaved(false)}
 async function save(){setBusy(true);setSaved(false);const next=await api<Preferences>('/notifications/preferences',preferences,'PATCH');setPreferences(next);setBusy(false);setSaved(true)}
 return <section className="settings-panel notification-preferences"><div className="settings-panel-heading"><div><h2>Notifications et canaux</h2><p>Les alertes internes restent actives. Choisissez où recevoir les rappels complémentaires.</p></div>{saved&&<span className="settings-saved"><CheckCircleIcon/>Enregistré</span>}</div><div className="notification-channels"><label><span><strong>E-mail</strong><small>Recevoir un résumé dans votre messagerie</small></span><input type="checkbox" checked={preferences.emailEnabled} onChange={e=>channel('emailEnabled',e.target.checked)}/></label><label><span><strong>Notifications push</strong><small>Recevoir les alertes sur cet appareil</small></span><input type="checkbox" checked={preferences.pushEnabled} onChange={e=>channel('pushEnabled',e.target.checked)}/></label></div><div className="notification-matrix"><div className="notification-matrix-head"><span>Type d’alerte</span><span>E-mail</span><span>Push</span></div>{Object.entries(preferences.categories).filter(([name])=>categoryLabels[name]).map(([name,values])=><div className="notification-matrix-row" key={name}><span><strong>{categoryLabels[name].title}</strong><small>{categoryLabels[name].description}</small></span><label><input aria-label={`${categoryLabels[name].title} par e-mail`} type="checkbox" disabled={!preferences.emailEnabled} checked={preferences.emailEnabled&&values.email} onChange={e=>category(name,'email',e.target.checked)}/></label><label><input aria-label={`${categoryLabels[name].title} par notification push`} type="checkbox" disabled={!preferences.pushEnabled} checked={preferences.pushEnabled&&values.push} onChange={e=>category(name,'push',e.target.checked)}/></label></div>)}</div><div className="settings-notification-footer"><p>Les alertes de sécurité et les notifications internes obligatoires ne peuvent pas être désactivées.</p><button className="admin-button primary-cta" disabled={busy} onClick={()=>void save()}>{busy?'Enregistrement…':'Enregistrer mes préférences'}</button></div></section>
}
