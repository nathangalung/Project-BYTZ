import { describe, expect, it, vi } from 'vitest'
import type { DisputeRepository } from '../repositories/dispute.repository'
import { DisputeService } from './dispute.service'

/**
 * Resolving a dispute moves money, and it used to live inside a route handler
 * alongside five others that ran Drizzle directly, so none of this had ever
 * been asserted - including the ordering rule, which is the part that matters.
 */

type RepoOverrides = Partial<{
  dispute: Record<string, unknown> | undefined
  deposit: { id: string; amount: number } | undefined
  ownerId: string | undefined
}>

function makeRepo(o: RepoOverrides = {}) {
  const resolve = vi.fn(async () => ({ id: 'd1', status: 'resolved' }))
  const repo = {
    findById: vi.fn(async () =>
      'dispute' in o
        ? o.dispute
        : { id: 'd1', projectId: 'p1', workPackageId: null, status: 'open' },
    ),
    findEscrowDeposit: vi.fn(async () =>
      'deposit' in o ? o.deposit : { id: 'tx1', amount: 10_000_000 },
    ),
    findProjectOwner: vi.fn(async () => ('ownerId' in o ? o.ownerId : 'owner-1')),
    updateStatus: vi.fn(async () => ({ id: 'd1', status: 'under_review' })),
    resolve,
  }
  return repo as unknown as DisputeRepository & typeof repo
}

const balance = (n: number) => vi.fn(async () => n)

describe('resolving a dispute', () => {
  it('refunds the owner and then marks it resolved', async () => {
    const repo = makeRepo()
    const refund = vi.fn(async () => undefined)
    const svc = new DisputeService(repo, refund, balance(10_000_000))

    await svc.resolve('d1', 'admin-1', { resolution: 'ok', resolutionType: 'funds_to_owner' })

    expect(refund).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 10_000_000, ownerId: 'owner-1' }),
    )
    expect(repo.resolve).toHaveBeenCalled()
  })

  /**
   * The ordering rule. Marking it resolved first would leave a dispute that
   * reads as settled with a refund that silently never happened - and nobody
   * goes looking for money that the record says already moved.
   */
  it('leaves the dispute open when the refund fails', async () => {
    const repo = makeRepo()
    const refund = vi.fn(async () => {
      throw new Error('gateway down')
    })
    const svc = new DisputeService(repo, refund, balance(10_000_000))

    await expect(
      svc.resolve('d1', 'admin-1', { resolution: 'ok', resolutionType: 'funds_to_owner' }),
    ).rejects.toThrow('gateway down')
    expect(repo.resolve).not.toHaveBeenCalled()
  })

  // A retry has to replay, not pay twice.
  it('keys the refund to the dispute so a retry replays', async () => {
    const repo = makeRepo()
    const refund = vi.fn(async () => undefined)
    await new DisputeService(repo, refund, balance(10_000_000)).resolve('d1', 'admin-1', {
      resolution: 'ok',
      resolutionType: 'funds_to_owner',
    })
    expect(refund).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'refund:dispute:d1' }),
    )
  })

  it('moves no money when the talent keeps the funds', async () => {
    const repo = makeRepo()
    const refund = vi.fn(async () => undefined)
    await new DisputeService(repo, refund, balance(10_000_000)).resolve('d1', 'admin-1', {
      resolution: 'talent delivered',
      resolutionType: 'funds_to_talent',
    })
    expect(refund).not.toHaveBeenCalled()
    expect(repo.resolve).toHaveBeenCalled()
  })

  /**
   * Sized against what is still held. Two of four milestones already paid
   * out means a refund on the deposit would exceed the balance, be rejected,
   * and dead-end the resolution.
   */
  it('refunds only what is still in escrow', async () => {
    const repo = makeRepo()
    const refund = vi.fn(async () => undefined)
    await new DisputeService(repo, refund, balance(4_000_000)).resolve('d1', 'admin-1', {
      resolution: 'partial',
      resolutionType: 'funds_to_owner',
    })
    expect(refund).toHaveBeenCalledWith(expect.objectContaining({ amount: 4_000_000 }))
  })

  it('skips the payment call entirely when nothing is left to refund', async () => {
    const repo = makeRepo()
    const refund = vi.fn(async () => undefined)
    await new DisputeService(repo, refund, balance(0)).resolve('d1', 'admin-1', {
      resolution: 'nothing held',
      resolutionType: 'funds_to_owner',
    })
    expect(refund).not.toHaveBeenCalled()
    expect(repo.resolve).toHaveBeenCalled()
  })

  it('does nothing when there was never an escrow deposit', async () => {
    const repo = makeRepo({ deposit: undefined })
    const refund = vi.fn(async () => undefined)
    await new DisputeService(repo, refund, balance(0)).resolve('d1', 'admin-1', {
      resolution: 'no escrow',
      resolutionType: 'funds_to_owner',
    })
    expect(refund).not.toHaveBeenCalled()
    expect(repo.resolve).toHaveBeenCalled()
  })
})

