import type { Context, Next } from 'hono'
import { uuidv7 } from 'uuidv7'

export async function correlationId(c: Context, next: Next) {
  const requestId = c.req.header('X-Request-ID') ?? uuidv7()
  c.header('X-Request-ID', requestId)
  c.set('requestId', requestId)
  await next()
}
