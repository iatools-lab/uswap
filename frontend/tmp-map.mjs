export default async function run(page, ui) {
  const failed = [];
  page.on('requestfailed', (r) => failed.push({ url: r.url(), err: r.failure()?.errorText }));
  page.on('response', (res) => {
    if (res.status() >= 400 && res.url().includes('unpkg')) failed.push({ url: res.url(), status: res.status() });
  });

  await page.fill('#identifier', 'admin@upowa.org');
  await page.fill('input[type=password]', 'Uswap2026!Demo');
  await page.click('button[type=submit]');
  await page.waitForTimeout(4500);

  // Open the station creation form, where the map lives.
  await page.goto('http://127.0.0.1:5173/app/admin/stations');
  await page.waitForTimeout(4000);

  const clicked = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => /créer une station/i.test(x.textContent));
    if (b) { b.click(); return true; }
    return false;
  });

  await page.waitForTimeout(4000);

  const state = await page.evaluate(() => {
    const containers = Array.from(document.querySelectorAll('[class*=map], .leaflet-container'));
    return {
      windowL: typeof window.L,
      leafletCss: Array.from(document.querySelectorAll('link[rel=stylesheet]')).map((l) => l.href).filter((h) => h.includes('leaflet')),
      leafletScripts: Array.from(document.querySelectorAll('script[src]')).map((s) => s.src).filter((h) => h.includes('leaflet')),
      mapContainers: containers.map((c) => ({
        cls: c.className,
        w: c.getBoundingClientRect().width,
        h: c.getBoundingClientRect().height,
        children: c.children.length,
      })),
    };
  });

  return { clicked, state, failed };
}
