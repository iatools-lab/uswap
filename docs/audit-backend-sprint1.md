> Archive de l’audit initial, avant correctifs et configuration PostgreSQL. Pour l’état actuel vérifié le 7 septembre, lire [la recette d’authentification](recette-auth-2026-09-07.md). Les mentions « aucune base », les anciennes migrations et les résultats en échec ci-dessous sont historiques.

# Audit du backend uSwap du 7 septembre 2026

Le backend compile, mais les stories d’authentification ne sont pas encore conformes au backlog. Ne pas considérer cette version comme prête à être exposée sur Internet. La réinitialisation permet au demandeur de récupérer un token sans accéder à la boîte mail du titulaire ; la déconnexion ne révoque pas les JWT d’accès.

Périmètre : `uswap-danielle/uswap-danielle`, fourni par Danielle, comparé au frontend React et au backlog précédemment examiné. Le 7 septembre ouvre les stories 2001–2004 dans le calendrier corrigé. T-001 est la première tâche backend ; les dates de plusieurs autres tâches techniques restent incohérentes dans le classeur. Les observations sur le reste du Sprint 1 sont anticipées, pas une exigence de terminer tout le sprint aujourd’hui.

## Résultats exécutés

- Installation reproductible : `npm ci --ignore-scripts --no-audit --no-fund`, réussie. Le hook `prisma skills sync` n’est pas nécessaire à l’exécution de l’application.
- `prisma generate` : réussi, client 6.19.3.
- `npm run build` : réussi sous Node 24.14.1.
- `npm test -- --runInBand` : 1 test réussi, uniquement le service Hello World du squelette NestJS.
- Audit ajouté : **14 tests, 6 réussis, 8 échecs**, avec Prisma simulé, bcrypt et JWT réels. Aucun e-mail envoyé, aucune base touchée.
- `npm run start:prod` : échec reproduit. Le script cherche `dist/main`, alors que la compilation produit `dist/src/main.js`.
- Le service PostgreSQL 17 local est présent et démarré. Aucune base uSwap ni URL fournie : aucune migration, aucun seed et aucun test avec PostgreSQL réel exécutés.
- Les tests e2e d’origine ne valident pas l’authentification. Ils nécessitent également un environnement configuré ; ils n’ont pas été exécutés ici.

Suite ajoutée : `test/auth-audit.spec.ts`, configuration `test/jest-auth-audit.json`, résultats `test/auth-audit-results.json`. Les assertions qui échouent décrivent les propriétés attendues ; ne pas les inverser pour obtenir du vert. La configuration d’audit adapte Jest aux dépendances JWT/Passport ESM ; la configuration e2e d’origine ne le fait pas.

## Corrections prioritaires

| Priorité | Observation et preuve | Correction attendue |
| --- | --- | --- |
| Critique | `src/auth/auth.service.ts:198–222` : `forgotPassword` renvoie `resetToken` dans une réponse publique. Le contrôleur expose aussi `reset-password` sans authentification, comme attendu pour ce parcours. La combinaison permet de remplacer un mot de passe à partir d’un e-mail connu, sans preuve de possession de la boîte mail. Deux tests échouent sur le token et la réponse non neutre. | Envoyer le lien uniquement à l’adresse du compte via un service mail. Toujours renvoyer la même réponse neutre sans token. Tant que le mail n’est pas prêt, désactiver ce parcours plutôt que renvoyer le secret. |
| Haute | `auth.service.ts:191` supprime seulement les refresh tokens ; `jwt.strategy.ts:21` retourne les claims sans contrôler un état de session. Test : un access token reste accepté après logout. | Ajouter des sessions révocables et vérifier leur validité côté serveur à chaque requête. Logout doit invalider la session courante ; reset doit pouvoir révoquer toutes les sessions. |
| Haute | La stratégie JWT ne recharge ni le rôle ni `isActive`. | Vérifier le compte et son rôle courant ; un compte désactivé et un ancien rôle ne doivent pas conserver leurs droits pendant 15 minutes. |
| Haute | `activateAccount` et `refreshAccessToken` existent dans le service, mais aucun handler ne les expose dans `auth.controller.ts`. Deux tests le confirment. Aucun service d’envoi d’e-mails trouvé. | Ajouter les routes proposées `/auth/activate-account` et `/auth/refresh`, définir leurs DTO, puis livrer l’invitation réelle et son suivi. Ces noms sont une proposition de contrat, pas une exigence textuelle du backlog. |
| Haute | `LoginDto.password` utilise seulement `IsNotEmpty` : un objet passe la validation, constaté par test. | Ajouter `IsString` et des limites de taille ; compléter aussi les validations des tokens et de `fullName`. Retourner 400 pour les entrées mal formées. |
| Moyenne | La connexion d’un compte inactif est refusée mais non journalisée (`auth.service.ts:134`). | Tracer tous les refus sans mot de passe ni token. Conserver une réponse extérieure neutre. |
| Moyenne | Refresh token enregistré en clair ; aucune rotation au renouvellement. Test sur le stockage en clair en échec. | Stocker son hash, faire une rotation atomique, prévoir révocation et purge des expirés. |
| Moyenne | Activation/reset lisent le token puis mettent à jour le compte sans consommation conditionnelle atomique. | Une transaction ou une mise à jour conditionnelle doit empêcher deux requêtes concurrentes de consommer le même token. Ajouter un test de concurrence sur PostgreSQL. |
| Moyenne | Aucune limitation de fréquence identifiée pour login/reset. | Limiter les tentatives par compte et source ; choisir un stockage partagé si plusieurs instances. |
| Moyenne | `package.json` : démarrage de production erroné, reproduit. | Aligner le script sur `node dist/src/main.js`, ou modifier proprement le périmètre de compilation puis vérifier le chemin produit. |

