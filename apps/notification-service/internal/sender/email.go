package sender

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

const resendEndpoint = "https://api.resend.com/emails"

// Used when EMAIL_FROM is unset. Must name a domain verified in Resend, or
// every send answers 403. A subdomain, so signup complaints never attach to
// the root domain that carries the human mailbox.
const defaultEmailFrom = "KerjaCUS! <noreply@notify.kerjacus.id>"

type EmailSender struct {
	apiKey string
	from   string
	client *http.Client
	// Overridden only by tests; production always talks to Resend.
	baseURL string
}

// NewEmailSender builds the Resend client. from is the RFC 5322 From header and
// its domain must be the one verified with Resend; an unverified domain is
// rejected upstream, not here.
func NewEmailSender(apiKey, from string) *EmailSender {
	if from == "" {
		from = defaultEmailFrom
	}
	return &EmailSender{
		apiKey:  apiKey,
		from:    from,
		baseURL: resendEndpoint,
		client: &http.Client{
			Timeout:   10 * time.Second,
			Transport: otelhttp.NewTransport(http.DefaultTransport),
		},
	}
}

type SendEmailInput struct {
	To      string
	Subject string
	HTML    string
}

type resendRequest struct {
	From    string   `json:"from"`
	To      []string `json:"to"`
	Subject string   `json:"subject"`
	HTML    string   `json:"html"`
}

// ErrNotConfigured reports that no Resend key is set, so nothing can be sent.
//
// It used to be a warning and a nil return: an unconfigured deployment
// reported every send as a success it never attempted, which is how a password
// reset or a verification mail went missing with nothing to retry, nothing in
// the dead letter queue and nothing on screen - recovery answers identically
// whether the address exists. An error stops at the consumer, which naks the
// event and finally parks it where an operator can see it.
var ErrNotConfigured = errors.New("RESEND_API_KEY is not configured")

func (s *EmailSender) Send(ctx context.Context, in SendEmailInput) error {
	if s.apiKey == "" {
		return ErrNotConfigured
	}

	body := resendRequest{
		From:    s.from,
		To:      []string{in.To},
		Subject: in.Subject,
		HTML:    in.HTML,
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal email request: %w", err)
	}

	url := s.baseURL
	if url == "" {
		url = resendEndpoint
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
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
