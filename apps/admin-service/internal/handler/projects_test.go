package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/bytz/admin-service/internal/store"
	"github.com/gofiber/fiber/v2"
)

func newProjectsTestApp(ph *ProjectsHandler) *fiber.App {
	app := fiber.New()
	g := app.Group("/api/v1/admin")
	g.Get("/projects", ph.ListProjects)
	g.Get("/projects/:id", ph.GetProject)
	return app
}

func TestListProjects_Success(t *testing.T) {
	now := time.Now().UTC()
	mock := &store.MockProjectStore{
		GetProjectsListFn: func(_ context.Context, _ store.ProjectFilters) (*store.ProjectListResult, error) {
			return &store.ProjectListResult{
				Items: []store.ProjectListItem{
					{
						ID: "p-1", Title: "Demo", OwnerID: "u-1", OwnerName: "Owner",
						OwnerEmail: "o@b.com", Status: "matching", Category: "web_app",
						TeamSize: 3, BudgetMin: 1000, BudgetMax: 5000,
						EstimatedTimelineDays: 30, Progress: 10, CreatedAt: now,
					},
				},
				Total: 1,
			}, nil
		},
	}
	h := NewProjectsHandler(mock)
	app := newProjectsTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/projects?page=1&pageSize=10", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
	var body struct {
		Success bool `json:"success"`
		Data    struct {
			Items []struct {
				ID        string `json:"id"`
				OwnerName string `json:"ownerName"`
			} `json:"items"`
			Total int64 `json:"total"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if !body.Success || len(body.Data.Items) != 1 || body.Data.Items[0].OwnerName != "Owner" {
		t.Errorf("unexpected body: %+v", body)
	}
}

func TestListProjects_WithFilters(t *testing.T) {
	mock := &store.MockProjectStore{
		GetProjectsListFn: func(_ context.Context, f store.ProjectFilters) (*store.ProjectListResult, error) {
			if f.Status != "in_progress" {
				t.Errorf("status = %q, want in_progress", f.Status)
			}
			if f.Search != "demo" {
				t.Errorf("search = %q, want demo", f.Search)
			}
			return &store.ProjectListResult{Items: []store.ProjectListItem{}, Total: 0}, nil
		},
	}
	h := NewProjectsHandler(mock)
	app := newProjectsTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/projects?status=in_progress&search=demo", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
}

func TestListProjects_PaginationClamping(t *testing.T) {
	var capturedPage, capturedPageSize int
	mock := &store.MockProjectStore{
		GetProjectsListFn: func(_ context.Context, f store.ProjectFilters) (*store.ProjectListResult, error) {
			capturedPage = f.Page
			capturedPageSize = f.PageSize
			return &store.ProjectListResult{Items: []store.ProjectListItem{}, Total: 0}, nil
		},
	}
	h := NewProjectsHandler(mock)
	app := newProjectsTestApp(h)

	tests := []struct {
		name         string
		query        string
		wantPage     int
		wantPageSize int
	}{
		{"negative page", "?page=-1", 1, 20},
		{"zero pageSize", "?pageSize=0", 1, 20},
		{"over 100 pageSize", "?pageSize=200", 1, 20},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			capturedPage, capturedPageSize = 0, 0
			req := httptest.NewRequest("GET", "/api/v1/admin/projects"+tt.query, nil)
			resp, err := app.Test(req)
			if err != nil {
				t.Fatalf("test failed: %v", err)
			}
			if resp.StatusCode != fiber.StatusOK {
				t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
			}
			if capturedPage != tt.wantPage {
				t.Errorf("page = %d, want %d", capturedPage, tt.wantPage)
			}
			if capturedPageSize != tt.wantPageSize {
				t.Errorf("pageSize = %d, want %d", capturedPageSize, tt.wantPageSize)
			}
		})
	}
}

func TestListProjects_StoreError(t *testing.T) {
	mock := &store.MockProjectStore{
		GetProjectsListFn: func(_ context.Context, _ store.ProjectFilters) (*store.ProjectListResult, error) {
			return nil, fmt.Errorf("err")
		},
	}
	h := NewProjectsHandler(mock)
	app := newProjectsTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/projects", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}

func TestGetProject_Success(t *testing.T) {
	now := time.Now().UTC()
	mock := &store.MockProjectStore{
		GetProjectByIDFn: func(_ context.Context, id string) (*store.ProjectDetail, error) {
			d := &store.ProjectDetail{
				ProjectListItem: store.ProjectListItem{
					ID: id, Title: "Demo", OwnerID: "u-1", OwnerName: "Owner",
					OwnerEmail: "o@b.com", Status: "in_progress", Category: "web_app",
					TeamSize: 2, BudgetMin: 5000, BudgetMax: 10000,
					EstimatedTimelineDays: 60, Progress: 40, CreatedAt: now,
				},
				Description: "long description",
				ProjectType: "individual",
				Visibility:  "public_summary",
				UpdatedAt:   now,
				WorkPackages: []store.ProjectWorkPackageRow{
					{ID: "wp-1", Title: "Backend", Description: "API", OrderIndex: 0,
						RequiredSkills: json.RawMessage(`["go"]`), EstimatedHours: 80,
						Amount: 5000, TalentPayout: 4500, Status: "in_progress"},
				},
				Workers: []store.ProjectAssignmentRow{
					{ID: "a-1", TalentID: "t-1", TalentUserID: "u-2", TalentName: "Talent",
						AcceptanceStatus: "accepted", Status: "active", CreatedAt: now},
				},
				Milestones: []store.ProjectMilestoneRow{
					{ID: "m-1", Title: "M1", Description: "first", MilestoneType: "individual",
						OrderIndex: 0, Amount: 2500, Status: "submitted", RevisionCount: 0,
						DueDate: now.Add(24 * time.Hour)},
				},
				Transactions: []store.ProjectTransactionRow{
					{ID: "tx-1", Type: "escrow_in", Amount: 10000, Status: "completed", CreatedAt: now},
				},
				Disputes: []store.ProjectDisputeRow{},
			}
			return d, nil
		},
	}
	h := NewProjectsHandler(mock)
	app := newProjectsTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/projects/p-1", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}
	var body struct {
		Success bool `json:"success"`
		Data    struct {
			ID           string `json:"id"`
			OwnerName    string `json:"ownerName"`
			WorkPackages []struct {
				Title string `json:"title"`
			} `json:"workPackages"`
			Workers []struct {
				TalentName string `json:"talentName"`
			} `json:"workers"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if !body.Success || body.Data.ID != "p-1" || body.Data.OwnerName != "Owner" {
		t.Errorf("unexpected body: %+v", body)
	}
	if len(body.Data.WorkPackages) != 1 || body.Data.WorkPackages[0].Title != "Backend" {
		t.Errorf("work packages = %+v", body.Data.WorkPackages)
	}
	if len(body.Data.Workers) != 1 || body.Data.Workers[0].TalentName != "Talent" {
		t.Errorf("workers = %+v", body.Data.Workers)
	}
}

func TestGetProject_NotFound(t *testing.T) {
	mock := &store.MockProjectStore{
		GetProjectByIDFn: func(_ context.Context, _ string) (*store.ProjectDetail, error) {
			return nil, nil
		},
	}
	h := NewProjectsHandler(mock)
	app := newProjectsTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/projects/missing", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusNotFound {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusNotFound)
	}
}

func TestGetProject_StoreError(t *testing.T) {
	mock := &store.MockProjectStore{
		GetProjectByIDFn: func(_ context.Context, _ string) (*store.ProjectDetail, error) {
			return nil, fmt.Errorf("boom")
		},
	}
	h := NewProjectsHandler(mock)
	app := newProjectsTestApp(h)

	req := httptest.NewRequest("GET", "/api/v1/admin/projects/p-1", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("test failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusInternalServerError)
	}
}
