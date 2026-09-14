const {chromium}=require('playwright'), http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
async function main(){
 const root=path.resolve(__dirname,'../dist');
 const server=http.createServer(async(req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);let file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep)){file=path.join(root,'index.html');}let data;try{data=await fs.readFile(file);}catch{file=path.join(root,'index.html');data=await fs.readFile(file);}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream');res.end(data);}catch{res.statusCode=500;res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const page=await context.newPage();
  // Authentication unavailable on this isolated production-build origin; no real login or mail.
  await page.route('**/auth/refresh',route=>route.fulfill({status:401,body:'{}',contentType:'application/json'}));
  const base='http://127.0.0.1:'+server.address().port;
  await page.goto(base+'/auth/login');await page.getByRole('heading',{name:'Connexion',exact:true}).waitFor();
  const manifest=await (await context.request.get(base+'/manifest.webmanifest')).json();assert.equal(manifest.display,'standalone');assert.equal(manifest.start_url,'/auth/login');
  for(const icon of manifest.icons){const response=await context.request.get(base+icon.src);assert.equal(response.headers()['content-type'],'image/png');assert((await response.body()).length>1000);}
  await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();
  await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
  await fs.mkdir(path.resolve(__dirname,'../docs/verification/pwa'),{recursive:true});
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.resolve(__dirname,'../docs/verification/pwa/login-mobile.png'),fullPage:true});
  const cached=await page.evaluate(async()=>{const entries=[];for(const key of await caches.keys()){const cache=await caches.open(key);entries.push(...(await cache.keys()).map(r=>new URL(r.url).pathname));}return entries;});assert.deepEqual(cached.sort(),['/icons/app-192.png','/icons/app-512.png','/icons/app-maskable.png','/offline.html'].sort());
  await context.setOffline(true);await page.getByText('Hors connexion · Reconnectez-vous pour enregistrer vos opérations.').waitFor();
  await page.goto(base+'/app/mon-espace');await page.getByRole('heading',{name:'Vous êtes hors connexion'}).waitFor();await page.screenshot({path:path.resolve(__dirname,'../docs/verification/pwa/offline-mobile.png'),fullPage:true});
  await context.setOffline(false);await page.getByRole('link',{name:'Réessayer'}).click();await page.getByRole('heading',{name:'Connexion',exact:true}).waitFor();
  console.log('PASS PWA production build: manifest, PNG icons, service worker, public-only cache, responsive login, offline navigation and online recovery.');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
