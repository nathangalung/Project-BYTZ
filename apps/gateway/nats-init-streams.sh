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

# Create the stream, or sync its subject list if it already exists.
#
# Every call used to end in `|| true`, which hid two separate things: a stream
# that already existed kept whatever subjects it was first created with, so a
# subject change never reached a running environment; and a genuine failure was
# indistinguishable from "already there".
#
# That mattered because 12 event types were published to subjects no stream
# captured. The outbox worker publishes via JetStream (outbox-worker.ts), which
# errors when no stream matches the subject, so those events retried three times
# and dead-lettered instead of ever reaching a consumer.
ensure_stream() {
  name=$1
  subjects=$2
  shift 2

  if nats -s "$NATS_URL" stream info "$name" >/dev/null 2>&1; then
    if nats -s "$NATS_URL" stream update "$name" --subjects "$subjects" -f >/dev/null 2>&1; then
      echo "  $name: subjects synced"
    else
      echo "  WARNING: $name exists but subjects could not be updated to: $subjects"
    fi
  else
    # shellcheck disable=SC2086
    if nats -s "$NATS_URL" stream add "$name" --subjects "$subjects" "$@" $COMMON >/dev/null 2>&1; then
      echo "  $name: created"
    else
      echo "  ERROR: failed to create $name"
    fi
  fi
}

# project.> alone left application / contract / work_package / review / dispute /
# time_log events homeless. They are all project-lifecycle events, so they share
# PROJECT_EVENTS' retention rather than each getting a stream.
ensure_stream PROJECT_EVENTS \
  "project.>,application.>,contract.>,work_package.>,review.>,dispute.>,time_log.>" \
  --max-bytes=10GB --max-age=720h --dupe-window 2m \
  --no-allow-rollup --deny-delete --deny-purge

ensure_stream PAYMENT_EVENTS "payment.>" \
  --max-bytes=5GB --max-age=2160h --dupe-window 2m \
  --no-allow-rollup --no-deny-delete --no-deny-purge

# talent_placement.> is a distinct subject token from talent.> - NATS matches
# whole dot-separated tokens, so `talent.>` never captured it.
ensure_stream TALENT_EVENTS "talent.>,talent_placement.>" \
  --max-bytes=5GB --max-age=720h --dupe-window 2m \
  --no-allow-rollup --no-deny-delete --no-deny-purge

ensure_stream MILESTONE_EVENTS "milestone.>" \
  --max-bytes=5GB --max-age=720h --dupe-window 2m \
  --no-allow-rollup --no-deny-delete --no-deny-purge

ensure_stream CHAT_EVENTS "chat.>" \
  --max-bytes=10GB --max-age=168h --dupe-window 2m \
  --no-allow-rollup --no-deny-delete --no-deny-purge

ensure_stream AI_EVENTS "ai.>" \
  --max-bytes=5GB --max-age=336h --dupe-window 2m \
  --no-allow-rollup --no-deny-delete --no-deny-purge

ensure_stream SYSTEM_EVENTS "notification.>,admin.>" \
  --max-bytes=2GB --max-age=336h --dupe-window 2m \
  --no-allow-rollup --no-deny-delete --no-deny-purge

ensure_stream DLQ "dlq.>" \
  --max-bytes=1GB --max-age=2160h --dupe-window 2m \
  --no-allow-rollup --no-deny-delete --no-deny-purge

echo ""
echo "Streams:"
nats -s "$NATS_URL" stream ls
