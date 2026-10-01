# Web app (Next.js standalone). Build context: repository root.
FROM node:20-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace web --include-workspace-root=false --ignore-scripts
# The lockfile is written on macOS, so npm leaves out the Linux builds of Tailwind's native
# CSS tools (npm/cli#4828). Add the ones for this machine, at the locked versions.
RUN ARCH=$(node -p "process.arch") && cd apps/web && \
    npm install --no-save --ignore-scripts --no-package-lock \
      lightningcss-linux-$ARCH-musl@$(node -p "require('lightningcss/package.json').version") \
      @tailwindcss/oxide-linux-$ARCH-musl@$(node -p "require('@tailwindcss/oxide/package.json').version")
COPY packages/domain packages/domain
COPY apps/web apps/web
ENV NEXT_TELEMETRY_DISABLED=1
# The /api rewrite target is fixed at build time.
ARG API_URL=http://api:4000
ENV API_URL=$API_URL
RUN npm run build -w web

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
