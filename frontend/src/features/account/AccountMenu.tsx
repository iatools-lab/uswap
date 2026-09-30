import { useEffect, useRef, useState } from 'react';
import { GearIcon } from '@phosphor-icons/react';
import { LogOut } from '../../ui/icons';
import type { User } from '../../api/auth-api';

export function AccountMenu({user,busy,onLogout,settingsPath}:{user:User;busy:boolean;onLogout:()=>void;settingsPath:string}) {
  const [open,setOpen]=useState(false);
  const root=useRef<HTMLDivElement>(null);
  const trigger=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);trigger.current?.focus();}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[open]);
  return <div className="account-tools" ref={root} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setOpen(false);}}>
    <button ref={trigger} className="account-trigger" aria-label="Ouvrir le menu du compte" aria-expanded={open} aria-controls="account-popover" onClick={()=>setOpen(!open)}>{user.fullName.trim().charAt(0).toUpperCase()}</button>
    {open&&<div id="account-popover" className="account-popover">
      <div className="account-summary"><strong>{user.fullName}</strong><span>{user.email}</span>{user.stationName && <span className="account-station">Station : {user.stationName}</span>}</div>
      <a href={settingsPath}><GearIcon size={20}/>Paramètres</a>
      <button onClick={onLogout} disabled={busy}><LogOut size={20}/>{busy?'Déconnexion…':'Se déconnecter'}</button>
    </div>}
  </div>;
}
