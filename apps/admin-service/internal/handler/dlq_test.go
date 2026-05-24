package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/bytz/admin-service/internal/publisher"
	"github.com/bytz/admin-service/internal/store"
)

func newDLQTestApp(h *DLQHandler) *fiber.App {
	app := fiber.New()
	g := app.Group("/api/v1/admin")
	g.Get("/dlq", h.ListDLQ)
	g.Get("/dlq/:id", h.GetDLQEvent)
	g.Patch("/dlq/:id/reprocess", h.ReprocessDLQEvent)
	return app
}

func TestListDLQ_Success(t *testing.T) {
	now := time.Now().UTC()
	dlq := &store.MockDLQStore{
		GetDLQListFn: func(_ context.Context, _ store.DLQFilters) (*store.DLQListResult, error) {
			return &store.DLQListResult{
				Items: []store.DLQEvent{{
					ID:              "d-1",
					OriginalEventID: "evt-1",
					EventType:       "milestone.submitted",
					ConsumerService: "notification-service",
					ErrorMessage:    "boom",
					RetryCount:      3,
					CreatedAt:       now,
				}},
				Total: 1,
			}, nil
		},
	}
	h := NewDLQHandler(dlq, &store.MockUserStore{}, &publisher.MockPublisher{})
	app := newDLQTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/dlq?page=1&pageSize=10", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
}

func TestListDLQ_WithFilters(t *testing.T) {
	dlq := &store.MockDLQStore{
		GetDLQListFn: func(_ context.Context, f store.DLQFilters) (*store.DLQListResult, error) {
			if f.EventType != "payment.released" {
				t.Errorf("eventType = %q, want payment.released", f.EventType)
			}
			if f.ConsumerService != "project-service" {
				t.Errorf("consumerService = %q, want project-service", f.ConsumerService)
			}
			if f.Reprocessed == nil || *f.Reprocessed != true {
				t.Errorf("reprocessed = %v, want true", f.Reprocessed)
			}
			return &store.DLQListResult{Items: []store.DLQEvent{}, Total: 0}, nil
		},
	}
	h := NewDLQHandler(dlq, &store.MockUserStore{}, &publisher.MockPublisher{})
	app := newDLQTestApp(h)

	req := httptest.NewRequest("GET",
		"/api/v1/admin/dlq?eventType=payment.released&consumerService=project-service&reprocessed=true",
		nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
}

func TestListDLQ_ReprocessedFalse(t *testing.T) {
	dlq := &store.MockDLQStore{
		GetDLQListFn: func(_ context.Context, f store.DLQFilters) (*store.DLQListResult, error) {
			if f.Reprocessed == nil || *f.Reprocessed != false {
				t.Errorf("reprocessed = %v, want false", f.Reprocessed)
			}
			return &store.DLQListResult{Items: []store.DLQEvent{}, Total: 0}, nil
		},
	}
	h := NewDLQHandler(dlq, &store.MockUserStore{}, &publisher.MockPublisher{})
	app := newDLQTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/dlq?reprocessed=false", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
}

func TestListDLQ_InvalidReprocessed(t *testing.T) {
	h := NewDLQHandler(&store.MockDLQStore{}, &store.MockUserStore{}, &publisher.MockPublisher{})
	app := newDLQTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/dlq?reprocessed=maybe", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusBadRequest)
	}
}

func TestListDLQ_PaginationClamping(t *testing.T) {
	dlq := &store.MockDLQStore{
		GetDLQListFn: func(_ context.Context, _ store.DLQFilters) (*store.DLQListResult, error) {
			return &store.DLQListResult{Items: []store.DLQEvent{}, Total: 0}, nil
		},
	}
	h := NewDLQHandler(dlq, &store.MockUserStore{}, &publisher.MockPublisher{})
	app := newDLQTestApp(h)

	tests := []struct {
		name  string
		query string
	}{
		{"negative page", "?page=-1"},
		{"zero pageSize", "?pageSize=0"},
		{"over 100 pageSize", "?pageSize=200"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/api/v1/admin/dlq"+tt.query, nil)
			resp, err := app.Test(req)
			if err != nil {
				t.Fatalf("test failed: %v", err)
			}
			if resp.StatusCode != fiber.StatusOK {
				t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
			}
		})
	}
}

