/**
 * Effet d'un CONGÉ en attente sur la disponibilité d'affectation.
 * On crée un congé couvrant un créneau à venir, puis on relève les motifs
 * renvoyés par la liste des candidats.
 */
import { PrismaClient } from '@prisma/client';

const BASE = 'http://127.0.0.1:3000';
const prisma = new PrismaClient();

const login = await fetch(`${BASE}/auth/login/admin`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: process.env.ADMIN,
    password: process.env.DEMO_PASSWORD,
  }),
});
const { accessToken } = await login.json();

// Créneau du planning le plus récent.
const plannings = await fetch(`${BASE}/pilot/plannings`, {
  headers: { authorization: `Bearer ${accessToken}` },
}).then((r) => r.json());
const list = Array.isArray(plannings) ? plannings : (plannings.items ?? []);
const withOcc = list.find((p) => (p.occurrences ?? []).length);
const occ = withOcc?.occurrences?.[0];

if (!occ) {
  console.log('aucun créneau disponible');
  process.exit(0);
}

const swapper = await prisma.user.findFirst({
  where: { email: process.env.SWAPPER_EMAIL },
  select: { id: true },
});

// Congé EN ATTENTE couvrant la période du créneau.
const start = new Date(occ.startTime);
const end = new Date(occ.endTime);
await prisma.leave.deleteMany({
  where: { reason: { contains: 'Congé QA dispo' } },
});
await prisma.leave.create({
  data: {
    swapperId: swapper.id,
    startTime: start,
    endTime: end,
    type: 'ANNUAL',
    reason: 'Congé QA dispo',
    status: 'PENDING',
    clientRef: `qa-leave-${Date.now()}`,
  },
});

const res = await fetch(
  `${BASE}/pilot/operations/shifts/${occ.id}/candidates`,
  { headers: { authorization: `Bearer ${accessToken}` } },
);
const body = await res.json();
const cand = (body.candidates ?? []).find((c) => c.id === swapper.id);

console.log(
  cand
    ? `swapper -> eligible=${cand.eligible} | ${cand.issues.map((i) => i.code).join(', ') || 'aucun motif'}`
    : 'swapper absent de la liste',
);

// Nettoyage du congé de test.
await prisma.leave.deleteMany({
  where: { reason: { contains: 'Congé QA dispo' } },
});
await prisma.$disconnect();
