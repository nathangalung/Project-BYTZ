package handler

import (
	"log/slog"
	"strconv"
	"time"

	"github.com/bytz/notification-service/internal/store"
	"github.com/gofiber/fiber/v2"
)

type Handler struct {
	store   store.StoreInterface
	startAt time.Time
}

func New(s store.StoreInterface) *Handler {
	return &Handler{store: s, startAt: time.Now()}
}

func (h *Handler) Register(app *fiber.App) {
	app.Get("/health", h.health)
	app.Get("/health/ready", h.ready)

	// Internal endpoints — called by other services (no session required)
	internal := app.Group("/api/v1/notifications")
	internal.Post("/", h.createNotification)
}

// RegisterWithAuth registers user-facing routes with session auth middleware.
func (h *Handler) RegisterWithAuth(app *fiber.App, authMiddleware fiber.Handler) {
	api := app.Group("/api/v1/notifications", authMiddleware)
	api.Get("/", h.listNotifications)
	api.Patch("/:id/read", h.markRead)
	api.Patch("/read-all", h.markAllRead)
	api.Get("/unread-count", h.unreadCount)
}

// GET /health
func (h *Handler) health(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{
		"status":  "ok",
		"service": "notification-service",
		"uptime":  time.Since(h.startAt).Seconds(),
	})
}

// GET /health/ready
func (h *Handler) ready(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{"status": "ready"})
}

type apiResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   *apiError   `json:"error,omitempty"`
}

type apiError struct {
	Code    string      `json:"code"`
	Message string      `json:"message"`
	Details interface{} `json:"details,omitempty"`
}

func errorResponse(c *fiber.Ctx, status int, code, message string) error {
	return c.Status(status).JSON(apiResponse{
		Success: false,
		Error:   &apiError{Code: code, Message: message},
	})
}

func successResponse(c *fiber.Ctx, data interface{}) error {
	return c.JSON(apiResponse{Success: true, Data: data})
}

func successResponseCreated(c *fiber.Ctx, data interface{}) error {
	return c.Status(fiber.StatusCreated).JSON(apiResponse{Success: true, Data: data})
}

// GET /api/v1/notifications?page=1&pageSize=20
func (h *Handler) listNotifications(c *fiber.Ctx) error {
	// Use authenticated user ID from session middleware
	userID, _ := c.Locals("userID").(string)
	if userID == "" {
		return errorResponse(c, fiber.StatusUnauthorized, "AUTH_UNAUTHORIZED", "authenticated user required")
	}

	page, _ := strconv.Atoi(c.Query("page", "1"))
	pageSize, _ := strconv.Atoi(c.Query("pageSize", "20"))

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	result, err := h.store.FindByUserID(c.Context(), userID, page, pageSize)
	if err != nil {
		slog.Error("list notifications", "error", err, "userId", userID)
		return errorResponse(c, fiber.StatusInternalServerError, "INTERNAL_ERROR", "An unexpected error occurred")
	}

	return successResponse(c, result)
}

type createNotificationRequest struct {
	UserID  string `json:"userId"`
	Type    string `json:"type"`
	Title   string `json:"title"`
	Message string `json:"message"`
	Link    string `json:"link,omitempty"`
}

// POST /api/v1/notifications
func (h *Handler) createNotification(c *fiber.Ctx) error {
	var req createNotificationRequest
	if err := c.BodyParser(&req); err != nil {
		return errorResponse(c, fiber.StatusBadRequest, "VALIDATION_ERROR", "Invalid JSON body")
	}

	if req.UserID == "" {
		return errorResponse(c, fiber.StatusBadRequest, "VALIDATION_ERROR", "userId is required")
	}
	if req.Title == "" || len(req.Title) > 255 {
		return errorResponse(c, fiber.StatusBadRequest, "VALIDATION_ERROR", "title is required and must be <= 255 characters")
	}
	if req.Message == "" {
		return errorResponse(c, fiber.StatusBadRequest, "VALIDATION_ERROR", "message is required")
	}
	if !store.IsValidType(req.Type) {
		return errorResponse(c, fiber.StatusBadRequest, "VALIDATION_ERROR", "Invalid notification type")
	}

	var link *string
	if req.Link != "" {
		link = &req.Link
	}

	notif, err := h.store.Create(c.Context(), store.CreateInput{
		UserID:  req.UserID,
		Type:    store.NotificationType(req.Type),
		Title:   req.Title,
		Message: req.Message,
		Link:    link,
	})
	if err != nil {
		slog.Error("create notification", "error", err)
		return errorResponse(c, fiber.StatusInternalServerError, "INTERNAL_ERROR", "An unexpected error occurred")
	}

	return successResponseCreated(c, notif)
}

// PATCH /api/v1/notifications/:id/read
func (h *Handler) markRead(c *fiber.Ctx) error {
	id := c.Params("id")

	// Verify authenticated user owns this notification
	userID, _ := c.Locals("userID").(string)
	if userID == "" {
		return errorResponse(c, fiber.StatusUnauthorized, "AUTH_UNAUTHORIZED", "authenticated user required")
	}

	existing, err := h.store.FindByID(c.Context(), id, userID)
	if err != nil {
		slog.Error("find notification", "error", err, "id", id)
		return errorResponse(c, fiber.StatusInternalServerError, "INTERNAL_ERROR", "An unexpected error occurred")
	}
	if existing == nil {
		return errorResponse(c, fiber.StatusNotFound, "NOT_FOUND", "Notification not found")
	}

	updated, err := h.store.MarkAsRead(c.Context(), id)
	if err != nil {
		slog.Error("mark read", "error", err, "id", id)
		return errorResponse(c, fiber.StatusInternalServerError, "INTERNAL_ERROR", "An unexpected error occurred")
	}

	return successResponse(c, updated)
}

// PATCH /api/v1/notifications/read-all
func (h *Handler) markAllRead(c *fiber.Ctx) error {
	// Use authenticated user ID from session middleware
	userID, _ := c.Locals("userID").(string)
	if userID == "" {
		return errorResponse(c, fiber.StatusUnauthorized, "AUTH_UNAUTHORIZED", "authenticated user required")
	}

	count, err := h.store.MarkAllAsRead(c.Context(), userID)
	if err != nil {
		slog.Error("mark all read", "error", err, "userId", userID)
		return errorResponse(c, fiber.StatusInternalServerError, "INTERNAL_ERROR", "An unexpected error occurred")
	}

	return successResponse(c, fiber.Map{"markedCount": count})
}

// GET /api/v1/notifications/unread-count
func (h *Handler) unreadCount(c *fiber.Ctx) error {
	// Use authenticated user ID from session middleware
	userID, _ := c.Locals("userID").(string)
	if userID == "" {
		return errorResponse(c, fiber.StatusUnauthorized, "AUTH_UNAUTHORIZED", "authenticated user required")
	}

	count, err := h.store.CountUnread(c.Context(), userID)
	if err != nil {
		slog.Error("count unread", "error", err, "userId", userID)
		return errorResponse(c, fiber.StatusInternalServerError, "INTERNAL_ERROR", "An unexpected error occurred")
	}

	return successResponse(c, fiber.Map{"count": count})
}
