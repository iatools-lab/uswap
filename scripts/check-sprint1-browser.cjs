const { chromium } = require("playwright");
const { createRequire } = require("node:module");
const path = require("node:path"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises");
const backend = createRequire(
  path.resolve(__dirname, "../uswap-danielle/uswap-danielle/package.json"),
);
backend("dotenv").config({
  path: path.resolve(__dirname, "../uswap-danielle/uswap-danielle/.env"),
  quiet: true,
});
const { PrismaClient } = backend("@prisma/client"),
  { JwtService } = backend("@nestjs/jwt"),
  { AuthService } = backend("./dist/src/auth/auth.service"),
  { DateTime } = backend("luxon");
const db = new PrismaClient(),
  password = crypto.randomBytes(20).toString("hex"),
  prefix = "ui-sprint1-" + crypto.randomUUID() + "-",
  out = path.resolve(__dirname, "../docs/verification/sprint1");
const auth = new AuthService(
  db,
  new JwtService({ secret: process.env.JWT_SECRET }),
  {
    assertConfigured() {},
    async sendLink() {
      throw new Error("No external mail from tests");
    },
  },
);
async function main() {
  const url = new URL(process.env.DATABASE_URL);
  assert(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.equal(url.pathname, "/uswap_db");
  await fs.mkdir(out, { recursive: true });
  let browser, debugPage;
  const stationIds = [],
    errors = [];
  try {
    const create = (name, role, extra = {}) =>
      auth.register({
        fullName: name,
        email:
          prefix +
          role.toLowerCase() +
          crypto.randomBytes(3).toString("hex") +
          "@example.invalid",
        role,
        password,
        ...extra,
      });
    const admin = await create("Alex Mballa", "ADMIN"),
      supervisor = await create("Nora Ekani", "SUPERVISOR"),
      swapper = await create("Diane Abena", "SWAPPER"),
      target = await create("Paul Essomba", "SWAPPER"),
      pending = await create("Invitation recette", "SWAPPER", {
        accountStatus: "PENDING",
      });
    browser = await chromium.launch({ channel: "chrome", headless: true });
    async function open(user, width = 1440) {
      const session = await auth.login({ email: user.email, password });
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        timezoneId: "Africa/Douala",
      });
      await context.addCookies([
        {
          name: "uswap_refresh",
          value: session.refreshToken,
          domain: "127.0.0.1",
          path: "/auth",
          httpOnly: true,
          sameSite: "Strict",
          secure: false,
        },
      ]);
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      return { context, page };
    }
    const { page, context } = await open(admin);
    debugPage = page;
    page.on("response", (r) => {
      if (r.status() >= 400 && r.url().includes(":3000/"))
        console.log("HTTP " + r.status() + " " + new URL(r.url()).pathname);
    });
    const shot = async (p, name) => {
      await p.screenshot({
        path: path.join(out, name + ".png"),
        fullPage: true,
      });
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        name + " overflows",
      );
    };
    await page.goto("http://127.0.0.1:5173/app/admin/utilisateurs");
    await page.getByLabel('Rechercher un utilisateur').fill(target.fullName);
    const rowAction=page.getByRole('button',{name:'Actions pour '+target.fullName,exact:true});
    await rowAction.click();
    await page.getByRole('button',{name:'Désactiver',exact:true}).click();
    await page.getByRole('button',{name:'Annuler',exact:true}).click();
    assert.equal((await db.user.findUnique({where:{id:target.id}})).disabledAt,null);
    await page.getByRole('button',{name:'Désactiver',exact:true}).click();
    await page.getByRole('button',{name:'Confirmer',exact:true}).click();
    await page.getByText('Inactif',{exact:true}).waitFor();
    assert((await db.user.findUnique({where:{id:target.id}})).disabledAt);
    await rowAction.click();
    await page.getByRole('button',{name:'Réactiver',exact:true}).click();
    await page.getByRole('button',{name:'Confirmer',exact:true}).click();
    await page.getByText('Actif',{exact:true}).waitFor();
    await rowAction.click();
    await shot(page,'actions-utilisateur');
    await page.getByRole('link',{name:'Modifier',exact:true}).click();
    await page.getByLabel("Nom complet").fill("Paul Essomba modifié");
    await page.getByLabel("Rôle", { exact: true }).selectOption("SUPERVISOR");
    await page
      .getByRole("button", { name: "Enregistrer", exact: true })
      .click();
    await page
      .getByText("Modifications enregistrées.", { exact: true })
      .waitFor();
    await page.getByText("Profil modifié", { exact: false }).waitFor();
    await shot(page, "utilisateur-desktop");
    await page
      .getByRole("button", { name: "Désactiver le compte", exact: true })
      .click();
    await page.getByRole("button", { name: "Confirmer", exact: true }).click();
    await page
      .getByRole("button", { name: "Réactiver le compte", exact: true })
      .waitFor();
    assert.equal(
      (await db.user.findUnique({ where: { id: target.id } })).isActive,
      false,
    );
    await page
      .getByRole("button", { name: "Réactiver le compte", exact: true })
      .click();
    await page.getByRole("button", { name: "Confirmer", exact: true }).click();
    await page
      .getByRole("button", { name: "Désactiver le compte", exact: true })
      .waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await shot(page, "utilisateur-mobile");
    await page.setViewportSize({ width: 320, height: 844 });
    await shot(page, "utilisateur-320");
    // Only this invitation response is simulated; the real invitation API is exercised with captured mail in test:sprint1.
    await page.route(
      "**/auth/invitations/" + pending.id + "/resend",
      async (route) => {
        await db.user.update({
          where: { id: pending.id },
          data: { invitationSentAt: new Date(), invitationDelivery: "SENT" },
        });
        await route.fulfill({
          status: 201,
          json: { message: "Invitation envoyée" },
        });
      },
    );
    await page.goto(
      "http://127.0.0.1:5173/app/admin/utilisateurs/" + pending.id,
    );
    await page
      .getByRole("button", { name: "Envoyer l’invitation", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Renvoyer l’invitation", exact: true })
      .waitFor();
    await shot(page, "invitation-mobile");
    await page.goto("http://127.0.0.1:5173/app/admin/stations");
    await page
      .getByRole("button", { name: "Créer une station", exact: true })
      .click();
    const stationName =
      "Station recette " + crypto.randomBytes(3).toString("hex");
    await page.getByLabel("Nom de la station").fill(stationName);
    await page.getByLabel("Adresse", { exact: true }).fill("Douala, Bonapriso");
    await page.getByLabel("Nom du contact").fill("Marie");
    await page.getByLabel("Téléphone du contact").fill("+237600000000");
    await page
      .getByLabel("Tolérance de retard (minutes)", { exact: true })
      .fill("3");
    await page
      .getByLabel("Validité QR début (minutes)", { exact: true })
      .fill("2");
    await page
      .getByLabel("Validité QR fin (minutes)", { exact: true })
      .fill("3");
    await shot(page, "station-form-320");
    await page
      .getByRole("button", { name: "Enregistrer la station", exact: true })
      .click();
    await page
      .getByRole("heading", { name: stationName, exact: true })
      .waitFor();
    const station = await db.station.findUnique({
      where: { name: stationName },
    });
    stationIds.push(station.id);
    assert.equal(station.checkinQrTtl, 120);
    assert.equal(station.checkoutQrTtl, 180);
    const card = page
      .locator(".admin-station")
      .filter({
        has: page.getByRole("heading", { name: stationName, exact: true }),
      });
    await card.getByRole("button", { name: "Désactiver", exact: true }).click();
    await page.getByRole("button", { name: "Confirmer", exact: true }).click();
    await card
      .getByRole("button", { name: "Réactiver", exact: true })
      .waitFor();
    await card.getByRole("button", { name: "Réactiver", exact: true }).click();
    await page.getByRole("button", { name: "Confirmer", exact: true }).click();
    await card
      .getByRole("button", { name: "Désactiver", exact: true })
      .waitFor();
    await page.setViewportSize({ width: 1440, height: 900 });
    await shot(page, "stations-desktop");
    const chief = await create("Marie Atangana", "STATION_CHIEF", {
      stationId: station.id,
    });
    const sup = await open(supervisor);
    await sup.page.goto("http://127.0.0.1:5173/app/supervision");
    await sup.page
      .getByRole("button", { name: "Nouvelle affectation", exact: true })
      .click();
    await sup.page
      .getByLabel("Station", { exact: true })
      .selectOption(station.id);
    await sup.page
      .getByLabel("Swappeur", { exact: true })
      .selectOption(swapper.id);
    const start = DateTime.now()
      .setZone("Africa/Douala")
      .plus({ days: 2 })
      .startOf("day")
      .plus({ hours: 8 });
    await sup.page
      .getByLabel("Début", { exact: true })
      .fill(start.toFormat("yyyy-MM-dd'T'HH:mm"));
    await sup.page
      .getByLabel("Fin", { exact: true })
      .fill(start.plus({ hours: 4 }).toFormat("yyyy-MM-dd'T'HH:mm"));
    await sup.page
      .getByRole("button", { name: "Enregistrer le brouillon", exact: true })
      .click();
    const row = sup.page.locator("tbody tr").filter({ hasText: stationName });
    await row.getByRole("button", { name: "Publier", exact: true }).waitFor();
    await shot(sup.page, "affectation-brouillon");
    await row.getByRole("button", { name: "Publier", exact: true }).click();
    await row.getByText("Publié", { exact: true }).waitFor();
    await shot(sup.page, "supervision-desktop");
    const shift = await db.shift.findFirst({
      where: { stationId: station.id, swapperId: swapper.id },
    });
    assert(shift.publishedAt);
    await db.shift.update({
      where: { id: shift.id },
      data: {
        startTime: new Date(Date.now() - 5 * 60000),
        endTime: new Date(Date.now() + 3600000),
      },
    });
    const c = await open(chief, 390);
    await c.page.goto("http://127.0.0.1:5173/app/station");
    const qrResponse = c.page.waitForResponse((r) =>
      r.url().endsWith("/attendance/qr"),
    );
    await c.page
      .getByRole("button", { name: "Générer le QR de début", exact: true })
      .click();
    const qr = await (await qrResponse).json();
    await c.page
      .getByRole("img", { name: "QR à scanner pour le pointage" })
      .waitFor();
    await shot(c.page, "qr-debut-mobile");
    const sw = await open(swapper, 390);
    await sw.page.goto("http://127.0.0.1:5173/app/mon-espace#qr=" + qr.token);
    await sw.page
      .getByLabel("Affectation", { exact: true })
      .selectOption(shift.id);
    assert.equal(
      await sw.page.getByLabel("Lien ou code QR").inputValue(),
      qr.token,
    );
    await sw.page
      .getByRole("button", { name: "Confirmer le pointage", exact: true })
      .click();
    await sw.page.getByText("Présent · en retard", { exact: true }).waitFor();
    await shot(sw.page, "pointage-mobile");
    const exitResponse = c.page.waitForResponse((r) =>
      r.url().endsWith("/attendance/qr"),
    );
    await c.page
      .getByRole("button", { name: "Générer le QR de fin", exact: true })
      .click();
    const exit = await (await exitResponse).json();
    await sw.page
      .getByLabel("Affectation", { exact: true })
      .selectOption(shift.id);
    await sw.page.getByLabel("Lien ou code QR").fill(exit.token);
    await sw.page
      .getByRole("button", { name: "Confirmer le pointage", exact: true })
      .click();
    await sw.page.getByText("Terminé", { exact: true }).waitFor();
    assert(
      (await db.attendance.findUnique({ where: { shiftId: shift.id } }))
        .checkedOutAt,
    );
    await page.goto("http://127.0.0.1:5173/app/admin/utilisateurs");
    await page
      .getByRole("textbox", { name: "Rechercher un utilisateur" })
      .fill(swapper.fullName);
    await page.getByRole("button",{name:"Filtrer",exact:true}).click();
    await page.getByLabel("Filtrer par rôle").selectOption("SWAPPER");
    await page.getByLabel("Filtrer par statut").selectOption("active");
    await Promise.all([
      page.waitForResponse(r=>{const url=new URL(r.url());return url.pathname==='/users/page'&&url.searchParams.get('stationId')===station.id&&url.searchParams.get('q')===swapper.fullName&&r.ok();}),
      page.getByLabel("Filtrer par station planifiée").selectOption(station.id)
    ]);
    await page.locator('.admin-loading').waitFor({state:'hidden'});
    assert.equal(await page.locator("tbody tr").count(), 1);
    await page.locator(".directory-more > summary").click();
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Exporter les résultats", exact: true })
      .click();
    const csv = await fs.readFile(await (await download).path(), "utf8");
    assert(csv.includes(swapper.email));
    assert(!csv.includes(admin.email));
    await shot(page, "filtres-export");
    for(let index=0;index<9;index++){
      const u=await create('Pagination recette '+index,'SWAPPER');
      await db.shift.create({data:{stationId:station.id,swapperId:u.id,startTime:start.toJSDate(),endTime:start.plus({hours:4}).toJSDate(),publishedAt:new Date()}});
    }
    await page.reload();
    await page.getByRole('button',{name:'Filtrer',exact:true}).click();
    await page.getByLabel('Filtrer par rôle').selectOption('SWAPPER');
    await page.getByLabel('Filtrer par statut').selectOption('active');
    await page.getByLabel('Filtrer par station planifiée').selectOption(station.id);
    await page.getByRole('textbox',{name:'Rechercher un utilisateur'}).fill('Pagination recette');
    await page.getByText('9 résultats',{exact:true}).waitFor();
    await page.locator('.admin-loading').waitFor({state:'hidden'});
    assert.equal(await page.locator('tbody tr').count(),8);
    await Promise.all([
      page.waitForResponse(r=>{const url=new URL(r.url());return url.pathname==='/users/page'&&url.searchParams.get('page')==='2'&&r.ok();}),
      page.getByRole('button',{name:'Page suivante',exact:true}).click()
    ]);
    await page.locator('.admin-loading').waitFor({state:'hidden'});
    assert.equal(await page.locator('tbody tr').count(),1);
    assert.equal(await page.getByRole('textbox',{name:'Rechercher un utilisateur'}).inputValue(),'Pagination recette');
    assert.equal(await page.getByLabel('Filtrer par rôle').inputValue(),'SWAPPER');
    assert.equal(await page.getByLabel('Filtrer par statut').inputValue(),'active');
    assert.equal(await page.getByLabel('Filtrer par station planifiée').inputValue(),station.id);
    await page.locator('.directory-more > summary').click();
    const allDownload=page.waitForEvent('download');
    await page.getByRole('button',{name:'Exporter les résultats',exact:true}).click();
    const allCsv=await fs.readFile(await(await allDownload).path(),'utf8');
    assert.equal(allCsv.trim().split(/\r?\n/).length,10);
    assert.deepEqual(errors, []);
    await context.close();
    await sup.context.close();
    await c.context.close();
    await sw.context.close();
    console.log(
      "PASS Sprint 1 UI: profile/audit, invitation state, deactivate/reactivate, stations/minute settings, draft/publication, chief QR, swapper check-in/out, combined filtered export, mobile/desktop.",
    );
  } catch (e) {
    console.error(e.stack || e);
    if (debugPage) {
      console.log(
        "Headings:",
        await debugPage.getByRole("heading").allTextContents(),
      );
      console.log(
        "Alerts:",
        await debugPage.getByRole("alert").allTextContents(),
      );
      console.log(
        "Labels:",
        await debugPage.locator("label").allTextContents(),
      );
      await debugPage
        .screenshot({ path: path.join(out, "failure.png"), fullPage: true })
        .catch(() => {});
    }
    throw e;
  } finally {
    await browser?.close();
    const users = await db.user.findMany({
        where: { email: { startsWith: prefix } },
        select: { id: true },
      }),
      ids = users.map((u) => u.id);
    await db.$transaction([
      db.attendance.deleteMany({
        where: { shift: { swapperId: { in: ids } } },
      }),
      db.shift.deleteMany({ where: { swapperId: { in: ids } } }),
      db.stationQr.deleteMany({ where: { stationId: { in: stationIds } } }),
      db.stationRuleVersion.deleteMany({
        where: { stationId: { in: stationIds } },
      }),
      db.userAudit.deleteMany({ where: { userId: { in: ids } } }),
      db.refreshToken.deleteMany({ where: { userId: { in: ids } } }),
      db.loginAttempt.deleteMany({ where: { email: { startsWith: prefix } } }),
      db.user.deleteMany({ where: { id: { in: ids } } }),
      db.station.deleteMany({ where: { id: { in: stationIds } } }),
    ]);
    await db.$disconnect();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
