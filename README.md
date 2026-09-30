# uSwap — frontend Dylane V0

Cette branche contient le frontend seul. L'application est dans `frontend/` ;
aucun code backend ni schéma de base de données n'est inclus.

## Lancer l'application fictive

```powershell
cd frontend
npm ci
npm run dev
```

Sans `VITE_API_URL`, l'interface utilise les données mockées. Pour produire le
build de vérification :

```powershell
npm run build
```

## Base et compatibilité

L'interface Dylane avant le sprint 5 constitue la version visible de cette
branche. L'authentification et la session V0 ont été gardées pour faciliter un
raccord futur au backend de Danielle. Le backend est maintenu dans sa branche ;
cette branche ne le modifie pas.

Les contrats à vérifier avant le branchement sont décrits dans
[`docs/FRONTEND-DYLANE-INTEGRATION.md`](docs/FRONTEND-DYLANE-INTEGRATION.md).
