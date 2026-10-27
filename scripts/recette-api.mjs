// Recette API — réactivation de compte, RBAC SUPER_ADMIN, nettoyage de données.
//
//   node scripts/recette-api.mjs            (API sur http://127.0.0.1:3000)
//
// Crée trois comptes techniques `recette.*@uswap.test` (idempotent), puis
// vérifie les comportements côté serveur. Aucune donnée métier n'est supprimée :
// la simulation de nettoyage est lancée avec `dryRun`.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('../backend_new/node_modules/@prisma/client');
// `bcrypt` est hoisté à la racine du dépôt par npm (dépendance du backend).
const bcrypt = require('bcrypt');

const BASE = process.env.API_URL ?? 'http://127.0.0.1:3000';
const PASSWORD = 'Recette-SuperAdmin-2026!';
const prisma = new PrismaClient();
const results = [];
const log = (name, ok, detail = '') => results.push({ name, ok, detail });

async function call(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

const login = (email, password = PASSWORD) =>
  call('/auth/login', { method: 'POST', body: { email, password } });

async function ensureUser(email, fullName, role, passwordHash) {
  return prisma.user.upsert({
    where: { email },
    create: {
      fullName,
      email,
      role,
      isActive: true,
      passwordHash,
      invitationStatus: 'ACTIVATED',
    },
    update: {
      role,
      isActive: true,
      disabledAt: null,
      passwordHash,
      invitationStatus: 'ACTIVATED',
    },
  });
}

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 10);
  await ensureUser('recette.superadmin@uswap.test', 'Recette Super Admin', 'SUPER_ADMIN', hash);
  await ensureUser('recette.admin@uswap.test', 'Recette Admin', 'ADMIN', hash);
  await ensureUser('recette.supervisor@uswap.test', 'Recette Superviseur', 'SUPERVISOR', hash);

  const sa = await login('recette.superadmin@uswap.test');
  log('SUPER_ADMIN peut se connecter', sa.status === 200 && sa.data?.user?.role === 'SUPER_ADMIN', sa.data?.message ?? '');
  const ad = await login('recette.admin@uswap.test');
  log('ADMIN peut se connecter', ad.status === 200, ad.data?.message ?? '');
  const sv = await login('recette.supervisor@uswap.test');
  log('SUPERVISOR peut se connecter', sv.status === 200, sv.data?.message ?? '');

  const saToken = sa.data?.accessToken;
  const adToken = ad.data?.accessToken;
  const svToken = sv.data?.accessToken;

  // 1) Nettoyage réservé au super administrateur.
  for (const [label, token] of [
    ['ADMIN', adToken],
    ['SUPERVISOR', svToken],
  ]) {
    const read = await call('/super-admin/cleanup', { token });
    log(`Nettoyage refusé (403) pour ${label}`, read.status === 403, `HTTP ${read.status}`);
    const preview = await call('/super-admin/cleanup/preview', {
      method: 'POST',
      body: { targets: ['PLANNINGS'] },
      token,
    });
    log(`Simulation refusée (403) pour ${label}`, preview.status === 403, `HTTP ${preview.status}`);
  }
  const overview = await call('/super-admin/cleanup', { token: saToken });
  log('SUPER_ADMIN voit les volumes', overview.status === 200 && !!overview.data?.counts, JSON.stringify(overview.data?.counts ?? overview.data));

  // 2) Hiérarchie des rôles.
  const adminRouteForSuper = await call('/users/page?limit=1', { token: saToken });
  log('SUPER_ADMIN accède aux écrans ADMIN', adminRouteForSuper.status === 200, `HTTP ${adminRouteForSuper.status}`);
  const adminRouteForSupervisor = await call('/users/page?limit=1', { token: svToken });
  log('SUPERVISOR gère les comptes (liste accessible)', adminRouteForSupervisor.status === 200, `HTTP ${adminRouteForSupervisor.status}`);
  const superRouteForAdmin = await call('/super-admin/cleanup', { token: adToken });
  log('ADMIN n’hérite pas du SUPER_ADMIN', superRouteForAdmin.status === 403, `HTTP ${superRouteForAdmin.status}`);

  // 3) Qui peut créer quel rôle — appliqué côté serveur.
  const email = (tag) => `recette.${tag}.${Date.now()}@uswap.test`;
  const adminCreatesSuper = await call('/users', {
    method: 'POST',
    body: { fullName: 'Test Super', email: email('super'), role: 'SUPER_ADMIN' },
    token: adToken,
  });
  log('ADMIN ne peut pas créer un SUPER_ADMIN (403)', adminCreatesSuper.status === 403, `HTTP ${adminCreatesSuper.status} ${adminCreatesSuper.data?.message ?? ''}`);

  const adminCreatesAdmin = await call('/users', {
    method: 'POST',
    body: { fullName: 'Test Admin 2', email: email('admin2'), role: 'ADMIN', accountStatus: 'ACTIVE', password: 'Recette-Admin-2026!' },
    token: adToken,
  });
  log('ADMIN peut créer un ADMIN (201)', adminCreatesAdmin.status === 201, `HTTP ${adminCreatesAdmin.status}`);

  const supervisorCreatesSuper = await call('/users', {
    method: 'POST',
    body: { fullName: 'Test Super 2', email: email('super2'), role: 'SUPER_ADMIN', accountStatus: 'ACTIVE', password: 'Recette-Admin-2026!' },
    token: svToken,
  });
  log('SUPERVISOR peut créer un SUPER_ADMIN (201)', supervisorCreatesSuper.status === 201, `HTTP ${supervisorCreatesSuper.status} ${supervisorCreatesSuper.data?.message ?? ''}`);

  // 4) Désactivation / réactivation.
  const victimEmail = email('victim');
  const victim = await call('/users', {
    method: 'POST',
    body: { fullName: 'Recette Victime', email: victimEmail, role: 'ADMIN', accountStatus: 'ACTIVE', password: 'Recette-Victime-2026!' },
    token: saToken,
  });
  const victimId = victim.data?.id;
  log('Compte de test créé', Boolean(victimId), JSON.stringify(victim.data));

  if (victimId) {
    const disable = await call(`/users/${victimId}/status`, { method: 'PATCH', body: { enabled: false }, token: saToken });
    log('Désactivation : 200 + enabled=false', disable.status === 200 && disable.data?.enabled === false, JSON.stringify(disable.data));

    const blocked = await login(victimEmail, 'Recette-Victime-2026!');
    log('Compte désactivé ne peut plus se connecter (403)', blocked.status === 403, `HTTP ${blocked.status}`);

    const reactivate = await call(`/users/${victimId}/status`, { method: 'PATCH', body: { enabled: true }, token: saToken });
    log('Réactivation : 200 + enabled=true', reactivate.status === 200 && reactivate.data?.enabled === true, JSON.stringify(reactivate.data));

    const fresh = await call(`/users/${victimId}`, { token: saToken });
    log('En base : disabledAt=null et actif', fresh.data?.disabledAt === null && fresh.data?.isActive === true, JSON.stringify({ isActive: fresh.data?.isActive, disabledAt: fresh.data?.disabledAt, invitationStatus: fresh.data?.invitationStatus }));

    const backIn = await login(victimEmail, 'Recette-Victime-2026!');
    log('Compte réactivé peut se reconnecter (200)', backIn.status === 200, `HTTP ${backIn.status}`);

    await call(`/users/${victimId}/status`, { method: 'PATCH', body: { enabled: false }, token: saToken });
    const bad = await call(`/users/${victimId}/status`, { method: 'PATCH', body: { enabled: 'peut-être' }, token: saToken });
    const afterBad = await call(`/users/${victimId}`, { token: saToken });
    log('Statut invalide rejeté sans modifier le compte', [400, 422].includes(bad.status) && afterBad.data?.disabledAt !== null, `HTTP ${bad.status}, disabledAt=${afterBad.data?.disabledAt}`);

    await call(`/users/${victimId}/status`, { method: 'PATCH', body: { enabled: true }, token: saToken });
  }

  // 5) E-mails : chaque tentative doit être journalisée (EmailLog).
  const mailLogs = await prisma.emailLog.findMany({ orderBy: { createdAt: 'desc' }, take: 5 });
  log('Tentatives d’e-mail journalisées', mailLogs.length > 0, JSON.stringify(mailLogs.map((row) => ({ to: row.to, template: row.template, status: row.status }))));

  // 6) Simulation de nettoyage : aucune écriture.
  const before = await prisma.planning.count();
  const preview = await call('/super-admin/cleanup/preview', { method: 'POST', body: { targets: ['PLANNINGS', 'NOTIFICATIONS'] }, token: saToken });
  const after = await prisma.planning.count();
  log('Simulation : aucune écriture', preview.status === 200 && before === after, `plannings ${before} -> ${after}`);
  log('Simulation : volumes par catégorie', Array.isArray(preview.data?.targets), JSON.stringify(preview.data?.targets));

  const withoutConfirmation = await call('/super-admin/cleanup', { method: 'POST', body: { targets: ['NOTIFICATIONS'], dryRun: false }, token: saToken });
  log('Suppression sans « EFFACER » refusée (400)', withoutConfirmation.status === 400, `HTTP ${withoutConfirmation.status} ${withoutConfirmation.data?.message ?? ''}`);

  console.log(JSON.stringify(results, null, 2));
  const failed = results.filter((row) => !row.ok);
  console.log(`\n${results.length - failed.length}/${results.length} contrôles réussis`);
  for (const row of failed) console.log(` - ÉCHEC ${row.name} :: ${row.detail}`);
}

main()
  .catch((error) => {
    console.error('ERREUR', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
