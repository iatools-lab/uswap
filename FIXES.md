# uSwap v5.3 — correctifs full-stack

## Correctifs inclus

### Authentification
- Correction des liens d'activation : `/auth/activate?token=...`.
- La page d'activation accepte les tokens en query string et hash.
- Activation : mot de passe hashé, compte actif, token consommé, sessions invalidées.
- Réinitialisation : même gestion robuste du token et expiration.
- Envoi SMTP Gmail/Nodemailer au lieu de Resend.
- Historique des invitations et réinitialisations.

### Utilisateurs
- Ajout du vrai statut `pending / active / inactive`.
- Ajout de `disabledAt`.
- Compteurs indépendants et filtres fonctionnels.
- Modification e-mail, nom, rôle, station, téléphone et adresse.
- Contrôle d'unicité de l'e-mail.
- Audit de modification renvoyé à l'interface.
- Correction des routes d'import placées avant `/:id`.
- Historique de communication admin.

### Planning / shifts
- Un poste peut être vacant (`Shift.swapperId` nullable).
- Dupliquer un poste crée réellement un poste vacant.
- Suppression d'une affectation supprime aussi son attendance attendue.
- Affectation d'un swappeur recrée l'attendance attendue.
- Support réel des `templateIds` et `weekdays` lors de la génération.
- Correction dimanche = 0 dans les jours de semaine.
- Permutation de deux occurrences via `swapWithId`.
- Contrôle de révision après modification.
- Planning mis à jour après ajout/suppression/permutation.
- Les plannings visibles par un swappeur sont limités à ses propres shifts publiés.

### Notifications
- Préférences frontend alignées avec le contrat backend.
- Gestion `inApp / email / push / digest / quiet hours`.
- Abonnement push d'un appareil enregistré côté serveur.
- Service worker prêt à afficher et ouvrir les notifications push.
- Les notifications in-app respectent la préférence utilisateur.

### Hors connexion / PWA
- Suppression du cache de planning lors de la déconnexion.
- File offline conservée jusqu'à confirmation serveur.
- Déclarations d'absence avec `clientRef` idempotent pour éviter les doublons.

## Installation après téléchargement

Backend :
```bash
npm install
npx prisma generate
npx prisma db push
npm run build
```

Frontend :
```bash
cd frontend
npm install
npm run build
```

## Notifications push

Pour activer les push réels :
```bash
npx web-push generate-vapid-keys
```
Mettre la clé publique dans `VAPID_PUBLIC_KEY` et `frontend/.env` dans `VITE_VAPID_PUBLIC_KEY`, ainsi que la clé privée dans `VAPID_PRIVATE_KEY` et un `VAPID_SUBJECT` de type `mailto:...`.

## Variables e-mail

Utiliser :
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=adresse@gmail.com
SMTP_PASS=GOOGLE_APP_PASSWORD
MAIL_FROM=adresse@gmail.com
FRONTEND_URL=http://127.0.0.1:5173
```

`SMTP_PASS` doit être un Google App Password, jamais le mot de passe Gmail normal.

## Base de données

Le fichier :
`prisma/migrations/20261002_bugfixes/migration.sql`

documente les changements SQL principaux. Comme ce projet v5.2 n'avait pas de migration initiale complète dans l'archive, `prisma db push` est le chemin le plus simple pour une base de développement existante.

## Important

Le ZIP ne contient volontairement aucun secret SMTP, JWT ou base de données.
