package handler

import (
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
)

// clampPagination bounds both ends. The hand-rolled copies it replaced bounded
// page below and pageSize above, so a negative pageSize reached LIMIT and an
// arbitrarily large page produced an unbounded OFFSET.
func TestClampPagination(t *testing.T) {
	cases := []struct {
		name            string
		query           string
		defaultPageSize int
		wantPage        int
		wantPageSize    int
	}{
		{"defaults when absent", "", 50, 1, 50},
		{"passes a valid pair through", "?page=3&pageSize=25", 50, 3, 25},
		{"raises page below one", "?page=0", 50, 1, 50},
		{"raises a negative page", "?page=-7", 50, 1, 50},
		{"caps page at the maximum", "?page=100000000", 50, maxPage, 50},
		{"caps pageSize at the maximum", "?pageSize=5000", 50, 1, maxPageSize},
		{"restores the default for a negative pageSize", "?pageSize=-1", 50, 1, 50},
		{"restores the default for a zero pageSize", "?pageSize=0", 20, 1, 20},
		{"treats junk as absent", "?page=abc&pageSize=xyz", 50, 1, 50},
		{"bounds both ends at once", "?page=99999&pageSize=-3", 20, maxPage, 20},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			app := fiber.New()
			var gotPage, gotPageSize int
			app.Get("/", func(c *fiber.Ctx) error {
				gotPage, gotPageSize = clampPagination(c, tc.defaultPageSize)
				return nil
			})

			if _, err := app.Test(httptest.NewRequest("GET", "/"+tc.query, nil)); err != nil {
				t.Fatalf("request: %v", err)
			}
			if gotPage != tc.wantPage {
				t.Errorf("page = %d, want %d", gotPage, tc.wantPage)
			}
			if gotPageSize != tc.wantPageSize {
				t.Errorf("pageSize = %d, want %d", gotPageSize, tc.wantPageSize)
			}
		})
	}
}
