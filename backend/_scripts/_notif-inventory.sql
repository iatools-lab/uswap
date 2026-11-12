-- Journal de livraison et e-mails (Étape 4)
SELECT 'notifications' AS entity, count(*) FROM notifications
UNION ALL SELECT 'notification_deliveries', count(*) FROM notification_deliveries
UNION ALL SELECT 'email_logs', count(*) FROM email_logs;

-- Répartition des livraisons par canal et statut
SELECT channel, status, count(*) FROM notification_deliveries GROUP BY channel, status ORDER BY channel, status;

-- Derniers e-mails journalisés
SELECT "to", subject, template, status, "createdAt" FROM email_logs ORDER BY "createdAt" DESC LIMIT 10;

-- Dernières notifications émises
SELECT kind, title, "createdAt" FROM notifications ORDER BY "createdAt" DESC LIMIT 8;
