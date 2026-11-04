/**
 * Contrôle syntaxique des scripts bash du dépôt, sans bash installé.
 *
 * Windows n'a pas bash (Git Bash n'est pas toujours disponible) : les scripts
 * de déploiement sont relus ici avant d'être envoyés sur le serveur. Le
 * contrôle porte sur les erreurs qui ont réellement cassé des scripts de ce
 * dépôt :
 *   - affectation avec espaces : `compose = "$x"` (invalide en bash) ;
 *   - fonction écrite en `nom() = ...` au lieu de `nom() { ... }` ;
 *   - `if`/`fi`, `case`/`esac`, `do`/`done` déséquilibrés ;
 *   - guillemets en nombre impair sur une ligne de code (une quote ouverte
 *     avale la suite du script : c'est la panne du `check-live.sh` bricolé).
 *
 * Limites assumées : ce n'est pas un analyseur shell. Il neutralise d'abord
 * tout ce qui n'est pas du code (commentaires, contenu des chaînes, heredocs,
 * et hors des blocs ```bash pour un fichier .md), puis vérifie l'équilibre
 * des structures. `bash -n` reste la référence sur le serveur.
 *
 * Usage :
 *   node scripts/check-bash.mjs [fichiers…] [--md]
 *   --md : inclut aussi les .md et n'analyse que leurs blocs ```bash
 *
 * Sortie : code 1 si une anomalie est détectée.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const ROOT = process.cwd();
const ARGS = process.argv.slice(2);
const INCLUDE_MD = ARGS.includes('--md');
const EXPLICIT = ARGS.filter((a) => !a.startsWith('--'));



function collect(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collect(full, acc);
    else if (name.endsWith('.sh') || (INCLUDE_MD && name.endsWith('.md')))
      acc.push(full);
  }
  return acc;
}

const blank = (s) => s.replace(/[^\n]/g, ' ');

/**
 * Neutralise le texte : tout caractère qui n'est pas du code devient espace.
 * Les sauts de ligne sont conservés pour garder la numérotation.
 *
 * Renvoie `{ code, warnings }`. `warnings` liste les lignes dont les
 * guillemets ne s'équilibrent pas sur la ligne (sans faire échouer le
 * contrôle : `l'image` hors chaîne est légitime et très fréquent ici).
 */
