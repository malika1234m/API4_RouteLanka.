# API service. Build context: repository root.
FROM node:20-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @routelanka/api --include-workspace-root=false --ignore-scripts
COPY packages/domain packages/domain
COPY apps/api apps/api
RUN npm run build -w @routelanka/api

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/apps/api/dist ./dist
COPY apps/api/package.json ./
# The domain package is bundled into dist; install only the runtime dependencies.
RUN node -e "const p=require('./package.json');delete p.devDependencies;require('fs').writeFileSync('package.json',JSON.stringify(p))" \
 && npm install --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://localhost:4000/api/health || exit 1
CMD ["node", "dist/index.js"]
