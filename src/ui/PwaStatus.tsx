import { useEffect, useState } from "react";

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

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);

    const available = (event: Event) => {
      event.preventDefault();
      setInstall(event as InstallEvent);
    };
    const installed = () => setInstall(null);

    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    window.addEventListener("beforeinstallprompt", available);
    window.addEventListener("appinstalled", installed);

    if ("serviceWorker" in navigator && (import.meta as unknown as { env: { PROD: boolean } }).env.PROD) {
      // L'application reste utilisable si l'installation du service worker échoue.
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      window.removeEventListener("beforeinstallprompt", available);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  if (!online) {
    return (
      <div className="pwa-status" role="status">
        Hors connexion · Reconnectez-vous pour enregistrer vos opérations.
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
