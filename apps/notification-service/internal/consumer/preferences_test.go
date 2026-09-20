package consumer

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/kerjacus/notification-service/internal/store"
)

/*
 * The toggles on the settings page used to persist nowhere and gate nothing.
 * They now sit in user_notification_preferences, and this is the only place
 * that decides whether a row turns into an email or a push.
 *
 * Every case here fails open on purpose: a lookup that breaks, or a user who
 * has never opened settings, must still be told. The one direction worth
 * losing sleep over is the silent one, so the DB-error case asserts that a
 * blip does not mute the account.
 */

// prefQuerier answers resolveRecipient with a fixed address and toggle set.
type prefQuerier struct {
	email string
	// nil leaves resolveRecipient's own seeds standing, the way a driver that
	// does not know the columns would.
	bools []bool
	err   error
}

func (q prefQuerier) QueryRow(context.Context, string, ...any) pgx.Row {
	return fakeRow{value: q.email, bools: q.bools, err: q.err}
}

func TestDeliver_RespectsNotificationPreferences(t *testing.T) {
	const userID = "user-1"
	// email_notifications, project_updates, payment_alerts.
	allOn := []bool{true, true, true}

	tests := []struct {
		name      string
		bools     []bool
		queryErr  error
		notifType store.NotificationType
		wantEmail bool
		wantPush  bool
	}{
		{
			name:      "every toggle on delivers both channels",
			bools:     allOn,
			notifType: store.TypeMilestoneUpdate,
			wantEmail: true,
			wantPush:  true,
		},
		{
			name:      "email off keeps the push but drops the mail",
			bools:     []bool{false, true, true},
			notifType: store.TypeMilestoneUpdate,
			wantEmail: false,
			wantPush:  true,
		},
		{
			name:      "project updates off silences a milestone on both channels",
			bools:     []bool{true, false, true},
			notifType: store.TypeMilestoneUpdate,
			wantEmail: false,
			wantPush:  false,
		},
		{
			name:      "project updates off does not touch a payment",
			bools:     []bool{true, false, true},
			notifType: store.TypePayment,
			wantEmail: true,
			wantPush:  true,
		},
		{
			name:      "payment alerts off silences a payment",
			bools:     []bool{true, true, false},
			notifType: store.TypePayment,
			wantEmail: false,
			wantPush:  false,
		},
		{
			name:      "payment alerts off does not touch a project match",
			bools:     []bool{true, true, false},
			notifType: store.TypeProjectMatch,
			wantEmail: true,
			wantPush:  true,
		},
		{
			name:      "a type with no toggle is delivered whatever is off",
			bools:     []bool{true, false, false},
			notifType: store.TypeDispute,
			wantEmail: true,
			wantPush:  true,
		},
		{
			// The account has no preferences row yet; the LEFT JOIN coalesces
			// to true and the fake leaves the seeds standing.
			name:      "an account with no preferences row is told everything",
			bools:     nil,
			notifType: store.TypePayment,
			wantEmail: true,
			wantPush:  true,
		},
		{
			// Fail open. A dropped connection must not read as consent
			// withdrawn, which is the failure nobody would ever report.
			name:      "a failed lookup delivers rather than mutes",
			queryErr:  errors.New("connection reset"),
			notifType: store.TypePayment,
			wantEmail: false, // no address came back, so no mail is possible
			wantPush:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			email := &recordingEmail{}
			channels := &recordingChannels{}
			st := &countingStore{}
			c := &Consumer{
				store:      st,
				db:         prefQuerier{email: "rina@kerjacus.id", bools: tt.bools, err: tt.queryErr},
				email:      email,
				centrifugo: channels,
			}

			err := c.createAndDeliverRaw(context.Background(), userID, tt.notifType,
				"Judul", "Pesan", nil, []string{"in_app", "email"})
			if err != nil {
				t.Fatalf("createAndDeliverRaw: %v", err)
			}

			// The row is always written: the toggles govern interruption, not
			// the history the notification list reads.
			if st.createCount() != 1 {
				t.Errorf("rows created = %d, want 1", st.createCount())
			}
			if got := email.count() > 0; got != tt.wantEmail {
				t.Errorf("email sent = %v, want %v", got, tt.wantEmail)
			}
			if got := len(channels.users) > 0; got != tt.wantPush {
				t.Errorf("push sent = %v, want %v", got, tt.wantPush)
			}
		})
	}
}

// A failed lookup must hand back the permissive set, not the zero value. The
// struct's zero value is every toggle off, so the error path is one forgotten
// line away from muting every account whenever the database hiccups.
func TestResolveRecipient_FailedLookupKeepsEveryToggleOn(t *testing.T) {
	c := &Consumer{db: prefQuerier{err: errors.New("connection reset")}}

	who := c.resolveRecipient(context.Background(), "user-1")

	if who.prefs != allPrefsOn() {
		t.Errorf("prefs = %+v, want every toggle on", who.prefs)
	}
}

func TestResolveRecipient_ReadsTheStoredToggles(t *testing.T) {
	c := &Consumer{db: prefQuerier{email: "a@b.id", bools: []bool{false, true, false}}}

	who := c.resolveRecipient(context.Background(), "user-1")

	want := prefs{email: false, projectUpdates: true, paymentAlerts: false}
	if who.prefs != want {
		t.Errorf("prefs = %+v, want %+v", who.prefs, want)
	}
	if who.email != "a@b.id" {
		t.Errorf("email = %q, want a@b.id", who.email)
	}
}

// The map from notification type to toggle, stated once so a type added to the
// catalog without a decision here shows up as a deliberate default rather than
// as silence.
func TestPrefsAllows(t *testing.T) {
	off := prefs{}

	tests := []struct {
		notifType store.NotificationType
		want      bool
	}{
		{store.TypeProjectMatch, false},
		{store.TypeApplicationUpdate, false},
		{store.TypeMilestoneUpdate, false},
		{store.TypePayment, false},
		{store.TypeDispute, true},
		{store.TypeTeamFormation, true},
		{store.TypeAssignmentOffer, true},
		{store.TypeSystem, true},
	}

	for _, tt := range tests {
		t.Run(string(tt.notifType), func(t *testing.T) {
			if got := off.allows(tt.notifType); got != tt.want {
				t.Errorf("allows(%s) with every toggle off = %v, want %v",
					tt.notifType, got, tt.want)
			}
		})
	}

	for _, tt := range tests {
		if !allPrefsOn().allows(tt.notifType) {
			t.Errorf("allows(%s) with every toggle on = false, want true", tt.notifType)
		}
	}
}
