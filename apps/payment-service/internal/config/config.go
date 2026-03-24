package config

import (
	"fmt"
	"os"
	"strings"
)

type Config struct {
	DatabaseURL        string
	MidtransServerKey  string
	MidtransClientKey  string
	MidtransIsSandbox  bool
	MidtransSnapURL    string
	Port               string
	CORSOrigin         string
	ProjectServiceURL  string
	AuthServiceURL     string
	ServiceAuthSecret  string
}

func Load() (*Config, error) {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
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

	isSandbox := true
	if v := os.Getenv("MIDTRANS_IS_SANDBOX"); strings.EqualFold(v, "false") || v == "0" {
		isSandbox = false
	}

	snapURL := "https://app.sandbox.midtrans.com/snap/v1/transactions"
	if !isSandbox {
		snapURL = "https://app.midtrans.com/snap/v1/transactions"
	}

	return &Config{
		DatabaseURL:       dbURL,
		MidtransServerKey: os.Getenv("MIDTRANS_SERVER_KEY"),
		MidtransClientKey: os.Getenv("MIDTRANS_CLIENT_KEY"),
		MidtransIsSandbox: isSandbox,
		MidtransSnapURL:   snapURL,
		Port:              port,
		CORSOrigin:        corsOrigin,
		ProjectServiceURL: projectServiceURL,
		AuthServiceURL:    authServiceURL,
		ServiceAuthSecret: os.Getenv("SERVICE_AUTH_SECRET"),
	}, nil
}
