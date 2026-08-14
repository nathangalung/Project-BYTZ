package main

import (
	"errors"
	"os"
	"os/exec"
	"strings"
	"testing"
)

/*
run wires the process together and must fail fast rather than start serving on
a broken configuration. An admin service that binds its port without a database
answers every dashboard and dispute query with a 500 while looking healthy to
Traefik, which routes to it because the container is up.

Only the failing paths are reachable without live infrastructure. Everything
past the database ping - the NATS publisher, the route table, the listener, the
shutdown sequence - needs a real Postgres, and is exercised by the compose
stack instead.
*/
func TestRun_FailsFastOnBrokenConfiguration(t *testing.T) {
	tests := []struct {
		name    string
		env     map[string]string
		wantErr string
	}{
		{
			name:    "no database url",
			env:     map[string]string{"DATABASE_URL": ""},
			wantErr: "load config: DATABASE_URL is required",
		},
		{
			name:    "unparseable port",
			env:     map[string]string{"DATABASE_URL": "postgres://u:p@127.0.0.1:1/db", "PORT": "not-a-number"},
			wantErr: "load config: invalid PORT",
		},
		{
			name:    "unparseable database url",
			env:     map[string]string{"DATABASE_URL": "not-a-dsn"},
			wantErr: "create database pool",
		},
		{
			name:    "database unreachable",
			env:     map[string]string{"DATABASE_URL": "postgres://u:p@127.0.0.1:1/db"},
			wantErr: "ping database",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Telemetry is not what is under test, and its exporters would
			// otherwise buffer for a collector that is not there.
			t.Setenv("OTEL_DISABLED", "true")
			t.Setenv("PORT", "")
			for k, v := range tt.env {
				t.Setenv(k, v)
			}

			err := run()
			if err == nil {
				t.Fatal("run started the service on a broken configuration")
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("error = %q, want it to mention %q", err.Error(), tt.wantErr)
			}
		})
	}
}

// main must turn a fatal startup error into a non-zero exit. Exiting zero would
// look like a clean shutdown to Docker, so a container that can never serve
// traffic would not be restarted or reported as failed.
func TestMain_ExitsNonZeroWhenRunFails(t *testing.T) {
	if os.Getenv("ADMIN_SERVICE_MAIN_UNDER_TEST") == "1" {
		main()
		return
	}

	cmd := exec.Command(os.Args[0], "-test.run=TestMain_ExitsNonZeroWhenRunFails")
	cmd.Env = append(os.Environ(),
		"ADMIN_SERVICE_MAIN_UNDER_TEST=1",
		"OTEL_DISABLED=true",
		"DATABASE_URL=postgres://u:p@127.0.0.1:1/db",
	)
	output, err := cmd.CombinedOutput()

	var exitErr *exec.ExitError
	if err == nil {
		t.Fatalf("main exited zero on a fatal error:\n%s", output)
	}
	if !errors.As(err, &exitErr) {
		t.Fatalf("main did not exit: %v", err)
	}
	if code := exitErr.ExitCode(); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
	if !strings.Contains(string(output), "fatal") {
		t.Errorf("the fatal error was not logged:\n%s", output)
	}
}
