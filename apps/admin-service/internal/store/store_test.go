package store

import (
	"encoding/json"
	"testing"
)

func TestItoa(t *testing.T) {
	tests := []struct {
		input int
		want  string
	}{
		{1, "1"},
		{10, "10"},
		{100, "100"},
		{0, "0"},
	}
	for _, tt := range tests {
		got := itoa(tt.input)
		if got != tt.want {
			t.Errorf("itoa(%d) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestMockDashboardStore_DefaultReturns(t *testing.T) {
	m := &MockDashboardStore{}
	ps, err := m.GetProjectStats(nil)
	if ps != nil || err != nil {
		t.Error("GetProjectStats defaults")
	}
	rs, err := m.GetRevenueStats(nil, nil)
	if rs != nil || err != nil {
		t.Error("GetRevenueStats defaults")
	}
	ts, err := m.GetTalentStats(nil)
	if ts != nil || err != nil {
		t.Error("GetTalentStats defaults")
	}
}

func TestMockUserStore_DefaultReturns(t *testing.T) {
	m := &MockUserStore{}
	ul, err := m.GetUsersList(nil, UserFilters{})
	if ul != nil || err != nil {
		t.Error("GetUsersList defaults")
	}
	u, err := m.GetUserByID(nil, "id")
	if u != nil || err != nil {
		t.Error("GetUserByID defaults")
	}
	u, err = m.SuspendUser(nil, "id")
	if u != nil || err != nil {
		t.Error("SuspendUser defaults")
	}
	u, err = m.UnsuspendUser(nil, "id")
	if u != nil || err != nil {
		t.Error("UnsuspendUser defaults")
	}
	al, err := m.GetAuditLogs(nil, 1, 10)
	if al != nil || err != nil {
		t.Error("GetAuditLogs defaults")
	}
	a, err := m.CreateAuditLog(nil, "", "", "", "", "", nil)
	if a != nil || err != nil {
		t.Error("CreateAuditLog defaults")
	}
	pss, err := m.GetPlatformSettings(nil)
	if pss != nil || err != nil {
		t.Error("GetPlatformSettings defaults")
	}
	ps, err := m.GetPlatformSetting(nil, "key")
	if ps != nil || err != nil {
		t.Error("GetPlatformSetting defaults")
	}
	ps, err = m.UpsertPlatformSetting(nil, "", "", json.RawMessage{}, nil, "")
	if ps != nil || err != nil {
		t.Error("UpsertPlatformSetting defaults")
	}
}
