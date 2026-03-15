# Stage 1: Install dependencies
FROM oven/bun:1.3-alpine AS deps
WORKDIR /app
COPY package.json bun.lockb ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/logger/package.json ./packages/logger/
COPY packages/config/package.json ./packages/config/
COPY packages/nats-events/package.json ./packages/nats-events/
COPY apps/auth-service/package.json ./apps/auth-service/
RUN bun install --frozen-lockfile --production

# Stage 2: Build
FROM oven/bun:1.3-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN cd apps/auth-service && bun run build

# Stage 3: Production
FROM oven/bun:1.3-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 -S bytz && adduser -S bytz -u 1001
COPY --from=builder --chown=bytz:bytz /app/apps/auth-service/dist ./dist
COPY --from=deps --chown=bytz:bytz /app/node_modules ./node_modules
USER bytz
EXPOSE 3001
CMD ["bun", "run", "dist/index.js"]
