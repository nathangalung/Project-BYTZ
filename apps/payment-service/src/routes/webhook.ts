import { createHash } from 'node:crypto'
import { getDb, transactionEvents, transactions } from '@bytz/db'
import type { TransactionStatus } from '@bytz/shared'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'

const midtransWebhookSchema = z.object({
  order_id: z.string(),
  status_code: z.string(),
  gross_amount: z.string(),
  signature_key: z.string(),
  transaction_status: z.string(),
  transaction_id: z.string().optional(),
  payment_type: z.string().optional(),
  fraud_status: z.string().optional(),
})

export const webhookRoute = new Hono()

// POST /api/v1/payments/webhook/midtrans
webhookRoute.post('/midtrans', async (c) => {
  const body = await c.req.json()
  const parsed = midtransWebhookSchema.safeParse(body)

  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid webhook payload',
          details: parsed.error.flatten().fieldErrors,
        },
      },
      400,
    )
  }

  const { order_id, status_code, gross_amount, signature_key, transaction_status, payment_type } =
    parsed.data

  // Verify SHA512 signature
  const serverKey = process.env.MIDTRANS_SERVER_KEY ?? ''
  const expectedSignature = createHash('sha512')
    .update(`${order_id}${status_code}${gross_amount}${serverKey}`)
    .digest('hex')

  if (signature_key !== expectedSignature) {
    console.error('Webhook signature mismatch', {
      orderId: order_id,
      expected: `${expectedSignature.substring(0, 16)}...`,
      received: `${signature_key.substring(0, 16)}...`,
    })
    return c.json(
      {
        success: false,
        error: {
          code: 'PAYMENT_GATEWAY_ERROR',
          message: 'Invalid signature',
        },
      },
      403,
    )
  }

  const db = getDb()

  // Find transaction by order_id (mapped to idempotency_key)
  const [txn] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.idempotencyKey, order_id))
    .limit(1)

  if (!txn) {
    console.error('Webhook received for unknown order', { orderId: order_id })
    return c.json(
      {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Transaction not found' },
      },
      404,
    )
  }

  // Map Midtrans transaction_status to internal status
  let newStatus: TransactionStatus
  switch (transaction_status) {
    case 'capture':
    case 'settlement':
      newStatus = 'completed'
      break
    case 'pending':
      newStatus = 'processing'
      break
    case 'deny':
    case 'cancel':
    case 'expire':
      newStatus = 'failed'
      break
    case 'refund':
    case 'partial_refund':
      newStatus = 'refunded'
      break
    default:
      // Unknown status, keep current
      newStatus = txn.status as TransactionStatus
  }

  // Skip if status unchanged (idempotent)
  if (txn.status === newStatus) {
    return c.json({ success: true, data: { received: true, changed: false } })
  }

  const previousStatus = txn.status as TransactionStatus

  // Update transaction in a single db transaction
  await db.transaction(async (tx) => {
    await tx
      .update(transactions)
      .set({
        status: newStatus,
        paymentMethod: payment_type ?? txn.paymentMethod,
        paymentGatewayRef: parsed.data.transaction_id ?? txn.paymentGatewayRef,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, txn.id))

    // Determine event type based on new status
    let eventType: 'escrow_created' | 'funds_released' | 'refund_initiated' = 'escrow_created'
    if (newStatus === 'completed') {
      eventType = txn.type === 'escrow_release' ? 'funds_released' : 'escrow_created'
    } else if (newStatus === 'refunded') {
      eventType = 'refund_initiated'
    }

    await tx.insert(transactionEvents).values({
      id: uuidv7(),
      transactionId: txn.id,
      eventType,
      previousStatus,
      newStatus,
      amount: Number.parseInt(gross_amount, 10) || txn.amount,
      metadata: {
        source: 'midtrans_webhook',
        midtrans_status: transaction_status,
        midtrans_status_code: status_code,
        payment_type,
      },
      performedBy: txn.workerId ?? txn.projectId,
      createdAt: new Date(),
    })
  })

  console.log('Webhook processed', {
    orderId: order_id,
    previousStatus,
    newStatus,
    transactionId: txn.id,
  })

  return c.json({ success: true, data: { received: true, changed: true } })
})
