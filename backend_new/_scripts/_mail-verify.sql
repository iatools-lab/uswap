-- Vérification de l'envoi réel (Étape 5)
SELECT "to", subject, template, status, "error", "sentAt"
FROM email_logs
ORDER BY "createdAt" DESC
LIMIT 5;

SELECT u.email, u."invitationStatus", u."invitationSentAt", u."invitationExpiresAt"
FROM users u
WHERE u.email = 'guimazeudanielle@gmail.com';

SELECT count(*) AS invitation_tokens
FROM invitation_tokens it
JOIN users u ON u.id = it."userId"
WHERE u.email = 'guimazeudanielle@gmail.com' AND it.purpose = 'ACTIVATION';
