# Build: 2026-03-26 same-origin API proxy
FROM oven/bun:1.3-alpine AS builder
WORKDIR /app
# vitest.shared.ts is imported by vite.config.ts, so the production
# build needs it even though it only configures tests. Missing, the
# build fails at config load with an unresolved import.
COPY package.json bun.lock tsconfig.json vitest.shared.ts ./
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
COPY apps/web/ ./apps/web/
RUN bun install --frozen-lockfile
ARG VITE_API_URL
ARG VITE_APP_URL
ARG VITE_CENTRIFUGO_URL
ARG VITE_MIDTRANS_CLIENT_KEY
ARG VITE_MIDTRANS_IS_SANDBOX
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_APP_URL=$VITE_APP_URL
ENV VITE_CENTRIFUGO_URL=$VITE_CENTRIFUGO_URL
ENV VITE_MIDTRANS_CLIENT_KEY=$VITE_MIDTRANS_CLIENT_KEY
ENV VITE_MIDTRANS_IS_SANDBOX=$VITE_MIDTRANS_IS_SANDBOX
RUN cd apps/web && bunx vite build

FROM nginx:alpine AS runner
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
