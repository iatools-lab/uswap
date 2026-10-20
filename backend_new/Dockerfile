# syntax=docker/dockerfile:1.7
#
# Image de production de l'API uSwap (NestJS 11 + Prisma 6 + PostgreSQL).
#
# Particularites du projet prises en compte :
#  - compilation via `tsc -p tsconfig.build.json` (script `npm run build`),
#    point d'entree reel : dist/main.js (script `npm start`) ;
#  - Prisma Client genere dans node_modules/.prisma puis dans les dependances
#    `@prisma/client`, avec ses moteurs natifs : les devDependencies sont donc
#    retirees APRES la generation du client, jamais avant ;
#  - aucune migration n'est executee au demarrage : `prisma migrate deploy`
#    fait l'objet d'un service Compose dedie, lance manuellement ;
#  - aucune valeur secrete n'est integree : la configuration arrive par
#    variables d'environnement (voir deploy/.env.example).

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false
# openssl est requis par les moteurs Prisma sous Debian slim.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------- build ----
FROM base AS build
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Ne conserve que les dependances de production, apres generation du client
# Prisma (sinon `npm prune --omit=dev` supprimerait le client genere).
RUN npm prune --omit=dev

# -------------------------------------------------------------- runtime ----
FROM base AS runtime
ENV PORT=3000 \
    UPLOAD_DIR=var/uploads
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# Les migrations sont livrees pour que `prisma migrate deploy` puisse etre joue
# depuis l'image (service Compose `migrate`), jamais automatiquement. Le schema
# est aussi lu au demarrage par Prisma Client (resolution de env(DATABASE_URL)).
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/package.json ./package.json
# Mailer en mode `json` et fichiers temporaires : repertoire inscriptible.
RUN mkdir -p /app/var/mail /app/var/uploads && chown -R node:node /app/var
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/auth/session',{method:'GET'}).then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
