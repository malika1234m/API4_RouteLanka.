# API service. Build context: repository root.
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @routelanka/api --include-workspace-root=false --ignore-scripts
COPY packages/domain packages/domain
COPY apps/api apps/api
RUN npm run build -w @routelanka/api

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/apps/api/dist ./dist
# dist is one self-contained file (dependencies bundled by tsup): nothing to install here.
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
CMD ["node", "dist/index.js"]
