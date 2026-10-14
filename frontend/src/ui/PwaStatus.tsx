import { useEffect, useRef, useState } from "react";
import { CloudArrowUpIcon, WifiSlashIcon } from "./icons";
import { pending, subscribeOutbox } from "../features/offline/outbox";
import { useI18n } from "../app/i18n";

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

/**
 * Indicateur global PWA : signale la perte de connexion et propose
 * l'installation de l'application. Enregistre le service worker en production.
 */
export function PwaStatus() {
  const { t } = useI18n();
  const [online, setOnline] = useState(navigator.onLine);
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [queued, setQueued] = useState(0);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(
    null,
  );
  const [updating, setUpdating] = useState(false);
  const updateRequested = useRef(false);

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

    const controllerChanged = () => {
      if (updateRequested.current) window.location.reload();
    };
    if (
      "serviceWorker" in navigator &&
      (import.meta as unknown as { env: { PROD: boolean } }).env.PROD
    ) {
      // L'application reste utilisable si l'installation du service worker échoue.
      navigator.serviceWorker
        .register("/sw.js")
        .then((value) => {
          const offerWaitingWorker = () => {
            if (value.waiting && navigator.serviceWorker.controller)
              setWaitingWorker(value.waiting);
          };
          offerWaitingWorker();
          value.addEventListener("updatefound", () => {
            const installing = value.installing;
            installing?.addEventListener("statechange", () => {
              if (installing.state === "installed") offerWaitingWorker();
            });
          });
          // Vérifie aussi une version déployée depuis l'ouverture de l'onglet.
          void value.update().catch(() => {});
        })
        .catch(() => {});
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        controllerChanged,
      );
    }

    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      window.removeEventListener("beforeinstallprompt", available);
      window.removeEventListener("appinstalled", installed);
      if ("serviceWorker" in navigator)
        navigator.serviceWorker.removeEventListener(
          "controllerchange",
          controllerChanged,
        );
      unsubscribe();
    };
  }, []);

  if (!online || queued > 0) {
    return (
      <div
        className={`pwa-status pwa-status--sync ${online ? "is-syncing" : "is-offline"}`}
        role="status"
      >
        {online ? <CloudArrowUpIcon /> : <WifiSlashIcon />}
        <span>
          <strong>
            {online
              ? t("Synchronisation en attente")
              : t("Mode hors connexion")}
          </strong>
          <small>
            {queued
              ? `${queued} ${t(queued === 1 ? "opération conservée" : "opérations conservées")} ${t("sur cet appareil")}`
              : t("Votre dernier planning reste disponible")}
          </small>
        </span>
      </div>
    );
  }

  if (waitingWorker && !dismissed) {
    return (
      <div className="pwa-status pwa-status--update" role="status">
        <span>
          <strong>{t("Une nouvelle version de uSwap est prête.")}</strong>
          <small>
            {t("Actualisez pour utiliser les dernières améliorations.")}
          </small>
        </span>
        <button
          type="button"
          disabled={updating}
          onClick={() => {
            updateRequested.current = true;
            setUpdating(true);
            waitingWorker.postMessage({ type: "SKIP_WAITING" });
          }}
        >
          {updating ? t("Mise à jour…") : t("Actualiser")}
        </button>
        <button
          type="button"
          aria-label={t("Fermer la notification de mise à jour")}
          onClick={() => setDismissed(true)}
        >
          {t("Plus tard")}
        </button>
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
      <span>{t("uSwap sur votre écran d’accueil")}</span>
      <button type="button" onClick={promptInstall}>
        {t("Installer")}
      </button>
      <button
        type="button"
        aria-label={t("Fermer la proposition d’installation")}
        onClick={() => setDismissed(true)}
      >
        {t("Fermer")}
      </button>
    </div>
  );
}
