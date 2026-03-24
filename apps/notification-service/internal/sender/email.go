package sender

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"
)

type EmailSender struct {
	apiKey string
	client *http.Client
}

func NewEmailSender(apiKey string) *EmailSender {
	return &EmailSender{
		apiKey: apiKey,
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

type SendEmailInput struct {
	To      string
	Subject string
	HTML    string
}

type resendRequest struct {
	From    string `json:"from"`
	To      []string `json:"to"`
	Subject string `json:"subject"`
	HTML    string `json:"html"`
}

func (s *EmailSender) Send(ctx context.Context, in SendEmailInput) error {
	if s.apiKey == "" {
		slog.Warn("resend api key not configured, skipping email", "to", in.To, "subject", in.Subject)
		return nil
	}

	body := resendRequest{
		From:    "BYTZ <noreply@bytz.id>",
		To:      []string{in.To},
		Subject: in.Subject,
		HTML:    in.HTML,
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal email request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create email request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+s.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("send email: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("resend API error (status %d): %s", resp.StatusCode, string(respBody))
	}

	slog.Info("email sent", "to", in.To, "subject", in.Subject)
	return nil
}
