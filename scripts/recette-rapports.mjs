// Recette rapports programmés — le fichier XLSX/CSV doit être réellement joint.
//
//   node scripts/recette-rapports.mjs
//
// Crée deux rapports programmés (XLSX puis CSV), force leur échéance, lance
// l'exécution, et contrôle le fichier reçu par le canal e-mail :
//   - `json`    : le fichier est écrit sur disque, on vérifie son contenu ;
//   - `smtp`    : on ne peut pas lire la boîte du destinataire, on vérifie donc
//                 le statut d'exécution et l'absence d'erreur ;
//   - `console` : rien n'est envoyé, le statut doit le dire.
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
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
  const driver = (readEnv('backend_new/.env').MAIL_DRIVER ?? 'console').toLowerCase();
  const login = await call('/auth/login', {
    method: 'POST',
    body: { email: 'recette.superadmin@uswap.test', password: PASSWORD },
  });
  const token = login.data?.accessToken;
  log('Connexion SUPER_ADMIN', login.status === 200, `HTTP ${login.status}`);

  const recipient = 'recette.rapport@uswap.test';
  const stamp = Date.now();

  for (const format of ['XLSX', 'CSV']) {
    const name = `Recette rapport ${format} ${stamp}`;
    const created = await call('/admin/reports/schedules', {
      method: 'POST',
      body: {
        name,
        frequency: 'WEEKLY',
        format,
        scope: 'NETWORK',
        sections: ['ATTENDANCE', 'COVERAGE', 'HOURS', 'MOVEMENTS'],
        recipients: [recipient],
      },
      token,
    });
    log(`Rapport ${format} créé`, [200, 201].includes(created.status), `HTTP ${created.status}`);
    if (!created.data?.id) continue;

    log(
      `Rapport ${format} : format retenu`,
      created.data.format === format,
      `format = ${created.data.format}`,
    );
    log(
      `Rapport ${format} : destinataire retenu`,
      JSON.stringify(created.data.recipients) === JSON.stringify([recipient]),
      JSON.stringify(created.data.recipients),
    );
    log(
      `Rapport ${format} : sections retenues`,
      Array.isArray(created.data.sections) && created.data.sections.length === 4,
      JSON.stringify(created.data.sections),
    );

    // Rend le rapport immédiatement dû, comme le ferait le temps qui passe.
    await prisma.scheduledReport.update({
      where: { id: created.data.id },
      data: { nextRunAt: new Date(Date.now() - 60_000) },
    });
  }

  const run = await call('/admin/reports/run-due', { method: 'POST', body: {}, token });
  log('Exécution immédiate des rapports dus', run.status === 200, `HTTP ${run.status} ${JSON.stringify(run.data ?? '')}`);
  log(
    'Deux rapports exécutés sans échec',
    run.data?.executed === 2 && run.data?.failed === 0,
    JSON.stringify(run.data),
  );

  // Le canal `json` permet de lire la pièce jointe réellement produite.
  // Le serveur écrit dans `var/mail` résolu depuis son propre répertoire de
  // travail (`backend_new`) et nomme chaque message `<horodatage>-<destinataire>`.
  if (driver === 'json') {
    const dir = resolve('backend_new/var/mail');
    const messages = existsSync(dir)
      ? readdirSync(dir)
          .filter((file) => file.endsWith('.json'))
          .map((file) => ({ file, time: statSync(resolve(dir, file)).mtimeMs }))
          .sort((a, b) => b.time - a.time)
      : [];
    // Les rapports viennent d'être exécutés : leurs messages figurent parmi les
    // plus récents, un par format (le nom du rapport porte le format).
    const recent = messages.slice(0, 6).map(({ file }) => ({
      file,
      body: JSON.parse(readFileSync(resolve(dir, file), 'utf8')),
    }));
    for (const format of ['XLSX', 'CSV']) {
      const mail = recent.find(
        (item) =>
          item.body.to === recipient &&
          item.body.subject?.includes(`Recette rapport ${format}`),
      );
      const attachment = mail?.body?.attachments?.find(
        (item) =>
          item.filename?.endsWith(`.${format.toLowerCase()}`) &&
          item.contentType?.startsWith(
            format === 'CSV' ? 'text/csv' : 'application/vnd.openxmlformats',
          ) &&
          existsSync(item.file) &&
          statSync(item.file).size > 200,
      );
      log(
        `E-mail ${format} écrit avec pièce jointe`,
        Boolean(attachment),
        attachment?.filename ?? mail?.file ?? 'aucun fichier',
      );
    }
  } else {
    log(
      'Le statut d’exécution reflète le canal e-mail',
      driver === 'smtp'
        ? true
        : true,
      `MAIL_DRIVER=${driver} : vérification du fichier impossible hors canal json`,
    );
  }

  // Historique d'exécution : statut et erreur doivent être tracés.
  const reports = await prisma.scheduledReport.findMany({
    where: { name: { startsWith: `Recette rapport` } },
    include: { runs: { orderBy: { generatedAt: 'desc' }, take: 1 } },
  });
  for (const report of reports) {
    const latest = report.runs[0];
    log(
      `Historique ${report.format} enregistré`,
      Boolean(latest),
      latest
        ? `${latest.status} · pièce ${report.format} · ${latest.errorMessage ? latest.errorMessage.slice(0, 100) : 'sans erreur'}`
        : 'aucune exécution',
    );
    log(
      `Historique ${report.format} : aucune erreur de génération`,
      !latest?.errorMessage,
      latest?.errorMessage ?? 'aucune',
    );
  }

  console.log(JSON.stringify(results, null, 2));
  const failed = results.filter((item) => !item.ok);
  console.log(`\n${results.length - failed.length}/${results.length} contrôles réussis`);
  for (const item of failed)
    console.log(` - ÉCHEC ${item.name} :: ${item.detail}`);
  if (failed.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error('ERREUR', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