Les durées existantes sont 15 minutes pour le JWT d’accès, 7 jours pour le refresh, 15 minutes pour le reset et 48 heures pour l’invitation. Elles sont codées en dur. L’expiration après inactivité et la configuration globale demandées par le backlog ne sont pas implémentées par ces seules durées.

## Ce qui est déjà utile

- Structure NestJS modulaire et client Prisma partagé.
- Hash bcrypt des mots de passe ; tokens d’invitation et reset aléatoires, hashés en base et munis d’une date d’expiration.
- Refus des comptes inactifs à la connexion et au renouvellement.
- Journalisation des connexions réussies, des comptes inconnus et des mauvais mots de passe sans enregistrer le mot de passe dans LoginAttempt.
- DTO, ValidationPipe globale, guards de rôle et Swagger.
- Création de comptes réservée à un administrateur ; pas d’inscription publique.

## Préparation PostgreSQL locale

Le fichier `.env` a été créé dans le dossier backend réel avec un secret JWT aléatoire, sans affichage de sa valeur. Il est ignoré par Git. `DATABASE_URL` est volontairement vide.

1. Dans pgAdmin, créer une base dédiée `uswap_dev` sur le serveur PostgreSQL local et un utilisateur de développement approprié. Ne pas utiliser une base existante contenant d’autres données.
2. Renseigner uniquement `DATABASE_URL` dans le `.env` local, sur le modèle du `.env.example`. Encoder les caractères spéciaux du mot de passe dans l’URL.
3. Depuis le dossier backend, exécuter les commandes ci-dessous après vérification de la base cible.

```powershell
Set-Location 'D:\PROJETS\Uswap\uswap-danielle\uswap-danielle'
.\node_modules\.bin\prisma.cmd validate
.\node_modules\.bin\prisma.cmd migrate status
.\node_modules\.bin\prisma.cmd migrate deploy
npm.cmd run build
node -r dotenv/config dist/src/main.js
```

Swagger sera à `http://localhost:3000/api-docs` si le démarrage réussit. Aucune de ces migrations n’a été appliquée pendant cet audit. Ne pas utiliser `migrate reset`.

Le seed actuel contient un compte administrateur et un mot de passe fixes. Remplacer cette configuration par des variables locales avant de l’utiliser ; ne pas conserver ces identifiants dans une instance accessible. La création de comptes étant protégée, il faut ce bootstrap administratif pour le premier login.

Attention à la migration `20260907103015_invitation_and_refresh_flow` : elle supprime `User.phone` et crée `phoneNumber` sans recopier les valeurs. Sur une base déjà remplie, elle perd les numéros. Sur une nouvelle base vide, il n’y a pas de numéros existants à perdre. Coordonner la correction avec Danielle si cette migration a déjà été appliquée ailleurs ; ne pas réécrire sans vérifier une migration partagée.

## Relancer les tests

```powershell
Set-Location 'D:\PROJETS\Uswap\uswap-danielle\uswap-danielle'
npm.cmd test -- --runInBand
.\node_modules\.bin\jest.cmd --config test/jest-auth-audit.json --runInBand
```

Après correction et configuration de PostgreSQL, compléter avec des tests HTTP sur une base de test dédiée : authentification valide et invalide, 400 sur mauvais types, 401 sans token, 403 mauvais rôle, 401 après logout/reset/désactivation, changement de rôle immédiat, usage unique concurrent des liens, envoi mail capturé localement et CORS. Ne pas utiliser les données de production pour ces tests.

## Contrat avec le frontend

Les échanges actuels ne sont pas compatibles.

