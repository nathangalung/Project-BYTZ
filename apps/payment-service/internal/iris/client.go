// Package iris talks to Midtrans Payouts (formerly Iris): the disbursement and
// account-validation API, separate from the Snap/Core acquiring API. Only
// account validation is wired today; it is what fills a talent's
// payout_verified_at before any money is allowed to move to that destination.
package iris

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// Client is a thin Iris caller. A zero API key means Iris is not configured, so
// the caller stays inert rather than failing: disbursement is opt-in per
// deployment, and an unconfigured platform simply cannot validate or pay out.
type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

// SandboxBaseURL and ProductionBaseURL are the Iris roots under the Midtrans
// host. The acquiring API lives elsewhere; these are not interchangeable.
const (
	SandboxBaseURL    = "https://app.sandbox.midtrans.com/iris"
	ProductionBaseURL = "https://app.midtrans.com/iris"
)

func NewClient(baseURL, apiKey string) *Client {
	return &Client{
		baseURL: baseURL,
		apiKey:  apiKey,
		http:    &http.Client{Timeout: 10 * time.Second},
	}
}

// Enabled reports whether an API key is present. Without one the platform
// cannot reach Iris, so every payout path treats a disabled client as "cannot
// validate, cannot pay" rather than an error.
func (c *Client) Enabled() bool { return c != nil && c.apiKey != "" }

// AccountValidation is Iris's answer for a bank or e-wallet destination: the
// registered holder name for the account, which the caller compares against the
// name the talent claimed before trusting the destination.
type AccountValidation struct {
	AccountNo   string `json:"account_no"`
	AccountName string `json:"account_name"`
	BankName    string `json:"bank_name"`
}

// InvalidAccountError is a destination Iris rejects (unknown account, wrong
// bank). It is a definitive "this account does not exist", distinct from a
// transport failure, so the caller can leave the destination unverified rather
// than retrying.
type InvalidAccountError struct {
	Status  int
	Message string
}

func (e *InvalidAccountError) Error() string {
	return fmt.Sprintf("iris rejected account (status %d): %s", e.Status, e.Message)
}

// ValidateAccount asks Iris for the registered holder of a destination. bank is
// the Iris bank code for a bank account or the e-wallet name (gopay/ovo);
// account is the account number, or the registered phone for an e-wallet.
func (c *Client) ValidateAccount(ctx context.Context, bank, account string) (*AccountValidation, error) {
	if !c.Enabled() {
		return nil, fmt.Errorf("iris client is not configured")
	}

	q := url.Values{}
	q.Set("bank", bank)
	q.Set("account", account)
	endpoint := fmt.Sprintf("%s/api/v1/account_validation?%s", c.baseURL, q.Encode())

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("build account validation request: %w", err)
	}
	// Iris uses the same Basic scheme as the acquiring API: the key as the
	// username with an empty password.
	req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(c.apiKey+":")))
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("call account validation: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read account validation response: %w", err)
	}

	// A 4xx is Iris's verdict on the account, not a transport failure. Surface
	// it as InvalidAccountError so the caller records "unverified" rather than
	// retrying a destination that will never validate.
	if resp.StatusCode >= 400 && resp.StatusCode < 500 {
		return nil, &InvalidAccountError{Status: resp.StatusCode, Message: irisErrorMessage(body)}
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("account validation returned status %d", resp.StatusCode)
	}

	var result AccountValidation
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("decode account validation response: %w", err)
	}
	if result.AccountName == "" {
		return nil, fmt.Errorf("account validation returned no holder name")
	}
	return &result, nil
}

// PayoutRequest is a single disbursement to a talent. Bank is the Iris bank
// code or e-wallet name; Account is the number or registered phone. Amount is in
// whole Rupiah and is sent to Iris as a numeric string.
type PayoutRequest struct {
	BeneficiaryName    string
	BeneficiaryAccount string
	BeneficiaryBank    string
	BeneficiaryEmail   string
	Amount             int64
	Notes              string
	IdempotencyKey     string
}

// PayoutResult is Iris's answer for a created payout: the reference number that
// identifies it in later approve calls and status notifications.
type PayoutResult struct {
	Status      string `json:"status"`
	ReferenceNo string `json:"reference_no"`
}

// CreatePayout queues a single payout. Iris returns a reference number even
// before the payout is approved; the status callback and the approve call both
// key off it. The idempotency key makes a retried create return the original
// rather than sending twice.
func (c *Client) CreatePayout(ctx context.Context, in PayoutRequest) (*PayoutResult, error) {
	if !c.Enabled() {
		return nil, fmt.Errorf("iris client is not configured")
	}
	if in.Amount <= 0 {
		return nil, fmt.Errorf("payout amount must be positive")
	}

	payload := map[string]any{
		"payouts": []map[string]any{
			{
				"beneficiary_name":    in.BeneficiaryName,
				"beneficiary_account": in.BeneficiaryAccount,
				"beneficiary_bank":    in.BeneficiaryBank,
				"beneficiary_email":   in.BeneficiaryEmail,
				"amount":              strconv.FormatInt(in.Amount, 10),
				"notes":               in.Notes,
			},
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal payout request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/v1/payouts", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build payout request: %w", err)
	}
	req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(c.apiKey+":")))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	// Iris deduplicates a create on this key, so a retry never sends twice.
	req.Header.Set("X-Idempotency-Key", in.IdempotencyKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("call create payout: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read payout response: %w", err)
	}

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("create payout returned status %d: %s", resp.StatusCode, irisErrorMessage(respBody))
	}

	var parsed struct {
		Payouts []PayoutResult `json:"payouts"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return nil, fmt.Errorf("decode payout response: %w", err)
	}
	if len(parsed.Payouts) == 0 || parsed.Payouts[0].ReferenceNo == "" {
		return nil, fmt.Errorf("create payout returned no reference number")
	}
	return &parsed.Payouts[0], nil
}

// ApprovePayout releases queued payouts to the bank. Iris's maker/checker model
// requires this second step; otp is empty when the approving account has OTP
// disabled. A payout is not sent until it is approved.
func (c *Client) ApprovePayout(ctx context.Context, referenceNos []string, otp string) error {
	if !c.Enabled() {
		return fmt.Errorf("iris client is not configured")
	}
	if len(referenceNos) == 0 {
		return fmt.Errorf("no reference numbers to approve")
	}

	payload := map[string]any{"reference_nos": referenceNos}
	if otp != "" {
		payload["otp"] = otp
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal approve request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/v1/payouts/approve", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build approve request: %w", err)
	}
	req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(c.apiKey+":")))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("call approve payout: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read approve response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("approve payout returned status %d: %s", resp.StatusCode, irisErrorMessage(respBody))
	}
	return nil
}

// irisErrorMessage pulls a human message out of an Iris error body, which comes
// as either {"error_message": "..."} or {"errors": ["...", ...]}.
func irisErrorMessage(body []byte) string {
	var single struct {
		ErrorMessage string   `json:"error_message"`
		Errors       []string `json:"errors"`
	}
	if err := json.Unmarshal(body, &single); err == nil {
		if single.ErrorMessage != "" {
			return single.ErrorMessage
		}
		if len(single.Errors) > 0 {
			return single.Errors[0]
		}
	}
	return "account rejected"
}
