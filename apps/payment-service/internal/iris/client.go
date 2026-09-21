// Package iris talks to Midtrans Payouts (formerly Iris): the disbursement and
// account-validation API, separate from the Snap/Core acquiring API. Only
// account validation is wired today; it is what fills a talent's
// payout_verified_at before any money is allowed to move to that destination.
package iris

import (
	"bytes"
	"context"
	"crypto/sha512"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
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

// Payout statuses as Iris reports them, on the create response, on Get Payout
// Details and in a payout notification. They are the same four words the
// disbursement_status enum uses for everything past 'pending', which is why the
// gateway's answer can be stored without translation.
//
// Documented meanings (Midtrans, Get Payout Details):
//
//	queued    - payout is waiting to be executed
//	processed - payout request is sent to the bank and completed
//	completed - payout request is sent to the bank and received by beneficiary
//	failed    - payout didn't go through
const (
	PayoutQueued    = "queued"
	PayoutProcessed = "processed"
	PayoutCompleted = "completed"
	PayoutFailed    = "failed"
)

// ErrPayoutNotFound is Iris answering that it holds no payout under a
// reference. It is a definitive "there is nothing here", as distinct from a
// call that could not be completed.
var ErrPayoutNotFound = errors.New("iris has no payout under that reference")

// PayoutRejectedError is Iris definitively refusing to create a payout: a
// malformed request, a rejected beneficiary, an exhausted balance. Iris
// answered, and its answer is that nothing was created, so the caller may
// safely try again once the cause is fixed.
//
// 408 and 429 are deliberately NOT rejections: a request that timed out at the
// gateway or was shed under load may still have been accepted.
type PayoutRejectedError struct {
	Status  int
	Message string
}

func (e *PayoutRejectedError) Error() string {
	return fmt.Sprintf("iris rejected the payout (status %d): %s", e.Status, e.Message)
}

/*
AmbiguousError is a payout call whose outcome cannot be established: a client
timeout, a connection failure, a 5xx, a 408 or 429, or a 2xx whose body could
not be read or parsed.

It exists because "the call failed" and "the payout was not created" are
different facts, and only the second one makes a retry safe. Midtrans
deduplicates a create on X-Idempotency-Key for five minutes; past that window a
second POST with the same key is a second payout. So an ambiguous create must
never feed a path that creates again - see DisbursementService.Execute, which
leaves such a row queued rather than returning it to the retryable set.
*/
type AmbiguousError struct {
	Op     string
	Status int
	Err    error
}

func (e *AmbiguousError) Error() string {
	if e.Status != 0 {
		return fmt.Sprintf("iris %s outcome unknown (status %d)", e.Op, e.Status)
	}
	return fmt.Sprintf("iris %s outcome unknown: %v", e.Op, e.Err)
}

func (e *AmbiguousError) Unwrap() error { return e.Err }

// ambiguousStatus reports whether an HTTP status leaves the outcome of a write
// unknown. A 5xx may have been applied before the failure; a 408 is the
// gateway's own timeout; a 429 is load shedding that can happen after the work.
func ambiguousStatus(code int) bool {
	return code >= 500 || code == http.StatusRequestTimeout || code == http.StatusTooManyRequests
}

/*
NotificationSignature computes the value Midtrans puts in the Iris-Signature
header of a payout notification.

Per Midtrans "Validating Payout Notification": the signature is
SHA512(stringFromHttpNotificationBody + merchantKey), hex encoded, where
merchantKey is the Iris Merchant Key from the Midtrans dashboard. Note that this
is a plain digest over a concatenation, not an HMAC, and that the merchant key
is a different secret from the Iris creator/approver API key this client
authenticates with.

body must be the bytes exactly as they arrived. Re-marshalling the parsed
payload changes key order and whitespace and would never match.
*/
func NotificationSignature(body []byte, merchantKey string) string {
	sum := sha512.Sum512(append(append([]byte{}, body...), merchantKey...))
	return hex.EncodeToString(sum[:])
}

// VerifyNotification reports whether a payout notification carries the
// signature Midtrans would have produced for it. An empty merchant key or an
// empty header never verifies: without the secret the endpoint cannot tell a
// notification from a forgery, so it must refuse rather than accept.
func VerifyNotification(body []byte, signature, merchantKey string) bool {
	if merchantKey == "" || signature == "" {
		return false
	}
	expected := NotificationSignature(body, merchantKey)
	return subtle.ConstantTimeCompare([]byte(signature), []byte(expected)) == 1
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

/*
CreatePayout queues a single payout. Iris returns a reference number even
before the payout is approved; the status callback and the approve call both
key off it.

Every failure is classified, because the caller's next move depends entirely on
which kind it is. A *PayoutRejectedError means Iris answered and created
nothing, so the payout may be tried again. An *AmbiguousError means the outcome
is unknown, and creating again could send the money twice: Midtrans honours
X-Idempotency-Key for five minutes only, so a retry outside that window is a
second payout, not a deduplicated one.

A 2xx whose body cannot be read or parsed is ambiguous, not a failure: the
payout exists at the gateway and we simply do not know its reference.
*/
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
	// X-Idempotency-Key is the header the Iris Create Payout reference names
	// ("Please ensure X-Idempotency-Key header is provided"); the Core API uses
	// the differently spelled Idempotency-Key, which is not this endpoint.
	// Deduplication is real but short lived - Midtrans documents a five minute
	// key lifetime - so it protects an immediate retry and nothing later. That
	// is why an ambiguous outcome is never retried blindly here.
	req.Header.Set("X-Idempotency-Key", in.IdempotencyKey)

	resp, err := c.http.Do(req)
	if err != nil {
		// A transport failure covers the timeout case: the request may have
		// reached Iris and created a payout whose response we never saw.
		return nil, &AmbiguousError{Op: "create payout", Err: err}
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, &AmbiguousError{Op: "create payout", Status: resp.StatusCode, Err: err}
	}

	if ambiguousStatus(resp.StatusCode) {
		return nil, &AmbiguousError{
			Op:     "create payout",
			Status: resp.StatusCode,
			Err:    errors.New(irisErrorMessage(respBody)),
		}
	}
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return nil, &PayoutRejectedError{Status: resp.StatusCode, Message: irisErrorMessage(respBody)}
	}

	var parsed struct {
		Payouts []PayoutResult `json:"payouts"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return nil, &AmbiguousError{Op: "create payout", Status: resp.StatusCode, Err: err}
	}
	if len(parsed.Payouts) == 0 || parsed.Payouts[0].ReferenceNo == "" {
		return nil, &AmbiguousError{
			Op:     "create payout",
			Status: resp.StatusCode,
			Err:    errors.New("create payout returned no reference number"),
		}
	}
	return &parsed.Payouts[0], nil
}

// PayoutStatus is Iris's account of one payout, as returned by Get Payout
// Details. Status is one of the four Payout* constants; ErrorDetails carries
// whatever the gateway said about a failure, in whichever shape it sent.
type PayoutStatus struct {
	ReferenceNo        string          `json:"reference_no"`
	Status             string          `json:"status"`
	Amount             string          `json:"amount"`
	BeneficiaryName    string          `json:"beneficiary_name"`
	BeneficiaryAccount string          `json:"beneficiary_account"`
	Bank               string          `json:"bank"`
	Notes              string          `json:"notes"`
	ErrorDetails       json.RawMessage `json:"error_details"`
	UpdatedAt          string          `json:"updated_at"`
}

// FailureReason renders whatever Iris said about a failed payout into one line
// worth storing on the row. Empty when the gateway gave no detail.
func (p *PayoutStatus) FailureReason() string {
	if len(p.ErrorDetails) == 0 || string(p.ErrorDetails) == "null" {
		return ""
	}
	return string(p.ErrorDetails)
}

/*
GetPayout reads Iris's own account of a payout: GET /api/v1/payouts/{reference_no}.

This is the reconciliation primitive. A payout notification can be lost or
delayed, and the documented way to learn a payout's real state is to ask,
exactly as the acquiring side's Get Status does. Midtrans asks for a ten minute
buffer after a create before the answer is final, which is why the sweep that
calls this only looks at payouts that have been still for far longer.

A 404 is ErrPayoutNotFound: a definite "no such payout". Anything that leaves
the answer unknown is an *AmbiguousError, so a caller cannot mistake "we could
not ask" for "it is not there".
*/
func (c *Client) GetPayout(ctx context.Context, referenceNo string) (*PayoutStatus, error) {
	if !c.Enabled() {
		return nil, fmt.Errorf("iris client is not configured")
	}
	if referenceNo == "" {
		return nil, fmt.Errorf("reference number is required")
	}

	endpoint := fmt.Sprintf("%s/api/v1/payouts/%s", c.baseURL, url.PathEscape(referenceNo))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("build payout status request: %w", err)
	}
	req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(c.apiKey+":")))
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, &AmbiguousError{Op: "get payout", Err: err}
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, &AmbiguousError{Op: "get payout", Status: resp.StatusCode, Err: err}
	}

	if resp.StatusCode == http.StatusNotFound {
		return nil, ErrPayoutNotFound
	}
	if ambiguousStatus(resp.StatusCode) {
		return nil, &AmbiguousError{
			Op:     "get payout",
			Status: resp.StatusCode,
			Err:    errors.New(irisErrorMessage(body)),
		}
	}
	if resp.StatusCode != http.StatusOK {
		return nil, &PayoutRejectedError{Status: resp.StatusCode, Message: irisErrorMessage(body)}
	}

	var parsed PayoutStatus
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, &AmbiguousError{Op: "get payout", Status: resp.StatusCode, Err: err}
	}
	if parsed.Status == "" {
		return nil, &AmbiguousError{
			Op:     "get payout",
			Status: resp.StatusCode,
			Err:    errors.New("payout details carried no status"),
		}
	}
	if parsed.ReferenceNo == "" {
		parsed.ReferenceNo = referenceNo
	}
	return &parsed, nil
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
