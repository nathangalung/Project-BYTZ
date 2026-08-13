import { getDb } from '@kerjacus/db'
import { ProjectRepository } from '../repositories/project.repository'
import { PaymentSettlementService } from './payment-settlement.service'
import { ProjectService } from './project.service'

/**
 * Builds the settlement service with its status-transition dependency.
 *
 * Two callers need this: the payment-callback route and the NATS settlement
 * consumer. Wiring it in either one makes that caller the owner of a graph it
 * has no other reason to know about, and putting it in the route means the
 * consumer imports a route module, which is the inversion already removed from
 * invoice-consumer.
 *
 * A fresh instance per call, not a cached singleton like the invoice factory:
 * this one holds no client or connection worth reusing, and settle() is
 * stateless.
 */
export function buildSettlementService(): PaymentSettlementService {
  const db = getDb()
  const projects = new ProjectService(new ProjectRepository(db))
  return new PaymentSettlementService(db, (id, target, userId, reason) =>
    projects.transitionStatus(id, target, userId, reason),
  )
}