func TestListDLQ_StoreError(t *testing.T) {
	dlq := &store.MockDLQStore{
		GetDLQListFn: func(_ context.Context, _ store.DLQFilters) (*store.DLQListResult, error) {
			return nil, fmt.Errorf("boom")
		},
	}
	h := NewDLQHandler(dlq, &store.MockUserStore{}, &publisher.MockPublisher{})
	app := newDLQTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/dlq", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

func TestGetDLQEvent_Success(t *testing.T) {
	now := time.Now().UTC()
	dlq := &store.MockDLQStore{
		GetDLQByIDFn: func(_ context.Context, id string) (*store.DLQEvent, error) {
			return &store.DLQEvent{
				ID:              id,
				OriginalEventID: "evt-1",
				EventType:       "milestone.submitted",
				ConsumerService: "notification-service",
				ErrorMessage:    "boom",
				CreatedAt:       now,
			}, nil
		},
	}
	h := NewDLQHandler(dlq, &store.MockUserStore{}, &publisher.MockPublisher{})
	app := newDLQTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/dlq/d-1", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
}

func TestGetDLQEvent_NotFound(t *testing.T) {
	dlq := &store.MockDLQStore{
		GetDLQByIDFn: func(_ context.Context, _ string) (*store.DLQEvent, error) { return nil, nil },
	}
	h := NewDLQHandler(dlq, &store.MockUserStore{}, &publisher.MockPublisher{})
	app := newDLQTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/dlq/missing", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusNotFound {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusNotFound)
	}
}

