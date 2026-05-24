package handler

import (
	"log/slog"

	"github.com/gofiber/fiber/v2"

	"github.com/bytz/admin-service/internal/store"
)

// ProjectsHandler serves admin project endpoints.
type ProjectsHandler struct {
	projects store.ProjectStoreInterface
}

func NewProjectsHandler(p store.ProjectStoreInterface) *ProjectsHandler {
	return &ProjectsHandler{projects: p}
}

// ListProjects returns paginated projects with optional filters.
// GET /api/v1/admin/projects?status=in_progress&search=foo&page=1&pageSize=20
func (h *ProjectsHandler) ListProjects(c *fiber.Ctx) error {
	status := c.Query("status")
	search := c.Query("search")
	page := c.QueryInt("page", 1)
	pageSize := c.QueryInt("pageSize", 20)

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	result, err := h.projects.GetProjectsList(c.UserContext(), store.ProjectFilters{
		Status:   status,
		Search:   search,
		Page:     page,
		PageSize: pageSize,
	})
	if err != nil {
		slog.Error("failed to list projects", "error", err)
		return internalError(c)
	}

	return c.JSON(fiber.Map{
		"success": true,
		"data": fiber.Map{
			"items":    result.Items,
			"total":    result.Total,
			"page":     page,
			"pageSize": pageSize,
		},
	})
}

// GetProject returns a full project detail bundle.
// GET /api/v1/admin/projects/:id
func (h *ProjectsHandler) GetProject(c *fiber.Ctx) error {
	id := c.Params("id")

	detail, err := h.projects.GetProjectByID(c.UserContext(), id)
	if err != nil {
		slog.Error("failed to get project", "id", id, "error", err)
		return internalError(c)
	}
	if detail == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"success": false,
			"error": fiber.Map{
				"code":    "NOT_FOUND",
				"message": "Project not found",
			},
		})
	}

	return c.JSON(fiber.Map{
		"success": true,
		"data":    detail,
	})
}
