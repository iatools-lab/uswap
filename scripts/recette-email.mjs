// Recette e-mail — statut réel du journal après une tentative d'envoi.
//
//   node scripts/recette-email.mjs
//
// En mode `console` (pas de SMTP configuré), aucun message n'est livré : le
// journal doit le dire. En `smtp`, il doit refléter la réponse du fournisseur.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('../backend_new/node_modules/@prisma/client');

const BASE = process.env.API_URL ?? 'http://127.0.0.1:3000';
const PASSWORD = 'Recette-SuperAdmin-2026!';
const prisma = new PrismaClient();
const results = [];
const log = (name, ok, detail = '') => results.push({ name, ok, detail });

const call = async (path, { method = 'GET', body, token } = {}) => {
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
};

const readEnv = (file) => {
  try {
    return Object.fromEntries(
      readFileSync(resolve(file), 'utf8')
        .split(/\r?\n/)
        .filter((line) => /^[A-Z0-9_]+=/.test(line))
        .map((line) => {
          const index = line.indexOf('=');
          return [line.slice(0, index), line.slice(index + 1).trim()];
        }),
    );
  } catch {
    return {};
  }
};

async function main() {
  const env = readEnv('backend_new/.env');
  const driver = (env.MAIL_DRIVER ?? 'console').toLowerCase();
  log('Canal e-mail local connu', true, `MAIL_DRIVER=${driver}`);

  const login = await call('/auth/login', {
    method: 'POST',
    body: { email: 'recette.superadmin@uswap.test', password: PASSWORD },
  });
  const token = login.data?.accessToken;

  // Une invitation réelle : c'est le parcours signalé comme cassé.
  const email = `recette.mail.${Date.now()}@uswap.test`;
  const created = await call('/users', {
    method: 'POST',
    body: { fullName: 'Recette Mail', email, role: 'ADMIN' },
    token,
  });
  log('Compte en attente créé (invitation demandée)', [200, 201].includes(created.status), `HTTP ${created.status}`);
  log(
    'Le compte reste en attente d’activation',
    created.data?.isActive === false && created.data?.invitationStatus !== 'ACTIVATED',
    JSON.stringify({ isActive: created.data?.isActive, invitationStatus: created.data?.invitationStatus }),
  );

  const rows = await prisma.emailLog.findMany({
    where: { to: email },
    orderBy: { createdAt: 'desc' },
  });
  log('Envoi journalisé dans EmailLog', rows.length > 0, `${rows.length} ligne(s)`);
  const row = rows[0];
  if (!row) return;

  log(
    'Statut terminal, jamais bloqué en PENDING',
    ['SENT', 'FAILED', 'SKIPPED'].includes(row.status),
    row.status,
  );
  log(
    'Le statut reflète la réalité du canal',
    driver === 'smtp'
      ? row.status === 'SENT' || row.status === 'FAILED'
      : row.status === 'SKIPPED',
    driver === 'smtp'
      ? `smtp → ${row.status}${row.error ? ` (${row.error.slice(0, 100)})` : ''}`
      : `console → ${row.status} : ${row.error ?? ''}`,
  );
  log(
    'Un envoi réel porte une date d’envoi',
    row.status !== 'SENT' || Boolean(row.sentAt),
    row.sentAt ? row.sentAt.toISOString() : 'aucune',
  );

  // La tentative ne doit pas laisser le compte utilisable sans mot de passe.
  const loginAttempt = await call('/auth/login', {
    method: 'POST',
    body: { email, password: 'mot-de-passe-inconnu' },
  });
  log('Compte non activé : connexion refusée', [401, 403].includes(loginAttempt.status), `HTTP ${loginAttempt.status}`);

  console.log(JSON.stringify(results, null, 2));
  const failed = results.filter((item) => !item.ok);
  console.log(`\n${results.length - failed.length}/${results.length} contrôles réussis`);
  for (const item of failed) console.log(` - ÉCHEC ${item.name} :: ${item.detail}`);
}

main()
  .catch((error) => {
    console.error('ERREUR', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
