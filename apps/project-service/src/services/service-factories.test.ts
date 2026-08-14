import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The two factories that exist to keep a NATS consumer from importing a route.
 *
 * Both were written to remove the codebase's only service-to-route edge, and
 * both are reachable from two callers each - a route and a consumer - so the
 * property worth pinning is the one the comments claim: the invoice service is
 * cached for the process, the settlement service deliberately is not. A cached
 * settlement service would pin one Database handle and one ProjectService for
 * the process; an uncached invoice service would build a new S3 client per
 * invoice.
 *
 * The S3 branch matters separately. S3_ENDPOINT=disabled is how storage is
 * turned off in dev and test, and it has to yield a null client rather than an
 * S3Client aimed at the literal host "disabled" - which would fail at upload
 * time, in the invoice path, long after anyone was looking.
 */

const ORIGINAL_S3_ENDPOINT = process.env.S3_ENDPOINT

/** The factory's output, with `private` erased as it is at runtime. */
type Storage = { s3: unknown; bucket: string; endpoint: string }

describe('getInvoiceService', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    if (ORIGINAL_S3_ENDPOINT === undefined) delete process.env.S3_ENDPOINT
    else process.env.S3_ENDPOINT = ORIGINAL_S3_ENDPOINT
    vi.resetModules()
  })

  it('caches the service for the process lifetime', async () => {
    const { getInvoiceService } = await import('./invoice-service.factory')

    expect(getInvoiceService()).toBe(getInvoiceService())
  })

  it('builds an S3 client aimed at the configured endpoint and bucket', async () => {
    process.env.S3_ENDPOINT = 'http://localhost:9000'
    const { S3Client } = await import('@aws-sdk/client-s3')
    const { getInvoiceService } = await import('./invoice-service.factory')

    // `private` is erased at runtime, so the wiring is directly readable.
    const service = getInvoiceService() as unknown as Storage

    expect(service.s3).toBeInstanceOf(S3Client)
    expect(service.endpoint).toBe('http://localhost:9000')
    expect(service.bucket).toBe('kerjacus-uploads')
  })

  /**
   * Storage off must be a null client, not an S3Client aimed at the literal
   * host "disabled". The service branches on null; a client would be built
   * happily here and fail at PutObject, inside invoice generation, long after
   * anyone was looking at startup.
   */
  it('builds no S3 client when storage is disabled', async () => {
    process.env.S3_ENDPOINT = 'disabled'
    const { getInvoiceService } = await import('./invoice-service.factory')

    const service = getInvoiceService() as unknown as Storage

    expect(service.s3).toBeNull()
    expect(service.endpoint).toBe('disabled')
  })
})

describe('buildSettlementService', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns a settlement service', async () => {
    const { buildSettlementService } = await import('./settlement-service.factory')
    const { PaymentSettlementService } = await import('./payment-settlement.service')

    expect(buildSettlementService()).toBeInstanceOf(PaymentSettlementService)
  })

  /**
   * Deliberately uncached, unlike the invoice factory. settle() is stateless
   * and the instance holds nothing worth reusing, so a singleton would only
   * outlive the request that made it.
   */
  it('builds a fresh instance per call', async () => {
    const { buildSettlementService } = await import('./settlement-service.factory')

    expect(buildSettlementService()).not.toBe(buildSettlementService())
  })

  /**
   * The wiring that is easy to get wrong: the callback handed to the
   * settlement service has to reach ProjectService.transitionStatus, because
   * that is what moves a project to brd_purchased when the money lands. A
   * factory that passed a no-op would settle payments and never advance the
   * project.
   */
  it('wires status transitions through ProjectService', async () => {
    const projectServiceModule = await import('./project.service')
    const transition = vi
      .spyOn(projectServiceModule.ProjectService.prototype, 'transitionStatus')
      .mockResolvedValue(undefined as never)

    const { buildSettlementService } = await import('./settlement-service.factory')
    const service = buildSettlementService() as unknown as {
      transitionStatus: (a: string, b: string, c: string, d: string) => Promise<unknown>
    }
    await service.transitionStatus('project-1', 'brd_purchased', 'user-1', 'paid')

    expect(transition).toHaveBeenCalledWith('project-1', 'brd_purchased', 'user-1', 'paid')
    transition.mockRestore()
  })
})
