/**
 * Recense les fichiers du frontend contenant du texte doublement encodé.
 * Lecture seule : ne modifie rien. Code 1 si des occurrences subsistent.
 *
 *   node backend_new/scripts/scan-mojibake.mjs
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Racines résolues depuis l'emplacement du script : il est lançable depuis
// n'importe quel dossier.
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ROOTS = [
  join(REPO, 'frontend_new/frontend/src'),
  join(REPO, 'frontend_new/frontend/public'),
].filter((p) => existsSync(p));

const EXT = /\.(tsx?|jsx?|css|html|webmanifest|json)$/;
/** Tête d'un caractère UTF-8 relu en Latin-1, suivie d'une continuation. */
const BAD =
  /[\u00c3\u00c2\u00e2\u00c5][\u0080-\u00bf\u2018-\u203a\u0152\u0153\u0178]/;

const files = [];
const walk = (p) => {
  const st = statSync(p);
  if (st.isFile()) {
    if (EXT.test(p)) files.push(p);
    return;
  }
  for (const e of readdirSync(p)) walk(join(p, e));
};
for (const r of ROOTS) walk(r);

let total = 0;
const hits = [];

for (const f of files) {
  const text = readFileSync(f, 'utf8');
  const samples = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (BAD.test(line) && samples.length < 3) {
      samples.push(`${i + 1}: ${line.trim().slice(0, 90)}`);
    }
  });
  if (!samples.length) continue;
  const count = text.split('\n').filter((l) => BAD.test(l)).length;
  total += count;
  hits.push({ file: f.replace(REPO, '.'), count, samples });
}

hits.sort((a, b) => b.count - a.count);
for (const h of hits) {
  console.log(`\n${h.file}  (${h.count} ligne(s))`);
  for (const s of h.samples) console.log(`   ${s}`);
}
console.log(`\nfichiers: ${hits.length}, lignes: ${total}`);

process.exit(total === 0 ? 0 : 1);
