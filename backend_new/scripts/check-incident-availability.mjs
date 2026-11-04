/**
 * Effet d'un INCIDENT ouvert sur la disponibilité d'affectation.
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

const plannings = await fetch(`${BASE}/pilot/plannings`, {
  headers: { authorization: `Bearer ${accessToken}` },
}).then((r) => r.json());
const list = Array.isArray(plannings) ? plannings : (plannings.items ?? []);
const withOcc = list.find((p) => (p.occurrences ?? []).length);
const occ = withOcc?.occurrences?.[0];

const swapper = await prisma.user.findFirst({
  where: { email: process.env.SWAPPER_EMAIL },
  select: { id: true },
});

// Nettoyage puis incident ouvert visant le swapper.
await prisma.incident.deleteMany({
  where: { title: { contains: 'Incident QA dispo' } },
});
const station = await prisma.station.findFirst({ select: { id: true } });

const incident = await prisma.incident.create({
  data: {
    title: 'Incident QA dispo',
    description: 'Test de disponibilité',
    category: 'OTHER',
    severity: 'MEDIUM',
    status: 'REPORTED',
    affectedSwapperId: swapper.id,
    stationId: occ.stationId ?? station.id,
    reporterId: swapper.id,
    occurredAt: new Date(),
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
    ? `swapper -> eligible=${cand.eligible} | motifs: ${cand.issues.map((i) => i.code).join(', ') || 'aucun'}`
    : 'swapper absent de la liste',
);

await prisma.incident.delete({ where: { id: incident.id } });
await prisma.$disconnect();
