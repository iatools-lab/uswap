import { useEffect, useState } from 'react';
type InstallEvent = Event & { prompt:()=>Promise<void>; userChoice:Promise<{outcome:string}> };
export function PwaStatus() {
  const [online,setOnline]=useState(navigator.onLine);
  const [install,setInstall]=useState<InstallEvent|null>(null);
  const [dismissed,setDismissed]=useState(false);
  useEffect(()=>{
    const sync=()=>setOnline(navigator.onLine);
    const available=(event:Event)=>{event.preventDefault();setInstall(event as InstallEvent);};
    const installed=()=>setInstall(null);
    window.addEventListener('online',sync);window.addEventListener('offline',sync);
    window.addEventListener('beforeinstallprompt',available);window.addEventListener('appinstalled',installed);
    if ('serviceWorker' in navigator && (import.meta as unknown as {env:{PROD:boolean}}).env.PROD)
      navigator.serviceWorker.register('/sw.js').catch(()=>{/* The web application remains usable if installation is unavailable. */});
    return ()=>{window.removeEventListener('online',sync);window.removeEventListener('offline',sync);window.removeEventListener('beforeinstallprompt',available);window.removeEventListener('appinstalled',installed);};
  },[]);
  if(!online) return <div className="pwa-status" role="status">Hors connexion · Reconnectez-vous pour enregistrer vos opérations.</div>;
  if(!install||dismissed) return null;
  return <div className="pwa-status"><span>uSwap sur votre écran d’accueil</span><button onClick={async()=>{await install.prompt();await install.userChoice;setInstall(null);}}>Installer</button><button aria-label="Fermer la proposition d’installation" onClick={()=>setDismissed(true)}>Fermer</button></div>;
}
