# Notifier worker. Build context: repository root.
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/
COPY services/notifier/package.json services/notifier/
RUN npm ci --workspace @routelanka/notifier --include-workspace-root=false --ignore-scripts
COPY packages/domain packages/domain
COPY services/notifier services/notifier
RUN npm run build -w @routelanka/notifier

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/services/notifier/dist ./dist
# dist is one self-contained file (dependencies bundled by tsup): nothing to install here.
USER node
CMD ["node", "dist/index.js"]
