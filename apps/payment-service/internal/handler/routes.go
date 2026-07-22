package handler

import "github.com/gofiber/fiber/v2"

// RegisterAll wires every payment route in the one order that works.
//
// Order is load-bearing. Fiber's Group(prefix, mw) is prefix-scoped Use: the
// middleware runs for every request matching the prefix, not only for routes
// declared on the returned router. RegisterWithAuth mounts session auth on
// /api/v1/payments, and the webhook lives at /api/v1/payments/webhook/midtrans,
// which matches that prefix. Registered after the auth groups, the webhook
// inherited them and answered every Midtrans callback with 401 - so no payment
// was ever confirmed. Registering the concrete webhook route first means Fiber
// matches and terminates there before reaching the auth middleware.
//
// This lives here, rather than inline in main.go, so the tests exercise the
// real registration order instead of a copy of it that can drift.
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
