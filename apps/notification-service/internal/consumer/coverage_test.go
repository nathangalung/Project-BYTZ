package consumer

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// Events published with no handler here are dropped.
//
// The consumer's default branch returns nil, so an event nobody handles is
// acked and discarded. Adding a subject to packages/nats-events without a
// handler is therefore silent. This test makes it loud: anything published but
// unhandled must be listed below, on purpose.
// Consumed by a service other than this one, so no notification is due.
var handledElsewhere = map[string]bool{
	// ai-service nats_consumer, builds the pgvector embeddings.
	"ai.brd.embed_requested": true,
	"ai.prd.embed_requested": true,
	// project-service invoice-consumer, renders the milestone invoice.
	"milestone.invoice_requested": true,
}

// Published, delivered here, and dropped by the consumer default.
//
// The entries below the first group are events the notification catalog in
// CLAUDE.md says should reach a user and that nothing yet turns into a
// notification row or an email. They are listed rather than handled so the
// gap is visible and can be prioritised, not so it is settled.
var knowinglyUnhandled = map[string]bool{
	"project.created":                      true,
	"project.cancelled":                    true,
	"project.disputed":                     true,
	"project.on_hold":                      true,
	"project.resumed":                      true,
	"project.team.forming":                 true,
	"project.team.talent_assigned":         true,
	"project.team.talent_replaced":         true,
	"payment.escrow.created":               true,
	"payment.refunded":                     true,
	"payment.partial_refund":               true,
	"payment.revision_fee.charged":         true,
	"payment.talent_placement_fee.charged": true,
	"payment.gateway.webhook_received":     true,
	"talent.registered":                    true,
	"talent.verified":                      true,
	"talent.suspended":                     true,
	"talent.unsuspended":                   true,
	"talent.assignment.accepted":           true,
	"talent.assignment.declined":           true,
	"milestone.dependency.blocked":         true,
	"chat.bypass_detected":                 true,
	"ai.brd.generated":                     true,
	"ai.prd.generated":                     true,
	"ai.cv.parsed":                         true,
	"ai.matching.completed":                true,
	"admin.action.performed":               true,
	// Talents are warned and penalised with no notification.
	"talent.inactive_warning":  true,
	"talent.abandon_penalized": true,

	// Catalog says notify, nothing does yet.
	"application.created":            true,
	"contract.created":               true,
	"contract.signed":                true,
	"contract.fully_executed":        true,
	"dispute.created":                true,
	"dispute.status_changed":         true,
	"dispute.resolved":               true,
	"review.created":                 true,
	"talent_placement.requested":     true,
	"talent_placement.in_discussion": true,
	"talent_placement.accepted":      true,
	"talent_placement.declined":      true,
	"talent_placement.completed":     true,
	"project.team.escalated":         true,

	// Internal state changes with no user-facing meaning.
	"application.status.pending":   true,
	"application.status.withdrawn": true,
	"dispute.phase.direct":         true,
	"dispute.phase.mediation":      true,
	"dispute.phase.binding":        true,
	"milestone.created":            true,
	"work_package.created":         true,
	"work_package.status_changed":  true,
	"time_log.created":             true,
	"time_log.stopped":             true,
	"talent.availability_changed":  true,
}

func repoRoot(t *testing.T) string {
	t.Helper()
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatalf("resolve repo root: %v", err)
	}
	return root
}

func publishedSubjects(t *testing.T) []string {
	t.Helper()
	path := filepath.Join(repoRoot(t), "packages/nats-events/src/subjects.ts")
	src, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}

	re := regexp.MustCompile(`:\s*'([a-z_]+(?:\.[a-z_]+)+)'`)
	var out []string
	for _, m := range re.FindAllStringSubmatch(string(src), -1) {
		if !strings.HasPrefix(m[1], "dlq.") {
			out = append(out, m[1])
		}
	}
	return out
}

func handledSubjects(t *testing.T) map[string]bool {
	t.Helper()
	path := filepath.Join(repoRoot(t), "apps/notification-service/internal/consumer/nats.go")
	src, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}

	re := regexp.MustCompile(`case "([a-z_]+(?:\.[a-z_]+)+)":`)
	handled := map[string]bool{}
	for _, m := range re.FindAllStringSubmatch(string(src), -1) {
		handled[m[1]] = true
	}
	return handled
}

func TestEveryPublishedSubjectIsHandledOrListed(t *testing.T) {
	published := publishedSubjects(t)
	if len(published) == 0 {
		t.Fatal("parsed no subjects; the catalog format changed")
	}
	handled := handledSubjects(t)

	var undocumented []string
	for _, subject := range published {
		if !handled[subject] && !knowinglyUnhandled[subject] && !handledElsewhere[subject] {
			undocumented = append(undocumented, subject)
		}
	}

	sort.Strings(undocumented)
	if len(undocumented) > 0 {
		t.Errorf("published with no handler and not listed as knowingly unhandled: %v", undocumented)
	}
}

// A listed subject that gained a handler should leave the list.
func TestUnhandledListHasNoStaleEntries(t *testing.T) {
	handled := handledSubjects(t)

	var stale []string
	for subject := range knowinglyUnhandled {
		if handled[subject] {
			stale = append(stale, subject)
		}
	}

	sort.Strings(stale)
	if len(stale) > 0 {
		t.Errorf("now handled, remove from knowinglyUnhandled: %v", stale)
	}
}

// Auto-release must notify, the timer moves money.
func TestMilestoneAutoReleasedIsHandled(t *testing.T) {
	if !handledSubjects(t)["milestone.auto_released"] {
		t.Error("milestone.auto_released has no handler; the 14-day payout would be silent")
	}
}
