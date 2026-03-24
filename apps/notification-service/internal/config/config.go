package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	Port              int
	DatabaseURL       string
	NatsURL           string
	ResendAPIKey      string
	CentrifugoURL     string
	CentrifugoAPIKey  string
	CorsOrigin        string
	AuthServiceURL    string
	ServiceAuthSecret string
}

func Load() (*Config, error) {
	port := 3005
	if v := os.Getenv("PORT"); v != "" {
		p, err := strconv.Atoi(v)
		if err != nil {
			return nil, fmt.Errorf("invalid PORT: %w", err)
		}
		port = p
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}

	natsURL := os.Getenv("NATS_URL")
	if natsURL == "" {
		natsURL = "nats://localhost:4222"
	}

	corsOrigin := os.Getenv("CORS_ORIGIN")
	if corsOrigin == "" {
		corsOrigin = "http://localhost:5173"
	}

	authServiceURL := os.Getenv("AUTH_SERVICE_URL")
	if authServiceURL == "" {
		authServiceURL = "http://localhost:3001"
	}

	return &Config{
		Port:              port,
		DatabaseURL:       dbURL,
		NatsURL:           natsURL,
		ResendAPIKey:      os.Getenv("RESEND_API_KEY"),
		CentrifugoURL:     os.Getenv("CENTRIFUGO_URL"),
		CentrifugoAPIKey:  os.Getenv("CENTRIFUGO_API_KEY"),
		CorsOrigin:        corsOrigin,
		AuthServiceURL:    authServiceURL,
		ServiceAuthSecret: os.Getenv("SERVICE_AUTH_SECRET"),
	}, nil
}
