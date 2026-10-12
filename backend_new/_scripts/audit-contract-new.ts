/**
 * Audit de contrat : appels du frontend_new vs routes réellement exposées par
 * backend_new (document Swagger généré au démarrage).
 *
 * Usage :
 *   cd backend_new
 *   npx tsx ../scripts/audit-contract-new.ts
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { AppModule } from '../src/app.module';

interface Call {
  method: string;
  path: string;
  source: string;
}

const FRONTEND_ROOT = join(process.cwd(), '..', 'frontend_new', 'frontend', 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (['.ts', '.tsx'].includes(extname(full))) out.push(full);
  }
  return out;
}

/**
 * Découpe les arguments de premier niveau d'un appel `api(...)` en respectant
 * les parenthèses, crochets, accolades et chaînes (y compris les template
 * literals).
 */
function splitArgs(argText: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let current = '';
  let quote: string | null = null;
  for (let i = 0; i < argText.length; i += 1) {
    const ch = argText[i];
    if (quote) {
      current += ch;
      if (ch === quote && argText[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    if (ch === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

/**
 * Extrait les appels `api(...)` du frontend.
 *
 * Signature réelle : `api<T>(path, body?, method?, allowRefresh?)`.
 * La méthode HTTP est donc le 3e argument lorsqu'il est présent ; sinon c'est
 * POST si un corps est fourni, GET sinon.
 */
function extractCalls(): Call[] {
  const calls: Call[] = [];

  for (const file of walk(FRONTEND_ROOT)) {
    const text = readFileSync(file, 'utf8');
    const opener = /\bapi\s*(?:<[\s\S]*?>)?\s*\(/g;
    let match: RegExpExecArray | null;

    while ((match = opener.exec(text))) {
      let depth = 1;
      let i = opener.lastIndex;
      let quote: string | null = null;
      for (; i < text.length && depth > 0; i += 1) {
        const ch = text[i];
        if (quote) {
          if (ch === quote && text[i - 1] !== '\\') quote = null;
          continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') quote = ch;
        else if (ch === '(') depth += 1;
        else if (ch === ')') depth -= 1;
      }

      const args = splitArgs(text.slice(opener.lastIndex, i - 1));
      if (!args.length) continue;

      const pathLiteral = args[0].match(/^(["'`])([^"'`]+)\1$/);
      if (!pathLiteral) continue;

      let path = pathLiteral[2].replace(/\$\{[^}]+\}/g, '{x}');
      path = path.split('?')[0];
      if (!path.startsWith('/')) continue;

      let method: string;
      if (args.length >= 3 && /^["'`](GET|POST|PUT|PATCH|DELETE)["'`]$/.test(args[2])) {
        method = args[2].replace(/["'`]/g, '').toUpperCase();
      } else {
        method = args.length >= 2 ? 'POST' : 'GET';
      }

      calls.push({ method, path, source: file.replace(FRONTEND_ROOT, '') });
    }
  }
  return calls;
}

/** Normalise une route backend en forme comparable (`:param` / `{param}` -> `{x}`). */
function normalizeRoute(path: string): string {
  return path.replace(/:[^/]+/g, '{x}').replace(/\{[^}]+\}/g, '{x}');
}

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  const doc = SwaggerModule.createDocument(app, new DocumentBuilder().build());

  const backend = new Map<string, Set<string>>();
  for (const [rawPath, methods] of Object.entries(doc.paths ?? {})) {
    const path = normalizeRoute(rawPath);
    const verbs = new Set<string>();
    for (const verb of Object.keys(methods as object)) {
      verbs.add(verb.toUpperCase());
    }
    backend.set(path, verbs);
  }

  const calls = extractCalls();
  const missing: Call[] = [];
  const seen = new Set<string>();

  console.log('=== CONTRAT : frontend_new  ->  backend_new ===\n');

  for (const call of calls) {
    const key = `${call.method} ${call.path}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const verbs = backend.get(call.path);
    const ok = verbs?.has(call.method);
    const detail = verbs ? [...verbs].join(',') : 'ROUTE INCONNUE';
    const line = `  ${ok ? 'OK      ' : 'MANQUANT'} ${call.method.padEnd(6)} ${call.path.padEnd(52)} ${ok ? '' : '(' + detail + ')'}`;
    console.log(line);
    if (!ok) missing.push(call);
  }

  console.log('');
  console.log('routes backend totales : ' + backend.size);
  console.log('appels frontend uniques : ' + seen.size);
  console.log('manquants               : ' + missing.length);

  if (missing.length) {
    console.log('\n=== DÉTAIL DES MANQUANTS ===');
    for (const m of missing) {
      console.log(`  ${m.method} ${m.path}  (${m.source})`);
    }
  }

  // Routes backend non consommées : utile pour repérer le code mort.
  console.log('\n=== ROUTES BACKEND NON APPELÉES (indicatif) ===');
  const usedPaths = new Set(calls.map((c) => `${c.method} ${c.path}`));
  for (const [path, verbs] of backend) {
    for (const verb of verbs) {
      if (!usedPaths.has(`${verb} ${path}`)) {
        console.log(`  ${verb.padEnd(6)} ${path}`);
      }
    }
  }

  await app.close();
  process.exit(missing.length ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
