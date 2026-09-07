import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, Eye, EyeOff, Zap, ArrowUpRight, LoaderCircle, X, Mail } from './icons';
import '@fontsource/poppins/latin-400.css';
import '@fontsource/poppins/latin-500.css';
import '@fontsource/poppins/latin-600.css';
import '@fontsource/poppins/latin-700.css';
import { IconContext } from '@phosphor-icons/react';
import './styles.css';

import { login, logout, refresh, api, forgetSession, rolePaths, type Session, type User } from './auth-api';
import { AccountAccess } from './AccountAccess';
import { SessionHome } from './SessionHome';
import { AdminWorkspace, isAdminPath } from './AdminWorkspace';
const accountMode = location.pathname === '/auth/activate' ? 'activate' : location.pathname === '/auth/reset-password' ? 'reset' : location.pathname === '/auth/forgot-password' ? 'forgot' : null;

document.title = `${accountMode === 'activate' ? 'Activation' : accountMode === 'reset' ? 'Réinitialisation' : accountMode === 'forgot' ? 'Mot de passe oublié' : 'Connexion'} · uSwap`;

function App() {
 const [identifier,setIdentifier]=useState(''); const [password,setPassword]=useState('');
 const [visible,setVisible]=useState(false); const [busy,setBusy]=useState(false);
 const [error,setError]=useState(''); const [submitted,setSubmitted]=useState(false);
 const [help,setHelp]=useState<'invite'|null>(null);
 const [capsLock,setCapsLock]=useState(false);
 const [session,setSession]=useState<Session|null>(null);
 const [checking,setChecking]=useState(!accountMode);
 const [deadline,setDeadline]=useState(0);
 const [warning,setWarning]=useState(false);
 function accept(data: Session, preservePath=false) { setSession(data); setDeadline(Date.now()+data.expiresIn*1000); setWarning(false); document.title='Mon espace · uSwap'; if(!(preservePath&&data.user.role==='ADMIN'&&isAdminPath(location.pathname)))history.replaceState(null,'',rolePaths[data.user.role]); }
 function clear() { forgetSession(); setSession(null); setPassword(''); setVisible(false); setSubmitted(false); setDeadline(0); setWarning(false); document.title='Connexion · uSwap'; history.replaceState(null,'','/auth/login'); }
 useEffect(()=>{
  // A restored browser page must not display an old authenticated snapshot.
  const hide=()=>{document.getElementById('root')!.style.visibility='hidden';};
  const restore=(event:PageTransitionEvent)=>{if(event.persisted)location.reload();};
  const openToken=()=>{if(new URLSearchParams(location.hash.slice(1)).has('token'))location.reload();};
  window.addEventListener('pagehide',hide);
  window.addEventListener('pageshow',restore);
  window.addEventListener('hashchange',openToken);
  const channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('uswap-session');
  if(channel)channel.onmessage=event=>{if(event.data==='logout'&&!accountMode){clear();setError('Votre session a été fermée.');}};
  return ()=>{window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',restore);window.removeEventListener('hashchange',openToken);channel?.close();};
 },[]);
 useEffect(()=>{
  if(accountMode)return;
  let active=true;
  refresh().then(data=>{if(active)accept(data,true);}).catch(()=>{if(active)clear();}).finally(()=>{if(active)setChecking(false);});
  return ()=>{active=false;};
 },[]);
 useEffect(()=>{
  if(!session)return;
  const tick=()=>{const remaining=deadline-Date.now();setWarning(remaining<=60_000);if(remaining<=0){clear();setError('Votre session a expiré. Veuillez vous reconnecter.');}};
  const timer=setInterval(tick,1000);
  const check=()=>{tick();if(document.visibilityState==='visible')api<{user:User}>('/auth/me').then(({user})=>{setSession(s=>s?{...s,user}:null);if(!(user.role==='ADMIN'&&isAdminPath(location.pathname)))history.replaceState(null,'',rolePaths[user.role]);}).catch(()=>clear());};
  document.addEventListener('visibilitychange',check);
  return ()=>{clearInterval(timer);document.removeEventListener('visibilitychange',check);};
 },[session?.user.id,deadline]);
 async function disconnect(){setBusy(true);setError('');try{await logout();clear();if(typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel('uswap-session');channel.postMessage('logout');channel.close();}}catch(e){setError(e instanceof Error?e.message:'Déconnexion impossible.');}finally{setBusy(false);}}
 async function extend(){setBusy(true);try{accept(await refresh(),true);}catch{clear();setError('Votre session a expiré. Veuillez vous reconnecter.');}finally{setBusy(false);}}

 async function submit(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();setSubmitted(true);setError('');
  const emailInput=e.currentTarget.elements.namedItem('username') as HTMLInputElement;
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.trim())||!emailInput.validity.valid){emailInput.focus();return;}
  if(!password){(e.currentTarget.elements.namedItem('password') as HTMLInputElement).focus();return;}
  if(new TextEncoder().encode(password).length>72){setError('Ce mot de passe est trop long.');return;}
  setBusy(true);
  try { accept(await login(identifier.trim(),password)); setPassword(''); }
  catch(e){setError(e instanceof Error?e.message:'Connexion impossible.');}
  finally{setBusy(false);}

 }
 if(!accountMode&&session?.user.role==='ADMIN')return <AdminWorkspace user={session.user} busy={busy} warning={warning} error={error} onLogout={disconnect} onExtend={extend} onAccessLost={()=>{clear();setError('Votre session ou vos droits ont changé. Veuillez vous reconnecter.');}}/>;
 return <main className="auth-layout">
  <aside className="brand-panel" aria-label="Bienvenue sur uSwap">
   <a className="brand" href="/" aria-label="uSwap, Powered by uPowa — accueil"><span className="brand-symbol"><Zap size={25} fill="currentColor"/></span><span className="brand-lockup"><span className="brand-name">u<span className="brand-swap">Swap</span><span className="brand-dot">.</span></span><span className="brand-endorsement">Powered by <strong>uPowa</strong></span></span></a>
   <div className="battery-art" aria-hidden="true"><div className="battery-halo"/><div className="battery battery-back"><div className="battery-cap"/><div className="battery-indicator"/><Zap weight="fill"/></div><div className="battery battery-front"><div className="battery-cap"/><div className="battery-indicator"/><Zap weight="fill"/></div><div className="battery-plinth"/></div>
   <div className="brand-story"><h1>La gestion de vos stations,<br/><span>en un seul endroit.</span></h1></div>

  </aside>
  <section className="form-panel">
   <div className="form-content">
    {accountMode?<AccountAccess mode={accountMode}/>:checking?<div className="session-check" role="status"><LoaderCircle className="spin" size={22}/><span>Vérification de votre session…</span></div>:session?<SessionHome user={session.user} busy={busy} warning={warning} error={error} onLogout={disconnect} onExtend={extend}/>:<>
    <h2 className="login-title">Bon retour.</h2>
    <form onSubmit={submit} noValidate>
     <div className="field"><label htmlFor="identifier">Adresse e-mail</label><div className={`input-wrap ${submitted&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.trim())?'invalid':''}`}><input id="identifier" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} type="email" inputMode="email" required maxLength={254} placeholder="Votre adresse e-mail" value={identifier} onChange={e=>{setIdentifier(e.target.value);setError('');}} aria-invalid={submitted&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.trim())} aria-describedby={submitted&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.trim())?'identifier-error':undefined} disabled={busy}/></div>{submitted&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.trim())&&<span id="identifier-error" className="field-error">Saisissez une adresse e-mail valide.</span>}</div>
     <div className="field"><div className="label-row"><label htmlFor="password">Mot de passe</label><button type="button" className="text-button" onClick={()=>location.assign('/auth/forgot-password')}>Mot de passe oublié ?</button></div><div className={`input-wrap ${submitted&&!password?'invalid':''}`}><input id="password" name="password" type={visible?'text':'password'} autoComplete="current-password" placeholder="Votre mot de passe" value={password} onChange={e=>{setPassword(e.target.value);setError('');}} onKeyUp={e=>setCapsLock(e.getModifierState('CapsLock'))} onBlur={()=>setCapsLock(false)} aria-invalid={submitted&&!password} aria-describedby={submitted&&!password?'password-error':undefined} disabled={busy}/><button className="eye-button" type="button" onClick={()=>setVisible(!visible)} aria-label={visible?'Masquer le mot de passe':'Afficher le mot de passe'} aria-pressed={visible}>{visible?<EyeOff size={19}/>:<Eye size={19}/>}</button></div>{submitted&&!password&&<span id="password-error" className="field-error">Saisissez votre mot de passe.</span>}{capsLock&&<span className="field-hint" role="status">La touche Verr. Maj est activée.</span>}</div>
     {error&&<div className="error-message" role="alert">{error}</div>}
     <button className="submit-button" disabled={busy} type="submit">{busy?<><LoaderCircle className="spin" size={19}/>Connexion en cours…</>:<>Se connecter<ArrowRight size={19}/></>}</button>
    </form>
    <div className="invite-note">Première connexion ? <button className="text-button" onClick={()=>setHelp('invite')}>Activer mon accès <ArrowUpRight size={13}/></button></div>
    </>}
   </div>
  </section>
  {help&&<div className="dialog-backdrop" onClick={()=>setHelp(null)}><dialog open aria-modal="true" aria-labelledby="help-title" ref={el=>el?.focus()} tabIndex={-1} onKeyDown={e=>{if(e.key==='Escape')setHelp(null);if(e.key==='Tab'){e.preventDefault();e.currentTarget.querySelector('button')?.focus();}}} onClick={e=>e.stopPropagation()}><button className="dialog-close" autoFocus aria-label="Fermer" onClick={()=>setHelp(null)}><X/></button><div className="form-icon"><Mail/></div><h2 id="help-title">Activez votre accès</h2><p>Ouvrez le lien d’activation reçu par e-mail pour définir votre mot de passe. Si vous n’avez pas reçu d’invitation, contactez votre administrateur.</p></dialog></div>}
 </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><IconContext.Provider value={{ weight: 'duotone', size: 22 }}><App/></IconContext.Provider></React.StrictMode>);

