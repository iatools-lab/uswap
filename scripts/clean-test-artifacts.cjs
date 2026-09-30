require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

(async () => {
  const prisma = new PrismaClient();

  // Requests auto-opened by the cron during local runs. They point at shifts
  // from an earlier week; harmless, but cleared so the demo starts clean.
  const stale = await prisma.replacementRequest.deleteMany({
    where: { source: 'AUTOMATIC_ABSENCE' },
  });
  console.log('cleared AUTOMATIC_ABSENCE requests: ' + stale.count);

  const testUsers = await prisma.user.deleteMany({
    where: { email: { startsWith: 'demo.user.' } },
  });
  console.log('cleared test users: ' + testUsers.count);

  const testStations = await prisma.station.deleteMany({
    where: { name: { startsWith: 'Station Test ' } },
  });
  console.log('cleared test stations: ' + testStations.count);

  await prisma.$disconnect();
  process.exit(0);
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});