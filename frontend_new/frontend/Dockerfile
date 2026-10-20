# syntax=docker/dockerfile:1.7
#
# Image de production du frontend uSwap (React 19 + Vite 6).
#
# - Build statique : `npm run build` (tsc -b && vite build) -> dist/
# - Servi par Nginx, qui assure aussi le routage SPA (BrowserRouter) et le
#   proxy /api -> backend NestJS.
# - VITE_API_URL est OBLIGATOIRE a la construction : dans le code,
#   `usingMock = !VITE_API_URL` (src/api/auth-api.ts). Une image construite
#   sans cette variable utiliserait la maquette locale au lieu de l'API.
#   Seule une valeur publique peut transiter ici : tout VITE_* est integre
#   au JavaScript livre au navigateur.

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false
# Vite charge TOUS les .env* de sa racine, pas seulement le mode courant :
# un .env de developpement copie par erreur l'emporterait sur .env.production.
# Le .dockerignore l'exclut deja, on echoue explicitement plutot que de deviner.
RUN test ! -e .env
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src

# Vite lit les variables VITE_* depuis les fichiers .env de sa racine de
# projet (nouvelle recherche confirmee lors du build local). On ecrit donc
# .env.production, dont la lecture est verifiee : les valeurs finissent dans
# le JavaScript public, aucun secret ne peut y figurer.
# Le contexte limite est ../frontend_new/frontend, donc aucun .env local ne
# peut entrer dans l'image.
ARG VITE_API_URL=/api
ARG VITE_VAPID_PUBLIC_KEY=
RUN test -n "$VITE_API_URL" \
 && printf 'VITE_API_URL=%s\nVITE_VAPID_PUBLIC_KEY=%s\n' \
      "$VITE_API_URL" "$VITE_VAPID_PUBLIC_KEY" > .env.production \
 && npm run build

FROM nginx:1.27-alpine AS runtime
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
