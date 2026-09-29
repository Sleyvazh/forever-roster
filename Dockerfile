# Image multi-étapes : cibles « api » (Node), « bot » (bot Discord, Node) et « web » (Caddy qui sert le front et fait reverse proxy).

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/game-data/package.json packages/game-data/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/bot/package.json apps/bot/
RUN npm ci --ignore-scripts=false

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
RUN npm run build

# Dépendances de production de l'API uniquement
FROM node:24-alpine AS api-prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/game-data/package.json packages/game-data/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/bot/package.json apps/bot/
RUN npm ci --omit=dev --workspace=@forever/api --include-workspace-root=false

FROM node:24-alpine AS api
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
WORKDIR /app/apps/api
COPY --from=api-prod-deps /app/node_modules /app/node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/drizzle ./drizzle
COPY apps/api/package.json ./
# Utilisateur non privilégié, système de fichiers en lecture seule côté compose
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "dist/server.js"]

# Dépendances de production du bot (discord.js)
FROM node:24-alpine AS bot-prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/game-data/package.json packages/game-data/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/bot/package.json apps/bot/
RUN npm ci --omit=dev --workspace=@forever/bot --include-workspace-root=false

# Bot Discord : aucun port ouvert, il se connecte à Discord (sortant) et à l'API interne.
FROM node:24-alpine AS bot
ENV NODE_ENV=production
WORKDIR /app/apps/bot
COPY --from=bot-prod-deps /app/node_modules /app/node_modules
COPY --from=build /app/apps/bot/dist ./dist
COPY apps/bot/package.json ./
USER node
CMD ["node", "dist/bot.js"]

FROM caddy:2-alpine AS web
COPY infra/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
