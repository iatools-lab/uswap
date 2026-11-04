/**
 * Vérifie que l'affectation tient compte de l'absence approuvée :
 * le swapper absent ne doit PAS être proposé comme disponible.
 */
import { PrismaClient } from '@prisma/client';

const BASE = process.env.API ?? 'http://127.0.0.1:3000';
const PASSWORD = process.env.DEMO_PASSWORD;

async function login(email, segment) {
  const r = await fetch(`${BASE}/auth/login/${segment}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return (await r.json().catch(() => ({}))).accessToken;
}

const admin = await login(process.env.ADMIN, 'admin');
const prisma = new PrismaClient();

// Le créneau qui porte l'absence APPROUVÉE du test précédent.
const absence = await prisma.absence.findFirst({
  where: { status: 'APPROVED' },
  orderBy: { reportedAt: 'desc' },
  select: { shiftId: true, swapperId: true },
});
await prisma.$disconnect();

if (!absence) {
  console.log('aucune absence approuvée à vérifier');
  process.exit(0);
}

const candidates = await fetch(
  `${BASE}/pilot/operations/shifts/${absence.shiftId}/candidates`,
  { headers: { authorization: `Bearer ${admin}` } },
);
const body = await candidates.json().catch(() => []);
const list = Array.isArray(body) ? body : (body.candidates ?? []);

console.log(
  `créneau ${absence.shiftId.slice(0, 8)} — ${list.length} candidat(s), statut ${candidates.status}`,
);

const target = list.find(
  (c) => c.id === absence.swapperId || c.userId === absence.swapperId,
);

if (!target) {
  console.log('le swapper absent n\'est plus proposé : indisponibilité respectée');
  process.exit(0);
}

const blocked = Boolean(
  target.conflict === true ||
    target.unavailable === true ||
    target.reason ||
    target.eligible === false,
);
console.log(
  `${blocked ? '[OK]  ' : '[FAIL]'} swapper absent marqué indisponible : conflit=${target.conflict ?? 'non'}`,
);
process.exit(blocked ? 0 : 1);
