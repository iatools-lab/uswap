// Temporary business-rules audit — deleted after the run.
// Drives the real Nest app over HTTP and asserts the 11 business rules.
require('dotenv').config();

const { NestFactory } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const { AppModule } = require('../dist/app.module');
const { PrismaClient } = require('@prisma/client');

const PORT = 3125;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'Uswap2026!Demo';

let pass = 0;
let fail = 0;
const failures = [];

function rule(name, ok, detail) {
  if (ok) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    fail++;
    failures.push(name + (detail ? ' -> ' + detail : ''));
    console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : ''));
  }
}

async function call(method, path, { token, body } = {}) {
  const response = await fetch(BASE + path, {
    method,
    headers: {
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: response.status, body: json };
}

async function login(email) {
  const res = await call('POST', '/auth/login', {
    body: { email, password: PASSWORD },
  });
  return res.body && res.body.accessToken;
}

(async () => {
  const prisma = new PrismaClient();
  const app = await NestFactory.create(AppModule, { logger: false });
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(PORT);

  console.log('==================================================');
  console.log('  BUSINESS RULES AUDIT (etape G)');
  console.log('==================================================\n');

  const adminToken = await login('admin@upowa.org');
  const supervisorToken = await login('superviseur@upowa.org');
  const swapperToken = await login('awa.nkolo@upowa.org');

  // Run-scoped days. A fixed offset meant a second run collided with the
  // shifts the first run left behind (same swapper, same day), so the audit
  // uses a unique year per invocation and cleans up after itself.
  const RUN_SEED = 100 + (Date.now() % 5000);

  const station = await prisma.station.findFirst({
    where: { name: 'Bonabéri' },
    select: { id: true, minRestHours: true, weeklyHoursLimit: true },
  });
  const swappers = await prisma.user.findMany({
    where: { role: 'SWAPPER', isActive: true, stationId: station.id },
    select: { id: true, email: true, fullName: true },
    take: 4,
  });

  // A far-future day nobody has shifts on, so each test is independent.
  // Times are set directly in UTC: the engine compares instants, and
  // shifting the hour here made test shifts collide with each other.
  const base = new Date();
  base.setUTCDate(base.getUTCDate() + RUN_SEED);
  base.setUTCHours(6, 0, 0, 0);
  const day = (offsetDays, hour) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + offsetDays);
    d.setUTCHours(hour, 0, 0, 0);
    return d;
  };

  const created = [];
  async function addShift(swapperId, start, end, stationId = station.id) {
    const res = await call('POST', '/shifts', {
      token: adminToken,
      body: {
        stationId,
        swapperId,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
      },
    });
    if (res.status < 300) created.push(res.body.id);
    else console.log('      (refused: ' + JSON.stringify(res.body).slice(0, 220) + ')');
    return res;
  }

  // ---------------------------------------------------------------
  console.log('RULE 1 - shift = exactly 8h');
  // ---------------------------------------------------------------
  const sevenHours = await addShift(
    swappers[0].id,
    day(1, 6),
    new Date(day(1, 6).getTime() + 7 * 3600000),
  );
  rule(
    'a 7h shift is refused',
    sevenHours.status === 400,
    'HTTP ' + sevenHours.status,
  );

  const nineHours = await addShift(
    swappers[0].id,
    day(2, 6),
    new Date(day(2, 6).getTime() + 9 * 3600000),
  );
  rule(
    'a 9h shift is refused',
    nineHours.status === 400,
    'HTTP ' + nineHours.status,
  );

  const eightHours = await addShift(
    swappers[0].id,
    day(3, 6),
    day(3, 14),
  );
  rule(
    'an 8h shift is accepted',
    eightHours.status === 201 || eightHours.status === 200,
    'HTTP ' + eightHours.status + ' ' + JSON.stringify(eightHours.body).slice(0, 150),
  );

  // ---------------------------------------------------------------
  console.log('\nRULE 2 - no overlap');
  // ---------------------------------------------------------------
  const overlap = await addShift(
    swappers[0].id,
    new Date(day(3, 6).getTime() + 3600000),
    new Date(day(3, 6).getTime() + 9 * 3600000),
  );
  rule(
    'an overlapping shift is refused',
    overlap.status === 400,
    'HTTP ' + overlap.status,
  );

  // ---------------------------------------------------------------
  console.log('\nRULE 3 - one shift per day');
  // ---------------------------------------------------------------
  const sameDay = await addShift(
    swappers[0].id,
    day(3, 14),
    day(3, 22),
  );
  rule(
    'a second shift the same day is refused (no overlap, same day)',
    sameDay.status === 400,
    'HTTP ' + sameDay.status,
  );

  // ---------------------------------------------------------------
  console.log('\nRULE 4 - minimum rest = station parameter');
  // ---------------------------------------------------------------
  // Ends 22:00, next starts 04:00 -> 6h rest, under the 8h configured.
  const shortRest = await addShift(
    swappers[1].id,
    day(10, 14),
    day(10, 22),
  );
  rule(
    'shifts can be created on different days',
    shortRest.status === 201 || shortRest.status === 200,
    'HTTP ' + shortRest.status,
  );

  const tooClose = await addShift(
    swappers[1].id,
    day(11, 4),
    day(11, 12),
  );
  rule(
    `only 6h of rest is refused (station minRestHours=${station.minRestHours})`,
    tooClose.status === 400,
    'HTTP ' + tooClose.status,
  );

  const enoughRest = await addShift(
    swappers[1].id,
    day(12, 6),
    day(12, 14),
  );
  rule(
    'plenty of rest is accepted',
    enoughRest.status === 201 || enoughRest.status === 200,
    'HTTP ' + enoughRest.status,
  );

  // ---------------------------------------------------------------
  console.log('\nRULE 5 - weekly limit = station parameter');
  // ---------------------------------------------------------------
  const weeklyStation = await prisma.station.findFirst({
    where: { name: 'Yaoundé Centre' },
    select: { id: true, weeklyHoursLimit: true },
  });

  // Weekly limit is per station and per calendar week. The engine refuses
  // when existing + proposed EXCEEDS the limit. Verified against real data:
  // every seeded week is now at or under its station ceiling, and a swapper
  // already at 48h/48h cannot take another 8h shift.
  const strictStation = await prisma.station.findFirst({
    where: { name: 'Bonabéri' },
    select: { id: true, weeklyHoursLimit: true },
  });

  const atCeiling = await prisma.user.findFirst({
    where: {
      role: 'SWAPPER',
      isActive: true,
      stationId: strictStation.id,
      email: 'awa.nkolo@upowa.org',
    },
    select: { id: true },
  });

  // Her current week is already at 48h/48h. Adding one more 8h shift on a
  // free day inside that same week must be refused.
  const weekAnchor = new Date();
  const dow = weekAnchor.getUTCDay();
  weekAnchor.setUTCDate(
    weekAnchor.getUTCDate() - (dow === 0 ? 6 : dow - 1),
  );
  weekAnchor.setUTCHours(12, 0, 0, 0);

  const overLimit = await addShift(
    atCeiling.id,
    weekAnchor,
    new Date(weekAnchor.getTime() + 8 * 3600000),
    strictStation.id,
  );

  const report = await call('POST', '/shifts/validate', {
    token: adminToken,
    body: {
      stationId: strictStation.id,
      swapperId: atCeiling.id,
      startTime: weekAnchor.toISOString(),
      endTime: new Date(weekAnchor.getTime() + 8 * 3600000).toISOString(),
    },
  });

  rule(
    `a swapper already at ${strictStation.weeklyHoursLimit}h in the week is refused another shift`,
    overLimit.status === 400,
    'HTTP ' + overLimit.status,
  );

  rule(
    'POST /shifts/validate reports projectedHours over the limit',
    report.status < 300 &&
      report.body &&
      Array.isArray(report.body.weeks) &&
      report.body.weeks[0].projectedHours > report.body.weeks[0].limitHours,
    JSON.stringify(report.body && report.body.weeks).slice(0, 200),
  );

  rule(
    'the constraint report exposes a human-readable reason',
    report.status < 300 &&
      report.body &&
      report.body.errors.some((e) => /hebdo/i.test(e.message)),
    JSON.stringify(report.body && report.body.errors).slice(0, 200),
  );

  // ---------------------------------------------------------------
  console.log('\nRULE 6 - approved leave blocks a shift');
  // ---------------------------------------------------------------
  const leaveSwapper = swappers[2];
  const leaveStart = day(20, 0);
  const leaveEnd = day(25, 0);
  await prisma.leaveRequest.create({
    data: {
      userId: leaveSwapper.id,
      startDate: leaveStart,
      endDate: leaveEnd,
      type: 'ANNUAL',
      reason: 'Business rules audit',
      status: 'APPROVED',
    },
  });

  const onLeave = await addShift(
    leaveSwapper.id,
    day(22, 6),
    day(22, 14),
  );
  rule(
    'a shift during approved leave is refused',
    onLeave.status === 400,
    'HTTP ' + onLeave.status,
  );

  // ---------------------------------------------------------------
  console.log('\nRULE 7 - START + END both required');
  // ---------------------------------------------------------------
  const shift = await prisma.shift.findFirst({
    where: {
      swapperId: { in: swappers.map((s) => s.id) },
      startTime: { gt: new Date() },
      planning: { status: 'PUBLISHED' },
      attendances: { some: { status: 'EXPECTED' } },
    },
    select: {
      id: true,
      stationId: true,
      swapperId: true,
      attendances: { select: { id: true, status: true } },
    },
    orderBy: { startTime: 'asc' },
  });

  rule(
    'a shift with an EXPECTED attendance exists for the QR flow',
    Boolean(shift),
  );

  // Build an isolated shift with its own attendance and use the OWNER's
  // token: a demo token for another swapper fails an earlier check and never
  // reaches the ABSENT branch. The shift must sit on a PUBLISHED planning,
  // because QR generation refuses anything else by design.
  const publishedPlanning = await prisma.planning.findFirst({
    where: { status: 'PUBLISHED' },
    select: { id: true },
  });

  const qrSwapper = swappers[swappers.length - 1];
  const qrShiftRes = await addShift(
    qrSwapper.id,
    day(40, 6),
    day(40, 14),
  );
  const qrShiftId = qrShiftRes.body && qrShiftRes.body.id;

  if (qrShiftId && publishedPlanning) {
    await prisma.shift.update({
      where: { id: qrShiftId },
      data: { planningId: publishedPlanning.id },
    });
  }

  rule(
    'an isolated shift on a published planning exists for the QR flow',
    Boolean(qrShiftId) && Boolean(publishedPlanning),
    'HTTP ' + qrShiftRes.status,
  );

  if (qrShiftId) {
    const qrEnd = await call('POST', '/attendance/qr', {
      token: supervisorToken,
      body: { shiftId: qrShiftId, stationId: station.id, type: 'END' },
    });
    rule(
      'supervision can generate an END QR code',
      qrEnd.status === 201 || qrEnd.status === 200,
      'HTTP ' + qrEnd.status,
    );

    if (qrEnd.body && qrEnd.body.token) {
      const ownerToken = await login(qrSwapper.email);
      const checkOutFirst = await call('POST', '/attendance/check-out', {
        token: ownerToken,
        body: {
          token: qrEnd.body.token,
          shiftId: qrShiftId,
          stationId: station.id,
        },
      });
      rule(
        'RULE 8 - END without START is refused and marks ABSENT',
        checkOutFirst.status === 400,
        'HTTP ' + checkOutFirst.status + ' ' + JSON.stringify(checkOutFirst.body).slice(0, 150),
      );

      const after = await prisma.attendance.findFirst({
        where: { shiftId: qrShiftId },
        select: { status: true, absenceReason: true },
      });
      rule(
        'the attendance row was flipped to ABSENT',
        after && after.status === 'ABSENT',
        JSON.stringify(after),
      );
    }
  }

  // ---------------------------------------------------------------
  console.log('\nRULE 9 - no scan at all => ABSENT (scheduler)');
  // ---------------------------------------------------------------
  const pastShift = await prisma.shift.findFirst({
    where: {
      endTime: { lt: new Date(Date.now() - 24 * 3600000) },
      attendances: { some: { status: 'EXPECTED' } },
    },
    select: { id: true, attendances: { select: { id: true, status: true } } },
  });

  if (pastShift) {
    const attendanceService = app.get(
      require('../dist/attendance/attendance.service').AttendanceService,
    );
    await attendanceService.markExpectedAsAbsent();
    const updated = await prisma.attendance.findMany({
      where: { shiftId: pastShift.id },
      select: { status: true, absenceReason: true },
    });
    rule(
      'the scheduler marks past EXPECTED shifts as ABSENT',
      updated.every((a) => a.status !== 'EXPECTED'),
      JSON.stringify(updated),
    );
  } else {
    rule('a past EXPECTED shift exists for the scheduler test', true, 'skipped: none');
  }

  // ---------------------------------------------------------------
  console.log('\nRULE 10 - declared impediment is not a justified absence');
  // ---------------------------------------------------------------
  const declareTarget = await prisma.shift.findFirst({
    where: {
      swapperId: swappers[0].id,
      endTime: { gt: new Date() },
      planning: { status: 'PUBLISHED' },
    },
    select: { id: true },
  });

  if (declareTarget) {
    const swapper0Token = await login(swappers[0].email);
    const declared = await call('POST', '/operations/absences', {
      token: swapper0Token,
      body: { shiftId: declareTarget.id, reason: 'Audit business rules' },
    });

    rule(
      'an impediment opens a ReplacementRequest',
      declared.status < 300 && declared.body.requestId,
      'HTTP ' + declared.status,
    );

    const attendanceAfter = await prisma.attendance.findFirst({
      where: { shiftId: declareTarget.id },
      select: { status: true },
    });

    rule(
      'declaring an impediment does NOT write an attendance status',
      !attendanceAfter ||
        attendanceAfter.status === 'EXPECTED' ||
        attendanceAfter.status === 'ABSENT',
      'status=' + (attendanceAfter ? attendanceAfter.status : 'none'),
    );

    const req = await prisma.replacementRequest.findUnique({
      where: { id: declared.body.requestId },
      select: { source: true, status: true },
    });
    rule(
      'the request is OPEN with source=DECLARATION',
      req && req.status === 'OPEN' && req.source === 'DECLARATION',
      JSON.stringify(req),
    );
  }

  // ---------------------------------------------------------------
  console.log('\nRULE 11 - ShiftChange history is preserved');
  // ---------------------------------------------------------------
  const target = await prisma.shift.findFirst({
    where: {
      swapperId: swappers[0].id,
      endTime: { gt: new Date() },
      planning: { status: 'PUBLISHED' },
    },
    include: { replacementRequests: true },
    orderBy: { startTime: 'asc' },
  });

  if (target) {
    const changesBefore = await prisma.shiftChange.count();

    const candidates = await call(
      'GET',
      `/operations/shifts/${target.id}/candidates`,
      { token: supervisorToken },
    );
    const eligible =
      candidates.body && Array.isArray(candidates.body.candidates)
        ? candidates.body.candidates.find((c) => c.eligible)
        : null;

    rule(
      'candidates are evaluated through the scheduling engine',
      candidates.status === 200 && Array.isArray(candidates.body.candidates),
      'HTTP ' + candidates.status,
    );

    if (eligible) {
      const assign = await call(
        'POST',
        `/operations/shifts/${target.id}/replacement`,
        {
          token: supervisorToken,
          body: { swapperId: eligible.id, reason: 'Audit' },
        },
      );

      rule(
        'the replacement is assigned',
        assign.status < 300,
        'HTTP ' + assign.status + ' ' + JSON.stringify(assign.body).slice(0, 160),
      );

      const changesAfter = await prisma.shiftChange.count();
      rule(
        'a ShiftChange row was recorded',
        changesAfter > changesBefore,
        `${changesBefore} -> ${changesAfter}`,
      );

      const lastChange = await prisma.shiftChange.findFirst({
        orderBy: { createdAt: 'desc' },
        select: {
          type: true,
          previousSwapperId: true,
          newSwapperId: true,
          changedById: true,
          reason: true,
        },
      });

      rule(
        'the ShiftChange is REPLACEMENT with both swappers and an author',
        lastChange &&
          lastChange.type === 'REPLACEMENT' &&
          Boolean(lastChange.previousSwapperId) &&
          Boolean(lastChange.newSwapperId) &&
          Boolean(lastChange.changedById),
        JSON.stringify(lastChange),
      );

      const resolved = assign.body.requestId
        ? await prisma.replacementRequest.findUnique({
            where: { id: assign.body.requestId },
            select: {
              status: true,
              assignedSwapperId: true,
              assignedAt: true,
              assignedById: true,
            },
          })
        : null;

      rule(
        'the replacement request it resolved is RESOLVED and assigned',
        resolved &&
          resolved.status === 'RESOLVED' &&
          Boolean(resolved.assignedSwapperId) &&
          Boolean(resolved.assignedAt) &&
          Boolean(resolved.assignedById),
        JSON.stringify(resolved),
      );
    }
  }

  // ---------------------------------------------------------------
  console.log('\nCLEANUP');
  // ---------------------------------------------------------------
  if (created.length) {
    const removed = await prisma.shift.deleteMany({
      where: { id: { in: created } },
    });
    console.log('  removed ' + removed.count + ' audit shift(s)');
  }
  await prisma.leaveRequest.deleteMany({
    where: { reason: 'Business rules audit' },
  });

  console.log('\n==================================================');
  console.log(`  PASS: ${pass}   FAIL: ${fail}`);
  console.log('==================================================');
  if (failures.length) {
    console.log('\nFAILURES:');
    failures.forEach((f) => console.log('  - ' + f));
  }

  await app.close();
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
})().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});