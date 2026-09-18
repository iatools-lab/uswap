import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.BASE_URL || "http://127.0.0.1:5174";
const browser = await chromium.launch({ headless: true });
const failures = [];

async function login(page, email, password) {
  await page.goto(`${baseUrl}/auth/login`, { waitUntil: "domcontentloaded" });
  await page.locator("#demo-profile").selectOption(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/app\//);
}

async function exercise(name, email, password, expectedPath, run) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => failures.push(`${name}: ${error.message}`));
  try {
    await login(page, email, password);
    assert.match(page.url(), new RegExp(`${expectedPath.replaceAll("/", "\\/")}(?:$|\\/)`));
    await run(page);
  } finally {
    await context.close();
  }
}

async function createPlanning(page, { mode, name, start, end }) {
  const buttonName = mode === "automatic" ? "Générer un planning" : "Nouveau planning";
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  await page.getByRole("heading", { name: mode === "automatic" ? "Générer un planning" : "Créer un planning" }).waitFor();
  await page.locator("#planning-name").fill(name);
  const dates = page.locator('.stepper-modal input[type="date"]');
  await dates.nth(0).fill(start);
  await dates.nth(1).fill(end);
  await page.getByRole("button", { name: "Suivant", exact: true }).click();
  await page.getByRole("button", { name: "Sélectionner une station", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Station Bastos/ }).click();
  await page.getByRole("button", { name: "Suivant", exact: true }).click();
  await page.locator('.planner-options input[type="checkbox"]').first().check();
  await page.getByRole("button", { name: "Suivant", exact: true }).click();
  await page.getByRole("button", { name: mode === "automatic" ? "Générer et affecter" : "Créer le brouillon", exact: true }).click();
  await page.getByRole("button", { name: "Tous les plannings", exact: true }).waitFor();
}

await exercise(
  "administrateur",
  "admin@uswap.example.com",
  "AdminUswap",
  "/app/admin",
  async (page) => {
    await page.getByRole("link", { name: "Utilisateurs", exact: true }).click();
    await page.waitForURL(/\/app\/admin\/utilisateurs$/);
    await page.getByRole("button", { name: "Créer un utilisateur" }).first().click();
    await page.getByRole("heading", { name: "Nouveau collaborateur" }).waitFor();
    await page.getByRole("button", { name: "Fermer" }).click();

    await page.getByRole("link", { name: "Plannings", exact: true }).click();
    await page.waitForURL(/\/app\/admin\/plannings$/);
    await page.getByRole("button", { name: /Nouveau planning|Créer un planning/ }).first().click();
    await page.getByRole("heading", { name: "Créer un planning" }).waitFor();
    await page.getByRole("button", { name: "Fermer" }).click();

    await page.getByRole("button", { name: /Stations/ }).click();
    await page.waitForURL(/\/app\/admin\/stations\?tab=list$/);
    await page.getByRole("button", { name: "Créer une station" }).click();
    await page.getByRole("heading", { name: "Nouvelle station" }).waitFor();
    await page.getByRole("button", { name: "Fermer" }).click();

    await createPlanning(page, { mode: "manual", name: "Recette manuel", start: "2026-10-05", end: "2026-10-06" });
    await page.getByRole("button", { name: "Tous les plannings", exact: true }).click();
    await createPlanning(page, { mode: "automatic", name: "Recette automatique", start: "2026-10-07", end: "2026-10-08" });
  },
);

await exercise(
  "superviseur",
  "superviseur@uswap.example.com",
  "uswap2026",
  "/app/supervision",
  async (page) => {
    await page.getByRole("link", { name: "Plannings", exact: true }).click();
    await page.waitForURL(/\/app\/supervision\/plannings$/);
    await page.getByRole("button", { name: /Nouveau planning|Créer un planning/ }).first().click();
    await page.getByRole("heading", { name: "Créer un planning" }).waitFor();
    await page.getByRole("button", { name: "Fermer" }).click();

    await createPlanning(page, { mode: "automatic", name: "Recette superviseur", start: "2026-10-09", end: "2026-10-10" });
  },
);

await exercise(
  "chef de station",
  "chef@uswap.example.com",
  "uswap2026",
  "/app/station",
  async (page) => {
    await page.getByRole("link", { name: "Plannings", exact: true }).click();
    await page.waitForURL(/\/app\/station\/plannings$/);
    await page.getByText("Aucun planning pour le moment").waitFor();
    assert.equal(await page.getByRole("button", { name: /Créer un planning|Nouveau planning|Générer un planning/ }).count(), 0);
  },
);

await exercise(
  "navigation mobile",
  "admin@uswap.example.com",
  "AdminUswap",
  "/app/admin",
  async (page) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("link", { name: "Plannings", exact: true }).click();
    await page.waitForURL(/\/app\/admin\/plannings$/);
    const links = await page.getByRole("link").all();
    for (const link of links) {
      const box = await link.boundingBox();
      if (box) {
        assert.ok(box.x >= -1 && box.x + box.width <= 391, `Lien hors écran : ${await link.innerText()}`);
      }
    }
    await page.getByRole("button", { name: "Nouveau planning", exact: true }).click();
    await page.getByRole("heading", { name: "Créer un planning" }).waitFor();
    await page.keyboard.press("Escape");
  },
);

await exercise(
  "swappeur",
  "swappeur@uswap.example.com",
  "uswap2026",
  "/app/mon-espace",
  async (page) => {
    await page.getByRole("link", { name: "Plannings", exact: true }).click();
    await page.waitForURL(/\/app\/mon-espace\/plannings$/);
    await page.getByText("Aucun planning pour le moment").waitFor();
  },
);

await browser.close();
if (failures.length) throw new Error(`Erreurs navigateur :\n${failures.join("\n")}`);
console.log("Smoke UI réussi pour les quatre rôles.");
