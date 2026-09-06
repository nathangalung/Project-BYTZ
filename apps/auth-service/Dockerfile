FROM oven/bun:1.3-alpine AS builder
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/ ./packages/
COPY apps/auth-service/ ./apps/auth-service/
RUN bun install
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
