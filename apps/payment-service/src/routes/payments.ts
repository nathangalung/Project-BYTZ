import { Hono } from 'hono'
import { z } from 'zod'
import { paymentService } from '../services/payment.service'

const createEscrowSchema = z.object({
  projectId: z.string().min(1),
  amount: z.number().int().positive(),
  workPackageId: z.string().optional(),
  workerId: z.string().optional(),
  clientId: z.string().min(1),
  idempotencyKey: z.string().min(1),
})

const releaseEscrowSchema = z.object({
  milestoneId: z.string().min(1),
  projectId: z.string().min(1),
  workerId: z.string().min(1),
  amount: z.number().int().positive(),
  performedBy: z.string().min(1),
  idempotencyKey: z.string().min(1),
})

const refundSchema = z.object({
  originalTransactionId: z.string().min(1),
  amount: z.number().int().positive(),
  reason: z.string().min(1),
  clientId: z.string().min(1),
  performedBy: z.string().min(1),
  idempotencyKey: z.string().min(1),
})

const webhookSchema = z.object({
  order_id: z.string(),
  status_code: z.string(),
  gross_amount: z.string(),
  signature_key: z.string().optional(),
  transaction_status: z.string(),
})

export const paymentsRoute = new Hono()

// POST /payments/escrow
paymentsRoute.post('/escrow', async (c) => {
  const body = await c.req.json()
  const parsed = createEscrowSchema.safeParse(body)

  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          details: parsed.error.flatten().fieldErrors,
        },
      },
      400,
    )
  }

  const transaction = await paymentService.createEscrow(parsed.data)
  return c.json({ success: true, data: transaction }, 201)
})

// POST /payments/release
paymentsRoute.post('/release', async (c) => {
  const body = await c.req.json()
  const parsed = releaseEscrowSchema.safeParse(body)

  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          details: parsed.error.flatten().fieldErrors,
        },
      },
      400,
    )
  }

  const transaction = await paymentService.releaseEscrow(parsed.data)
  return c.json({ success: true, data: transaction })
})

// POST /payments/refund
paymentsRoute.post('/refund', async (c) => {
  const body = await c.req.json()
  const parsed = refundSchema.safeParse(body)

  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          details: parsed.error.flatten().fieldErrors,
        },
      },
      400,
    )
  }

  const transaction = await paymentService.processRefund(parsed.data)
  return c.json({ success: true, data: transaction })
})

// GET /payments/project/:projectId
paymentsRoute.get('/project/:projectId', async (c) => {
  const projectId = c.req.param('projectId')
  const transactions = await paymentService.getProjectTransactions(projectId)
  return c.json({ success: true, data: transactions })
})

// GET /payments/:id
paymentsRoute.get('/:id', async (c) => {
  const id = c.req.param('id')
  const transaction = await paymentService.getTransactionById(id)
  return c.json({ success: true, data: transaction })
})

// POST /payments/webhook
paymentsRoute.post('/webhook', async (c) => {
  const body = await c.req.json()
  const parsed = webhookSchema.safeParse(body)

  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid webhook payload',
        },
      },
      400,
    )
  }

  // TODO: Validate signature from payment gateway (Midtrans SHA512)
  // const serverKey = process.env.MIDTRANS_SERVER_KEY;
  // const expectedSignature = sha512(parsed.data.order_id + parsed.data.status_code + parsed.data.gross_amount + serverKey);
  // if (expectedSignature !== parsed.data.signature_key) { ... }

  // Log webhook receipt for now
  console.log('Payment webhook received:', parsed.data)

  return c.json({ success: true, data: { received: true } })
})
