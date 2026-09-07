# Maquettes uSwap — Sprint 1

Ouvrir `/maquettes/index.html` sur le serveur du projet (`npm run dev`) ou ouvrir `index.html` directement dans un navigateur. Les fichiers HTML, CSS et JavaScript sont autonomes, sans compilation ; la police Poppins est chargée depuis Google Fonts avec une police de secours.

La barre supérieure permet de sélectionner un écran et de simuler une largeur mobile de 390 px. Sur un téléphone, les écrans s’adaptent naturellement. Les liens, filtres combinés, export CSV des résultats filtrés, exemples d’erreurs, bascules de statut et parcours de formulaires sont interactifs. Aucune donnée n’est envoyée à un serveur ni conservée après rechargement.

## Périmètre

- 2001 : connexion, erreur neutre et lien vers la page React développée.
- 2002 : activation et exemple de lien expiré.
- 2003 : demande de réinitialisation avec réponse neutre, nouveau mot de passe et option de révocation des sessions.
- 2004 : confirmation de déconnexion.
- 2005 : présentation des permissions et accès refusé.
- 2006 : avertissement d’expiration avec exemple de délai (pas un véritable compte à rebours), prolongation et état déconnecté.
- 2007 : création d’un utilisateur.
- 2008 : sélection locale d’un fichier, prévisualisation fictive, modèle CSV et bilan d’import. Le fichier choisi n’est pas analysé.
- 2009 : invitations envoyées, activées, expirées et renvoi simulé.
- 2010–2011 : modification du profil, rôle, historique et désactivation/réactivation simulée.
- 2012 : filtres combinés, état vide et export des résultats visibles. Pagination illustrée sur une seule page.
- 2013–2014 : liste, création, détail, modification et activation/désactivation de station.
- 2015–2018 : paramètres opérationnels et exemples d’erreurs métier.

Les valeurs de paramètres, la politique de mot de passe, les permissions détaillées et la semaine de référence restent à confirmer avec le métier et le backend. Les fonctions de planning mentionnées dans les permissions sont contextuelles ; aucun écran de planning hors périmètre n’a été ajouté.

Ce dossier contient des propositions visuelles. Il ne constitue ni une implémentation des règles de sécurité et des API, ni une validation des critères d’acceptation ou de la Definition of Done. Les mutations affichent une simulation et ne persistent pas. Les profils et stations sont des exemples de mise en page, non des dossiers individuels réels.
