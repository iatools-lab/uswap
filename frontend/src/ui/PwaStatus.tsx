import { useEffect, useState } from "react";
import { CloudArrowUpIcon, WifiSlashIcon } from "@phosphor-icons/react";
import { pending, subscribeOutbox } from "../features/offline/outbox";

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

/**
 * Indicateur global PWA : signale la perte de connexion et propose
 * l'installation de l'application. Enregistre le service worker en production.
 */
export function PwaStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [queued, setQueued] = useState(0);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);

    const available = (event: Event) => {
      event.preventDefault();
      setInstall(event as InstallEvent);
    };
    const installed = () => setInstall(null);
    const count = () => void pending().then((rows) => setQueued(rows.length));

    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    window.addEventListener("beforeinstallprompt", available);
    window.addEventListener("appinstalled", installed);
    const unsubscribe = subscribeOutbox(count);
    count();

    if ("serviceWorker" in navigator && (import.meta as unknown as { env: { PROD: boolean } }).env.PROD) {
      // L'application reste utilisable si l'installation du service worker échoue.
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      window.removeEventListener("beforeinstallprompt", available);
      window.removeEventListener("appinstalled", installed);
      unsubscribe();
    };
  }, []);

  if (!online || queued > 0) {
    return (
      <div className={`pwa-status pwa-status--sync ${online ? "is-syncing" : "is-offline"}`} role="status">
        {online ? <CloudArrowUpIcon /> : <WifiSlashIcon />}
        <span><strong>{online ? "Synchronisation en attente" : "Mode hors connexion"}</strong><small>{queued ? `${queued} opération(s) conservée(s) sur cet appareil` : "Votre dernier planning reste disponible"}</small></span>
      </div>
    );
  }

  if (!install || dismissed) return null;

  async function promptInstall() {
    if (!install) return;
    await install.prompt();
    await install.userChoice;
    setInstall(null);
  }

  return (
    <div className="pwa-status">
      <span>uSwap sur votre écran d’accueil</span>
      <button type="button" onClick={promptInstall}>
        Installer
      </button>
      <button
        type="button"
        aria-label="Fermer la proposition d’installation"
        onClick={() => setDismissed(true)}
      >
        Fermer
      </button>
    </div>
  );
}
