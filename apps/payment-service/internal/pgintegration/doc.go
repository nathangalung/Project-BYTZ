// Package pgintegration holds the payment-service tests that need a real
// Postgres, kept apart from the mock suites so it is obvious which is which.
//
// Every test here skips unless TEST_DATABASE_URL names a migrated database
// whose name ends in _test; see internal/testsupport for why that gate is a
// runtime skip rather than a build tag. CI sets the variable, so they run
// there.
//
// The package holds no production code. This file exists only because a
// directory of nothing but _test.go files is not a package `go build ./...`
// can load.
package pgintegration
