// Package iris talks to Midtrans Payouts (formerly Iris): the disbursement and
// account-validation API, separate from the Snap/Core acquiring API. Only
// account validation is wired today; it is what fills a talent's
// payout_verified_at before any money is allowed to move to that destination.
package iris

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
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
