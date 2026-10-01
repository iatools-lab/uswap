export default async function run(page, ui) {
  const net = [];
  page.on("response", (res) => {
    const url = res.url();
    if (url.includes(":3000"))
      net.push(res.status() + " " + url.replace("http://localhost:3000", ""));
  });

  await page.fill("#identifier", "admin@upowa.org");
  await page.fill("input[type=password]", "Uswap2026!Demo");
  await page.click("button[type=submit]");
  await page.waitForTimeout(4000);

  async function visit(path, label) {
    net.length = 0;
    await page.goto("http://127.0.0.1:5173" + path);
    await page.waitForTimeout(4000);
    const text = await page.evaluate(() =>
      document.body.innerText.slice(0, 700),
    );
    return { label, url: page.url(), net: [...net], text };
  }

  const users = await visit("/app/admin/utilisateurs", "USERS");
  const stations = await visit("/app/admin/stations", "STATIONS");
  const plans = await visit("/app/admin/plannings", "PLANNINGS");

  return { users, stations, plans };
}
