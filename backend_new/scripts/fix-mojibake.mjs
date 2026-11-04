/**
 * Répare un texte doublement encodé (« Ã© » au lieu de « é »).
 *
 * Cause : le fichier a été réécrit un jour en relisant de l'UTF-8 comme du
 * Latin-1, puis sauvegardé en UTF-8. Chaque accent est devenu deux caractères
 * (Ã + U+00A9). La réparation est l'opération inverse : relire la suite
 * d'octets comme du Latin-1 pour retrouver l'UTF-8 d'origine.
 *
 *   node scripts/fix-mojibake.mjs <fichier...>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node fix-mojibake.mjs <fichier...>');
  process.exit(2);
}

/** Une séquence est « doublement encodée » si elle contient Ã/Â suivis d'un C1. */
const DOUBLED = /(?:[ÃÂ])[\u0080-\u00BF]/;
const WIDE = /[â€Å]/;

/**
 * Un « groupe » commence par Ã / Â / â (tête d'un caractère UTF-8 relu en
 * Latin-1) suivi des caractères de continuation correspondants.
 */
const GROUP = /(?:Ã|Â|â|Å)[\u0080-\u00BF\u2018-\u203A\u0152\u0153\u0178]{0,3}/g;

/** Relit un groupe comme des octets Latin-1 et l'interprète en UTF-8. */
const repairGroup = (group) => {
  const text = Buffer.from(group, 'latin1').toString('utf8');
  // `toString('utf8')` remplace par U+FFFD ce qui n'est pas de l'UTF-8 valide.
  return text.includes('\uFFFD') ? group : text;
};

for (const file of files) {
  const original = readFileSync(file, 'utf8');
  if (!DOUBLED.test(original) && !WIDE.test(original)) {
    console.log(`${file}: rien à corriger`);
    continue;
  }

  let repaired = original;
  let fixed = 0;
  /*
   * Remplacement GROUPE PAR GROUPE : un fichier peut contenir des accents
   * corrects à côté de séquences cassées, et une conversion globale
   * détruirait les premiers. On répète, une chaîne pouvant être encodée
   * plusieurs fois.
   */
  for (let pass = 0; pass < 3; pass++) {
    if (!DOUBLED.test(repaired) && !WIDE.test(repaired)) break;
    repaired = repaired.replace(GROUP, (group) => {
      const out = repairGroup(group);
      if (out !== group) fixed++;
      return out;
    });
  }

  // Garde-fou : ne jamais écrire un fichier cassé.
  if (repaired.includes('\uFFFD') || DOUBLED.test(repaired)) {
    console.log(`${file}: réparation incomplète, fichier laissé intact`);
    continue;
  }

  const before = fixed;
  writeFileSync(file, repaired, 'utf8');
  console.log(`${file}: ${before} groupe(s) repare(s)`);
}
