# Recette uSwap du 7 septembre 2026

## Retouche visuelle après revue utilisateur

Pieds de page (mentions répétées et date), mention « uPowa Cameroun » en bas de navigation et bandeau promotionnel retirés. Signature « uSwap · Powered by uPowa » conservée avec le logo. Typographie et contrôles agrandis ; Poppins embarquée localement. Icônes Phosphor duotone issues de la bibliothèque officielle sous licence MIT. Illustration de batteries statique sur le login. Aucune fonction métier supplémentaire dans cette passe.

Le parcours navigateur existant a de nouveau réussi après la retouche : login, activation, reset, déconnexion, contrôles de rôle, compteurs réels, navigation et absence de débordement à 320/390/768/1440 px. Compilation réussie. Les captures `login-*.png` et `admin-*.png` montrent le rendu actualisé. Le périmètre fonctionnel reste celui documenté ci-dessous, avec SMTP et acceptation encore à finaliser.

## Correction de l’espace administrateur

La première livraison utilisait une URL administrateur avec une simple fiche de compte : elle ne répondait pas complètement à l’espace par rôle attendu dans 2001. Après le retour de l’utilisateur, l’admin arrive désormais dans un espace dédié, hors du gabarit de connexion : navigation latérale sur ordinateur, navigation inférieure sur mobile, vue d’ensemble, utilisateurs, stations et compte.

Les compteurs, derniers comptes et répartition des rôles utilisent les réponses réelles `/users` et `/stations`. Les sous-pages sont consultables et restent accessibles à leur URL après rechargement. Aucun module de création, import ou modification n’est déclaré livré ici. Les autres rôles conservent pour l’instant un accueil de compte : leur espace métier reste à réaliser.

Recette étendue dans `scripts/check-auth-browser.cjs` : compteurs comparés à PostgreSQL, recherche et résultat vide, navigation arrière, sous-page rechargée, erreur réseau simulée puis reprise, affichage 320/390/768/1440 px. Les captures `admin-*.png` contiennent un compte temporaire de recette supprimé à la fin des tests. La capture `account-mobile.png` du passage précédent représente l’ancien écran, pas la page administrateur actuelle.

## Périmètre et calendrier

Classeur fourni : `Product_Backlog_Jira_Gestion_Swappeurs.xlsx`, feuille `04_Sprint Backlog`, lignes 5–8. Stories 2001–2004 : connexion, activation, réinitialisation, déconnexion. Les dates 7–8 août sont interprétées comme 7–8 septembre selon la correction de l’utilisateur ; le Sprint 1 se termine le 11 septembre.

L’onglet `05_Tâches techniques` contient encore des fins antérieures aux débuts et des tâches après le 11 septembre. T-001 commence bien le 7 septembre. Ces incohérences empêchent d’affirmer une conformité de toutes les dates techniques. Le classeur n’a pas été modifié. Répartition de travail suivie : utilisateur au frontend, Danielle au backend, conformément à la conversation.

## État des stories

| Story | Résultat vérifié | Reste à valider |
| --- | --- | --- |
| 2001 | Connexion aux quatre rôles sur PostgreSQL, erreurs neutres, journalisation sans mot de passe ; login navigateur et URL administrateur, cookie HttpOnly, restauration de session | Acceptation fonctionnelle ; revue navigateur des trois autres URLs de rôle |
| 2002 | Activation réelle via navigateur ; expiration et usage unique, y compris deux requêtes concurrentes sur PostgreSQL ; compte rendu actif | Configuration SMTP et réception réelle de l’invitation ; politique de mot de passe à confirmer avec le PO |
| 2003 | Demande neutre testée avec service mail capturé ; expiration et consommation concurrente unique ; nouveau mot de passe utilisable, ancien refusé ; toutes les sessions révoquées ; reset navigateur et lien réutilisé refusé | Envoi et réception réels du mail. Sans SMTP, la réponse est une indisponibilité identique pour toute adresse |
| 2004 | Révocation serveur immédiate ; retour à la connexion ; fermeture dans le deuxième onglet ; retour arrière sans carte de compte ; cookie supprimé | Acceptation fonctionnelle sur les téléphones utilisés par l’équipe |

Ne pas déclarer les quatre stories intégralement terminées tant que la recette e-mail et l’acceptation ne sont pas faites.

## Vérifications exécutées

- Backend : compilation réussie ; 32 tests unitaires/HTTP réussis (Prisma simulé pour ces tests).
- PostgreSQL local : `uswap_db` sur `localhost:5000`, migration `20260907141005_init` appliquée ; `migrate status` à jour et `migrate diff` sans différence.
- 9 scénarios supplémentaires sur PostgreSQL réel réussis. Les liens sont capturés en mémoire ; aucun e-mail externe n’est envoyé.
- Compte administrateur local existant actif, rôle ADMIN, mot de passe configuré correspondant au hash enregistré. Aucun identifiant secret affiché ou modifié.
- Frontend : build TypeScript/Vite réussi. Vérifications Chrome sur 320, 390, 768 et 1440 px, sans débordement horizontal ni erreur JavaScript lors du parcours automatisé.
- Parcours navigateur sur la vraie API et PostgreSQL : activation, connexion, refresh au rechargement, déconnexion entre onglets, retour arrière, reset, lien déjà consommé, indisponibilité SMTP.
- Comptes temporaires, sessions et tentatives de recette supprimés après les essais ; aucun reset de base effectué.

Les tests navigateur ont révélé une réouverture de lien dans le même document qui conservait l’état précédent. Un changement de fragment contenant un token recharge maintenant le parcours. Le scénario de réutilisation du lien a ensuite réussi.

## Frontend livré dans ce passage

Charte et panneau bleu animé conservés. Formulaires activation/reset harmonisés, validation près des champs, affichage du mot de passe, états de réussite et lien invalide, actions de retour explicites. L’accueil après connexion montre le nom, l’adresse et le rôle réels, avec déconnexion. Aucun tableau de bord métier fictif n’a été ajouté. Les animations respectent la préférence de réduction des mouvements.

Captures dans `docs/verification`. Les données affichées dans les captures de compte proviennent d’un compte temporaire supprimé après la recette. Poppins dépend encore de Google Fonts, avec Arial en secours ; la recette visuelle vérifie aussi ce rendu de secours. L’application n’est pas une PWA installable à ce stade.

## Commandes

Frontend, à la racine : `npm run dev` puis ouvrir `http://127.0.0.1:5173/auth/login`.

Backend, dans `uswap-danielle/uswap-danielle` : `npm run dev` (alias ajouté de `start:dev`). Tests : `npm test -- --runInBand` et `npm run test:postgres -- --database uswap_db`.

La recette navigateur est dans `scripts/check-auth-browser.cjs`. Elle nécessite Chrome installé, Playwright accessible via NODE_PATH, les deux serveurs démarrés et la base locale `uswap_db`. Les tokens de test restent en mémoire et ne figurent pas dans les captures.

## Suites

Configurer SMTP_HOST et MAIL_FROM, ainsi que les identifiants du relais si requis, dans le seul `.env` backend. Vérifier ensuite la réception d’une invitation et d’un lien de reset. Ne jamais placer ces secrets dans le frontend.

Les index de session sont présents. Aucun benchmark de charge n’a été réalisé : les tests fonctionnels ne prouvent pas les performances sous charge. Les améliorations de pagination, d’envoi mail asynchrone et les fonctionnalités des autres stories restent hors de cette recette d’authentification.
