# WhatsApp Cloud API simulator. Build context: repository root.
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/
COPY services/wa-sim/package.json services/wa-sim/
RUN npm ci --workspace @routelanka/wa-sim --include-workspace-root=false --ignore-scripts
COPY packages/domain packages/domain
COPY services/wa-sim services/wa-sim
RUN npm run build -w @routelanka/wa-sim

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/services/wa-sim/dist ./dist
# dist is one self-contained file (dependencies bundled by tsup): nothing to install here.
USER node
EXPOSE 3200
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:3200/health || exit 1
CMD ["node", "dist/index.js"]
