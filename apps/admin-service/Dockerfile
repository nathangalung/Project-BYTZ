FROM golang:1.25-alpine AS builder
WORKDIR /app
RUN apk add --no-cache ca-certificates
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o admin-service .

FROM alpine:3.21 AS runner
WORKDIR /app
ENV PORT=3006
RUN apk add --no-cache ca-certificates && \
    addgroup -g 1001 -S bytz && adduser -S bytz -u 1001
COPY --from=builder --chown=bytz:bytz /app/admin-service .
USER bytz
EXPOSE 3006
CMD ["./admin-service"]
