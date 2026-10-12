/**
 * Test d'envoi e-mail réel (SMTP).
 *
 * Vérifie que les identifiants du .env permettent d'ouvrir une session SMTP,
 * puis envoie un message de test à l'adresse fournie en argument.
 *
 * Usage :  cd backend_new && node _scripts/test-smtp.mjs destinataire@exemple.com
 */
import 'dotenv/config';
import nodemailer from 'nodemailer';

const to = process.argv[2];
if (!to) {
  console.error('Usage: node _scripts/test-smtp.mjs <destinataire@exemple.com>');
  process.exit(1);
}

const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT ?? 587);
const secure = String(process.env.SMTP_SECURE ?? 'false') === 'true';
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASSWORD ?? process.env.SMTP_PASS;
const from = process.env.MAIL_FROM ?? user;

console.log(`SMTP ${host}:${port} (secure=${secure}) user=${user}`);
console.log(`From: ${from}\nTo:   ${to}\n`);

const transporter = nodemailer.createTransport({
  host,
  port,
  secure,
  auth: user ? { user, pass } : undefined,
});

try {
  await transporter.verify();
  console.log('OK   : session SMTP ouverte (identifiants valides).');

  const info = await transporter.sendMail({
    from,
    to,
    subject: 'uSwap — test d’envoi (Étape 5)',
    text: 'Ce message confirme que la configuration SMTP de uSwap fonctionne.',
    html: '<p>Ce message confirme que la configuration SMTP de <strong>uSwap</strong> fonctionne.</p>',
  });
  console.log('OK   : message accepté par le serveur.');
  console.log(`      messageId = ${info.messageId}`);
  console.log(`      réponse   = ${info.response}`);
  process.exit(0);
} catch (error) {
  console.error('ECHEC:', error instanceof Error ? error.message : error);
  process.exit(1);
}
