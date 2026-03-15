import { pinoLogger } from 'hono-pino'
import pino from 'pino'
import { uuidv7 } from 'uuidv7'

export function createLogger(service: string) {
  return pino({
    name: service,
    level: process.env.LOG_LEVEL ?? 'info',
    formatters: {
      level(label) {
        return { level: label }
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  })
}

export function honoLogger(service: string) {
  return pinoLogger({
    pino: createLogger(service),
    http: {
      reqId: () => uuidv7(),
    },
  })
}

export type { Logger } from 'pino'
export { pino }
