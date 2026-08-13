import { AppError } from '@kerjacus/shared'
import { Hono } from 'hono'
import { z } from 'zod'
import { env } from '../../lib/env'
import { buildSettlementService } from '../../services/settlement-service.factory'

/**
 * The money boundary of a project, kept apart from the rest of it.
 *
 * This is the only handler in the project surface that payment-service calls
 * rather than a browser, it authenticates with a shared secret instead of a
 * session, and it is the one place a payment turns into a status change. It
 * lived in the middle of an 1831-line file next to the scoping chat and the
 * PDF renderer, so a change to BRD pricing recompiled and retested the
 * settlement path.
 *
 * Mounted into projectsRoute rather than the app, so the URL is unchanged.
 */

const paymentCallbackSchema = z.object({
  orderId: z.string().min(1),
  status: z.string().min(1),
  amount: z.number().optional(),
})

export const settlementRoutes = new Hono()

// POST /projects/:id/payment-callback, from payment-service.
settlementRoutes.post('/:id/payment-callback', async (c) => {
  const serviceAuth = c.req.header('X-Service-Auth')
  const secret = env.SERVICE_AUTH_SECRET
  if (!secret || serviceAuth !== secret) {
    throw new AppError('AUTH_UNAUTHORIZED', 'Invalid service authentication')
  }

  const projectId = c.req.param('id')
  const body = await c.req.json()

  const parsed = paymentCallbackSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid payment callback data', {
      issues: z.flattenError(parsed.error).fieldErrors,
    })
  }

  const { orderId, status } = parsed.data

  if (status !== 'completed') {
    return c.json({ success: true, data: { processed: false, reason: 'non-completed status' } })
  }

  // What settling means lives in the service, where each branch can be tested
  // against a retried notification without needing HTTP and a database.
  const result = await buildSettlementService().settle(projectId, orderId, parsed.data.amount)
  return c.json({ success: true, data: result })
})
