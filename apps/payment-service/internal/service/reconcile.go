package service

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/kerjacus/payment-service/internal/iris"
)

// Defaults for the reconciliation sweep.
//
// The threshold is generous on purpose. Midtrans asks for a ten minute buffer
// after a create before Get Payout Details is authoritative, and a payout that
// is genuinely in flight at a bank can take a working day. A day old payout
// that Iris still calls queued is a real stall, not impatience.
const (
	DefaultReconcileInterval  = 15 * time.Minute
	DefaultReconcileThreshold = 24 * time.Hour
	reconcileBatchSize        = 100
	// Each sweep pass gets its own deadline so a hung gateway cannot hold the
	// ticker goroutine past the next tick.
	reconcilePassTimeout = 2 * time.Minute
)

/*
DisbursementReconciler resolves payouts Iris never reported on.

It exists because a payout notification can be lost, delayed, or never
configured at all, and until this ran there was no path out of 'queued' but the
notification: a payout whose callback went missing sat there for good, with the
talent's money booked as owed and never paid off. The sweep asks Iris directly
and settles the answer through exactly the same code the notification uses, so a
payout resolved here and one resolved by a callback are indistinguishable on the
books.

It asks under IrisBaseURL, not MidtransAPIURL. Those are different hosts for
different APIs: config.go names MidtransAPIURL the Core API base, where the
acquiring side's Get Status lives, and a payout's status is only ever under the
Iris root. Pointing this at MidtransAPIURL would query a host that has never
heard of the reference.

The shape is the outbox publisher's - Start hands a goroutine a ticker, Stop
waits for the pass in flight - rather than a second scheduler.
*/
type DisbursementReconciler struct {
	svc       *DisbursementService
	interval  time.Duration
	threshold time.Duration
	stop      chan struct{}
	done      chan struct{}

	// cancelPass cancels the pass in flight, so Stop bounds itself by the
	// shutdown budget rather than by reconcilePassTimeout.
	mu         sync.Mutex
	cancelPass context.CancelFunc
}

func NewDisbursementReconciler(svc *DisbursementService, interval, threshold time.Duration) *DisbursementReconciler {
	if interval <= 0 {
		interval = DefaultReconcileInterval
	}
	if threshold <= 0 {
		threshold = DefaultReconcileThreshold
	}
	return &DisbursementReconciler{
		svc:       svc,
		interval:  interval,
		threshold: threshold,
		stop:      make(chan struct{}),
		done:      make(chan struct{}),
	}
}

// Start runs the sweep on its interval until ctx is cancelled or Stop is
// called.
func (r *DisbursementReconciler) Start(ctx context.Context) {
	go r.loop(ctx)
	slog.Info("payout reconciliation sweep started",
		"interval", r.interval.String(), "threshold", r.threshold.String())
}

/*
Stop asks the pass in flight to wind up, then waits for the loop to leave.

It cancels rather than waiting the pass out. A pass is bounded by
reconcilePassTimeout, which is minutes, and main.go's shutdown budget is the 30
seconds Docker gives between SIGTERM and SIGKILL; waiting could overrun it and
be killed anyway. Cancelling is safe because each settlement is one
transaction: a cancelled pass rolls back whatever it was part way through, no
row is left half settled, and the next sweep picks it up.
*/
func (r *DisbursementReconciler) Stop() {
	select {
	case <-r.stop:
	default:
		close(r.stop)
	}

	r.mu.Lock()
	cancel := r.cancelPass
	r.mu.Unlock()
	if cancel != nil {
		cancel()
	}

	<-r.done
}

func (r *DisbursementReconciler) loop(ctx context.Context) {
	defer close(r.done)
	ticker := time.NewTicker(r.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-r.stop:
			return
		case <-ticker.C:
			r.runPass(ctx)
		}
	}
}

func (r *DisbursementReconciler) runPass(ctx context.Context) {
	passCtx, cancel := context.WithTimeout(ctx, reconcilePassTimeout)
	defer cancel()

	r.mu.Lock()
	r.cancelPass = cancel
	r.mu.Unlock()
	defer func() {
		r.mu.Lock()
		r.cancelPass = nil
		r.mu.Unlock()
	}()

	settled, err := r.Sweep(passCtx)
	switch {
	case err != nil:
		slog.Warn("payout reconciliation sweep error", "error", err)
	case settled > 0:
		slog.Info("payout reconciliation settled payouts", "count", settled)
	}
}

/*
Sweep asks Iris about every payout that has been still for longer than the
threshold and applies the answer. It returns how many payouts it moved.

A payout with no Iris reference is reported, never re-created. There is no Iris
endpoint that looks a payout up by idempotency key - Get Payout Details is keyed
on reference_no alone - so nothing here can establish whether a timed-out create
produced a payout, and Midtrans's five minute idempotency window is long gone by
the time a sweep sees the row. Creating again to find out would risk paying
twice, which is the one outcome this whole file exists to prevent, so these rows
are surfaced for a human with the dashboard instead.
*/
func (r *DisbursementReconciler) Sweep(ctx context.Context) (int, error) {
	if !r.svc.iris.Enabled() {
		return 0, nil
	}

	stuck, err := r.svc.store.ListStuck(ctx, r.threshold, reconcileBatchSize)
	if err != nil {
		return 0, err
	}

	settled := 0
	for i := range stuck {
		d := stuck[i]

		if d.IrisReferenceNo == nil || *d.IrisReferenceNo == "" {
			slog.Error("stuck payout has no gateway reference; it cannot be reconciled automatically",
				"disbursementId", d.ID, "talentId", d.TalentID, "amount", d.Amount,
				"idempotencyKey", d.IdempotencyKey, "stuckSince", d.UpdatedAt)
			continue
		}
		ref := *d.IrisReferenceNo

		status, statusErr := r.svc.iris.GetPayout(ctx, ref)
		if statusErr != nil {
			if errors.Is(statusErr, iris.ErrPayoutNotFound) {
				slog.Error("iris does not recognise a reference we recorded",
					"disbursementId", d.ID, "irisReferenceNo", ref)
				continue
			}
			slog.Warn("could not read payout status", "disbursementId", d.ID,
				"irisReferenceNo", ref, "error", statusErr)
			continue
		}

		if status.Status == iris.PayoutQueued {
			// Still waiting at the gateway: nothing to apply, and nothing has
			// gone wrong that this sweep can fix.
			slog.Warn("payout is still queued at the gateway past the reconciliation threshold",
				"disbursementId", d.ID, "irisReferenceNo", ref, "stuckSince", d.UpdatedAt)
			continue
		}

		outcome, settleErr := r.svc.settleByID(ctx, d.ID, status.Status, status.FailureReason())
		if settleErr != nil {
			slog.Error("could not settle a reconciled payout", "disbursementId", d.ID,
				"irisReferenceNo", ref, "irisStatus", status.Status, "error", settleErr)
			continue
		}
		if outcome.Changed {
			settled++
			slog.Info("reconciliation settled a payout", "disbursementId", d.ID,
				"irisReferenceNo", ref, "status", outcome.Status, "ledgerBooked", outcome.LedgerBooked)
		}
	}

	return settled, nil
}
