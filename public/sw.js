// Only public, explicitly listed files are cached. Never cache API responses,
// authentication links, QR tokens or authenticated HTML/data.
const CACHE = 'uswap-public-v1';
const PUBLIC = ['/offline.html','/icons/app-192.png','/icons/app-512.png','/icons/app-maskable.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PUBLIC))));
self.addEventListener('activate', event => event.waitUntil((async()=>{
  for (const key of await caches.keys()) if(key.startsWith('uswap-public-') && key!==CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const request=event.request, url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin) return;
  if(request.mode==='navigate') {
    event.respondWith(fetch(request).catch(()=>caches.match('/offline.html')));
  } else if(PUBLIC.includes(url.pathname) && !url.search) {
    event.respondWith(caches.match(request).then(cached=>cached||fetch(request)));
  }
});
