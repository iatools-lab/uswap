// Cache uniquement les ressources publiques explicitement autorisées.
// Les réponses API, sessions, QR et données d'autres utilisateurs ne sont
// jamais mises en cache par le service worker.
// Toute modification de ce fichier suffit a declencher la mise a jour du
// service worker installe dans les navigateurs (octet par octet).
const BUILD = "2026-10-29-2";
const CACHE = `uswap-public-${BUILD}`;
const PUBLIC = [
  "/offline.html",
  "/icons/app-192.png",
  "/icons/app-512.png",
  "/icons/app-maskable.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PUBLIC)));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("uswap-public-") && key !== CACHE)
          await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // Le reseau d'abord (sinon une version deployee n'apparaitrait jamais),
    // et la page hors connexion en secours.
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline.html")),
    );
  } else if (url.pathname === "/" || url.pathname === "/index.html") {
    // Coquille de la SPA (et jetons d'invitation `?token=` ou `#token` portes
    // par l'URL) : jamais servie depuis le cache, sinon le navigateur execute
    // le bundle d'une version precedente et les modifications deployees
    // n'apparaissent pas. `cache: "no-store"` double le `Cache-Control` de
    // Nginx. L'activation immediate du nouveau service worker est assuree
    // dans src/ui/PwaStatus.tsx.
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .then((response) => {
          // En-tete de version du service worker (diagnostic).
          const headers = new Headers(response.headers);
          headers.set("X-Uswap-Build", String(BUILD));
          return response.text().then(
            (body) =>
              new Response(body, {
                status: response.status,
                statusText: response.statusText,
                headers,
              }),
          );
        })
        .catch(() => caches.match("/offline.html")),
    );
  } else if (PUBLIC.includes(url.pathname) && !url.search) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request)),
    );
  }
});

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || "uSwap";
  const options = {
    body: data.body || "Vous avez une nouvelle notification.",
    data: { link: data.link || "/app" },
    icon: "/icons/app-192.png",
    badge: "/icons/app-192.png",
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.link || "/app";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => "focus" in client);
      if (existing) {
        existing.navigate(new URL(target, self.location.origin).href);
        return existing.focus();
      }
      return self.clients.openWindow(new URL(target, self.location.origin).href);
    }),
  );
});
