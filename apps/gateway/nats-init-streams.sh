#!/bin/sh
# Create NATS JetStream streams for KerjaCUS!
# Run after NATS is ready

set -e

NATS_URL="${NATS_URL:-nats://nats:4222}"

echo "Waiting for NATS to be ready..."
sleep 5

echo "Creating JetStream streams..."

nats -s "$NATS_URL" stream add PROJECT_EVENTS \
  --subjects "project.>" \
  --retention limits --max-bytes 10737418240 --max-age 720h \
  --storage file --replicas 1 --discard old \
  --dupe-window 2m --no-allow-rollup --deny-delete --deny-purge 2>/dev/null || true

nats -s "$NATS_URL" stream add PAYMENT_EVENTS \
  --subjects "payment.>" \
  --retention limits --max-bytes 5368709120 --max-age 2160h \
  --storage file --replicas 1 --discard old \
  --max-deliver 5 --dupe-window 2m 2>/dev/null || true

nats -s "$NATS_URL" stream add WORKER_EVENTS \
  --subjects "worker.>" \
  --retention limits --max-bytes 5368709120 --max-age 720h \
  --storage file --replicas 1 --discard old \
  --dupe-window 2m 2>/dev/null || true

nats -s "$NATS_URL" stream add MILESTONE_EVENTS \
  --subjects "milestone.>" \
  --retention limits --max-bytes 5368709120 --max-age 720h \
  --storage file --replicas 1 --discard old \
  --dupe-window 2m 2>/dev/null || true

nats -s "$NATS_URL" stream add CHAT_EVENTS \
  --subjects "chat.>" \
  --retention limits --max-bytes 10737418240 --max-age 168h \
  --storage file --replicas 1 --discard old \
  --dupe-window 2m 2>/dev/null || true

nats -s "$NATS_URL" stream add AI_EVENTS \
  --subjects "ai.>" \
  --retention limits --max-bytes 5368709120 --max-age 336h \
  --storage file --replicas 1 --discard old \
  --dupe-window 2m 2>/dev/null || true

nats -s "$NATS_URL" stream add SYSTEM_EVENTS \
  --subjects "notification.>,admin.>" \
  --retention limits --max-bytes 2147483648 --max-age 336h \
  --storage file --replicas 1 --discard old \
  --dupe-window 2m 2>/dev/null || true

nats -s "$NATS_URL" stream add DLQ \
  --subjects "dlq.>" \
  --retention limits --max-bytes 1073741824 --max-age 2160h \
  --storage file --replicas 1 --discard old 2>/dev/null || true

echo "All JetStream streams created successfully!"
nats -s "$NATS_URL" stream ls
