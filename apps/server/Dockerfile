FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/tools/package.json packages/tools/package.json
COPY packages/liveauth/package.json packages/liveauth/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --no-frozen-lockfile
COPY apps/server apps/server
COPY packages packages
RUN pnpm --filter @invokeworks/server... build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
RUN addgroup -S invoke && adduser -S invoke -G invoke
COPY --from=build --chown=invoke:invoke /app/node_modules ./node_modules
COPY --from=build --chown=invoke:invoke /app/apps/server/dist ./apps/server/dist
COPY --from=build --chown=invoke:invoke /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build --chown=invoke:invoke /app/packages ./packages
USER invoke
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "apps/server/dist/index.js"]
