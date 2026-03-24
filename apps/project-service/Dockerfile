FROM oven/bun:1.3-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/logger/package.json ./packages/logger/
COPY packages/config/package.json ./packages/config/
COPY packages/nats-events/package.json ./packages/nats-events/
COPY apps/project-service/package.json ./apps/project-service/
RUN bun install

FROM oven/bun:1.3-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY packages/ ./packages/
COPY apps/project-service/ ./apps/project-service/
COPY package.json bun.lock tsconfig.json ./
RUN cd apps/project-service && bun run build

FROM oven/bun:1.3-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 -S bytz && adduser -S bytz -u 1001
COPY --from=builder --chown=bytz:bytz /app/apps/project-service/dist ./dist
COPY --from=deps --chown=bytz:bytz /app/node_modules ./node_modules
COPY --from=builder --chown=bytz:bytz /app/packages ./packages
USER bytz
EXPOSE 3002
CMD ["bun", "run", "dist/index.js"]
