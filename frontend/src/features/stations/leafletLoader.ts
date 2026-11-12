type LeafletRuntime = any;

const version = "1.9.4";
const cssUrl = `https://unpkg.com/leaflet@${version}/dist/leaflet.css`;
const scriptUrl = `https://unpkg.com/leaflet@${version}/dist/leaflet.js`;
let pending: Promise<LeafletRuntime> | null = null;

function leafletGlobal(): LeafletRuntime | undefined {
  return (window as Window & { L?: LeafletRuntime }).L;
}

/** Charge une seule instance Leaflet partagée par toutes les cartes. */
export function loadLeaflet(): Promise<LeafletRuntime> {
  const loaded = leafletGlobal();
  if (loaded) return Promise.resolve(loaded);
  if (pending) return pending;

  pending = new Promise<LeafletRuntime>((resolve, reject) => {
    if (!document.querySelector(`link[href="${cssUrl}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = cssUrl;
      document.head.appendChild(link);
    }

    const script = document.createElement("script");
    script.src = scriptUrl;
    script.async = true;
    script.dataset.uswapLeaflet = "true";

    const timer = window.setTimeout(() => {
      script.remove();
      pending = null;
      reject(new Error("Délai dépassé lors du chargement de la carte."));
    }, 15_000);

    script.onload = () => {
      window.clearTimeout(timer);
      const runtime = leafletGlobal();
      if (runtime) resolve(runtime);
      else {
        pending = null;
        reject(new Error("La carte n'a pas pu être initialisée."));
      }
    };

    script.onerror = () => {
      window.clearTimeout(timer);
      script.remove();
      pending = null;
      reject(
        new Error("Impossible de charger la carte. Vérifiez votre connexion."),
      );
    };

    document.head.appendChild(script);
  });

  return pending;
}
