require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

(async () => {
  const prisma = new PrismaClient();

  console.log('=== REPLACEMENT REQUESTS ===');
  const reqs = await prisma.replacementRequest.findMany({
    select: {
      id: true,
      status: true,
      source: true,
      shiftId: true,
      assignedSwapperId: true,
      assignedAt: true,
      assignedById: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 8,
  });

  reqs.forEach((r) =>
    console.log(
      '  ' +
        String(r.status).padEnd(10) +
        String(r.source).padEnd(20) +
        'assigned=' +
        String(Boolean(r.assignedSwapperId)).padEnd(6) +
        'by=' +
        String(Boolean(r.assignedById)).padEnd(6) +
        'created=' +
        r.createdAt.toISOString().slice(0, 19),
    ),
  );

  console.log('\n=== SHIFT CHANGES (REPLACEMENT) ===');
  const changes = await prisma.shiftChange.findMany({
    where: { type: 'REPLACEMENT' },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      createdAt: true,
      reason: true,
      shiftId: true,
      previousSwapperId: true,
      newSwapperId: true,
      changedById: true,
    },
  });

  changes.forEach((c) =>
    console.log(
      '  ' +
        c.createdAt.toISOString().slice(0, 19) +
        '  reason="' +
        c.reason +
        '"  full=' +
        Boolean(c.previousSwapperId && c.newSwapperId && c.changedById),
    ),
  );

  console.log('\n=== THE AUDIT SHIFT IT ASSIGNED ON ===');
  // The audit cleans its own shifts, so this looks at the surviving evidence:
  // a REPLACEMENT change whose shift still exists.
  for (const change of changes) {
    const shift = await prisma.shift.findUnique({
      where: { id: change.shiftId },
      select: {
        id: true,
        swapperId: true,
        replacementRequests: {
          select: { id: true, status: true, source: true },
        },
      },
    });
    if (shift) {
      console.log('  shift ' + shift.id);
      console.log(
        '    requests on it: ' + JSON.stringify(shift.replacementRequests),
      );
    }
  }

  await prisma.$disconnect();
  process.exit(0);
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
