FROM oven/bun:1.3-alpine AS builder
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY packages/ ./packages/
COPY apps/web/ ./apps/web/
RUN bun install
ARG VITE_API_URL
ARG VITE_APP_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_APP_URL=$VITE_APP_URL
RUN cd apps/web && bunx vite build

FROM nginx:alpine AS runner
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
