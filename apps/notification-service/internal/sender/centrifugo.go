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

type CentrifugoSender struct {
	url    string
	apiKey string
	client *http.Client
}

func NewCentrifugoSender(url, apiKey string) *CentrifugoSender {
	return &CentrifugoSender{
		url:    url,
		apiKey: apiKey,
		client: &http.Client{Timeout: 5 * time.Second},
	}
}

type centrifugoPublishRequest struct {
	Channel string      `json:"channel"`
	Data    interface{} `json:"data"`
}

type centrifugoAPIRequest struct {
	Method string      `json:"method"`
	Params interface{} `json:"params"`
}

// Publish sends a message to a Centrifugo channel for real-time push.
func (s *CentrifugoSender) Publish(ctx context.Context, channel string, data interface{}) error {
	if s.url == "" || s.apiKey == "" {
		slog.Warn("centrifugo not configured, skipping publish", "channel", channel)
		return nil
	}

	body := centrifugoAPIRequest{
		Method: "publish",
		Params: centrifugoPublishRequest{
			Channel: channel,
			Data:    data,
		},
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal centrifugo request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.url+"/api", bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create centrifugo request: %w", err)
	}

	req.Header.Set("Authorization", "apikey "+s.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("publish to centrifugo: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("centrifugo API error (status %d): %s", resp.StatusCode, string(respBody))
	}

	slog.Debug("published to centrifugo", "channel", channel)
	return nil
}

// PublishUserNotification pushes a notification to the user's personal channel.
func (s *CentrifugoSender) PublishUserNotification(ctx context.Context, userID string, notification interface{}) error {
	channel := "notifications#" + userID
	return s.Publish(ctx, channel, notification)
}
