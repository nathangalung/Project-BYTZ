FROM oven/bun:1.3-alpine AS builder
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/ ./packages/
COPY apps/project-service/ ./apps/project-service/
RUN bun install
RUN cd apps/project-service && bun run build

FROM oven/bun:1.3-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 -S kerjacus && adduser -S kerjacus -u 1001
COPY --from=builder --chown=kerjacus:kerjacus /app/apps/project-service/dist ./dist
# The Temporal worker (docker-compose.prod.yml: project-worker) runs from source:
# Worker.create bundles src/workflows at startup via workflowsPath, and `bun run
# build` emits only the bundled HTTP entrypoint. Without src/ the worker image
# has no worker file and no workflows to bundle.
COPY --from=builder --chown=kerjacus:kerjacus /app/apps/project-service/src ./src
COPY --from=builder --chown=kerjacus:kerjacus /app/node_modules ./node_modules
COPY --from=builder --chown=kerjacus:kerjacus /app/packages ./packages
COPY --from=builder --chown=kerjacus:kerjacus /app/package.json ./
USER kerjacus
EXPOSE 3002
CMD ["bun", "run", "dist/index.js"]