func TestGetDLQEvent_StoreError(t *testing.T) {
	dlq := &store.MockDLQStore{
		GetDLQByIDFn: func(_ context.Context, _ string) (*store.DLQEvent, error) {
			return nil, fmt.Errorf("boom")
		},
	}
	h := NewDLQHandler(dlq, &store.MockUserStore{}, &publisher.MockPublisher{})
	app := newDLQTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/dlq/d-1", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

func TestReprocessDLQEvent_Success(t *testing.T) {
	now := time.Now().UTC()
	var auditCalled bool
	var capturedAction, capturedTargetType, capturedAdminID string
	dlq := &store.MockDLQStore{
		GetDLQByIDFn: func(_ context.Context, id string) (*store.DLQEvent, error) {
			return &store.DLQEvent{
				ID:              id,
				OriginalEventID: "evt-1",
				EventType:       "milestone.submitted",
				ConsumerService: "notification-service",
				ErrorMessage:    "boom",
				Reprocessed:     false,
				CreatedAt:       now,
			}, nil
		},
		MarkReprocessedFn: func(_ context.Context, id string) (*store.DLQEvent, error) {
			reAt := now
			return &store.DLQEvent{
				ID:            id,
				Reprocessed:   true,
				ReprocessedAt: &reAt,
				CreatedAt:     now,
			}, nil
		},
	}
	users := &store.MockUserStore{
		CreateAuditLogFn: func(_ context.Context, _, adminID, action, targetType, _ string, details json.RawMessage) (*store.AuditLog, error) {
			auditCalled = true
			capturedAction = action
			capturedTargetType = targetType
			capturedAdminID = adminID
			if !strings.Contains(string(details), "milestone.submitted") {
				t.Errorf("audit details missing eventType: %s", string(details))
			}
			return &store.AuditLog{}, nil
		},
	}
	pub := &publisher.MockPublisher{}
	h := NewDLQHandler(dlq, users, pub)
	app := newDLQTestApp(h)

	body := `{"adminId":"admin-1"}`
	req := httptest.NewRequest("PATCH", "/api/v1/admin/dlq/d-1/reprocess", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
	if len(pub.Calls) != 1 {
		t.Fatalf("publisher calls = %d, want 1", len(pub.Calls))
	}
	if pub.Calls[0].OriginalEventID != "evt-1" {
		t.Errorf("republish originalEventID = %q, want evt-1", pub.Calls[0].OriginalEventID)
	}
	if pub.Calls[0].EventType != "milestone.submitted" {
		t.Errorf("republish eventType = %q, want milestone.submitted", pub.Calls[0].EventType)
	}
	if !auditCalled {
		t.Error("CreateAuditLog was not called for reprocess")
	}
	if capturedAction != "dlq.reprocess" {
		t.Errorf("audit action = %q, want dlq.reprocess", capturedAction)
	}
	if capturedTargetType != "dlq_event" {
		t.Errorf("audit targetType = %q, want dlq_event", capturedTargetType)
	}
	if capturedAdminID != "admin-1" {
		t.Errorf("audit adminID = %q, want admin-1", capturedAdminID)
	}
}

func TestReprocessDLQEvent_AuditLogFailureIsNotFatal(t *testing.T) {
	now := time.Now().UTC()
	dlq := &store.MockDLQStore{
		GetDLQByIDFn: func(_ context.Context, id string) (*store.DLQEvent, error) {
			return &store.DLQEvent{ID: id, EventType: "x", CreatedAt: now}, nil
		},
		MarkReprocessedFn: func(_ context.Context, id string) (*store.DLQEvent, error) {
			return &store.DLQEvent{ID: id, Reprocessed: true, CreatedAt: now}, nil
		},
	}
	users := &store.MockUserStore{
		CreateAuditLogFn: func(_ context.Context, _, _, _, _, _ string, _ json.RawMessage) (*store.AuditLog, error) {
			return nil, fmt.Errorf("audit db down")
		},
	}
	h := NewDLQHandler(dlq, users, &publisher.MockPublisher{})
	app := newDLQTestApp(h)

	body := `{"adminId":"admin-1"}`
	req := httptest.NewRequest("PATCH", "/api/v1/admin/dlq/d-1/reprocess", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("audit log failure must not fail request: status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
}

func TestReprocessDLQEvent_AlreadyReprocessed(t *testing.T) {
	now := time.Now().UTC()
	var markCalled bool
	dlq := &store.MockDLQStore{
		GetDLQByIDFn: func(_ context.Context, id string) (*store.DLQEvent, error) {
			reAt := now
			return &store.DLQEvent{
				ID:            id,
				Reprocessed:   true,
				ReprocessedAt: &reAt,
				CreatedAt:     now,
			}, nil
		},
		MarkReprocessedFn: func(_ context.Context, _ string) (*store.DLQEvent, error) {
			markCalled = true
			return nil, nil
		},
	}
	h := NewDLQHandler(dlq, &store.MockUserStore{}, &publisher.MockPublisher{})
	app := newDLQTestApp(h)

	body := `{"adminId":"admin-1"}`
	req := httptest.NewRequest("PATCH", "/api/v1/admin/dlq/d-1/reprocess", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusConflict {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusConflict)
	}
	if markCalled {
		t.Error("MarkReprocessed must not be called when already reprocessed")
	}
}

func TestReprocessDLQEvent_NotFound(t *testing.T) {
	dlq := &store.MockDLQStore{
		GetDLQByIDFn: func(_ context.Context, _ string) (*store.DLQEvent, error) { return nil, nil },
	}
	h := NewDLQHandler(dlq, &store.MockUserStore{}, &publisher.MockPublisher{})
	app := newDLQTestApp(h)

	body := `{"adminId":"admin-1"}`
	req := httptest.NewRequest("PATCH", "/api/v1/admin/dlq/missing/reprocess", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusNotFound {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusNotFound)
	}
}

func TestReprocessDLQEvent_Validation(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{"invalid json", "not json"},
		{"missing adminId", `{"adminId":""}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := NewDLQHandler(&store.MockDLQStore{}, &store.MockUserStore{}, &publisher.MockPublisher{})
			app := newDLQTestApp(h)

			req := httptest.NewRequest("PATCH", "/api/v1/admin/dlq/d-1/reprocess", strings.NewReader(tt.body))
			req.Header.Set("Content-Type", "application/json")

			resp, err := app.Test(req)
			if err != nil {
				t.Fatalf("test failed: %v", err)
			}
			if resp.StatusCode != fiber.StatusBadRequest {
				t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusBadRequest)
			}
		})
	}
}

func TestReprocessDLQEvent_GetError(t *testing.T) {
	dlq := &store.MockDLQStore{
		GetDLQByIDFn: func(_ context.Context, _ string) (*store.DLQEvent, error) {
			return nil, fmt.Errorf("boom")
		},
	}
	h := NewDLQHandler(dlq, &store.MockUserStore{}, &publisher.MockPublisher{})
	app := newDLQTestApp(h)

	body := `{"adminId":"admin-1"}`
	req := httptest.NewRequest("PATCH", "/api/v1/admin/dlq/d-1/reprocess", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

func TestReprocessDLQEvent_MarkError(t *testing.T) {
	now := time.Now().UTC()
	dlq := &store.MockDLQStore{
		GetDLQByIDFn: func(_ context.Context, id string) (*store.DLQEvent, error) {
			return &store.DLQEvent{ID: id, EventType: "x", CreatedAt: now}, nil
		},
		MarkReprocessedFn: func(_ context.Context, _ string) (*store.DLQEvent, error) {
			return nil, fmt.Errorf("boom")
		},
	}
	h := NewDLQHandler(dlq, &store.MockUserStore{}, &publisher.MockPublisher{})
	app := newDLQTestApp(h)

	body := `{"adminId":"admin-1"}`
	req := httptest.NewRequest("PATCH", "/api/v1/admin/dlq/d-1/reprocess", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

func TestReprocessDLQEvent_PublishFailureSkipsMark(t *testing.T) {
	now := time.Now().UTC()
	var markCalled bool
	dlq := &store.MockDLQStore{
		GetDLQByIDFn: func(_ context.Context, id string) (*store.DLQEvent, error) {
			return &store.DLQEvent{
				ID:              id,
				OriginalEventID: "evt-1",
				EventType:       "milestone.submitted",
				Payload:         json.RawMessage(`{"foo":"bar"}`),
				CreatedAt:       now,
			}, nil
		},
		MarkReprocessedFn: func(_ context.Context, _ string) (*store.DLQEvent, error) {
			markCalled = true
			return &store.DLQEvent{}, nil
		},
	}
	pub := &publisher.MockPublisher{
		RepublishFn: func(_ context.Context, _, _ string, _, _ []byte) error {
			return fmt.Errorf("nats publish failed")
		},
	}
	h := NewDLQHandler(dlq, &store.MockUserStore{}, pub)
	app := newDLQTestApp(h)

	body := `{"adminId":"admin-1"}`
	req := httptest.NewRequest("PATCH", "/api/v1/admin/dlq/d-1/reprocess", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusBadGateway {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusBadGateway)
	}
	if markCalled {
		t.Error("MarkReprocessed must not be called when republish fails")
	}
	if len(pub.Calls) != 1 {
		t.Errorf("publisher calls = %d, want 1", len(pub.Calls))
	}
}

func TestReprocessDLQEvent_NilPublisherReturnsUnavailable(t *testing.T) {
	now := time.Now().UTC()
	dlq := &store.MockDLQStore{
		GetDLQByIDFn: func(_ context.Context, id string) (*store.DLQEvent, error) {
			return &store.DLQEvent{ID: id, EventType: "x", CreatedAt: now}, nil
		},
	}
	h := NewDLQHandler(dlq, &store.MockUserStore{}, nil)
	app := newDLQTestApp(h)

	body := `{"adminId":"admin-1"}`
	req := httptest.NewRequest("PATCH", "/api/v1/admin/dlq/d-1/reprocess", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusServiceUnavailable {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusServiceUnavailable)
	}
}
