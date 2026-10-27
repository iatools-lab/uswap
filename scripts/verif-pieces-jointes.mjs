// Vérifie le contenu réel des pièces jointes des rapports programmés.
//
//   node scripts/verif-pieces-jointes.mjs
//
// Nécessite `MAIL_DRIVER=json` (recette) : les e-mails et leurs pièces jointes
// sont alors écrits dans `backend_new/var/mail` (répertoire résolu depuis le
// `process.cwd()` du serveur, qui démarre dans `backend_new`). Le script lit le
// dernier message de chaque format, ouvre le fichier joint et contrôle :
//   - son nom, son type MIME et sa taille ;
//   - qu'il est lisible dans le format annoncé ;
//   - qu'il contient les lignes attendues (période, synthèse).
//
// Le format n'est pas déduit de l'extension : le message JSON décrit chaque
// pièce jointe (nom, type MIME, chemin du fichier écrit). C'est ce couple
// déclaration/contenu qui est vérifié, pas une simple convention de nommage.
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const require = createRequire(import.meta.url);
const XLSX = require('../backend_new/node_modules/xlsx');

const DIR = resolve('backend_new/var/mail');
const EXPECTED_MIME = {
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  CSV: 'text/csv',
};
const results = [];
const log = (name, ok, detail = '') => results.push({ name, ok, detail });

/**
 * Dernier message contenant une pièce jointe au format demandé.
 * Les messages sont triés par date de dépôt : l'horodatage qui préfixe leur nom
 * est celui du fichier et ne permet pas de trier entre le message et sa pièce.
 */
function latestMessage(format) {
  if (!existsSync(DIR)) return null;
  const expected = EXPECTED_MIME[format];
  const messages = readdirSync(DIR)
    .filter((file) => file.toLowerCase().endsWith('.json'))
    .map((file) => ({ file, time: statSync(join(DIR, file)).mtimeMs }))
    .sort((a, b) => b.time - a.time);

  for (const { file } of messages) {
    let body;
    try {
      body = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
    } catch {
      continue; // message en cours d'écriture ou illisible : on l'ignore
    }
    const attachment = (body.attachments ?? []).find(
      (item) =>
        item?.contentType?.split(';')[0].trim() === expected &&
        item?.filename?.toLowerCase().endsWith(`.${format.toLowerCase()}`) &&
        item?.file &&
        existsSync(item.file),
    );
    if (!attachment) continue;
    return { message: file, subject: body.subject, text: body.text, attachment };
  }
  return null;
}

function main() {
  for (const format of Object.keys(EXPECTED_MIME)) {
    const found = latestMessage(format);
    log(`Pièce jointe ${format} présente`, Boolean(found), found?.attachment.file ?? 'aucune');
    if (!found) continue;

    const { attachment, subject, message, text } = found;
    const name = attachment.filename ?? '';
    // Le nom affiché dans le message est nu ; sur disque il est préfixé par
    // l'horodatage et l'index de la pièce (anti-collision).
    const onDisk = attachment.file.split(/[\\/]/).pop() ?? '';
    const buffer = readFileSync(attachment.file);

    log(
      `${format} : nom de fichier explicite`,
      /^rapport-uswap-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\./.test(name),
      name,
    );
    log(`${format} : nom de fichier cohérent avec le format`, name.toLowerCase().endsWith(`.${format.toLowerCase()}`), name);
    log(
      `${format} : type MIME déclaré`,
      (attachment.contentType ?? '').split(';')[0].trim() === EXPECTED_MIME[format],
      String(attachment.contentType),
    );
    log(
      `${format} : nom repris dans le message`,
      String(subject ?? '').includes(name) ||
        String(text ?? '').includes(name),
      `${message} · ${subject}`,
    );
    log(
      `${format} : nom du fichier sur disque sans collision`,
      onDisk.endsWith(name) && /^\d+-\d+-/.test(onDisk),
      onDisk,
    );
    log(`${format} : fichier non vide`, buffer.length > 200, `${buffer.length} octets`);

    let rows;
    let flat;
    let csvHeader = null;
    let csvPeriod = [];
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: false });
      flat = rows.flat().map((cell) => String(cell ?? '').trim());
      if (format === 'CSV') {
        // Le CSV est relu par XLSX, qui reformate les dates au format local
        // (« 10/26/26 »). La période est donc vérifiée sur le texte brut.
        const lines = buffer.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
        csvHeader = lines[0];
        csvPeriod = lines
          .filter((line) => line.startsWith('Période,'))
          .map((line) => line.split(',')[2] ?? '');
      }
    } catch (error) {
      log(`${format} : lisible et non vide`, false, error instanceof Error ? error.message : 'illisible');
      continue;
    }

    log(`${format} : lisible et non vide`, rows.length > 5, `${rows.length} ligne(s)`);
    log(
      `${format} : contient la période`,
      flat.includes('Période') &&
        (format === 'CSV'
          ? csvPeriod.length === 2 && csvPeriod.every((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
          : flat.some((cell) => /^\u0000?\d{4}-\d{2}-\d{2}$/.test(cell))),
      format === 'CSV' ? csvPeriod.join(' → ') : rows.slice(1, 3).map((row) => row.join(' ')).join(' | '),
    );
    log(
      `${format} : contient les indicateurs attendus`,
      flat.includes('Taux de couverture (%)') && flat.includes('Taux de présence (%)'),
      flat.filter((cell) => cell.startsWith('Taux')).join(' · ') || 'aucun',
    );
    log(
      `${format} : contient la synthèse (services planifiés)`,
      flat.includes('Services planifiés'),
      rows.find((row) => row[1] === 'Services planifiés')?.join(' = ') ?? 'absent',
    );

    if (format === 'CSV') {
      const text = buffer.toString('utf8');
      log('CSV : séparateur et en-tête attendus', text.includes('Section,Libellé,Indicateur'), csvHeader);
      log('CSV : accents lisibles (BOM UTF-8)', text.charCodeAt(0) === 0xfeff, `premier caractère U+${text.charCodeAt(0).toString(16).toUpperCase()}`);
    }
  }

  console.log(JSON.stringify(results, null, 2));
  const failed = results.filter((row) => !row.ok);
  console.log(`\n${results.length - failed.length}/${results.length} contrôles réussis`);
  for (const row of failed) console.log(` - ÉCHEC ${row.name} :: ${row.detail}`);
  if (failed.length) process.exitCode = 1;
}

main();
