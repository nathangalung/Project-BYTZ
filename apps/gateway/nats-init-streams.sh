#!/bin/sh
# Create NATS JetStream streams for KerjaCUS!
# Run after NATS is ready

NATS_URL="${NATS_URL:-nats://nats:4222}"

echo "Waiting for NATS to be ready..."
sleep 5

echo "Creating JetStream streams..."

# Common flags (avoid interactive prompts; older nats CLI ignores --defaults for stream add)
UNL="--max-msgs=-1 --max-msg-size=-1 --max-consumers=-1 --max-msgs-per-subject=-1"
COMMON="--retention limits --storage file --replicas 1 --discard old $UNL"

nats -s "$NATS_URL" stream add PROJECT_EVENTS \
  --subjects "project.>" --max-bytes=10GB --max-age=720h --dupe-window 2m \
  --no-allow-rollup --deny-delete --deny-purge $COMMON || true

nats -s "$NATS_URL" stream add PAYMENT_EVENTS \
  --subjects "payment.>" --max-bytes=5GB --max-age=2160h --dupe-window 2m \
  --no-allow-rollup --no-deny-delete --no-deny-purge $COMMON || true

nats -s "$NATS_URL" stream add TALENT_EVENTS \
  --subjects "talent.>" --max-bytes=5GB --max-age=720h --dupe-window 2m \
  --no-allow-rollup --no-deny-delete --no-deny-purge $COMMON || true

nats -s "$NATS_URL" stream add MILESTONE_EVENTS \
  --subjects "milestone.>" --max-bytes=5GB --max-age=720h --dupe-window 2m \
  --no-allow-rollup --no-deny-delete --no-deny-purge $COMMON || true

nats -s "$NATS_URL" stream add CHAT_EVENTS \
  --subjects "chat.>" --max-bytes=10GB --max-age=168h --dupe-window 2m \
  --no-allow-rollup --no-deny-delete --no-deny-purge $COMMON || true

nats -s "$NATS_URL" stream add AI_EVENTS \
  --subjects "ai.>" --max-bytes=5GB --max-age=336h --dupe-window 2m \
  --no-allow-rollup --no-deny-delete --no-deny-purge $COMMON || true

nats -s "$NATS_URL" stream add SYSTEM_EVENTS \
  --subjects "notification.>,admin.>" --max-bytes=2GB --max-age=336h --dupe-window 2m \
  --no-allow-rollup --no-deny-delete --no-deny-purge $COMMON || true

nats -s "$NATS_URL" stream add DLQ \
  --subjects "dlq.>" --max-bytes=1GB --max-age=2160h --dupe-window 2m \
  --no-allow-rollup --no-deny-delete --no-deny-purge $COMMON || true

echo ""
echo "Streams:"
nats -s "$NATS_URL" stream ls