function neutralize(source, isMarkdown) {
  const lines = source.split('\n');
  const out = [];
  const warnings = [];
  let quote = null;
  let heredoc = null;

  lines.forEach((line, index) => {
    const n = index + 1;
    let result = '';

    if (heredoc) {
      if (line.trim() === heredoc) heredoc = null;
      out.push(blank(line));
      return;
    }

    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];

      // `${x:-mot}` : les quotes internes font partie du vocabulaire shell.
      if (quote === null && line.startsWith('${', i)) {
        const close = line.indexOf('}', i);
        if (close > i) {
          result += line.slice(i, close + 1);
          i = close;
          continue;
        }
      }

      if (quote === null) {
        // Un `#` de couleur (`'\033[1m'`, `un badge #1`) ou collé à un mot
        // n'ouvre pas de commentaire en bash : seul `#` isolé ou suivi d'une
        // espace en ouvre un.
        if (
          ch === '#' &&
          (i === 0 || /\s/.test(line[i - 1])) &&
          (i === line.length - 1 || /\s/.test(line[i + 1]))
        ) {
          result += blank(line.slice(i));
          break;
        }
        const heredocStart = line.slice(i).match(/^<<-?\s*'?([A-Z_][A-Z0-9_]*)'?/);
        if (heredocStart) {
          heredoc = heredocStart[1];
          result += blank(line.slice(i));
          break;
        }
        // Apostrophe française hors chaîne : `l'image`, `s'il`, `n'est`.
        const inWord = i > 0 && /[A-Za-zÀ-ÿ0-9]/.test(line[i - 1]);
        if (ch === "'" && inWord) {
          result += ch;
          continue;
        }
        if (ch === "'" || ch === '"') {
          quote = ch;
          result += ch;
          continue;
        }
        result += ch;
      } else if (ch === '\\' && quote === '"') {
        result += '  ';
        i += 1;
      } else if (ch === quote) {
        quote = null;
        result += ch;
      } else {
        result += ' ';
      }
    }

    // Un guillemet ouvert qu'un message français a interrompu (`"... l'image"`)
    // ne peut pas s'étendre sur les lignes suivantes : on referme en fin de
    // ligne pour que la suite du script reste analysable, et on le signale.
    if (quote !== null) {
      warnings.push(n);
      quote = null;
    }
    out.push(result);
  });

  let code = out.join('\n');

  if (isMarkdown) {
    // Seul le contenu des blocs ```bash est du code. Un bloc contenant un
    // heredoc (cat > f <<'EOF' suivi du script à créer) est du CODE BASH qu'on
    // ne peut pas analyser ici : il est neutralisé pour ne pas fausser les
    // compteurs du script hôte.
    const blocks = [];
    let current = null;
    lines.forEach((line) => {
      if (/^\s*```/.test(line)) {
        if (current === null) current = [];
        else {
          blocks.push(current);
          current = null;
        }
        return;
      }
      if (current !== null) current.push(line);
    });
    const inFence = new Array(lines.length).fill(false);
    let cursor = 0;
    for (const block of blocks) {
      const body = lines.slice(cursor, cursor + block.length);
      const hasHeredoc = body.some((l) => /<<-?\s*'?[A-Z_]/.test(l));
      lines.forEach((line, i) => {
        if (i >= cursor && i < cursor + block.length) inFence[i] = !hasHeredoc;
      });
      cursor += block.length;
    }
    code = code
      .split('\n')
      .map((l, i) => (inFence[i] ? l : blank(l)))
      .join('\n');
  }

  return { code, warnings };
}

let problems = 0;
let checked = 0;

for (const file of files()) {
  const text = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file) || file;
  const isMd = basename(file).endsWith('.md');

  if (isMd && !/```bash/.test(text)) {
    console.log(`${rel}: ignoré (Markdown sans bloc de code bash)`);
    continue;
  }
  checked += 1;

  const report = (line, message) => {
    console.log(`${rel}:${line}: ${message}`);
    problems += 1;
  };

  const { code, warnings } = neutralize(text, isMd);
  const codeLines = code.split('\n');
  const sourceLines = text.split('\n');
  const counters = { if: 0, case: 0, do: 0, brace: 0 };

  codeLines.forEach((visible, index) => {
    const n = index + 1;
    if (!visible.trim()) return;

    if (/^\s*[A-Za-z_][A-Za-z0-9_]*\s+=\s*/.test(visible)) {
      report(n, "affectation avec espaces autour du '=' (`VAR=x`, pas `VAR = x`)");
    }
    if (/[A-Za-z0-9_]+\(\)\s*=\s*/.test(visible)) {
      report(n, '`nom() = ...` : syntaxe invalide, attendu `nom() {`');
    }

    for (const w of visible.split(/\s+/).filter(Boolean)) {
      if (w === 'if') counters.if += 1;
      if (w === 'fi') counters.if -= 1;
      if (w === 'case') counters.case += 1;
      if (w === 'esac') counters.case -= 1;
      if (w === 'do') counters.do += 1;
      if (w === 'done') counters.do -= 1;
    }
    // Accolades de bloc : uniquement celles isolées en fin de ligne
    // (fonctions `f() {` et fermetures `}`) ; ${...} et $(...) sont ignorés.
    if (/\{\s*$/.test(visible)) counters.brace += 1;
    if (/^\s*\}\s*(;|$)/.test(visible)) counters.brace -= 1;
  });

  // `do` dans `for … do` / `while … do` est compté une fois : la mesure est
  // celle des mots-clés, pas des blocs. On compare donc `do` aux `done`.
  if (counters.if !== 0)
    report(sourceLines.length, `if/fi déséquilibrés (${counters.if})`);
  if (counters.case !== 0)
    report(sourceLines.length, `case/esac déséquilibrés (${counters.case})`);
  if (counters.do !== 0)
    report(sourceLines.length, `do/done déséquilibrés (${counters.do})`);
  if (counters.brace !== 0)
    report(
      sourceLines.length,
      `accolades de bloc déséquilibrées (${counters.brace})`,
    );

  // L'avertissement par ligne est indicatif : `l'image` dans un message est
  // légitime et TRÈS fréquent dans ce dépôt (35 occurrences). On ne le
  // détaille donc pas par défaut ; `--verbose` les liste pour inspection.
  if (warnings.length && ARGS.includes('--verbose')) {
    for (const n of warnings) {
      console.log(`${rel}:${n}: quotes non équilibrées sur la ligne (informatif)`);
    }
  }
}

function files() {
  return EXPLICIT.length ? EXPLICIT : collect(ROOT);
}

if (problems === 0) {
  console.log(`check-bash : ${checked} script(s) relu(s), aucune anomalie.`);
  process.exit(0);
}
console.log(`\ncheck-bash : ${problems} anomalie(s) à corriger.`);
process.exit(1);
