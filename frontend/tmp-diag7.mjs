export default async function run(page, ui) {
  const net = [];
  const errors = [];
  page.on("response", async (res) => {
    const url = res.url();
    if (!url.includes(":3000")) return;
    if (res.status() >= 400) {
      net.push({
        status: res.status(),
        url: url.replace("http://localhost:3000", ""),
        body: (await res.text().catch(() => "")).slice(0, 200),
      });
    }
  });
  page.on("pageerror", (e) => errors.push(String(e.message)));

  await page.fill("#identifier", "admin@upowa.org");
  await page.fill("input[type=password]", "Uswap2026!Demo");
  await page.click("button[type=submit]");
  await page.waitForTimeout(4500);

  net.length = 0;
  errors.length = 0;
  await page.goto("http://127.0.0.1:5173/app/admin/plannings");
  await page.waitForTimeout(5000);

  const out = {
    plannerUrl: page.url(),
    plannerErrors: [...errors],
    plannerFailures: [...net],
    plannerText: await page.evaluate(() =>
      document.body.innerText.slice(0, 600),
    ),
  };

  // Station map tab
  net.length = 0;
  errors.length = 0;
  await page.goto("http://127.0.0.1:5173/app/admin/stations?tab=map");
  await page.waitForTimeout(4500);
  out.mapErrors = [...errors];
  out.mapFailures = [...net];
  out.mapText = await page.evaluate(() =>
    document.body.innerText.slice(0, 500),
  );
  out.mapMarkers = await page.evaluate(() => {
    const t = document.body.innerHTML;
    return {
      hasLeaflet: /leaflet/i.test(t),
      markerCount: document.querySelectorAll(
        ".leaflet-marker-icon, [class*=marker]",
      ).length,
    };
  });

  return out;
}
