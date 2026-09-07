# uSwap frontend

React + TypeScript + Vite. Interface responsive aux couleurs uPowa.

## Démarrer

`npm install`, puis `npm run dev`. Compiler avec `npm run build`.

- Connexion : `/auth/login`.
- Mot de passe oublié : `/auth/forgot-password`.
- Activation : `/auth/activate#token=...` depuis l’e-mail.
- Réinitialisation : `/auth/reset-password#token=...` depuis l’e-mail.
- Maquettes : `/maquettes/index.html`, indépendantes du backend.

Le frontend utilise VITE_API_URL si configurée, sinon le même hostname sur le port 3000. Utiliser le même hostname pour les deux serveurs (127.0.0.1 ou localhost). Le backend est dans `uswap-danielle/uswap-danielle` : consulter son README pour PostgreSQL et SMTP.

Le jeton d’accès est gardé en mémoire uniquement. Le refresh token est un cookie HttpOnly émis par le backend. Les appels utilisent credentials, le header X-USwap-Client et Authorization pour les routes protégées. ADMIN accède à un espace dédié à `/app/admin`, avec vue d’ensemble et pages `/app/admin/utilisateurs`, `/app/admin/stations`, `/app/admin/compte`. Les autres rôles conduisent encore à des accueils de compte provisoires.

Les formulaires utilisent le contrat réel email/fullName. La session est restaurée via refresh, revérifiée lorsque l’onglet redevient visible, et effacée à expiration du jeton d’accès. Une prolongation explicite est proposée avant expiration. Le logout attend la confirmation serveur avant d’annoncer sa réussite. En cas de réseau indisponible, un message invite à réessayer. Aucun token ni mot de passe n’est persisté dans localStorage.

L’espace administrateur lit les utilisateurs et stations via les API protégées ; aucun chiffre métier fictif n’est affiché. Les listes sont consultables, avec recherche et filtres locaux sur les utilisateurs, pagination d’affichage et coordonnées des stations. L’import, la création et la modification ne sont pas encore livrés par cet écran et restent des stories distinctes. Les API actuelles renvoient les listes complètes : la pagination serveur et les exports restent à développer pour 2012. « Station rattachée » désigne stationId du compte et ne prétend pas représenter une affectation planifiée.

La fermeture de session est transmise aux autres onglets. Le retour sur une page restaurée par le navigateur force la vérification de session. Activation et reset proposent des états de réussite et de lien invalide, avec un retour vers la connexion. La réouverture d’un lien dans le même onglet est prise en charge.

État vérifié le 7 septembre : [recette des stories 2001–2004](docs/recette-auth-2026-09-07.md). Captures desktop/mobile dans `docs/verification`. Pour rejouer le navigateur avec les deux serveurs lancés : `node scripts/check-auth-browser.cjs` avec Playwright disponible via NODE_PATH. Ce script est limité à la base locale `uswap_db`, crée un compte temporaire et le supprime à la fin ; aucun e-mail réel n’est envoyé.

Poppins est embarquée via `@fontsource/poppins` (graisses 400–700) ; aucune requête à Google Fonts n’est nécessaire. Les pictogrammes proviennent de `@phosphor-icons/react`, en style duotone, centralisés dans `src/icons.ts`. Phosphor est une bibliothèque sous licence MIT ; aucun pack payant n’est revendiqué. Le décor de batteries du login est statique. Seuls les indicateurs de chargement tournent, selon la préférence de réduction des mouvements.

La retouche visuelle retire les pieds de page répétitifs et les descriptions redondantes du tableau de bord, agrandit la typographie et les commandes, et conserve les parcours et API existants. Les compteurs réels et les contrôles d’accès sont inchangés. L’application n’est pas encore une PWA installable. Les maquettes indépendantes ne constituent pas des fonctionnalités livrées et ne sont pas actualisées par cette retouche.
