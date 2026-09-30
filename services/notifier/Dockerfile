# Notifier worker. Build context: repository root.
FROM node:20-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/
COPY services/notifier/package.json services/notifier/
RUN npm ci --workspace @routelanka/notifier --include-workspace-root=false --ignore-scripts
COPY packages/domain packages/domain
COPY services/notifier services/notifier
RUN npm run build -w @routelanka/notifier

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/services/notifier/dist ./dist
COPY services/notifier/package.json ./
# The domain package is bundled into dist; install only the runtime dependencies.
RUN node -e "const p=require('./package.json');delete p.devDependencies;require('fs').writeFileSync('package.json',JSON.stringify(p))" \
 && npm install --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
USER node
CMD ["node", "dist/index.js"]
