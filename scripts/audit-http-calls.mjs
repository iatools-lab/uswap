#!/usr/bin/env node
/**
 * Audit des chemins d'API utilisés par le frontend.
 *
 * Repère les chaînes qui ressemblent à une route d'API (`/users`, `/admin/...`,
 * `/attendance...`) dans tout `frontend_new/frontend/src`, y compris celles
 * construites avec des gabarits, pour vérifier qu'aucune ne pointe encore vers
 * une ancienne route.
 *
 * Usage : node scripts/audit-http-calls.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve('frontend_new/frontend/src');
const EXT = /\.(ts|tsx|js|jsx)$/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXT.test(entry)) out.push(full);
  }
  return out;
}

// Segment de départ plausible d'une route d'API (à maintenir).
const API_SEGMENTS = [
  'auth', 'users', 'stations', 'plannings', 'attendance', 'shifts',
  'leaves', 'operations', 'corrections', 'incidents', 'notifications',
  'reports', 'admin', 'super-admin', 'superadmin', 'pilot', 'supervision',
  'agent', 'integrations', 'dashboard', 'maintenance', 'health', 'audit',
];
const re = new RegExp(`["'\`]\\/(${API_SEGMENTS.join('|')})(\\/[^"'\`]*)?["'\`]`, 'g');

for (const file of walk(ROOT)) {
  const source = readFileSync(file, 'utf8');
  const lines = source.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const match of line.matchAll(re)) {
      console.log(`${relative(ROOT, file)}:${i + 1}: ${match[0]}`);
    }
  });
}
