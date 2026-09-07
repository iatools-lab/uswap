// Local verification only. Requires Playwright from the bundled runtime (NODE_PATH).
const { chromium } = require('playwright');
const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const backend = createRequire(path.resolve(__dirname, '../uswap-danielle/uswap-danielle/package.json'));
backend('dotenv').config({ path: path.resolve(__dirname, '../uswap-danielle/uswap-danielle/.env'), quiet: true });
const { PrismaClient } = backend('@prisma/client');
const bcrypt = backend('bcrypt');
const db = new PrismaClient();

async function main() {
  const target = new URL(process.env.DATABASE_URL);
  assert(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname));
  assert.equal(target.pathname, '/uswap_db');
  const email = `browser-${crypto.randomUUID()}@example.invalid`;
  const password = crypto.randomBytes(16).toString('hex');
  const token = crypto.randomBytes(32).toString('hex');
  const out = path.resolve(__dirname, '../docs/verification');
  await fs.mkdir(out, { recursive: true });
  let browser;
  let id;
  const errors = [];
  try {
    const user = await db.user.create({ data: {
      email, fullName: 'Camille Essomba', role: 'ADMIN', isActive: false,
      password: await bcrypt.hash(password, 4),
      invitationTokenHash: crypto.createHash('sha256').update(token).digest('hex'),
      invitationTokenExpires: new Date(Date.now() + 60_000),
    } });
    id = user.id;
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if(response.url().includes(':3000/auth/')) console.log(new URL(response.url()).pathname + ' ' + response.status()); });
    const base = 'http://127.0.0.1:5173';
    const shot = async name => {
      await page.screenshot({ path: path.join(out, name + '.png'), fullPage: true });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow: ' + name);
    };
    await page.goto(base + '/auth/login');
    await page.getByRole('heading', { name: 'Bon retour.' }).waitFor();
    await shot('login-desktop');
    await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
    await page.getByText('Saisissez une adresse e-mail valide.').waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + '/auth/activate#token=' + token);
    assert(!page.url().includes('#'));
    await page.getByLabel('Mot de passe', { exact: true }).fill('short');
    await page.getByLabel('Confirmer le mot de passe').fill('different');
    await page.getByRole('button', { name: 'Activer mon compte' }).click();
    await page.getByText('Les deux mots de passe doivent être identiques.').waitFor();
    await page.getByLabel('Mot de passe', { exact: true }).fill(password);
    await page.getByLabel('Confirmer le mot de passe').fill(password);
    await shot('activation-mobile');
    await page.getByRole('button', { name: 'Activer mon compte' }).click();
    await page.getByRole('heading', { name: 'Votre accès est prêt.' }).waitFor();
    await shot('activation-success-mobile');
    await page.getByRole('link', { name: 'Revenir à la connexion' }).click();
    await page.getByRole('heading', { name: 'Bon retour.' }).waitFor();
    await shot('login-mobile');
    await page.getByLabel('Adresse e-mail').fill(email);
    await page.getByLabel('Mot de passe', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
    await page.getByRole('heading', { name: 'Vue d’ensemble', exact: true }).waitFor();
    assert(page.url().endsWith('/app/admin'));
    assert((await context.cookies('http://127.0.0.1:3000/auth')).some(c => c.name === 'uswap_refresh' && c.httpOnly && c.sameSite === 'Strict'));
    await page.getByTestId('user-count').waitFor();
    assert.equal(Number(await page.getByTestId('user-count').innerText()), await db.user.count());
    assert.equal(Number(await page.getByTestId('station-count').innerText()), await db.station.count());
    await shot('admin-mobile');
    await page.setViewportSize({width:1440,height:900});
    await shot('admin-desktop');
    await page.getByRole('navigation', {name:'Navigation administrateur'}).getByRole('link', {name:'Utilisateurs',exact:true}).click();
    await page.getByRole('heading', {name:'Utilisateurs',exact:true}).waitFor();
    await page.getByRole('textbox', {name:'Rechercher un utilisateur'}).fill(email);
    assert.equal(await page.locator('.admin-table tbody tr').count(),1);
    await page.getByRole('textbox', {name:'Rechercher un utilisateur'}).fill('aucun-resultat-unique');
    await page.getByRole('heading', {name:'Aucun résultat'}).waitFor();
    await page.reload();
    await page.getByRole('heading', {name:'Utilisateurs',exact:true}).waitFor();
    assert(page.url().endsWith('/app/admin/utilisateurs'));
    await page.getByRole('navigation', {name:'Navigation administrateur'}).getByRole('link', {name:'Stations',exact:true}).click();
    await page.getByRole('heading', {name:'Stations',exact:true}).waitFor();
    await page.goBack();
    await page.getByRole('heading', {name:'Utilisateurs',exact:true}).waitFor();
    await page.getByRole('navigation', {name:'Navigation administrateur'}).getByRole('link', {name:'Vue d’ensemble',exact:true}).click();
    for(const width of [320,768]){
      await page.setViewportSize({width,height:900});
      await shot('admin-'+width);
    }
    await page.setViewportSize({width:390,height:844});
    await page.route('**/users',route=>route.fulfill({status:500,contentType:'application/json',body:'{}'}));
    await page.getByRole('button',{name:'Actualiser'}).click();
    await page.getByRole('heading',{name:'Chargement indisponible'}).waitFor();
    await page.unroute('**/users');
    await page.getByRole('button',{name:'Réessayer'}).click();
    await page.getByTestId('user-count').waitFor();
    await page.reload();
    await page.getByRole('heading', { name: 'Vue d’ensemble', exact: true }).waitFor();
    const second = await context.newPage();
    await second.goto(base + '/auth/login');
    await second.getByRole('heading', { name: 'Vue d’ensemble', exact: true }).waitFor();
    await page.getByRole('navigation', {name:'Navigation administrateur'}).getByRole('link', {name:'Mon compte',exact:true}).click();
    await page.getByRole('button', { name: 'Se déconnecter',exact:true }).filter({visible:true}).click();
    await page.getByRole('heading', { name: 'Bon retour.' }).waitFor();
    await second.getByRole('heading', { name: 'Bon retour.' }).waitFor();
    assert.equal(await db.refreshToken.count({ where: { userId: id } }), 0);
    await second.close();
    await page.getByRole('button', { name: 'Mot de passe oublié ?' }).click();
    await page.getByRole('heading', { name: 'Mot de passe oublié ?' }).waitFor();
    await shot('forgot-mobile');
    await page.getByLabel('Adresse e-mail').fill(email);
    await page.getByRole('button', { name: 'Envoyer le lien' }).click();
    await page.getByRole('alert').filter({ hasText: 'momentanément indisponible' }).waitFor();
    await page.goBack();
    await page.getByRole('heading', { name: 'Bon retour.' }).waitFor();
    assert.equal(await page.locator('.profile-card').count(), 0);
    const reset = crypto.randomBytes(32).toString('hex');
    await db.user.update({ where: { id }, data: { resetTokenHash: crypto.createHash('sha256').update(reset).digest('hex'), resetTokenExpires: new Date(Date.now() + 60_000) } });
    await page.goto(base + '/auth/reset-password#token=' + reset);
    await page.getByLabel('Nouveau mot de passe', { exact: true }).fill(password + 'new');
    await page.getByLabel('Confirmer le mot de passe').fill(password + 'new');
    await shot('reset-mobile');
    await page.getByRole('button', { name: 'Enregistrer le mot de passe' }).click();
    await page.getByRole('heading', { name: 'Mot de passe modifié.' }).waitFor();
    await page.goto(base + '/auth/reset-password#token=' + reset);
    await page.getByLabel('Nouveau mot de passe', { exact: true }).fill(password + 'new');
    await page.getByLabel('Confirmer le mot de passe').fill(password + 'new');
    await page.getByRole('button', { name: 'Enregistrer le mot de passe' }).click();
    await page.getByRole('heading', { name: 'Ce lien n’est plus valide.' }).waitFor();
    await shot('invalid-link-mobile');
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(base + '/auth/forgot-password');
      await shot('forgot-' + width);
    }
    await db.user.update({ where: { id }, data: { role: 'SWAPPER' } });
    await page.goto(base + '/auth/login');
    await page.getByRole('heading', { name: 'Bon retour.' }).waitFor();
    await page.getByLabel('Adresse e-mail').fill(email);
    await page.getByLabel('Mot de passe', { exact: true }).fill(password + 'new');
    const signedIn = page.waitForResponse(response => response.url().endsWith('/auth/login'));
    await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
    const credentials = await (await signedIn).json();
    await page.getByRole('heading', { name: 'Bonjour, Camille.' }).waitFor();
    const forbidden = await context.request.get('http://127.0.0.1:3000/users', {headers:{Authorization:'Bearer '+credentials.accessToken}});
    assert.equal(forbidden.status(),403);
    await page.goto(base + '/app/admin/utilisateurs');
    await page.getByRole('heading', { name: 'Bonjour, Camille.' }).waitFor();
    assert(page.url().endsWith('/app/mon-espace'));
    assert.equal(await page.locator('.admin-workspace').count(),0);
    await page.getByRole('button', { name: 'Se déconnecter', exact: true }).click();
    await page.getByRole('heading', { name: 'Bon retour.' }).waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS: admin dashboard counts match PostgreSQL; user search, empty results, child URL reload, history, loading failure/retry, 320–1440px layout; SWAPPER redirected out of admin and API /users returns 403.');
    console.log('PASS: responsive 320/390/768/1440, validation, real activation/reset/login, refresh cookie, role URL, reload, cross-tab logout, back navigation, reused link and SMTP-unavailable state.');
  } finally {
    await browser?.close();
    if (id) await db.$transaction([
      db.refreshToken.deleteMany({ where: { userId: id } }),
      db.loginAttempt.deleteMany({ where: { email } }),
      db.user.deleteMany({ where: { id } }),
    ]);
    await db.$disconnect();
  }
}
main().catch(error => { console.error(error.message.replace(/browser-[^\s]+@example\.invalid/g, '[test account]')); process.exitCode = 1; });
