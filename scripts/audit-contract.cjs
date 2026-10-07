// Audit de contrat réel : routes attendues par le frontend sprint 5.2.0
// vs routes exposées par le backend (Swagger).
require('dotenv').config();

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { SwaggerModule, DocumentBuilder } = require('@nestjs/swagger');

// Contrat extrait de frontend/src/api/mock/handlers/*.ts + des appels api(...).
const CALLS = [
  ['POST', '/auth/login'],
  ['POST', '/auth/refresh'],
  ['POST', '/auth/logout'],
  ['GET', '/auth/me'],
  ['POST', '/auth/forgot-password'],
  ['POST', '/auth/activate-account'],
  ['POST', '/auth/reset-password'],
  ['POST', '/auth/register'],
  ['POST', '/auth/invitations/{id}/resend'],

  ['GET', '/users'],
  ['GET', '/users/page'],
  ['GET', '/users/export'],
  ['GET', '/users/imports/template'],
  ['POST', '/users/imports/preview'],
  ['POST', '/users/imports/{id}/confirm'],
  ['GET', '/users/{id}'],
  ['PATCH', '/users/{id}'],
  ['PATCH', '/users/{id}/status'],
  ['POST', '/users/{id}/activate'],
  ['GET', '/users/{id}/communication-history'],

  ['GET', '/stations'],
  ['POST', '/stations'],
  ['PATCH', '/stations/{id}'],
  ['PATCH', '/stations/{id}/activate'],
  ['PATCH', '/stations/{id}/deactivate'],
  ['GET', '/stations/{id}/shift-templates'],
  ['POST', '/stations/{id}/shift-templates'],
  ['PATCH', '/stations/{id}/shift-templates/{templateId}'],
  ['GET', '/stations/{id}/shift-templates/{templateId}/history'],

  ['GET', '/workspace'],
  ['POST', '/shifts/validate'],
  ['POST', '/shifts'],
  ['GET', '/shifts'],
  ['GET', '/shifts/mine'],
  ['PATCH', '/shifts/{id}'],
  ['DELETE', '/shifts/{id}'],
  ['GET', '/shifts/slots'],

  ['GET', '/plannings'],
  ['POST', '/plannings'],
  ['POST', '/plannings/{id}/auto-assign'],
  ['GET', '/plannings/notices'],
  ['PATCH', '/plannings/notices/{id}/read'],
  ['POST', '/plannings/{id}/preview'],
  ['POST', '/plannings/{id}/generate'],
  ['GET', '/plannings/{id}'],
  ['POST', '/plannings/{id}/occurrences/{occurrenceId}/duplicate'],
  ['POST', '/plannings/{id}/occurrences/{occurrenceId}/remove'],
  ['POST', '/plannings/{id}/occurrences/{occurrenceId}/validate'],
  ['PATCH', '/plannings/{id}/occurrences/{occurrenceId}'],
  ['PATCH', '/plannings/{id}/validate'],
  ['PATCH', '/plannings/{id}/publish'],

  ['POST', '/attendance'],
  ['GET', '/attendance/monitor'],
  ['GET', '/attendance/history'],
  ['POST', '/attendance/check-in'],
  ['POST', '/attendance/check-out'],
  ['GET', '/attendance/mine'],

  ['POST', '/operations/absences/attachments'],
  ['POST', '/operations/absences'],
  ['GET', '/operations/replacements/pending'],
  ['GET', '/operations/shifts/{shiftId}/candidates'],
  ['POST', '/operations/shifts/{shiftId}/replacement'],
  ['GET', '/operations/changes'],
  ['POST', '/corrections/attachments'],
  ['PATCH', '/corrections/shifts/{shiftId}'],
  ['GET', '/corrections/shifts/{shiftId}'],

  ['GET', '/leaves/workspace'],
  ['POST', '/leaves'],
  ['PATCH', '/leaves/{id}'],
  ['PATCH', '/leaves/{id}/cancel'],
  ['GET', '/leaves/management'],
  ['PATCH', '/leaves/{id}/decision'],
  ['GET', '/admin/leaves/pending'],
  ['PATCH', '/admin/leaves/{id}/decision'],
  ['GET', '/admin/integrations/leaves'],

  ['GET', '/incidents'],
  ['POST', '/incidents'],
  ['PATCH', '/incidents/{id}'],

  ['GET', '/notifications'],
  ['GET', '/notifications/unread-count'],
  ['PATCH', '/notifications/{id}/read'],
  ['PATCH', '/notifications/read-all'],
  ['GET', '/notifications/preferences'],
  ['PATCH', '/notifications/preferences'],
  ['POST', '/notifications/push-subscription'],
  ['DELETE', '/notifications/push-subscription'],

  ['GET', '/admin/settings'],
  ['PATCH', '/admin/settings'],
  ['GET', '/admin/audit'],
  ['GET', '/reports/dashboard'],
  ['GET', '/reports/export'],
  ['GET', '/admin/reports/schedules'],
  ['POST', '/admin/reports/schedules'],
  ['POST', '/admin/reports/schedules/preview'],
  ['GET', '/admin/reports/schedules/{id}/runs'],
  ['PATCH', '/admin/reports/schedules/{id}'],

  ['GET', '/dashboard/stats'],
];

(async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  const doc = SwaggerModule.createDocument(app, new DocumentBuilder().build());

  const missing = [];

  console.log('=== FRONTEND (sprint 5.2.0) -> BACKEND CONTRACT ===');
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
      console.log('  MANQUANT  ' + method.padEnd(6) + path.padEnd(52) + ' (' + available + ')');
    } else {
      console.log('  OK        ' + method.padEnd(6) + path);
    }
  }

  console.log('');
  console.log('routes backend totales : ' + Object.keys(doc.paths).length);
  console.log('appels vérifiés        : ' + CALLS.length);
  console.log('manquants              : ' + missing.length);

  if (missing.length) {
    console.log('');
    console.log('=== DÉTAIL DES MANQUANTS ===');
    missing.forEach((m) => console.log('  ' + m.method + ' ' + m.path + '  -> ' + m.available));
  }

  await app.close();
  process.exit(missing.length ? 1 : 0);
})().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});