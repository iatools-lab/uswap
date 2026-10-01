require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

(async () => {
  const prisma = new PrismaClient();

  const shift = await prisma.shift.findFirst({
    select: {
      id: true,
      startTime: true,
      endTime: true,
      planningId: true,
      stationId: true,
      swapperId: true,
      swapper: { select: { email: true, isActive: true, role: true } },
      attendances: { select: { id: true, status: true } },
      planning: { select: { id: true, status: true } },
    },
  });

  console.log('=== THE ONLY SHIFT ===');
  if (!shift) {
    console.log('  no shift');
  } else {
    console.log('  id:          ' + shift.id);
    console.log('  start:       ' + shift.startTime.toISOString());
    console.log('  end:         ' + shift.endTime.toISOString());
    console.log('  in the past: ' + (shift.endTime.getTime() < Date.now()));
    console.log('  planningId:  ' + shift.planningId);
    console.log(
      '  planning:    ' + (shift.planning ? shift.planning.status : 'null'),
    );
    console.log('  attendances: ' + shift.attendances.length);
    console.log(
      '  swapper:     ' +
        shift.swapper.email +
        ' active=' +
        shift.swapper.isActive,
    );
  }

  console.log('=== WHY /workspace RETURNS NOTHING ===');
  console.log('  filter requires: planning.status = PUBLISHED');
  console.log('                   endTime > now');
  console.log('  today is ' + new Date().toISOString());

  await prisma.$disconnect();
  process.exit(0);
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
