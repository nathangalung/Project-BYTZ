package handler

import "github.com/gofiber/fiber/v2"

// Mirrors MAX_PAGE and MAX_PAGE_SIZE in packages/shared/src/schemas.ts.
const (
	maxPage     = 1000
	maxPageSize = 100
)

// clampPagination bounds both ends of a page request.
//
// Only the lower bound on page and the upper bound on pageSize were enforced
// before, one hand-rolled copy per handler. That left two holes. A negative
// pageSize reached LIMIT unchanged, which Postgres rejects and the handler
// reports as a 500 rather than as bad input. And page had no ceiling, so
// offset is page times pageSize and an arbitrarily large page walked that many
// index entries to return nothing.
func clampPagination(c *fiber.Ctx, defaultPageSize int) (page int, pageSize int) {
	page = c.QueryInt("page", 1)
	pageSize = c.QueryInt("pageSize", defaultPageSize)
	if page < 1 {
		page = 1
	}
	if page > maxPage {
		page = maxPage
	}
	if pageSize < 1 {
		pageSize = defaultPageSize
	}
	if pageSize > maxPageSize {
		pageSize = maxPageSize
	}
	return page, pageSize
}
