package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	Port              int
	DatabaseURL       string
	AuthURL           string
	CORSOrigin        string
	ServiceAuthSecret string
}

func Load() (*Config, error) {
	port := 3006
	if v := os.Getenv("PORT"); v != "" {
		p, err := strconv.Atoi(v)
		if err != nil {
			return nil, fmt.Errorf("invalid PORT %q: %w", v, err)
		}
		port = p
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}

	authURL := os.Getenv("BETTER_AUTH_URL")
	if authURL == "" {
		authURL = "http://localhost:3001"
	}

	corsOrigin := os.Getenv("CORS_ORIGIN")
	if corsOrigin == "" {
		corsOrigin = "http://localhost:5173"
	}

	return &Config{
		Port:              port,
		DatabaseURL:       dbURL,
		AuthURL:           authURL,
		CORSOrigin:        corsOrigin,
		ServiceAuthSecret: os.Getenv("SERVICE_AUTH_SECRET"),
	}, nil
}
