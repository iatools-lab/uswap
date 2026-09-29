// Temporary contract audit — deleted after the run.
require('dotenv').config();

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { SwaggerModule, DocumentBuilder } = require('@nestjs/swagger');

// Every endpoint the frontend actually calls, with the method used.
const CALLS = [
  ['POST', '/auth/login'],
  ['POST', '/auth/refresh'],
  ['POST', '/auth/logout'],
  ['GET', '/auth/me'],
  ['POST', '/auth/register'],
  ['POST', '/auth/invitations/{id}/resend'],
  ['GET', '/users'],
  ['GET', '/users/page'],
  ['GET', '/users/{id}'],
  ['PATCH', '/users/{id}'],
  ['PATCH', '/users/{id}/status'],
  ['POST', '/users/{id}/activate'],
  ['GET', '/users/imports/template'],
  ['GET', '/stations'],
  ['POST', '/stations'],
  ['PATCH', '/stations/{id}'],
  ['PATCH', '/stations/{id}/status'],
  ['DELETE', '/shifts/{id}'],
  ['GET', '/shifts'],
  ['POST', '/shifts'],
  ['GET', '/shifts/mine'],
  ['POST', '/shifts/validate'],
  ['GET', '/shifts/slots'],
  ['GET', '/plannings'],
  ['POST', '/plannings'],
  ['POST', '/plannings/{id}/generate'],
  ['PATCH', '/plannings/{id}/publish'],
  ['GET', '/attendance'],
  ['GET', '/attendance/mine'],
  ['POST', '/attendance/qr'],
  ['POST', '/attendance/check-in'],
  ['POST', '/attendance/check-out'],
  ['GET', '/attendance/station/{stationId}'],
  ['GET', '/attendance/swapper/{swapperId}'],
  ['GET', '/workspace'],
  ['POST', '/operations/absences'],
  ['GET', '/operations/replacements/pending'],
  ['GET', '/operations/changes'],
  ['GET', '/operations/shifts/{shiftId}/candidates'],
  ['POST', '/operations/shifts/{shiftId}/replacement'],
  ['POST', '/corrections/attachments'],
  ['PATCH', '/corrections/shifts/{shiftId}'],
  ['GET', '/corrections/shifts/{shiftId}'],
  ['GET', '/notifications'],
  ['GET', '/notifications/unread-count'],
  ['PATCH', '/notifications/{id}/read'],
  ['PATCH', '/notifications/read-all'],
  ['GET', '/dashboard/stats'],
];

(async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  const doc = SwaggerModule.createDocument(app, new DocumentBuilder().build());

  const missing = [];

  console.log('=== FRONTEND -> BACKEND CONTRACT ===');
  console.log('');

  for (const [method, path] of CALLS) {
    const entry = doc.paths[path];
    const verb = method.toLowerCase();
    const ok = Boolean(entry && entry[verb]);

    if (!ok) {
      const available = entry
        ? Object.keys(entry).join(',').toUpperCase()
        : 'ROUTE NOT FOUND';
      missing.push({ method, path, available });
      console.log('  MISSING  ' + method.padEnd(6) + path.padEnd(46) + ' (' + available + ')');
    } else {
      console.log('  OK       ' + method.padEnd(6) + path);
    }
  }

  console.log('');
  console.log('backend routes total: ' + Object.keys(doc.paths).length);
  console.log('calls checked:        ' + CALLS.length);
  console.log('missing:              ' + missing.length);

  if (missing.length) {
    console.log('');
    console.log('=== MISSING DETAIL ===');
    missing.forEach((m) => console.log('  ' + m.method + ' ' + m.path + '  -> ' + m.available));
  }

  await app.close();
  process.exit(missing.length ? 1 : 0);
})().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});