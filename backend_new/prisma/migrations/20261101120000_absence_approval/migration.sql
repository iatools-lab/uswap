-- Cycle de validation des absences signalées par un agent.
-- ADD VALUE est additif : aucune donnée existante n'est modifiée.
--
-- `prisma:disable-transaction` : en PostgreSQL, une valeur d'énumération
-- ajoutée dans une transaction ne peut pas être UTILISÉE par un UPDATE/INSERT
-- de la MÊME transaction. Ces valeurs sont écrites en PENDING/APPROVED/
-- REJECTED dès la première déclaration d'absence. Désactiver la transaction
-- évite un « unsafe use of new value » au premier déploiement. Aucune écriture
-- ici : pas d'état partiel possible.
-- prisma:disable-transaction
ALTER TYPE "AbsenceStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "AbsenceStatus" ADD VALUE IF NOT EXISTS 'APPROVED';
ALTER TYPE "AbsenceStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
