/**
 * Loads the Leaflet runtime from the CDN exactly once and resolves when it is
 * ready to use.
 *
 * Every map in the app needs `window.L`. Components that mount before it is
 * fetched used to bail out silently (`if (!L) return`) and the map never
 * appeared. Awaiting this promise removes that race.
 */

const LEAFLET_VERSION = "1.9.4";
const LEAFLET_CSS = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;
const LEAFLET_JS = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;

const LEAFLET_TIMEOUT_MS = 15_000;

let pending: Promise<typeof window.L> | null = null;

function injectStylesheet() {
  if (document.querySelector(`link[href="${LEAFLET_CSS}"]`)) return;

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = LEAFLET_CSS;
  document.head.appendChild(link);
}

/** Resolves with the Leaflet global, loading it first if needed. */
export function loadLeaflet(): Promise<typeof window.L> {
  const existing = (window as { L?: typeof window.L }).L;

  if (existing) return Promise.resolve(existing);

  if (pending) return pending;

  pending = new Promise<typeof window.L>((resolve, reject) => {
    injectStylesheet();

    const script = document.createElement("script");
    script.src = LEAFLET_JS;
    script.async = true;

    const timer = window.setTimeout(() => {
      pending = null;
      reject(new Error("Délai dépassé lors du chargement de la carte."));
    }, LEAFLET_TIMEOUT_MS);

    script.onload = () => {
      window.clearTimeout(timer);
      const loaded = (window as { L?: typeof window.L }).L;

      if (loaded) {
        resolve(loaded);
      } else {
        pending = null;
        reject(new Error("La carte n'a pas pu être initialisée."));
      }
    };

    script.onerror = () => {
      window.clearTimeout(timer);
      // Allow a later attempt to retry instead of caching the failure forever.
      pending = null;
      reject(new Error("Impossible de charger la carte. Vérifiez votre connexion."));
    };

    document.head.appendChild(script);
  });

  return pending;
}
