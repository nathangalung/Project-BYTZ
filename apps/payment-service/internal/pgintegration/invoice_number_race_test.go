package pgintegration

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/kerjacus/payment-service/internal/testsupport"
)

// mintInvoiceNumber is the minting rule as
// apps/project-service/src/repositories/invoice.repository.ts:138 implements
// it: count the project's already-invoiced milestones, add one, pad to four
// digits behind the project's last eight characters. No lock, no sequence, no
// unique index behind it.
//
// The real call site is TypeScript, and no Go file mentions invoice_number.
// What is reproduced here is the SQL shape against the shared schema, so what
// this test proves is a property of the schema - that nothing in it stops two
// concurrent minters agreeing on a number - rather than coverage of that
// TypeScript function. A racing test at the actual call site belongs in
// project-service's integration suite.
func mintInvoiceNumber(ctx context.Context, tx pgx.Tx, projectID string) (string, error) {
	var count int
	err := tx.QueryRow(ctx,
		`SELECT COUNT(DISTINCT milestone_id)::int FROM project_invoices WHERE project_id = $1`,
		projectID).Scan(&count)
	if err != nil {
		return "", fmt.Errorf("count invoiced milestones: %w", err)
	}
	shortID := strings.ToUpper(projectID[len(projectID)-8:])
	return fmt.Sprintf("INV-%s-%04d", shortID, count+1), nil
}

// invoiceAudiences is the three copies one settlement owes.
var invoiceAudiences = []string{"owner", "talent", "admin"}

// TestConcurrentInvoiceNumbersAreUniquePerProject fails on main. That is the
// point of it.
//
// Two milestones of one project approved at the same moment both count zero
// invoiced milestones, both mint INV-<project>-0001, and both store it. The
// project then has two settlements sharing one invoice number, which is a
// reconciliation the finance side cannot do and a document the tax office
// cannot accept.
//
// The assertion is the invariant, not a constraint: distinct milestones of one
// project must never share an invoice number. It is deliberately not "a unique
// index exists on (project_id, invoice_number)", because that index would be
// wrong here - packages/db/src/schema/payment.ts documents that the three
// audience copies of one settlement share a number on purpose, migration 0009
// added a unique index on invoice_number and migration 0019 dropped it again
// for exactly that reason. Stating the invariant instead leaves the fix PR free
// to land a unique index on (project_id, invoice_number, audience), a counter
// table, an advisory lock or a sequence, and this test passes for any of them.
//
// Gated rather than deleted: this PR changes no application logic, so CI must
// stay green. `RUN_KNOWN_FAILING=1 go test ./internal/pgintegration/...` runs
// it and shows the duplicate today. Activating it permanently is deleting the
// SkipUntilFixed line.
func TestConcurrentInvoiceNumbersAreUniquePerProject(t *testing.T) {
	testsupport.SkipUntilFixed(t, "the per-project invoice number fix (money-safety: invoice UNIQUE)")

	pool := testsupport.Pool(t)
	ctx := testsupport.Ctx(t)
	f := testsupport.NewFixture(t, pool)

	milestones := []string{
		f.SeedMilestone(t, 1, 2_000_000),
		f.SeedMilestone(t, 2, 3_000_000),
	}

	// Phase one mints, phase two writes. The two writers touch disjoint rows,
	// so nothing blocks and the barrier cannot deadlock; it only guarantees
	// that both minted before either stored, which is the window the missing
	// lock leaves open.
	var minted sync.WaitGroup
	var stored sync.WaitGroup
	minted.Add(len(milestones))
	stored.Add(len(milestones))

	errs := make([]error, len(milestones))

	for i, milestoneID := range milestones {
		go func() {
			defer stored.Done()
			errs[i] = func() error {
				tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
				if err != nil {
					minted.Done()
					return fmt.Errorf("begin: %w", err)
				}
				defer tx.Rollback(ctx) //nolint:errcheck

				number, err := mintInvoiceNumber(ctx, tx, f.ProjectID)
				minted.Done()
				if err != nil {
					return err
				}
				minted.Wait()

				for _, audience := range invoiceAudiences {
					_, err = tx.Exec(ctx, `
						INSERT INTO project_invoices
							(id, project_id, milestone_id, invoice_number, pdf_url, audience)
						VALUES ($1, $2, $3, $4, 'file:///integration.pdf', $5::invoice_audience)
					`, f.ID("invoice"), f.ProjectID, milestoneID, number, audience)
					if err != nil {
						return fmt.Errorf("store %s copy: %w", audience, err)
					}
				}
				return tx.Commit(ctx)
			}()
		}()
	}
	stored.Wait()

	// A fix that serialises the minters will make one side lose its
	// transaction rather than mint a duplicate, and that is a pass: the
	// invariant is about what ends up stored.
	settled := 0
	for i, err := range errs {
		if err == nil {
			settled++
			continue
		}
		t.Logf("minter %d did not settle: %v", i, err)
	}
	if settled == 0 {
		t.Fatal("neither minter settled, so nothing was tested")
	}

	byNumber := map[string][]string{}
	rows, err := pool.Query(ctx,
		`SELECT DISTINCT invoice_number, milestone_id FROM project_invoices WHERE project_id = $1`,
		f.ProjectID)
	if err != nil {
		t.Fatalf("read stored invoices: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var number, milestoneID string
		if err := rows.Scan(&number, &milestoneID); err != nil {
			t.Fatalf("scan stored invoice: %v", err)
		}
		byNumber[number] = append(byNumber[number], milestoneID)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate stored invoices: %v", err)
	}

	for number, owners := range byNumber {
		if len(owners) > 1 {
			t.Errorf("invoice number %s was minted for %d distinct milestones (%v); "+
				"one project's settlements must not share a number", number, len(owners), owners)
		}
	}
}

// TestOneMilestoneShareOneInvoiceNumberAcrossAudiences pins the design the
// race fix must not break.
//
// It passes today and must keep passing. Without it, the cheapest-looking fix
// for the race above - a unique index on (project_id, invoice_number) - would
// look correct and would reject the talent and admin copies of every
// settlement, which is the constraint migration 0019 already removed once.
func TestOneMilestoneShareOneInvoiceNumberAcrossAudiences(t *testing.T) {
	pool := testsupport.Pool(t)
	ctx := testsupport.Ctx(t)
	f := testsupport.NewFixture(t, pool)

	milestoneID := f.SeedMilestone(t, 1, 2_000_000)
	number := fmt.Sprintf("INV-%s-0001", strings.ToUpper(f.ProjectID[len(f.ProjectID)-8:]))

	for _, audience := range invoiceAudiences {
		_, err := pool.Exec(ctx, `
			INSERT INTO project_invoices
				(id, project_id, milestone_id, invoice_number, pdf_url, audience)
			VALUES ($1, $2, $3, $4, 'file:///integration.pdf', $5::invoice_audience)
		`, f.ID("invoice"), f.ProjectID, milestoneID, number, audience)
		if err != nil {
			t.Fatalf("the %s copy of one settlement must share the number: %v", audience, err)
		}
	}

	// The same milestone twice for one audience is the duplicate the schema
	// does refuse, via uq_project_invoices_milestone_audience.
	_, err := pool.Exec(ctx, `
		INSERT INTO project_invoices
			(id, project_id, milestone_id, invoice_number, pdf_url, audience)
		VALUES ($1, $2, $3, $4, 'file:///integration.pdf', 'owner')
	`, f.ID("invoice"), f.ProjectID, milestoneID, number)
	if err == nil {
		t.Fatal("a second owner copy of one milestone was accepted; uq_project_invoices_milestone_audience is gone")
	}
}
