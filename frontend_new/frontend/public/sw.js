// Cache uniquement les ressources publiques explicitement autorisées.
// Les réponses API, sessions, QR et données d'autres utilisateurs ne sont
// jamais mises en cache par le service worker.
const CACHE = "uswap-public-v2";
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
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline.html")),
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
