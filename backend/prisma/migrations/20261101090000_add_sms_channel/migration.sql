-- Canal SMS pour les notifications.
-- Deux ajouts strictement additifs : aucune donnée n'est supprimée.

-- 1. Nouvelle valeur d'énumération.
ALTER TYPE "NotificationChannel" ADD VALUE IF NOT EXISTS 'SMS';

-- 2. Interrupteur de préférence par compte (désactivé par défaut : un SMS
--    coûte de l'argent, il ne doit jamais partir sans consentement).
ALTER TABLE "notification_preferences"
  ADD COLUMN IF NOT EXISTS "smsEnabled" BOOLEAN NOT NULL DEFAULT false;
