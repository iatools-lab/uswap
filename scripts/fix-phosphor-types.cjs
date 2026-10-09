/**
 * Régénère les fichiers de types manquants de `@phosphor-icons/react`.
 *
 * Le paquet installé expose `dist/csr/<Icon>.js` et `dist/csr/<Icon>.d.ts`
 * mais pas l'agrégateur `dist/index.d.ts` (et `dist/lib/types.d.ts`) que son
 * `package.json` déclare. TypeScript ne trouve donc aucun export.
 *
 * Ce script reconstruit l'agrégateur à partir des fichiers réellement présents.
 * Il est idempotent et ne s'exécute que si l'agrégateur manque.
 *
 * Usage : node scripts/fix-phosphor-types.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const candidates = [
  path.resolve(__dirname, '../frontend/node_modules/@phosphor-icons/react'),
  path.resolve(__dirname, '../../frontend/node_modules/@phosphor-icons/react'),
  path.resolve('frontend/node_modules/@phosphor-icons/react'),
];

const packageRoot = candidates.find((dir) => fs.existsSync(dir));
if (!packageRoot) {
  console.log('@phosphor-icons/react introuvable, rien à faire.');
  process.exit(0);
}

const dist = path.join(packageRoot, 'dist');
const csr = path.join(dist, 'csr');
const indexDts = path.join(dist, 'index.d.ts');

// L'agrégateur officiel est présent dans une installation saine : on l'utilise
// alors comme base et on se contente d'y ajouter nos alias de compatibilité.
// S'il manque (paquet tronqué), on le reconstruit entièrement.
const officialIndexExists = fs.existsSync(indexDts);

if (!fs.existsSync(csr)) {
  console.log('Aucun dossier dist/csr : paquet incomplet, abandon.');
  process.exit(1);
}

const iconNames = fs
  .readdirSync(csr)
  .filter((name) => name.endsWith('.d.ts') && name !== 'index.d.ts')
  .map((name) => name.replace(/\.d\.ts$/, ''))
  .filter((name) => /^[A-Z]/.test(name));

if (!iconNames.length) {
  console.log('Aucune icône trouvée dans dist/csr.');
  process.exit(1);
}

const header = `// Généré par scripts/fix-phosphor-types.cjs : l'agrégateur de types manquait\n// dans cette installation du paquet.\n`;
// L'application importe les icônes sous deux conventions : le nom Phosphor
// (« CheckCircle ») et la variante suffixée « Icon » (« CheckCircleIcon »).
// Cette version du paquet n'expose que la première : on ajoute un alias pour
// chaque icône afin que les deux conventions se résolvent.
const body = iconNames
  .map((name) => `export { ${name} } from './csr/${name}';\n`)
  .join('');

// Noms utilisés par l'application mais absents de cette version du paquet
// (renommés ou supprimés entre Phosphor 1 et 2). On les fait pointer vers
// l'icône la plus proche pour ne pas renommer le code de l'application.
const COMPAT = {
  Users: 'UsersThree',
  UserCircle: 'UserCirclePlus',
  UserRound: 'User',
  SidebarSimple: 'Sidebar',
  SlidersHorizontal: 'Sliders',
  ShieldWarning: 'ShieldWarning',
  WarningDiamond: 'WarningDiamond',
  XCircle: 'XCircle',
};

const aliases = iconNames
  .map((name) => `export { ${name} as ${name}Icon } from './csr/${name}';\n`)
  .join('');

const compatExports = Object.entries(COMPAT)
  .filter(([, source]) => iconNames.includes(source))
  .map(
    ([alias, source]) =>
      `export { ${source} as ${alias} } from './csr/${source}';\nexport { ${source} as ${alias}Icon } from './csr/${source}';\n`,
  )
  .join('');

if (officialIndexExists) {
  // Installation saine : on conserve l'agrégateur officiel et on ajoute
  // uniquement les alias manquants utilisés par l'application.
  const official = fs.readFileSync(indexDts, 'utf8');
  const marker = '// --- alias de compatibilité uSwap ---';
  const base = official.split(marker)[0];
  fs.writeFileSync(
    indexDts,
    `${base}\n${marker}\n${aliases}${compatExports}`,
    'utf8',
  );
  console.log(
    `Alias ajoutés à l'agrégateur officiel (${iconNames.length} icônes).`,
  );
} else {
  fs.writeFileSync(indexDts, header + body + aliases + compatExports, 'utf8');
  console.log(
    `Agrégateur reconstruit avec ${iconNames.length} icônes dans ${indexDts}.`,
  );
}

// `dist/csr/*.d.ts` importent les types partagés depuis `../lib/types`.
const libTypes = path.join(dist, 'lib/types.d.ts');
if (!fs.existsSync(libTypes)) {
  fs.mkdirSync(path.dirname(libTypes), { recursive: true });
  fs.writeFileSync(
    libTypes,
    `import type { ComponentType, SVGProps } from 'react';\n\nexport type IconWeight = 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';\nexport type IconProps = SVGProps<SVGSVGElement> & {\n  size?: number;\n  weight?: IconWeight;\n  color?: string;\n  mirrored?: boolean;\n};\nexport type Icon = ComponentType<IconProps>;\nexport declare const IconBase: Icon;\n`,
    'utf8',
  );
}

const libIconBase = path.join(dist, 'lib/IconBase.d.ts');
if (!fs.existsSync(libIconBase)) {
  fs.writeFileSync(
    libIconBase,
    `export { IconBase } from './types';\nexport type { Icon, IconProps, IconWeight } from './types';\n`,
    'utf8',
  );
}

console.log(
  `Agrégateur de types créé avec ${iconNames.length} icônes dans ${indexDts}.`,
);
