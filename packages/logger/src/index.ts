import { pinoLogger } from 'hono-pino'
import pino from 'pino'
import { uuidv7 } from 'uuidv7'

/**
 * `destination` exists so a test can read what was actually written. pino's
 * default is a SonicBoom on fd 1, which does not go through
 * process.stdout.write, so redaction cannot be asserted end to end without it.
 * Production passes nothing and keeps the default.
 */
export function createLogger(service: string, destination?: pino.DestinationStream) {
  return pino(
    {
      name: service,
      level: process.env.LOG_LEVEL ?? 'info',
      /**
       * hono-pino serialises req.headers and res.headers wholesale, and these
       * logs ship to OpenObserve, so without this every one of these values is
       * searchable for the whole retention window.
       *
       * Measured against both services running locally: `cookie` arrived
       * carrying a live session token, `x-service-auth` carried the shared
       * secret in full, and `set-cookie` on a successful POST /sign-in/email
       * carried a freshly minted token at level info. That last one is the
       * worst of the three: one query over the log store returns a working
       * session for every login, and the token still authenticates because
       * nothing about being logged invalidates it.
       *
       * Redaction happens before serialisation, so lines carrying none of these
       * keys pay nothing.
       */
      redact: {
        paths: [
          'req.headers.cookie',
          'req.headers.authorization',
          'req.headers["x-service-auth"]',
          'res.headers["set-cookie"]',
        ],
        censor: '[redacted]',
      },
      formatters: {
        level(label) {
          return { level: label }
        },
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    destination,
  )
}

export function honoLogger(service: string, destination?: pino.DestinationStream) {
  return pinoLogger({
    pino: createLogger(service, destination),
    http: {
      reqId: () => uuidv7(),
    },
  })
}

export type { Logger } from 'pino'
export {
  captureTraceContext,
  extractNatsTraceContext,
  injectNatsTraceContext,
  type NatsHeaderCarrier,
  restoreTraceContext,
} from './nats-tracing'
export { initTracing } from './tracing'
export { pino }
