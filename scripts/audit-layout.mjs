import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.BASE_URL || "http://127.0.0.1:5174";
const browser = await chromium.launch({ headless: true });

const profiles = [
  {
    name: "administrateur",
    email: "admin@uswap.example.com",
    password: "AdminUswap",
    routes: [
      "/app/admin",
      "/app/admin/utilisateurs",
      "/app/admin/stations?tab=list",
      "/app/admin/stations?tab=map",
      "/app/admin/plannings",
      "/app/admin/compte",
    ],
  },
  {
    name: "superviseur",
    email: "superviseur@uswap.example.com",
    password: "uswap2026",
    routes: [
      "/app/supervision",
      "/app/supervision/pointages",
      "/app/supervision/plannings",
      "/app/supervision/compte",
    ],
    inspectPlanning: true,
  },
  {
    name: "chef de station",
    email: "chef@uswap.example.com",
    password: "uswap2026",
    routes: ["/app/station", "/app/station/plannings", "/app/station/compte"],
  },
  {
    name: "swappeur",
    email: "swappeur@uswap.example.com",
    password: "uswap2026",
    routes: [
      "/app/mon-espace",
      "/app/mon-espace/plannings",
      "/app/mon-espace/conges",
      "/app/mon-espace/compte",
    ],
    inspectPlanning: true,
  },
];

async function login(page, profile) {
  await page.goto(`${baseUrl}/auth/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Choisir un profil" }).click();
  await page.getByRole("option").filter({ hasText: profile.email }).click();
  await page.locator("#password").fill(profile.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/app\//);
}

async function assertNoOverflow(page, label) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(500);
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(
    Math.max(dimensions.document, dimensions.body) <= dimensions.viewport + 1,
    `${label} déborde horizontalement (${Math.max(dimensions.document, dimensions.body)} px pour ${dimensions.viewport} px)`,
  );
}

for (const viewport of [
  { name: "mobile", width: 375, height: 812 },
  { name: "desktop", width: 1440, height: 900 },
]) {
  for (const profile of profiles) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await login(page, profile);
    for (const route of profile.routes) {
      await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
      await assertNoOverflow(
        page,
        `${profile.name} · ${viewport.name} · ${route}`,
      );
      if (profile.inspectPlanning && route.endsWith("/plannings")) {
        const openPlanning = page.getByRole("button", {
          name: /Ouvrir le planning/,
        });
        if (await openPlanning.count()) {
          await openPlanning.first().click();
          await assertNoOverflow(
            page,
            `${profile.name} · ${viewport.name} · détail du planning`,
          );
        }
      }
    }
    await context.close();
  }
}

await browser.close();
console.log("Audit responsive réussi sur les routes principales.");
