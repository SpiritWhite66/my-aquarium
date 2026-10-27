# Contexte de construction : la racine du dépôt (docker build -f api/Dockerfile .)
FROM node:26-slim AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.node.json ./
COPY shared/package.json shared/
COPY api/package.json api/
RUN npm ci --workspace shared --workspace api --ignore-scripts
COPY shared shared
COPY api api
RUN npm run build -w shared && npm run build -w api

FROM node:26-slim AS prod-deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY api/package.json api/
RUN npm ci --workspace shared --workspace api --omit=dev --ignore-scripts

FROM node:26-slim
ENV NODE_ENV=production
WORKDIR /repo
# npm et npx ne servent pas à l'exécution : moins de surface d'attaque, moins de failles à suivre.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --from=prod-deps /repo/node_modules node_modules
COPY --from=build /repo/shared/package.json shared/package.json
COPY --from=build /repo/shared/dist shared/dist
COPY --from=build /repo/api/package.json api/package.json
COPY --from=build /repo/api/dist api/dist
COPY --from=build /repo/api/drizzle api/drizzle
USER node
EXPOSE 3000
CMD ["node", "api/dist/server.js"]
