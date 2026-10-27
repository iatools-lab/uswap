﻿/**
 * Recette de bout en bout : SUPER_ADMIN reel, e-mail de reinitialisation,
 * rapport envoye a un vrai destinataire, prise et fin de service.
 *
 *   cd backend_new && node _scripts/recette-flow.mjs [destinataire@exemple.com]
 */
import 'dotenv/config';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');

const BASE = process.env.API_URL ?? 'http://127.0.0.1:3000';
const SUPERADMIN = process.env.SUPERADMIN_EMAIL ?? 'superadmin@gmail.com';
const SUPERADMIN_PASSWORD = process.env.DEMO_PASSWORD ?? '';
const RECIPIENT =
  process.argv[2] ?? process.env.SMTP_USER ?? process.env.RECIPIENT ?? '';

if (!RECIPIENT || !SUPERADMIN_PASSWORD) {
  console.error(
    'Definir DEMO_PASSWORD et un destinataire (argument ou SMTP_USER) avant la recette.',
  );
  process.exit(1);
}
const prisma = new PrismaClient();

const results = [];
const log = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`);
};

async function call(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(BASE + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
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

async function main() {
  // 1. Connexion du super administrateur reel.
  const login = await call('/auth/login', {
    method: 'POST',
    body: { email: SUPERADMIN, password: SUPERADMIN_PASSWORD },
  });
  log(
    'Connexion superadmin@gmail.com',
    login.status === 200 && Boolean(login.data?.accessToken),
    `HTTP ${login.status} role=${login.data?.user?.role ?? login.data?.role ?? '?'}`,
  );
  const token = login.data?.accessToken;

  // 2. Reinitialisation de mot de passe : e-mail reellement transmis.
  const forgot = await call('/auth/forgot-password', {
    method: 'POST',
    body: { email: SUPERADMIN },
  });
  log('Demande de reinitialisation', forgot.status === 200, `HTTP ${forgot.status}`);
  const resetLog = await prisma.emailLog.findFirst({
    where: { to: SUPERADMIN, template: 'PASSWORD_RESET' },
    orderBy: { createdAt: 'desc' },
  });
  log(
    'E-mail de reinitialisation accepte par le SMTP',
    resetLog?.status === 'SENT',
    `statut=${resetLog?.status} ${resetLog?.error ?? ''}`,
  );

  // Le lien recu est valide : on verifie qu'il fonctionne (sans changer le
  // mot de passe de demonstration).
  const resetToken = await prisma.invitationToken.findFirst({
    where: { purpose: 'PASSWORD_RESET', user: { email: SUPERADMIN }, usedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  const check = await call('/auth/reset-password', {
    method: 'POST',
    body: { token: resetToken?.token ?? '', password: 'trop-court' },
  });
  log(
    'Lien de reinitialisation valide',
    // 400 = jeton reconnu mais mot de passe refuse par la politique ;
    // 409 / INVALID_TOKEN signifieraient un lien inexploitable.
    check.status === 400 && !String(check.data?.code ?? '').includes('TOKEN'),
    `HTTP ${check.status} ${JSON.stringify(check.data ?? '').slice(0, 120)}`,
  );

  // 3. Rapport programme envoye immediatement au destinataire reel.
  const created = await call('/admin/reports/schedules', {
    method: 'POST',
    token,
    body: {
      name: `Recette SMTP ${Date.now()}`,
      frequency: 'WEEKLY',
      format: 'XLSX',
      scope: 'NETWORK',
      sections: ['ATTENDANCE', 'COVERAGE', 'HOURS', 'MOVEMENTS'],
      recipients: [RECIPIENT],
    },
  });
  log(
    'Creation d un rapport programme',
    [200, 201].includes(created.status),
    `HTTP ${created.status}`,
  );
  const send = await call(`/admin/reports/schedules/${created.data?.id}/send`, {
    method: 'POST',
    token,
    body: {},
  });
  log(
    'Envoi immediat du rapport',
    send.status === 200 && send.data?.ok === true,
    `HTTP ${send.status} ${JSON.stringify(send.data ?? '').slice(0, 160)}`,
  );
  const reportLog = await prisma.emailLog.findFirst({
    where: { to: RECIPIENT, template: 'SCHEDULED_REPORT' },
    orderBy: { createdAt: 'desc' },
  });
  log(
    'E-mail de rapport accepte par le SMTP',
    reportLog?.status === 'SENT',
    `statut=${reportLog?.status} ${reportLog?.error ?? ''}`,
  );

  // 4. Prise puis fin de service, avec la position de la station.
  const swapper = await prisma.user.findUnique({
    where: { email: 'awa.nkolo@upowa.org' },
    include: { station: true },
  });
  const swapperLogin = await call('/auth/login', {
    method: 'POST',
    body: { email: swapper.email, password: PASSWORD },
  });
  const swapperToken = swapperLogin.data?.accessToken;
  log(
    'Connexion agent',
    swapperLogin.status === 200 && Boolean(swapperToken),
    `HTTP ${swapperLogin.status}`,
  );

  const workspace = await call('/workspace', { token: swapperToken });
  const shifts = workspace.data?.shifts ?? [];
  const now = Date.now();
  const target = shifts.find(
    (shift) =>
      Date.parse(shift.startTime) - 10 * 60_000 <= now &&
      now <= Date.parse(shift.endTime) &&
      !shift.attendance?.checkOutAt,
  );
  log(
    'Un service en cours est visible dans l espace de travail',
    Boolean(target),
    target
      ? `${target.label} ${target.startTime} â†’ ${target.endTime}`
      : `${shifts.length} service(s)`,
  );

  if (target) {
    const punch = (kind) =>
      call('/attendance', {
        method: 'POST',
        token: swapperToken,
        body: {
          shiftId: target.id,
          kind,
          latitude: swapper.station.latitude,
          longitude: swapper.station.longitude,
          accuracyMeters: 5,
        },
      });

    const checkin = await punch('CHECKIN');
    log(
      'Prise de service',
      checkin.status === 200,
      `HTTP ${checkin.status} ${JSON.stringify(checkin.data ?? '').slice(0, 140)}`,
    );
    const duplicate = await punch('CHECKIN');
    log(
      'Double prise de service refusee proprement',
      duplicate.status === 409,
      `HTTP ${duplicate.status} ${duplicate.data?.message ?? ''}`,
    );
    const checkout = await punch('CHECKOUT');
    log(
      'Fin de service',
      checkout.status === 200,
      `HTTP ${checkout.status} ${JSON.stringify(checkout.data ?? '').slice(0, 140)}`,
    );
    const attendance = await prisma.attendance.findUnique({
      where: { shiftId: target.id },
    });
    log(
      'Pointage enregistre en base',
      Boolean(attendance?.checkedInAt && attendance?.checkedOutAt),
      `${attendance?.status} in=${attendance?.checkedInAt?.toISOString()} out=${attendance?.checkedOutAt?.toISOString()}`,
    );

    // Retour Ã  l'Ã©tat "service Ã  pointer" pour la dÃ©monstration suivante.
    await prisma.$transaction([
      prisma.absence.deleteMany({
        where: { shiftId: target.id, origin: 'AUTOMATIC_ABSENCE' },
      }),
      prisma.automatedAbsence.deleteMany({ where: { shiftId: target.id } }),
      prisma.attendance.deleteMany({ where: { shiftId: target.id } }),
      prisma.occurrence.update({
        where: { id: target.id },
        data: {
          startTime: new Date(Date.now() - 5 * 60_000),
          endTime: new Date(Date.now() + 3 * 3_600_000),
        },
      }),
    ]);
  }

  const failed = results.filter((item) => !item.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} contrÃ´les rÃ©ussis`,
  );
  if (failed.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error('ERREUR', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
