# uSwap — base de donnees (Prisma)

Le schéma reflète **exactement** les entités consommées par `frontend_new` :

| Domaine | Modèles |
|---|---|
| Comptes | `User`, `AccountAuditEntry`, `RefreshToken`, `InvitationToken`, `PasswordResetToken` |
| Stations | `Station`, `ShiftTemplate` |
| Planification | `Planning`, `Occurrence`, `PlanningNotice` |
| Opérations | `AttendanceRecord`, `AbsenceDeclaration`, `ShiftChange` |
| Congés | `LeaveRequest`, `LeaveBalance`, `LeaveSyncOperation` |
| Incidents | `Incident`, `IncidentAction` |
| Notifications | `Notification`, `NotificationPreference`, `PushSubscription`, `EmailLog` |
| Rapports | `ScheduledReport`, `ReportRun` |
| Divers | `Attachment`, `ImportBatch`, `ImportBatchRow`, `GlobalSetting`, `SettingsRevision`, `AuditLog`, `IdempotencyKey` |

## SQLite par défaut, PostgreSQL en production

`DATABASE_URL="file:./dev.db"` fonctionne sans installation. Pour PostgreSQL,
mettre les colonnes JSON en `Json` (déjà le cas) et changer le provider :

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

## Commandes

```bash
npm run prisma:push      # crée la base à partir du schéma
npm run seed             # jeu de données de démonstration
npm run prisma:studio    # explorer les tables
```
