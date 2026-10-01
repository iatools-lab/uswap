export default async function run(page, ui) {
  const net = [];
  page.on("response", (res) => {
    const url = res.url();
    if (url.includes(":3000"))
      net.push({
        status: res.status(),
        url: url.replace("http://localhost:3000", ""),
      });
  });

  // Log in as admin.
  await ui.fill("#identifier", "admin@upowa.org");
  await ui.fill("input[type=password]", "Uswap2026!Demo");
  const snap = await ui.snapshot();
  const btn = snap.match(/@(e\d+) button "Se connecter"/)?.[1];
  if (btn) await ui.click(btn);
  await page.waitForTimeout(3000);

  const afterLogin = page.url();

  // Users page
  await page.goto("http://127.0.0.1:5173/app/admin/utilisateurs");
  await page.waitForTimeout(3000);
  const usersText = await page.evaluate(() =>
    document.body.innerText.slice(0, 900),
  );

  // Stations page
  await page.goto("http://127.0.0.1:5173/app/admin/stations");
  await page.waitForTimeout(3000);
  const stationsText = await page.evaluate(() =>
    document.body.innerText.slice(0, 900),
  );

  // Plannings page
  await page.goto("http://127.0.0.1:5173/app/admin/plannings");
  await page.waitForTimeout(3000);
  const plansText = await page.evaluate(() =>
    document.body.innerText.slice(0, 900),
  );

  return {
    afterLogin,
    hasBell: await page.evaluate(
      () => !!document.querySelector(".notification-bell"),
    ),
    net,
    usersText,
    stationsText,
    plansText,
  };
}
