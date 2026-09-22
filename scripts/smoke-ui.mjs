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

async function assertNoHorizontalOverflow(page, label) {
  const sizes = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(
    Math.max(sizes.document, sizes.body) <= sizes.viewport + 1,
    `${label} déborde horizontalement (${Math.max(sizes.document, sizes.body)} px pour ${sizes.viewport} px)`,
  );
}

async function exercise(name, email, password, expectedPath, run) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => failures.push(`${name}: ${error.message}`));
  try {
    await login(page, email, password);
    assert.match(
      page.url(),
      new RegExp(`${expectedPath.replaceAll("/", "\\/")}(?:$|\\/)`),
    );
    await run(page);
  } finally {
    await context.close();
  }
}

async function createPlanning(page, { mode, name, start, end }) {
  const buttonName =
    mode === "automatic" ? "Générer un planning" : "Nouveau planning";
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  await page
    .getByRole("heading", {
      name: mode === "automatic" ? "Générer un planning" : "Créer un planning",
    })
    .waitFor();
  await page.locator("#planning-name").fill(name);
  const dates = page.locator('.stepper-modal input[type="date"]');
  await dates.nth(0).fill(start);
  await dates.nth(1).fill(end);
  await page.getByRole("button", { name: "Suivant", exact: true }).click();
  await page
    .getByRole("button", { name: "Sélectionner une station", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Station Bastos/ })
    .click();
  await page
    .getByRole("heading", { name: "Station Bastos", exact: true })
    .waitFor();
  await page.getByText("Repos minimal", { exact: true }).waitFor();
  await page
    .getByText(/swappeurs?$/)
    .first()
    .waitFor();
  const stationSelectorBox = await page
    .locator(".stepper-field-group")
    .first()
    .boundingBox();
  const stationSummaryBox = await page
    .locator(".planner-station-summary")
    .boundingBox();
  assert.ok(
    stationSelectorBox && stationSummaryBox,
    "Le résumé de station doit être visible",
  );
  assert.ok(
    stationSummaryBox.y - (stationSelectorBox.y + stationSelectorBox.height) <
      40,
    "Le résumé de station doit suivre immédiatement le sélecteur",
  );
  await page.getByRole("button", { name: "Suivant", exact: true }).click();
  await page.locator('.planner-options input[type="checkbox"]').first().check();
  await page.locator('.planner-days input[type="checkbox"]').first().check();
  await page.getByRole("button", { name: "Suivant", exact: true }).click();
  await page
    .getByRole("button", {
      name: mode === "automatic" ? "Générer et affecter" : "Créer le brouillon",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Tous les plannings", exact: true })
    .waitFor();
}

await exercise(
  "administrateur",
  "admin@uswap.example.com",
  "AdminUswap",
  "/app/admin",
  async (page) => {
    const workspace = page.locator(".admin-workspace");
    await page.getByRole("button", { name: "Masquer la navigation" }).click();
    await page.waitForFunction(
      () =>
        document.querySelector(".admin-sidebar")?.getBoundingClientRect()
          .width < 90,
    );
    assert.ok(
      await workspace.evaluate((element) =>
        element.classList.contains("is-sidebar-collapsed"),
      ),
      "La navigation doit pouvoir se replier depuis son rail",
    );
    await page.getByRole("button", { name: "Afficher la navigation" }).click();
    await page.waitForFunction(
      () =>
        document.querySelector(".admin-sidebar")?.getBoundingClientRect()
          .width > 200,
    );
    assert.ok(
      !(await workspace.evaluate((element) =>
        element.classList.contains("is-sidebar-collapsed"),
      )),
      "La navigation doit pouvoir être réaffichée",
    );
    await page.getByRole("link", { name: "Utilisateurs", exact: true }).click();
    await page.waitForURL(/\/app\/admin\/utilisateurs$/);
    assert.equal(
      await page.locator("h1").count(),
      1,
      "Le titre de page ne doit apparaître qu'une fois",
    );
    const notificationBox = await page
      .locator(".notification-bell__trigger")
      .boundingBox();
    const accountBox = await page.locator(".account-trigger").boundingBox();
    assert.ok(
      notificationBox && accountBox,
      "Les actions du compte doivent être visibles",
    );
    assert.ok(
      accountBox.x > notificationBox.x,
      "La cloche doit précéder l'avatar",
    );
    assert.ok(
      accountBox.x - (notificationBox.x + notificationBox.width) < 20,
      "La cloche doit rester accolée à l'avatar",
    );
    await page.getByRole("button", { name: /notification/i }).click();
    await page.getByText("Accès à valider", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Créer un utilisateur" })
      .first()
      .click();
    await page
      .getByRole("heading", { name: "Nouveau collaborateur" })
      .waitFor();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /Fermer/ })
      .click();

    assert.equal(
      await page.getByRole("link", { name: "Opérations", exact: true }).count(),
      0,
      "L'administrateur ne doit pas disposer de l'espace Opérations",
    );
    await page.goto(`${baseUrl}/app/admin/operations`);
    await page.waitForURL(/\/app\/admin$/);

    await page.getByRole("link", { name: "Plannings", exact: true }).click();
    await page.waitForURL(/\/app\/admin\/plannings$/);
    await page
      .getByRole("link", { name: /Ouvrir le planning/ })
      .first()
      .click();
    await page.locator(".planner-range").first().click();
    await page
      .getByRole("button", { name: "Ajouter", exact: true })
      .first()
      .click();
    await page
      .getByRole("heading", { name: "Ajouter des swappeurs" })
      .waitFor();
    await page
      .getByRole("form", { name: "Affecter un swappeur" })
      .getByText(/Pause .*60 min/)
      .waitFor();
    const assignmentStatus = page.locator(".assignment-status").first();
    await page
      .locator('.assignment-table input[type="checkbox"]')
      .first()
      .check();
    assert.equal(
      await page.getByRole("heading", { name: "Résultat du contrôle" }).count(),
      0,
      "La sélection d’un swappeur ne doit pas ouvrir le détail des contraintes",
    );
    await assignmentStatus.waitFor();
    await assignmentStatus.click();
    await page.getByRole("heading", { name: "Résultat du contrôle" }).waitFor();
    await page
      .getByRole("dialog")
      .last()
      .getByRole("button", { name: "Fermer", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Tous les plannings", exact: true })
      .click();
    await page
      .getByRole("button", { name: /Nouveau planning|Créer un planning/ })
      .first()
      .click();
    await page.getByRole("heading", { name: "Créer un planning" }).waitFor();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /Stations/ }).click();
    await page.waitForURL(/\/app\/admin\/stations\?tab=list$/);
    await page.getByRole("button", { name: "Créer une station" }).click();
    await page.getByRole("heading", { name: "Nouvelle station" }).waitFor();
    await page.locator(".map-picker-wrapper .leaflet-container").waitFor();
    assert.match(
      (await page
        .locator(".map-picker-wrapper .leaflet-tile")
        .first()
        .getAttribute("src")) || "",
      /server\.arcgisonline\.com/,
      "La mini-carte doit utiliser un fond sans clé API",
    );
    await page.keyboard.press("Escape");

    await page.getByRole("link", { name: "Plannings", exact: true }).click();
    await page.waitForURL(/\/app\/admin\/plannings$/);
    await createPlanning(page, {
      mode: "manual",
      name: "Recette manuel",
      start: "2026-10-05",
      end: "2026-10-06",
    });
    await page
      .getByRole("button", { name: "Tous les plannings", exact: true })
      .click();
    await createPlanning(page, {
      mode: "automatic",
      name: "Recette automatique",
      start: "2026-10-07",
      end: "2026-10-08",
    });
  },
);

await exercise(
  "superviseur",
  "superviseur@uswap.example.com",
  "uswap2026",
  "/app/supervision",
  async (page) => {
    const correctionButtons = page.getByRole("button", {
      name: "Corriger",
      exact: true,
    });
    if (await correctionButtons.count()) {
      await correctionButtons.first().click();
      const correctionDialog = page.getByRole("dialog", {
        name: /Corriger le pointage/,
      });
      await correctionDialog
        .getByText(/justificatif si la correction/i)
        .waitFor();
      await correctionDialog
        .getByLabel(/Motif/)
        .fill("Correction validée lors de la recette");
      await correctionDialog
        .getByText("Absence justifiée", { exact: true })
        .click();
      await correctionDialog
        .getByRole("button", { name: "Enregistrer" })
        .click();
      await correctionDialog.waitFor({ state: "detached" });
    }
    assert.equal(
      await page.getByRole("button", { name: "Gérer les QR" }).count(),
      0,
      "Le superviseur suit les opérations sans générer les QR",
    );
    await page.getByRole("tab", { name: "À remplacer" }).click();
    await page.getByRole("heading", { name: "Shifts à remplacer" }).waitFor();
    const replaceButtons = page.getByRole("button", {
      name: "Affecter",
      exact: true,
    });
    if (await replaceButtons.count()) {
      await replaceButtons.first().click();
      await page
        .getByRole("heading", { name: "Affecter un remplaçant" })
        .waitFor();
      await page.getByRole("button", { name: "Fermer" }).click();
    }
    await page.getByRole("tab", { name: "Historique" }).click();
    await page
      .getByRole("heading", {
        name: "Historique des changements d’affectation",
      })
      .waitFor();
    await page.getByRole("link", { name: "Planning", exact: true }).click();
    await page.waitForURL(/\/app\/supervision\/plannings$/);
    await page
      .getByRole("button", { name: /Nouveau planning|Créer un planning/ })
      .first()
      .click();
    await page.getByRole("heading", { name: "Créer un planning" }).waitFor();
    await page.getByRole("button", { name: "Fermer" }).click();

    await createPlanning(page, {
      mode: "automatic",
      name: "Recette superviseur",
      start: "2026-10-09",
      end: "2026-10-10",
    });
  },
);

await exercise(
  "chef de station",
  "chef@uswap.example.com",
  "uswap2026",
  "/app/station",
  async (page) => {
    await page.getByRole("button", { name: "Gérer les QR" }).click();
    await page
      .getByRole("heading", { name: "Générer un QR de service" })
      .waitFor();
    await page
      .getByRole("button", { name: "Fin de service", exact: true })
      .click();
    await page.getByRole("button", { name: "Shift publié pour le QR" }).click();
    const qrOptions = page.getByRole("option");
    assert.ok(
      await qrOptions.count(),
      "Un shift courant de la station doit permettre de générer un QR",
    );
    await qrOptions.first().click();
    await page.getByRole("button", { name: "Générer le QR de fin" }).click();
    await page
      .getByRole("img", { name: "QR temporaire de pointage" })
      .waitFor();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /Fermer/ })
      .click();
    await page.getByRole("heading", { name: /Présence du jour/ }).waitFor();
    await page
      .getByRole("heading", { name: /Pointages/ })
      .last()
      .waitFor();
    await page.getByRole("link", { name: "Planning", exact: true }).click();
    await page.waitForURL(/\/app\/station\/plannings$/);
    await page
      .getByText(/Semaine opérationnelle|Du .* au/)
      .first()
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", {
          name: /Créer un planning|Nouveau planning|Générer un planning/,
        })
        .count(),
      0,
    );
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
    for (const name of ["Générer un planning", "Nouveau planning"]) {
      const action = page.getByRole("button", { name, exact: true });
      const box = await action.boundingBox();
      assert.ok(box, `Action mobile absente : ${name}`);
      assert.ok(
        box.x >= -1 && box.x + box.width <= 391,
        `Action hors écran : ${name}`,
      );
    }
    await page
      .getByRole("button", { name: "Nouveau planning", exact: true })
      .click();
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
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole("heading", { name: "Pointer mon service" }).waitFor();
    for (const name of ["Pointage", "Planning", "Congés", "Compte"]) {
      await page.getByRole("link", { name, exact: true }).waitFor();
    }
    await assertNoHorizontalOverflow(page, "Pointage mobile");
    await page
      .getByRole("button", { name: "Ouvrir le pointage", exact: true })
      .click();
    const punchDialog = page.getByRole("dialog", {
      name: /Pointer mon service/,
    });
    await punchDialog.waitFor();
    await assertNoHorizontalOverflow(page, "Modale de pointage mobile");
    await punchDialog.getByRole("button", { name: /Fermer/ }).click();
    const nextShift = page.locator(".operations-hero");
    if (await nextShift.count()) {
      const nextEnd = await nextShift.getAttribute("data-shift-end");
      assert.ok(
        nextEnd && Date.parse(nextEnd) >= Date.now(),
        "La prochaine affectation ne doit pas être un shift déjà terminé",
      );
    }
    const automatedCheckoutAbsence = await page.evaluate(() => {
      const db = JSON.parse(localStorage.getItem("uswap.mock.db.v9") || "null");
      if (!db) return false;
      return db.attendance.some(
        (record) =>
          record.checkedInAt &&
          !record.checkedOutAt &&
          record.status === "ABSENT" &&
          db.absences.some(
            (absence) =>
              absence.shiftId === record.shiftId &&
              /sans pointage de fin/i.test(absence.reason),
          ),
      );
    });
    assert.ok(
      automatedCheckoutAbsence,
      "Un pointage sans fin de service doit produire une absence automatique",
    );
    await page.getByRole("heading", { name: "Mes pointages" }).waitFor();
    assert.ok(
      await page
        .locator(
          ".responsive-data-table__mobile .responsive-data-card, .swapper-attendance-card",
        )
        .count(),
      "Les pointages doivent devenir des cartes sur mobile",
    );
    await page.getByRole("link", { name: "Congés", exact: true }).click();
    await page.waitForURL(/\/app\/mon-espace\/conges$/);
    await assertNoHorizontalOverflow(page, "Congés mobile");
    await page.getByRole("heading", { name: "Absence imprévue" }).waitFor();
    await page.getByRole("button", { name: "Signaler", exact: true }).waitFor();
    await page.getByRole("button", { name: "Signaler", exact: true }).click();
    await page.getByRole("heading", { name: "Signaler une absence" }).waitFor();
    const sendAbsence = page.getByRole("button", {
      name: "Envoyer",
      exact: true,
    });
    assert.ok(
      await sendAbsence.isDisabled(),
      "Une absence vierge ne doit pas pouvoir être envoyée",
    );
    await page.getByRole("button", { name: "Shift concerné" }).click();
    await page.getByRole("option").last().click();
    await page
      .locator('#absence-declaration input[type="file"]')
      .setInputFiles({
      name: "justificatif.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n% justificatif recette uSwap"),
    });
    await page
      .locator('#absence-declaration input[placeholder*="Maladie"]')
      .fill("Indisponibilité médicale");
    await sendAbsence.click();
    await page.getByText("Absence déclarée.", { exact: true }).waitFor();
    await page.getByRole("link", { name: "Planning", exact: true }).click();
    await page.waitForURL(/\/app\/mon-espace\/plannings$/);
    await page
      .getByText(/Semaine opérationnelle|Du .* au/)
      .first()
      .waitFor();
    await assertNoHorizontalOverflow(page, "Planning mobile");
    await page.getByRole("button", { name: /Ouvrir le planning/ }).first().click();
    await page.locator(".swapper-calendar").waitFor();
    assert.equal(
      await page.locator(".swapper-planning-desktop").isVisible(),
      false,
      "La vue desktop du planning doit être masquée sur mobile",
    );
    await page.getByRole("button", { name: "Mois suivant" }).click();
    await page.getByRole("button", { name: "Mois précédent" }).click();
    await page.locator(".swapper-calendar__day.has-shift").first().click();
    const shiftDialog = page.getByRole("dialog").last();
    await shiftDialog.getByText("Horaires", { exact: true }).first().waitFor();
    await shiftDialog
      .locator(".swapper-shift-state")
      .first()
      .waitFor();
    const absenceShortcut = shiftDialog.getByRole("button", {
      name: "Signaler une absence",
    });
    if (await absenceShortcut.count())
      assert.ok(await absenceShortcut.first().isVisible());
    await assertNoHorizontalOverflow(page, "Détail mobile d’un shift");
    await shiftDialog.getByRole("button", { name: /Fermer/ }).click();
    await page.getByRole("link", { name: "Compte", exact: true }).click();
    await page.waitForURL(/\/app\/mon-espace\/compte$/);
    await assertNoHorizontalOverflow(page, "Compte mobile");
  },
);

await browser.close();
if (failures.length)
  throw new Error(`Erreurs navigateur :\n${failures.join("\n")}`);
console.log("Smoke UI réussi pour les quatre rôles.");
