FROM oven/bun:1.3-alpine AS builder
WORKDIR /app
COPY package.json bun.lock ./
# Every workspace manifest the lockfile describes, before the install.
# bun resolves the whole workspace graph, so a context carrying only this
# service makes --frozen-lockfile fail with "lockfile had changes" even though
# the lockfile is current. Manifests only, so a source edit in another app does
# not invalidate this layer.
COPY apps/admin/package.json ./apps/admin/
COPY apps/auth-service/package.json ./apps/auth-service/
COPY apps/project-service/package.json ./apps/project-service/
COPY apps/web/package.json ./apps/web/
COPY packages/ ./packages/
COPY apps/auth-service/ ./apps/auth-service/
RUN bun install --frozen-lockfile
# Set before the bundle step, not only in the runner. bun build substitutes the
# dotted process.env.NODE_ENV, so bundling without this bakes in the wrong
# value for any code that still reads it that way.
ENV NODE_ENV=production
RUN cd apps/auth-service && bun run build

FROM oven/bun:1.3-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 -S kerjacus && adduser -S kerjacus -u 1001
COPY --from=builder --chown=kerjacus:kerjacus /app/apps/auth-service/dist ./dist
COPY --from=builder --chown=kerjacus:kerjacus /app/node_modules ./node_modules
COPY --from=builder --chown=kerjacus:kerjacus /app/packages ./packages
COPY --from=builder --chown=kerjacus:kerjacus /app/package.json ./
USER kerjacus
EXPOSE 3001
CMD ["bun", "run", "dist/index.js"]
