// App shell only: business data stays in the local mock store / IndexedDB.
// Authentication URLs, QR tokens and API-like requests are never cached here.
const CACHE = 'uswap-public-v2';
const PUBLIC = ['/','/index.html','/offline.html','/manifest.webmanifest','/icons/app-192.png','/icons/app-512.png','/icons/app-maskable.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PUBLIC))));
self.addEventListener('activate', event => event.waitUntil((async()=>{
  for (const key of await caches.keys()) if(key.startsWith('uswap-public-') && key!==CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const request=event.request, url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin) return;
  if(request.mode==='navigate') {
    event.respondWith(fetch(request).then(response=>{
      const copy=response.clone(); caches.open(CACHE).then(cache=>cache.put('/index.html',copy)); return response;
    }).catch(()=>caches.match('/index.html').then(cached=>cached||caches.match('/offline.html'))));
  } else if((PUBLIC.includes(url.pathname)||url.pathname.startsWith('/assets/')) && !url.search) {
    event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{
      if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy));}return response;
    })));
  }
});
