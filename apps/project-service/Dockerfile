# glibc base: Temporal bridge is native.
# Alpine musl cannot load its .node binary.
FROM oven/bun:1.3-slim AS builder
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/ ./packages/
COPY apps/project-service/ ./apps/project-service/
RUN bun install
# Set before the bundle step, not only in the runner. bun build substitutes the
# dotted process.env.NODE_ENV, so bundling without this bakes in the wrong
# value for any code that still reads it that way.
ENV NODE_ENV=production
RUN cd apps/project-service && bun run build

FROM oven/bun:1.3-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN groupadd -g 1001 kerjacus && useradd -u 1001 -g kerjacus -m -s /bin/sh kerjacus
COPY --from=builder --chown=kerjacus:kerjacus /app/node_modules ./node_modules
COPY --from=builder --chown=kerjacus:kerjacus /app/packages ./packages
COPY --from=builder --chown=kerjacus:kerjacus /app/package.json ./
# Keep workspace path for resolution.
# Worker runs unbundled from source.
COPY --from=builder --chown=kerjacus:kerjacus /app/apps/project-service ./apps/project-service
USER kerjacus
WORKDIR /app/apps/project-service
EXPOSE 3002
CMD ["bun", "run", "dist/index.js"]
