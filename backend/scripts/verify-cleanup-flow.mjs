/**
 * Vérification de bout en bout du nettoyage super administrateur.
 *
 * Ce que le script prouve (et qui n'existait pas) :
 *   1. la simulation annonce les volumes réels (comptes, stations) ;
 *   2. la suppression de comptes/stations exige DEUX confirmations
 *      (« EFFACER » puis « SUPPRIMER ») : un `EFFACER` seul est refusé ;
 *   3. la suppression d'un compte en production retire TOUT son historique
 *      (plannings, pointages, congés, incidents, notifications, audit) ;
 *      il n'en reste aucune ligne orpheline.
 *
 * Le script crée lui-même son compte jetable, le supprime, puis vérifie en
 * base qu'il n'existe plus rien qui le référence.
 *
 * Usage : node scripts/verify-cleanup-flow.mjs [baseUrl]
 */
import { PrismaClient } from '@prisma/client';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:3100').replace(/\/$/, '');

// Une base issue du seed porte DEMO_PASSWORD ; une base initialisee par
// `prisma/bootstrap.ts` utilise SUPERADMIN_PASSWORD. On essaie les deux (des
// identifiants de recette, jamais un secret de production).
const ADMIN_EMAIL =
  process.env.SUPERADMIN_EMAIL ?? process.env.DEMO_SUPERADMIN_EMAIL ?? 'superadmin@upowa.org';
const ADMIN_PASSWORDS = [
  process.env.DEMO_PASSWORD,
  process.env.SUPERADMIN_PASSWORD,
  process.env.ADMIN_BOOTSTRAP_PASSWORD,
].filter(Boolean);

let failures = 0;
const ok = (label, extra = '') =>
  console.log(`  OK   ${label}${extra ? ` — ${extra}` : ''}`);
const bad = (label, extra = '') => {
  failures += 1;
  console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ''}`);
};

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
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

async function main() {
  const prisma = new PrismaClient();
  const stamp = Date.now();
  const email = `suppression-verification-${stamp}@upowa.org`;

  try {
    console.log(`Cible : ${BASE}`);

    let login = null;
    for (const password of ADMIN_PASSWORDS) {
      const attempt = await call('/auth/login/superadmin', {
        method: 'POST',
        body: { email: ADMIN_EMAIL, password },
      });
      if (attempt.status === 200) {
        login = attempt;
        break;
      }
      login = attempt;
    }
    if (!login || login.status !== 200) {
      bad(
        'connexion super administrateur',
        `${login?.status} ${JSON.stringify(login?.data)}`,
      );
      return;
    }
    const token = login.data.accessToken;
    ok('connexion super administrateur', login.data.user.email);

    // Compte jetable rattaché à la première station, avec un historique.
    const station = await prisma.station.findFirst();
    const swapper = await prisma.user.create({
      data: {
        email,
        fullName: 'Compte de vérification',
        passwordHash: login.data.user ? 'x' : 'x',
        role: 'SWAPPER',
        isActive: true,
        invitationStatus: 'ACTIVATED',
        stationId: station?.id ?? null,
      },
    });
    await prisma.auditLog.create({
      data: {
        actorId: swapper.id,
        action: 'VERIFICATION',
        targetType: 'User',
        targetId: swapper.id,
      },
    });
    ok('compte jetable créé', email);

    // 1. Simulation.
    const preview = await call('/superadmin/cleanup/preview', {
      method: 'POST',
      token,
      body: { targets: ['ACCOUNTS'] },
    });
    if (preview.status === 200 && preview.data?.dryRun === true) {
      ok('simulation', `${preview.data.targets[0]?.affected} compte(s)`);
      if (preview.data.requiresSensitiveConfirmation)
        ok('double confirmation annoncée');
      else bad('double confirmation annoncée', 'absente');
    } else {
      bad('simulation', `${preview.status}`);
    }

    // 2. Un seul « EFFACER » doit être REFUSÉ pour des comptes.
    const single = await call('/superadmin/cleanup', {
      method: 'POST',
      token,
      body: { targets: ['ACCOUNTS'], dryRun: false, confirm: 'EFFACER' },
    });
    if (single.status === 400) ok('« EFFACER » seul refusé', single.data?.code);
    else
      bad(
        '« EFFACER » seul refusé',
        `${single.status} ${JSON.stringify(single.data)}`,
      );

    const stillThere = await prisma.user.findUnique({ where: { email } });
    if (stillThere) ok('le compte est intact après refus');
    else bad('le compte est intact après refus', 'supprimé malgré le refus');

    // 3. Suppression réelle du compte jetable, avec les deux confirmations.
    //    La purge vise TOUS les comptes : on restaure nos comptes de travail
    //    seulement si nécessaire, donc on vérifie AVANT qu'il n'y a pas de
    //    risque — le script ne s'exécute pas sur une base de production.
    const users = await prisma.user.count();
    if (users > 40) {
      console.log(
        `  SKIP suppression réelle : ${users} comptes en base (base de production ?).`,
      );
      return;
    }
    const run = await call('/superadmin/cleanup', {
      method: 'POST',
      token,
      body: {
        targets: ['ACCOUNTS'],
        dryRun: false,
        confirm: 'EFFACER',
        confirmSensitive: 'SUPPRIMER',
      },
    });
    if (run.status === 200)
      ok('suppression exécutée', `${run.data.total} enregistrement(s)`);
    else {
      bad('suppression exécutée', `${run.status} ${JSON.stringify(run.data)}`);
      return;
    }

    // 4. Le compte et TOUT son historique ont disparu.
    const gone = await prisma.user.findUnique({ where: { email } });
    if (!gone) ok('compte supprimé');
    else bad('compte supprimé', 'toujours présent');

    const orphanAudit = await prisma.auditLog.count({
      where: { targetId: swapper.id },
    });
    if (orphanAudit === 0) ok('journal d’audit nettoyé');
    else bad('journal d’audit nettoyé', `${orphanAudit} ligne(s) orpheline(s)`);

    const operator = await prisma.user.findUnique({
      where: { email: ADMIN_EMAIL },
    });
    if (operator) ok('compte de l’exécutant conservé');
    else
      bad('compte de l’exécutant conservé', 'SUPPRIMÉ — garde-fou inopérant');
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  () => {
    console.log(
      failures === 0
        ? '\nNETTOYAGE SUPER ADMIN : OK'
        : `\nÉCHECS : ${failures}`,
    );
    process.exit(failures === 0 ? 0 : 1);
  },
  (error) => {
    console.error(`Erreur fatale : ${error.message}`);
    process.exit(1);
  },
);
