import { MAX_PAGE_SIZE, paginationSchema } from '@kerjacus/shared'
import { z } from 'zod'

/**
 * Pagination for the public browse, which pages by 12 to fill its card grid.
 *
 * Only the default differs from the shared schema. The bounds are deliberately
 * the same, because this is the one list endpoint reachable without a session:
 * it parsed both inputs with a bare Number(), so `?pageSize=1000000` was that
 * LIMIT and `?page=abc` was OFFSET NaN. Deriving from paginationSchema is what
 * keeps a later change to the caps from missing the route that needs them most.
 */
export const publicPaginationSchema = paginationSchema.extend({
  pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(12),
})
