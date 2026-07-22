package handler

import "github.com/gofiber/fiber/v2"

// Webhook first, auth prefix would catch it.
func RegisterAll(
	app fiber.Router,
	payments *PaymentHandler,
	webhooks *WebhookHandler,
	authMiddleware fiber.Handler,
	serviceMiddleware fiber.Handler,
) {
	webhooks.Register(app)
	payments.RegisterWithAuth(app, authMiddleware, serviceMiddleware)
}