describe('refusing to resolve', () => {
  it('rejects a dispute that does not exist', async () => {
    const svc = new DisputeService(makeRepo({ dispute: undefined }), vi.fn(), balance(0))
    await expect(
      svc.resolve('missing', 'admin-1', { resolution: 'x', resolutionType: 'split' }),
    ).rejects.toThrow(/not found/i)
  })

  // Resolving twice would refund twice were it not for the idempotency key,
  // and would overwrite the first decision's record either way.
  it('rejects one that is already resolved', async () => {
    const repo = makeRepo({
      dispute: { id: 'd1', projectId: 'p1', workPackageId: null, status: 'resolved' },
    })
    const refund = vi.fn()
    await expect(
      new DisputeService(repo, refund, balance(0)).resolve('d1', 'admin-1', {
        resolution: 'x',
        resolutionType: 'split',
      }),
    ).rejects.toThrow(/already resolved/i)
    expect(refund).not.toHaveBeenCalled()
  })

  it('refuses when the project behind the dispute is gone', async () => {
    const repo = makeRepo({ ownerId: undefined })
    await expect(
      new DisputeService(repo, vi.fn(), balance(10_000_000)).resolve('d1', 'admin-1', {
        resolution: 'x',
        resolutionType: 'funds_to_owner',
      }),
    ).rejects.toThrow(/Project not found/i)
  })
})

describe('a dispute raised over one work package', () => {
  /**
   * It must refund that package's escrow only. A project-level dispute has to
   * match the deposits with no work package, or it would take money belonging
   * to a talent who is not part of the dispute.
   */
  it('scopes the deposit lookup to that package', async () => {
    const repo = makeRepo({
      dispute: { id: 'd1', projectId: 'p1', workPackageId: 'wp-2', status: 'open' },
    })
    await new DisputeService(
      repo,
      vi.fn(async () => undefined),
      balance(10_000_000),
    ).resolve('d1', 'admin-1', { resolution: 'x', resolutionType: 'funds_to_owner' })
    expect(repo.findEscrowDeposit).toHaveBeenCalledWith('p1', 'wp-2')
  })

  it('scopes a project-level dispute to the unscoped deposits', async () => {
    const repo = makeRepo()
    await new DisputeService(
      repo,
      vi.fn(async () => undefined),
      balance(10_000_000),
    ).resolve('d1', 'admin-1', { resolution: 'x', resolutionType: 'funds_to_owner' })
    expect(repo.findEscrowDeposit).toHaveBeenCalledWith('p1', null)
  })
})

/**
 * The three-step escalation. Both rules were inline in the handler: the
 * transition has to be one the state machine allows, and the steps that put
 * the platform in the middle belong to an admin - a party moving their own
 * case to mediation would be deciding it themselves.
 */
describe('moving a dispute along', () => {
  const TRANSITIONS = {
    open: ['under_review', 'resolved'],
    under_review: ['mediation', 'resolved'],
    mediation: ['escalated', 'resolved'],
    escalated: ['resolved'],
    resolved: [],
  } as const

  function svc(repo: ReturnType<typeof makeRepo>) {
    return new DisputeService(repo, vi.fn(), balance(0))
  }

  it('lets an admin escalate', async () => {
    const repo = makeRepo()
    await svc(repo).changeStatus('d1', 'admin', 'under_review', TRANSITIONS)
    expect(repo.updateStatus).toHaveBeenCalledWith('d1', {
      projectId: 'p1',
      fromStatus: 'open',
      toStatus: 'under_review',
    })
  })

  it('refuses to let a party escalate their own dispute', async () => {
    const repo = makeRepo()
    await expect(
      svc(repo).changeStatus('d1', 'owner', 'under_review', TRANSITIONS),
    ).rejects.toThrow(/admin/i)
    expect(repo.updateStatus).not.toHaveBeenCalled()
  })

  it('refuses a transition the state machine does not allow', async () => {
    const repo = makeRepo()
    await expect(svc(repo).changeStatus('d1', 'admin', 'escalated', TRANSITIONS)).rejects.toThrow(
      /Cannot transition from open to escalated/,
    )
    expect(repo.updateStatus).not.toHaveBeenCalled()
  })

  // Resolved is terminal: reopening would unfreeze money already settled.
  it('refuses to move a resolved dispute', async () => {
    const repo = makeRepo({
      dispute: { id: 'd1', projectId: 'p1', workPackageId: null, status: 'resolved' },
    })
    await expect(svc(repo).changeStatus('d1', 'admin', 'mediation', TRANSITIONS)).rejects.toThrow(
      /already resolved/i,
    )
  })

  it('rejects a dispute that does not exist', async () => {
    const repo = makeRepo({ dispute: undefined })
    await expect(
      svc(repo).changeStatus('missing', 'admin', 'under_review', TRANSITIONS),
    ).rejects.toThrow(/not found/i)
  })
})
