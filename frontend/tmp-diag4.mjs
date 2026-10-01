export default async function run(page, ui) {
  const bodies = [];
  page.on("request", (req) => {
    if (req.url().includes("/auth/refresh")) {
      bodies.push({ method: req.method(), body: req.postData() });
    }
  });

  await page.fill("#identifier", "admin@upowa.org");
  await page.fill("input[type=password]", "Uswap2026!Demo");
  await page.click("button[type=submit]");
  await page.waitForTimeout(4000);

  const storedAfterLogin = await page.evaluate(() => ({
    refresh: localStorage.getItem("uswap-refresh-token"),
    user: localStorage.getItem("uswap-session-user"),
  }));

  bodies.length = 0;

  // Simulate a full page reload, which is what broke the user's session.
  await page.goto("http://127.0.0.1:5173/app/admin/utilisateurs");
  await page.waitForTimeout(4000);

  const storedAfterReload = await page.evaluate(() => ({
    refresh: localStorage.getItem("uswap-refresh-token"),
    user: localStorage.getItem("uswap-session-user"),
  }));

  return {
    refreshLenAfterLogin: storedAfterLogin.refresh
      ? storedAfterLogin.refresh.length
      : null,
    userAfterLogin: storedAfterLogin.user
      ? storedAfterLogin.user.slice(0, 80)
      : null,
    refreshCallsOnReload: bodies,
    refreshLenAfterReload: storedAfterReload.refresh
      ? storedAfterReload.refresh.length
      : null,
    userAfterReload: storedAfterReload.user,
    finalUrl: page.url(),
  };
}
