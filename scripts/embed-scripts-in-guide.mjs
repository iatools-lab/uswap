/**
 * Injecte le contenu courant des scripts dans deploy/REPARER-DEPLOIEMENT.md.
 *
 * Le guide est livré comme UN SEUL fichier : il doit contenir les scripts
 * eux-mêmes, pas un renvoi vers des fichiers absents du serveur. Rejouer ce
 * script après toute modification d'un script garantit que le guide ne
 * contient jamais une version obsolète.
 *
 *   node scripts/embed-scripts-in-guide.mjs          # écrit le guide
 *   node scripts/embed-scripts-in-guide.mjs --check  # échoue si désynchronisé
 *
 * Deux règles apprises à la dure :
 *   - le délimiteur de heredoc est porté par la variable « FIN_<nom> » :
 *     l'écrire en dur ici terminerait prématurément le heredoc shell ;
 *   - les marqueurs sont calculés par concaténation pour ne jamais s'écrire
 *     eux-mêmes dans le fichier produit.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const GUIDE = join(ROOT, 'deploy', 'REPARER-DEPLOIEMENT.md');

const SCRIPTS = [
  ['CHECK_LIVE', 'deploy/check-live.sh', '<<<<CHECK_LIVE>>>>'],
  ['FIX_SOURCES', 'deploy/fix-missing-sources.sh', '<<<<FIX_SOURCES>>>>'],
  ['CHECK_BASH', 'scripts/check-bash.mjs', '<<<<CHECK_BASH>>>>'],
];

let guide = readFileSync(GUIDE, 'utf8');
let changed = 0;

for (const [name, file, marker] of SCRIPTS) {
  const body = readFileSync(join(ROOT, file), 'utf8').replace(/\s*$/, '');
  const start = marker;
  const end = marker.replace('<<<<', '<<<</').replace('>>>>', '>>>>');
  const block = `${start}\n${body}\n${end}`;

  const from = guide.indexOf(start);
  if (from === -1) throw new Error(`marqueur de début absent : ${start}`);
  const to = guide.indexOf(end, from);
  if (to === -1) throw new Error(`marqueur de fin absent : ${end}`);

  const next = guide.slice(0, from) + block + guide.slice(to + end.length);
  const modified = next !== guide;
  if (modified) changed += 1;
  guide = next;
  console.log(`${file} -> ${modified ? 'mis à jour' : 'à jour'} (${name})`);
}

if (process.argv.includes('--check')) {
  if (changed > 0) {
    console.log(
      'guide désynchronisé : lancer node scripts/embed-scripts-in-guide.mjs',
    );
    process.exit(1);
  }
  console.log('guide synchronisé avec les scripts.');
  process.exit(0);
}

writeFileSync(GUIDE, guide, 'utf8');
console.log(
  `guide écrit : deploy/REPARER-DEPLOIEMENT.md (${changed} bloc(s) modifié(s))`,
);