| Élément | Frontend actuel | Backend actuel |
| --- | --- | --- |
| Requête login | `{ identifier, password }` | `{ email, password }`, e-mail obligatoire |
| Nom retourné | Attend `user.name` | Fournit `user.fullName` |
| Chef de station | `STATION_MANAGER` | `STATION_CHIEF` |
| Session | `credentials: include`, hypothèse cookie | JWT Bearer dans JSON ; aucun cookie émis |
| CORS | Appel avec credentials | `enableCors()` générique, incompatible avec ce mode credentials cross-origin |
| Après connexion | Accueil temporaire en mémoire, aucun espace protégé livré | Aucun `/auth/me` fourni |

La route login existante est `POST http://localhost:3000/auth/login` et son corps valide est :

```json
{ "email": "compte-de-test@example.invalid", "password": "mot-de-passe-du-compte-de-test" }
```

Elle retourne actuellement `accessToken`, `refreshToken` et `user: { id, email, fullName, role }`. Une route protégée attend `Authorization: Bearer <accessToken>`.

Deux architectures sont possibles. Pour cette application web, proposition : access token en mémoire, refresh en cookie HttpOnly avec Secure en HTTPS, renouvellement contrôlé et sessions révocables. Le backend doit alors ajouter le cookie, une politique SameSite/CSRF adaptée, une liste d’origines CORS explicite et un endpoint de session. Un contrat entièrement par cookie est aussi possible, mais exige d’adapter la stratégie JWT actuelle. Ne pas mélanger les deux implicitement et ne pas stocker les jetons durables dans localStorage.

Pour une vérification locale du login Bearer actuel uniquement, retirer `credentials: include`, envoyer `email`, lire `fullName` et `STATION_CHIEF` et traiter le JWT en mémoire. Cela ne corrige pas les failles de session et ne constitue pas une intégration finale. La page React n’a pas été modifiée pendant l’audit.

Une fois le contrat arrêté et sécurisé : renseigner `VITE_API_URL=http://localhost:3000` dans le `.env` frontend à la racine, relancer Vite, brancher login/session/logout, puis protéger les routes par rôle. Seul le backend autorise réellement les actions. Les maquettes restent indépendantes et ne doivent pas servir de contrôle d’accès.

## Reste du Sprint 1 et performances

- 2007 : création présente, mais règle d’un seul administrateur ajoutée sans justification dans le backlog et gestion de conflits Prisma à compléter.
- 2008–2009 : pas d’import CSV/Excel, de bilan, de service mail ou de renvoi d’invitations trouvé.
- 2010–2011 : pas de routes de modification de profil/rôle ou de désactivation d’utilisateur ; pas de piste d’audit correspondante.
- 2012 : liste filtrable par rôle et station, mais aucun filtre nom/statut, pagination ou export. `stationId` du compte n’est pas une affectation planifiée sur une période.
- 2013–2014 : création/modification/activation des stations présentes. `ShiftsService.create` ne vérifie pas si la station est inactive. Le frontend de maquette propose des champs code/ville/e-mail qui ne correspondent pas tous au DTO actuel : aligner le formulaire et le contrat avant intégration.
- 2015–2018 : paramètres stockés, mais pas de prise d’effet, génération/vérification QR, contrôle de repos ou de charge hebdomadaire. Les TTL QR sont en secondes dans l’API ; les maquettes sont en minutes : conversion explicite indispensable.
- Hors périmètre du jour : les congés gardent une demande en attente mais aucun mécanisme automatique de renvoi n’a été trouvé. Le client HTTP externe n’a pas de timeout.

Avant d’optimiser, mesurer sur une base de test : latences p50/p95, débit, erreurs, temps SQL et consommation CPU. Aucun benchmark réel n’a été réalisé sans base configurée.

Améliorations concrètes : paginer et limiter les listes ; ajouter les index correspondant aux requêtes réelles (`RefreshToken.userId`, expirations, filtres utilisateurs/shifts selon plans SQL) ; purger les tokens et définir une rétention des audits ; garder les appels bcrypt asynchrones ; prévoir une file d’envoi mail avec délais, reprises et suivi ; ajouter un timeout aux API externes. Éviter de mettre en cache longtemps les permissions, puisque leur modification doit prendre effet à la requête suivante. L’adapter PostgreSQL Prisma 7 présent est inutilisé par le PrismaClient 6 actuel : supprimer cette dépendance inutile ou aligner les versions dans un chantier distinct, sans migration de version improvisée.

## Références

- OWASP, reset : https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
- NestJS, configuration CORS : https://docs.nestjs.com/security/cors

Les constats viennent du code fourni et des tests indiqués. Les propositions de correction ne sont pas encore appliquées aux sources de Danielle.
