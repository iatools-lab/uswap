/**
 * Réparer le mojibake UTF-8 → Latin-1 sur les fichiers source du projet.
 *
 * Une partie des fichiers a été ré-encodée par erreur : le contenu UTF-8 a été
 * interprété comme du Latin-1 puis écrit à nouveau en UTF-8, ce qui double les
 * accents (« publié » devient « publiÃ© », « — » devient « â€“ »).
 *
 * La corruption est PARTIELLE : certains accents sont restés corrects (le « é »
 * de Yaoundé), d'autres sont devenus du mojibake. Un ré-encodage global casserait
 * les accents déjà corrects ; le script ne remplace donc que les séquences de
 * mojibake connues.
 *
 * Usage :
 *   node scripts/fix-mojibake.cjs            # applique les corrections
 *   node scripts/fix-mojibake.cjs --check    # n'écrit rien, signale seulement
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CHECK_ONLY = process.argv.includes('--check');

// Table de réparation : mojibake → caractère correct.
//
// Le second octet a été décodé en Windows-1252 (et non en Latin-1), donc les
// octets 0x80–0x9F deviennent la ponctuation CP1252 : 0x89 → “ ‰ ”, 0x80 → “ € ”,
// 0x93/0x94 → “ œ / ” ”, etc. On couvre les deux décodages par prudence.
const REPAIRS = [
  ['\u00C2\u00A0', '\u00A0'],
  ['\u00C2\u00AB', '«'],
  ['\u00C2\u00BB', '»'],
  ['\u00C2\u00B0', '°'],
  ['\u00C2\u00A9', '©'],
  ['\u00C2\u00B7', '·'],
  ['\u00C2\u00B2', '²'],
  ['\u00C3\u0080', 'À'],
  ['\u00C3\u0082', 'Â'],
  ['\u00C3\u0087', 'Ç'],
  ['\u00C3\u0088', 'È'],
  ['\u00C3\u0089', 'É'],
  ['\u00C3\u008A', 'Ê'],
  ['\u00C3\u008B', 'Ë'],
  ['\u00C3\u008E', 'Î'],
  ['\u00C3\u008F', 'Ï'],
  ['\u00C3\u0094', 'Ô'],
  ['\u00C3\u0099', 'Ù'],
  ['\u00C3\u009B', 'Û'],
  ['\u00C3\u009C', 'Ü'],
  ['\u00C3\u00A0', 'à'],
  ['\u00C3\u00A2', 'â'],
  ['\u00C3\u00A7', 'ç'],
  ['\u00C3\u00A8', 'è'],
  ['\u00C3\u00A9', 'é'],
  ['\u00C3\u00AA', 'ê'],
  ['\u00C3\u00AB', 'ë'],
  ['\u00C3\u00AE', 'î'],
  ['\u00C3\u00AF', 'ï'],
  ['\u00C3\u00B4', 'ô'],
  ['\u00C3\u00B9', 'ù'],
  ['\u00C3\u00BB', 'û'],
  ['\u00C3\u00BC', 'ü'],
  ['\u00C3\u0153', 'œ'],
  ['\u00C3\u2030', 'É'],
  ['\u00C3\u201A', 'È'],
  ['\u00C3\u20AC', 'À'],
  ['\u00C3\u02C6', 'È'],
  ['\u00C3\u2039', 'É'],
  ['\u00C3\u2013', 'È'],
  ['\u00C5\u0093', '“'],
  ['\u00C5\u0094', '”'],
  ['\u00C5\u0092', '’'],
  // Ponctuation typographique (« â€“ » pour un tiret cadratin, etc.).
  ['\u00E2\u0080\u0099', '’'],
  ['\u00E2\u0080\u0098', '‘'],
  ['\u00E2\u0080\u009C', '“'],
  ['\u00E2\u0080\u009D', '”'],
  ['\u00E2\u0080\u0093', '–'],
  ['\u00E2\u0080\u0094', '—'],
  ['\u00E2\u0080\u00A6', '…'],
  ['\u00E2\u201A\u00AC', '€'],
  ['\u00E2\u0082\u00AC', '€'],
  ['\u00E2\u2019\u00A5', '™'],
  // Les octets médians/derniers décodés en CP1252 : 0x80 → “ € ”, 0x99 → “ ™ ”,
  // 0x93 → “ œ ”, 0x94 → “ ” ”, 0x96 → “ – ”, 0x97 → “ — ”, 0x85 → “ … ”.
  ['\u00E2\u20AC\u2122', '’'],
  ['\u00E2\u20AC\u0098', '‘'],
  ['\u00E2\u20AC\u0153', '“'],
  ['\u00E2\u20AC\u009D', '”'],
  ['\u00E2\u20AC\u201C', '“'],
  ['\u00E2\u20AC\u201D', '”'],
  ['\u00E2\u20AC\u2013', '–'],
  ['\u00E2\u20AC\u2014', '—'],
  ['\u00E2\u20AC\u00A6', '…'],
  ['\u00C5\u2019', '’'],
];

// Variantes où l'octet médian a été ramené à un caractère CP1252 (0x93 → “ œ ”,
// 0x94 → “ ” ”, 0x96 → “ – ”, 0x97 → “ — ”, 0x85 → “ … ”).
const LONE_SEQUENCES = [
  [/\u00E2\u0080\u0093/g, '–'],
  [/\u00E2\u0080\u0094/g, '—'],
  [/\u00E2\u0080\u00A6/g, '…'],
  [/\u00E2\u0080\u0099/g, '’'],
  [/\u00E2\u0080\u009C/g, '“'],
  [/\u00E2\u0080\u009D/g, '”'],
];

const EXTENSIONS = new Set(['.ts', '.tsx', '.css', '.prisma', '.md']);
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  'coverage',
  'playwright-report',
  'test-results',
  '.vite',
  'scripts',
]);

/** Renvoie le texte réparé s'il contenait du mojibake, sinon `null`. */
function reparer(text) {
  let repaired = text;
  for (const [from, to] of REPAIRS) {
    repaired = repaired.split(from).join(to);
  }
  for (const [pattern, to] of LONE_SEQUENCES) {
    repaired = repaired.replace(pattern, to);
  }
  return repaired === text ? null : repaired;
}

function walk(dir, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), files);
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      files.push(path.join(dir, entry.name));
    }
  }
}

const files = [];
walk(ROOT, files);

let changed = 0;
for (const file of files) {
  const raw = fs.readFileSync(file);
  // Un fichier sain est déjà de l'UTF-8 valide : on ne touche pas aux octets.
  let text = raw.toString('utf8');
  if (text.includes('\uFFFD')) continue;

  const fixed = reparer(text);
  if (!fixed) continue;

  const relative = path.relative(ROOT, file);
  if (CHECK_ONLY) {
    const count = [...text].length - [...fixed].length;
    console.log(`MOJIBAKE ${relative} (${count > 0 ? count : 'séquences'} correction(s))`);
    changed += 1;
    continue;
  }

  fs.writeFileSync(file, fixed, 'utf8');
  console.log(`corrigé ${relative}`);
  changed += 1;
}

console.log(
  changed
    ? `${changed} fichier(s) ${CHECK_ONLY ? 'à corriger' : 'corrigé(s)'}.`
    : 'Aucun mojibake détecté.',
);
