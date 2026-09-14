const { chromium } = require('playwright');
const { createRequire } = require('node:module');
const path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const backend = createRequire(path.resolve(__dirname, '../uswap-danielle/uswap-danielle/package.json'));
backend('dotenv').config({ path: path.resolve(__dirname, '../uswap-danielle/uswap-danielle/.env'), quiet: true });
const { PrismaClient } = backend('@prisma/client'); const bcrypt = backend('bcrypt'); const { Workbook } = backend('exceljs');
const db = new PrismaClient(), prefix = `ui2-${crypto.randomUUID()}-`, email = name => `${prefix}${name}@example.invalid`, password = crypto.randomBytes(20).toString('hex');
const base = 'http://127.0.0.1:5173', out = path.resolve(__dirname, process.env.USWAP_SHOT_DIR || '../docs/verification');
async function main() {
  const target = new URL(process.env.DATABASE_URL); assert(['localhost','127.0.0.1','[::1]'].includes(target.hostname)); assert.equal(target.pathname, '/uswap_db');
  let browser;
  try {
    await require('node:fs/promises').mkdir(out,{recursive:true});
    await db.user.create({ data: { fullName: 'Alex Mballa', email: email('admin'), role: 'ADMIN', isActive: true, password: await bcrypt.hash(password, 4) } });
    browser = await chromium.launch({ channel: 'chrome', headless: true }); const context = await browser.newContext({ viewport: { width: 1440, height: 960 } }); const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
    async function shot(name) { await page.screenshot({ path: path.join(out, name + '.png'), fullPage: true }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ' overflows'); }
    await page.goto(base + '/auth/login'); await page.getByLabel('Adresse e-mail').fill(email('admin')); await page.getByLabel('Mot de passe', { exact: true }).fill(password); await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
    await page.getByRole('navigation').getByRole('link', { name: 'Utilisateurs', exact: true }).click(); await page.getByRole('link', { name: 'Créer un utilisateur', exact: true }).click();
    await page.getByLabel('Nom complet').fill('Diane Abena'); await page.getByLabel('Adresse e-mail').fill(email('manual')); await shot('creation-desktop');
    await page.setViewportSize({ width: 390, height: 844 }); await shot('creation-mobile'); await page.setViewportSize({ width: 320, height: 844 }); await shot('creation-320');
    await page.getByRole('button', { name: 'Créer l’utilisateur', exact: true }).click(); await page.getByText('Utilisateur créé.',{exact:true}).waitFor();
    assert.equal((await db.user.findUnique({ where: { email: email('manual') } })).isActive, false);
    await shot('notification-mobile');
    await page.getByText('Utilisateur créé.',{exact:true}).waitFor({state:'hidden',timeout:10000});
    await page.locator('.directory-more > summary').click(); await page.getByRole('link', { name: 'Importer un fichier', exact: true }).click();
    const [templateFile] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Télécharger le modèle Excel' }).click()]); assert.equal(templateFile.suggestedFilename(), 'modele-utilisateurs-uswap.xlsx');
    const csv = `fullName;email;role\nAlice Ngo;${email('csv')};SWAPPER\nDuplicate;${email('csv')};SWAPPER\nErreur;bad;INVALID`;
    await page.locator('input[type=file]').setInputFiles({ name: 'collaborateurs.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.getByRole('button', { name: 'Importer 1 utilisateur', exact: true }).waitFor(); assert.equal(await db.user.count({ where: { email: email('csv') } }), 0); await shot('import-preview-320');
    await page.setViewportSize({ width: 1440, height: 960 }); await shot('import-preview-desktop');
    await page.getByRole('button', { name: 'Importer 1 utilisateur', exact: true }).click(); await page.getByRole('heading', { name: 'Bilan de l’import' }).waitFor(); await shot('import-result-desktop');
    assert.equal(await db.user.count({ where: { email: email('csv') } }), 1);
    await page.getByRole('button', { name: 'Voir les utilisateurs', exact: true }).click(); await page.locator('.directory-more > summary').click(); await page.getByRole('link', { name: 'Importer un fichier', exact: true }).click();
    const workbook = new Workbook(); workbook.addWorksheet('Utilisateurs').addRows([['fullName','email','role'],['Paul',email('excel'),'SWAPPER']]);
    await page.locator('input[type=file]').setInputFiles({ name: 'collaborateurs.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await workbook.xlsx.writeBuffer()) });
    await page.getByRole('button', { name: 'Importer 1 utilisateur', exact: true }).click(); await page.getByRole('heading', { name: 'Bilan de l’import' }).waitFor();
    assert.equal(await db.user.count({ where: { email: email('excel') } }), 1);
    assert.deepEqual(errors, []);
    await context.close();
    // Short synthetic session tests exercise browser timers without waiting 30 real minutes.
    const timed = await browser.newContext({ viewport: { width: 390, height: 844 } }); const screen = await timed.newPage(); let renewals = 0, logouts = 0;
    await screen.route('**/auth/refresh', route => { renewals++; return route.fulfill({ json: { user: { id: 'timer-user', fullName: 'Test session', email: 'timer@example.invalid', role: 'SWAPPER' }, accessToken: 'test-only', expiresIn: 900, idleTimeoutSeconds: 120, sessionExpiresAt: new Date(Date.now()+120000).toISOString(), absoluteExpiresAt: new Date(Date.now()+86400000).toISOString() } }); });
    await screen.route('**/workspace', route => route.fulfill({ json: { shifts: [], station: null, limit: 50 } }));
    await screen.route('**/auth/logout', route => { logouts++; return route.fulfill({ json: { message: 'Déconnexion réussie' } }); });
    await screen.clock.install(); await screen.goto(base + '/app/mon-espace'); await screen.getByRole('heading', { name: 'Mon espace', exact: true }).waitFor();
    await screen.clock.fastForward(65000); await screen.getByRole('button', { name: 'Prolonger ma session' }).waitFor();
    await screen.getByRole('button', { name: 'Prolonger ma session' }).click(); await screen.getByRole('button', { name: 'Prolonger ma session' }).waitFor({ state: 'hidden' }); assert.equal(renewals, 2);
    await screen.clock.fastForward(65000); await screen.getByRole('button', { name: 'Prolonger ma session' }).waitFor();
    await screen.clock.fastForward(60000); await screen.getByRole('heading', { name: 'Connexion' }).waitFor(); assert.equal(logouts, 1); assert.equal(await screen.locator('.role-workspace').count(), 0);
    await timed.close();
    console.log('PASS day2 UI: pending creation, Excel template, CSV preview/report, Excel import, 320/390/1440px, inactivity warning/prolongation/expiry and sensitive content removed.');
  } finally {
    await browser?.close(); const owned = await db.user.findMany({ where: { email: { startsWith: prefix } }, select: { id: true } }); const ids = owned.map(x => x.id);
    await db.$transaction([db.refreshToken.deleteMany({ where: { userId: { in: ids } } }), db.loginAttempt.deleteMany({ where: { email: { startsWith: prefix } } }), db.user.deleteMany({ where: { id: { in: ids } } })]); await db.$disconnect();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
