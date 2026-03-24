package store

import "testing"

func TestIsValidType(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  bool
	}{
		{"project_match", "project_match", true},
		{"application_update", "application_update", true},
		{"milestone_update", "milestone_update", true},
		{"payment", "payment", true},
		{"dispute", "dispute", true},
		{"team_formation", "team_formation", true},
		{"assignment_offer", "assignment_offer", true},
		{"system", "system", true},
		{"invalid", "invalid_type", false},
		{"empty", "", false},
		{"random", "foobar", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsValidType(tt.input)
			if got != tt.want {
				t.Errorf("IsValidType(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}

func TestNotificationType_Constants(t *testing.T) {
	types := map[NotificationType]string{
		TypeProjectMatch:      "project_match",
		TypeApplicationUpdate: "application_update",
		TypeMilestoneUpdate:   "milestone_update",
		TypePayment:           "payment",
		TypeDispute:           "dispute",
		TypeTeamFormation:     "team_formation",
		TypeAssignmentOffer:   "assignment_offer",
		TypeSystem:            "system",
	}

	for typ, want := range types {
		if string(typ) != want {
			t.Errorf("type %q != expected %q", string(typ), want)
		}
	}
}

func TestMockStore_DefaultReturns(t *testing.T) {
	m := &MockStore{}

	n, err := m.Create(nil, CreateInput{})
	if n != nil || err != nil {
		t.Errorf("Create defaults: got (%v, %v)", n, err)
	}

	pr, err := m.FindByUserID(nil, "u", 1, 10)
	if pr != nil || err != nil {
		t.Errorf("FindByUserID defaults: got (%v, %v)", pr, err)
	}

	n, err = m.FindByID(nil, "id", "uid")
	if n != nil || err != nil {
		t.Errorf("FindByID defaults: got (%v, %v)", n, err)
	}

	n, err = m.MarkAsRead(nil, "id")
	if n != nil || err != nil {
		t.Errorf("MarkAsRead defaults: got (%v, %v)", n, err)
	}

	cnt, err := m.MarkAllAsRead(nil, "uid")
	if cnt != 0 || err != nil {
		t.Errorf("MarkAllAsRead defaults: got (%v, %v)", cnt, err)
	}

	cnt, err = m.CountUnread(nil, "uid")
	if cnt != 0 || err != nil {
		t.Errorf("CountUnread defaults: got (%v, %v)", cnt, err)
	}
}
