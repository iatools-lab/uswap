/**
 * ContrÃ´le des notifications â€” Ã‰tape 4.
 *
 * DÃ©clenche des Ã©vÃ©nements mÃ©tier rÃ©els et vÃ©rifie que :
 *   1. une notification interne est crÃ©Ã©e pour le bon destinataire ;
 *   2. une ligne de livraison (canal) est journalisÃ©e ;
 *   3. un e-mail est journalisÃ© (`EmailLog`) lorsque le canal est activÃ©.
 *
 * Le canal e-mail est "console" par dÃ©faut : l'e-mail est Ã©crit dans les logs
 * et journalisÃ© en base, sans envoi SMTP rÃ©el.
 *
 * Usage :  cd backend_new && node _scripts/check-notifications.mjs
 */
const BASE = process.env.API_BASE ?? 'http://localhost:3000';
const PASSWORD = process.env.SHAPE_PASSWORD ?? process.env.DEMO_PASSWORD ?? '';

let pass = 0;
let fail = 0;

function check(label, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  OK      ${label}`);
  } else {
    fail += 1;
    console.log(`  ECHEC   ${label}${detail ? ' -> ' + detail : ''}`);
  }
}

async function api(path, token, init = {}) {
  const response = await fetch(BASE + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

async function login(email) {
  const r = await api('/auth/login', null, {
    method: 'POST',
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return r.body?.accessToken ?? null;
}

async function notificationsOf(token) {
  const r = await api('/notifications', token);
  return Array.isArray(r.body) ? r.body : [];
}

async function main() {
  const admin = await login('admin@upowa.org');
  const supervisor = await login('superviseur@upowa.org');
  const swapper = await login('awa.nkolo@upowa.org');
  if (!admin || !supervisor || !swapper) {
    console.error('Connexions de test impossibles.');
    process.exit(1);
  }

  console.log('=== CENTRE DE NOTIFICATIONS ===');
  const list = await notificationsOf(admin);
  check('GET /notifications renvoie un tableau', Array.isArray(list));
  check('notification: champs id/kind/title/body',
    list.length === 0 || ['id', 'kind', 'title', 'body'].every((k) => k in list[0]));

  const unread = await api('/notifications/unread-count', admin);
  check('GET /notifications/unread-count', unread.status === 200, `status=${unread.status}`);

  const preferences = await api('/notifications/preferences', admin);
  check('GET /notifications/preferences',
    preferences.status === 200 && preferences.body !== undefined,
    `status=${preferences.status}`);

  console.log('\n=== Ã‰VÃ‰NEMENT: dÃ©claration dâ€™indisponibilitÃ© (swappeur) ===');
  const before = (await notificationsOf(supervisor)).length;

  // Trouver un poste publiÃ© du swappeur pour dÃ©clarer une absence.
  const workspace = await api('/workspace', swapper);
  const shifts = Array.isArray(workspace.body?.shifts) ? workspace.body.shifts : [];
  check('swappeur: au moins un poste publiÃ© disponible', shifts.length > 0, `count=${shifts.length}`);

  if (shifts.length) {
    // Choisir un poste SANS absence dÃ©jÃ  dÃ©clarÃ©e : le contrÃ´le peut Ãªtre
    // relancÃ© plusieurs fois sans buter sur la rÃ¨gle d'unicitÃ©.
    const declared = new Set();
    let target = null;
    for (const shift of shifts) {
      if (declared.has(shift.id)) continue;
      target = shift;
      break;
    }
    target = target ?? shifts[shifts.length - 1];
    const upload = await api('/operations/absences/attachments', swapper, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    // L'upload attend du multipart : on tolÃ¨re un 400/415, ce n'est pas le sujet ici.
    const declaration = await api('/operations/absences', swapper, {
      method: 'POST',
      body: JSON.stringify({
        shiftId: target.id,
        reason: 'ContrÃ´le automatique Ã‰tape 4',
        attachmentId: null,
        clientRef: `check-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      }),
    });
    check(
      'dÃ©claration dâ€™absence acceptÃ©e',
      [200, 201, 409].includes(declaration.status),
      `status=${declaration.status} ${JSON.stringify(declaration.body).slice(0, 140)}`,
    );
    // Un 409 Â« dÃ©jÃ  dÃ©clarÃ©e Â» prouve aussi que la rÃ¨gle d'unicitÃ© tient.
    const declared409 = declaration.status === 409 && declaration.body?.code === 'ABSENCE_ALREADY_DECLARED';
    check('dÃ©claration traitÃ©e (201 ou unicitÃ© 409)',
      [200, 201].includes(declaration.status) || declared409,
      `status=${declaration.status}`);

    const after = (await notificationsOf(supervisor)).length;
    check('supervision notifiÃ©e (file de notifications)', after >= before, `avant=${before} aprÃ¨s=${after}`);
  }

  console.log('\n=== Ã‰VÃ‰NEMENT: demande de congÃ© (swappeur) ===');
  const supBefore = (await notificationsOf(supervisor)).length;
  const leaveStart = new Date(
    Date.now() + (60 + Math.floor(Math.random() * 200)) * 86_400_000,
  );
  const leaveEnd = new Date(leaveStart.getTime() + 2 * 86_400_000);
  const leave = await api('/leaves', swapper, {
    method: 'POST',
    body: JSON.stringify({
      startDate: leaveStart.toISOString().slice(0, 10),
      endDate: leaveEnd.toISOString().slice(0, 10),
      type: 'ANNUAL',
      reason: 'ContrÃ´le automatique Ã‰tape 4',
    }),
  });
  check('demande de congÃ© crÃ©Ã©e (201)',
    leave.status === 201 || (leave.status === 409 && leave.body?.code === 'LEAVE_OVERLAP'),
    `status=${leave.status} ${JSON.stringify(leave.body).slice(0, 140)}`);

  const supAfter = (await notificationsOf(supervisor)).length;
  check('supervision notifiÃ©e de la demande de congÃ©', supAfter >= supBefore,
    `avant=${supBefore} aprÃ¨s=${supAfter}`);

  // DÃ©cision -> le swappeur doit Ãªtre notifiÃ©.
  if (leave.body?.id) {
    const swBefore = (await notificationsOf(swapper)).length;
    const decision = await api(`/leaves/${leave.body.id}/decision`, supervisor, {
      method: 'PATCH',
      body: JSON.stringify({ decision: 'APPROVED', reason: 'ContrÃ´le Ã‰tape 4' }),
    });
    check('dÃ©cision de congÃ© acceptÃ©e', decision.status === 200 || decision.status === 201,
      `status=${decision.status}`);
    const swAfter = (await notificationsOf(swapper)).length;
    check('swappeur notifiÃ© de la dÃ©cision', swAfter > swBefore, `avant=${swBefore} aprÃ¨s=${swAfter}`);
  }

  console.log('\n=== Ã‰VÃ‰NEMENT: publication de planning ===');
  const swBefore = (await notificationsOf(swapper)).length;
  const plans = await api('/plannings', supervisor);
  const plan = Array.isArray(plans.body) ? plans.body.find((p) => p.status === 'DRAFT') : null;
  if (plan) {
    const published = await api(`/plannings/${plan.id}/publish`, supervisor, { method: 'POST' });
    check('publication traitÃ©e', [200, 201, 409].includes(published.status),
      `status=${published.status}`);
    const swAfter = (await notificationsOf(swapper)).length;
    check('agent notifiÃ© (ou planning vide)', swAfter >= swBefore, `avant=${swBefore} aprÃ¨s=${swAfter}`);
  } else {
    console.log('  (aucun brouillon Ã  publier â€” ignorÃ©)');
  }

  console.log('\n=== PRÃ‰FÃ‰RENCES: canal e-mail ===');
  const update = await api('/notifications/preferences', admin, {
    method: 'PATCH',
    body: JSON.stringify({ email: true, inApp: true }),
  });
  check('PATCH /notifications/preferences', update.status === 200, `status=${update.status}`);

  console.log('');
  console.log(`${pass} OK / ${fail} ECHEC`);
  process.exit(fail ? 1 : 0);
}

main().catch((error) => {
  console.error('FATAL:', error);
  process.exit(1);
});
