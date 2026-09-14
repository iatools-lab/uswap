from pathlib import Path
import zipfile, hashlib, sys

root=Path(__file__).resolve().parents[1]
backend=root/'uswap-danielle/uswap-danielle'
output=root/'docs/livraison'
output.mkdir(parents=True,exist_ok=True)
sprint2='--sprint2' in sys.argv
archive=output/('uswap-backend-sprint2-en-cours.zip' if sprint2 else 'uswap-backend-sprint1-consolide.zip')
files=[]
for folder in ('src','prisma','test'):
    files.extend(p for p in (backend/folder).rglob('*') if p.is_file() and not p.name.endswith('-results.json'))
for name in ('package.json','package-lock.json','tsconfig.json','tsconfig.build.json','nest-cli.json','eslint.config.mjs','.prettierrc','.gitignore','.env.example','README.md'):
    files.append(backend/name)
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
    for path in sorted(files):
        assert path.name!='.env'
        z.write(path,'uswap-backend/'+path.relative_to(backend).as_posix())
    z.write(root/'docs/comparaison-backend-danielle-2.md','SYNTHESE-COMPARAISON.md')
    z.write(root/'docs/pwa-pagination.md','PAGINATION-PWA.md')
    if sprint2:
        z.write(root/'docs/sprint2-suivi.md','SPRINT2-SUIVI.md')
        z.write(root/'docs/sprint2-convergence.md','SPRINT2-CONVERGENCE.md')
    z.writestr('LIRE-AVANT-INSTALLATION.md', '''# Base backend commune uSwap — Sprint 1

Cette archive contient la version locale consolidée, pas le ZIP reçu de Danielle.
Elle ne contient ni .env réel, ni mots de passe, ni base de données, ni node_modules.

1. Extraire dans un nouveau dossier de travail.
2. Dans uswap-backend, copier .env.example vers .env et renseigner les paramètres localement.
3. Utiliser une nouvelle base PostgreSQL de développement dédiée. Si une base existante contient des données à conserver, préparer une réconciliation avant toute migration.
4. Exécuter npm ci, npx prisma generate, puis npx prisma migrate deploy sur cette base dédiée.
5. Configurer ADMIN_EMAIL et ADMIN_PASSWORD puis npm run seed pour le premier administrateur, si nécessaire.
6. Configurer Gmail SMTP et les origines frontend conformément au README. npm run dev démarre l'API.

Ne pas appliquer simultanément les migrations du ZIP Danielle et celles de cette archive. Aucun reset n'est requis par la livraison. Les tests PostgreSQL utilisent par défaut une base locale nommée uswap_db et des données temporaires.

Le frontend à utiliser est celui du projet uSwap actuel ; consulter SYNTHESE-COMPARAISON.md pour les contrats API. Les liens vers les documents du projet dans le README backend supposent le dépôt complet.

Limite connue : quatre alertes npm liées à la chaîne deepmerge-ts/Prisma restent à arbitrer avant une mise en production. La livraison est validée localement ; aucun déploiement ni envoi d'e-mail n'est réalisé par cette archive.
'''.replace('Base backend commune uSwap — Sprint 1','Base backend commune uSwap — Sprint 2 en cours' if sprint2 else 'Base backend commune uSwap — Sprint 1') + ('\nSprint 2 non terminé. Lire SPRINT2-CONVERGENCE.md pour les stories complètes, partielles et les dépendances restantes. Cette archive remplace uniquement le code après rapprochement des migrations ; elle ne contient ni .env réel ni base de données.\n' if sprint2 else ''))
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    assert not any(Path(n).name=='.env' or 'node_modules' in Path(n).parts for n in z.namelist())
digest=hashlib.sha256(archive.read_bytes()).hexdigest()
archive.with_suffix('.sha256').write_text(digest+'  '+archive.name+'\n')
print(f'{archive.name}: {len(files)} source files, {archive.stat().st_size} bytes, SHA256 {digest}')
