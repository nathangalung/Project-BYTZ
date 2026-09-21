FROM golang:1.26-alpine AS builder
WORKDIR /app
RUN apk add --no-cache git
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /payment-service .

FROM alpine:3.21 AS runner
WORKDIR /app
RUN apk add --no-cache ca-certificates tzdata && \
    addgroup -g 1001 -S kerjacus && adduser -S kerjacus -u 1001
COPY --from=builder --chown=kerjacus:kerjacus /payment-service .
USER kerjacus
EXPOSE 3004
CMD ["./payment-service"]

# Which commit built this image. Until now a running container was identifiable
# only by image digest, which says nothing about the revision behind it, and
# every image is tagged :latest. Declared at the very end so a changed SHA
# invalidates no layer above it.
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.revision=$GIT_SHA
