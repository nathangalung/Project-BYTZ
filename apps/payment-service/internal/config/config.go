package config

import (
	"fmt"
	"os"
	"strings"
)

type Config struct {
	DatabaseURL       string
	MidtransServerKey string
	MidtransClientKey string
	MidtransIsSandbox bool
	MidtransSnapURL   string
	MidtransAPIURL    string
	Port              string
	CORSOrigin        string
	ProjectServiceURL string
	AuthServiceURL    string
	ServiceAuthSecret string
	NATSURL           string
}

func Load() (*Config, error) {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}

	// The webhook signature is sha512(orderID + statusCode + grossAmount +
	// serverKey). Empty, every term is known to the sender, so anyone reaching
	// the endpoint forges a settlement for a known order id and funds escrow
	// with money nobody paid. Fail closed, as middleware/auth.go already does
	// for an empty SERVICE_AUTH_SECRET.
	midtransServerKey := os.Getenv("MIDTRANS_SERVER_KEY")
	if midtransServerKey == "" {
		return nil, fmt.Errorf("MIDTRANS_SERVER_KEY is required")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "3004"
	}

	corsOrigin := os.Getenv("CORS_ORIGIN")
	if corsOrigin == "" {
		corsOrigin = "http://localhost:5173"
	}

	projectServiceURL := os.Getenv("PROJECT_SERVICE_URL")
	if projectServiceURL == "" {
		projectServiceURL = "http://localhost:3002"
	}

	authServiceURL := os.Getenv("AUTH_SERVICE_URL")
	if authServiceURL == "" {
		authServiceURL = "http://localhost:3001"
	}

	natsURL := os.Getenv("NATS_URL")
	if natsURL == "" {
		natsURL = "nats://localhost:4222"
	}

	isSandbox := true
	if v := os.Getenv("MIDTRANS_IS_SANDBOX"); strings.EqualFold(v, "false") || v == "0" {
		isSandbox = false
	}

	snapURL := "https://app.sandbox.midtrans.com/snap/v1/transactions"
	// Core API base, where Get Status lives. Midtrans documents that a
	// notification can be delayed or lost, and that the way to learn the real
	// state is GET /v2/{order_id}/status rather than waiting.
	apiURL := "https://api.sandbox.midtrans.com"
	if !isSandbox {
		snapURL = "https://app.midtrans.com/snap/v1/transactions"
		apiURL = "https://api.midtrans.com"
	}

	return &Config{
		DatabaseURL:       dbURL,
		MidtransServerKey: midtransServerKey,
		MidtransClientKey: os.Getenv("MIDTRANS_CLIENT_KEY"),
		MidtransIsSandbox: isSandbox,
		MidtransSnapURL:   snapURL,
		MidtransAPIURL:    apiURL,
		Port:              port,
		CORSOrigin:        corsOrigin,
		ProjectServiceURL: projectServiceURL,
		AuthServiceURL:    authServiceURL,
		ServiceAuthSecret: os.Getenv("SERVICE_AUTH_SECRET"),
		NATSURL:           natsURL,
	}, nil
}
