FROM golang:1.24-alpine AS builder
WORKDIR /app
RUN apk add --no-cache git ca-certificates
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /notification-service .

FROM alpine:3.21 AS runner
RUN apk add --no-cache ca-certificates tzdata
RUN addgroup -g 1001 -S bytz && adduser -S bytz -u 1001
COPY --from=builder --chown=bytz:bytz /notification-service /notification-service
USER bytz
EXPOSE 3005
ENTRYPOINT ["/notification-service"]
