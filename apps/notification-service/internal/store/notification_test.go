package store

import (
	"strings"
	"testing"
)

func TestBuildListQueries_NoTypeFilter(t *testing.T) {
	listSQL, countSQL, listArgs, countArgs := buildListQueries("user-1", 20, 0, nil)

	if strings.Contains(listSQL, "type = ANY") {
		t.Errorf("list SQL should not filter by type: %s", listSQL)
	}
	if strings.Contains(countSQL, "type = ANY") {
		t.Errorf("count SQL should not filter by type: %s", countSQL)
	}
	if !strings.Contains(listSQL, "LIMIT $2 OFFSET $3") {
		t.Errorf("list SQL placeholders wrong: %s", listSQL)
	}
	if len(listArgs) != 3 || len(countArgs) != 1 {
		t.Errorf("args = list %d, count %d; want 3, 1", len(listArgs), len(countArgs))
	}
}

func TestBuildListQueries_WithTypeFilter(t *testing.T) {
	types := []string{"payment", "dispute"}
	listSQL, countSQL, listArgs, countArgs := buildListQueries("user-1", 20, 0, types)

	if !strings.Contains(listSQL, "AND type::text = ANY($2)") {
		t.Errorf("list SQL missing type filter: %s", listSQL)
	}
	if !strings.Contains(countSQL, "AND type::text = ANY($2)") {
		t.Errorf("count SQL missing type filter: %s", countSQL)
	}
	if !strings.Contains(listSQL, "LIMIT $3 OFFSET $4") {
		t.Errorf("list SQL placeholders wrong: %s", listSQL)
	}
	if len(listArgs) != 4 || len(countArgs) != 2 {
		t.Errorf("args = list %d, count %d; want 4, 2", len(listArgs), len(countArgs))
	}
}

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

	pr, err := m.FindByUserID(nil, "u", 1, 10, nil)
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
