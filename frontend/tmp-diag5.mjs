export default async function run(page, ui) {
  const net = [];
  page.on("response", async (res) => {
    const url = res.url();
    if (!url.includes(":3000")) return;
    let body = "";
    if (res.status() >= 400) {
      body = await res.text().catch(() => "");
    }
    net.push({
      status: res.status(),
      url: url.replace("http://localhost:3000", ""),
      body: body.slice(0, 300),
    });
  });

  await page.fill("#identifier", "admin@upowa.org");
  await page.fill("input[type=password]", "Uswap2026!Demo");
  await page.click("button[type=submit]");
  await page.waitForTimeout(4000);

  const results = {};
  results.landing = page.url();
  results.hasBell = await page.evaluate(
    () => !!document.querySelector(".notification-bell"),
  );

  // Drive the SPA the way a user does: click the sidebar, no full reload.
  const steps = [
    ["Utilisateurs", "/app/admin/utilisateurs"],
    ["Stations", "/app/admin/stations"],
    ["Plannings", "/app/admin/plannings"],
  ];

  for (const [label, expected] of steps) {
    net.length = 0;
    await page.evaluate((path) => {
      const link = Array.from(document.querySelectorAll("a")).find(
        (a) => a.getAttribute("href") === path,
      );
      if (link) link.click();
    }, expected);
    await page.waitForTimeout(4000);
    results[label] = {
      url: page.url(),
      net: [...net],
      text: await page.evaluate(() => document.body.innerText.slice(0, 500)),
    };
  }

  return results;
}
