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
  deposits: Array<{ id: string; amount: number }>
  ownerId: string | undefined
}>

function makeRepo(o: RepoOverrides = {}) {
  const resolve = vi.fn(async () => ({ id: 'd1', status: 'resolved' }))
  const repo = {
    findById: vi.fn(async () =>
      'dispute' in o
        ? o.dispute
        : {
            id: 'd1',
            projectId: 'p1',
            workPackageId: null,
            status: 'open',
            initiatedBy: 'owner-1',
            againstUserId: 'talent-1',
          },
    ),
    findEscrowDeposits: vi.fn(async () =>
      'deposits' in o ? o.deposits : [{ id: 'tx1', amount: 10_000_000 }],
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
    // Per deposit, because the refund is spread across them and each leg needs
    // its own key to replay rather than pay twice.
    expect(refund).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'refund:dispute:d1:tx1' }),
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
    const repo = makeRepo({ deposits: [] })
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
  /**
   * Escrow is deposited once per project - no escrow_in row carries a work
   * package - so a package-scoped refund cannot be sized. It used to match
   * nothing, skip the refund and mark the dispute resolved anyway, which is
   * terminal: the money stayed frozen on a case that could not be reopened and
   * the admin saw a success. Refusing is the honest outcome until deposits
   * carry the package.
   */
  it('refuses a work-package dispute rather than closing it unpaid', async () => {
    const repo = makeRepo({
      dispute: { id: 'd1', projectId: 'p1', workPackageId: 'wp-2', status: 'open' },
    })
    const refund = vi.fn(async () => undefined)

    await expect(
      new DisputeService(repo, refund, balance(10_000_000)).resolve('d1', 'admin-1', {
        resolution: 'x',
        resolutionType: 'funds_to_owner',
      }),
    ).rejects.toThrow(/project level/i)

    expect(refund).not.toHaveBeenCalled()
    expect(repo.resolve).not.toHaveBeenCalled()
  })

  /**
   * Each refund is capped at its own transaction's amount, so a project funded
   * twice needs the balance spread across both deposits. Sizing against one
   * arbitrary row stranded the rest on a closed dispute.
   */
  it('spreads the refund across every deposit', async () => {
    const repo = makeRepo({
      deposits: [
        { id: 'tx1', amount: 10_000_000 },
        { id: 'tx2', amount: 10_000_000 },
      ],
    })
    const refund = vi.fn(async () => undefined)

    await new DisputeService(repo, refund, balance(20_000_000)).resolve('d1', 'admin-1', {
      resolution: 'full',
      resolutionType: 'funds_to_owner',
    })

    expect(refund).toHaveBeenCalledTimes(2)
    expect(refund).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ originalTransactionId: 'tx1', amount: 10_000_000 }),
    )
    expect(refund).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ originalTransactionId: 'tx2', amount: 10_000_000 }),
    )
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

  const ADMIN = { id: 'admin-1', role: 'admin' }
  const OWNER = { id: 'owner-1', role: 'owner' }

  function svc(repo: ReturnType<typeof makeRepo>) {
    return new DisputeService(repo, vi.fn(), balance(0))
  }

  it('lets an admin escalate', async () => {
    const repo = makeRepo()
    await svc(repo).changeStatus('d1', ADMIN, 'under_review', TRANSITIONS)
    expect(repo.updateStatus).toHaveBeenCalledWith('d1', {
      projectId: 'p1',
      fromStatus: 'open',
      toStatus: 'under_review',
    })
  })

  it('refuses to let a party escalate their own dispute', async () => {
    const repo = makeRepo()
    await expect(svc(repo).changeStatus('d1', OWNER, 'under_review', TRANSITIONS)).rejects.toThrow(
      /admin/i,
    )
    expect(repo.updateStatus).not.toHaveBeenCalled()
  })

  it('refuses a transition the state machine does not allow', async () => {
    const repo = makeRepo()
    await expect(svc(repo).changeStatus('d1', ADMIN, 'escalated', TRANSITIONS)).rejects.toThrow(
      /Cannot transition from open to escalated/,
    )
    expect(repo.updateStatus).not.toHaveBeenCalled()
  })

  // Resolved is terminal: reopening would unfreeze money already settled.
  it('refuses to move a resolved dispute', async () => {
    const repo = makeRepo({
      dispute: {
        id: 'd1',
        projectId: 'p1',
        workPackageId: null,
        status: 'resolved',
        initiatedBy: 'owner-1',
        againstUserId: 'talent-1',
      },
    })
    await expect(svc(repo).changeStatus('d1', ADMIN, 'mediation', TRANSITIONS)).rejects.toThrow(
      /already resolved/i,
    )
  })

  it('rejects a dispute that does not exist', async () => {
    const repo = makeRepo({ dispute: undefined })
    await expect(
      svc(repo).changeStatus('missing', ADMIN, 'under_review', TRANSITIONS),
    ).rejects.toThrow(/not found/i)
  })
})

/**
 * The handler took a role and never a user, so being signed in was enough to
 * move any dispute on the platform by id. `resolved` is terminal, so a
 * stranger could settle two other people's dispute without a resolution or a
 * refund, and `resolve` would then refuse it as already resolved - the
 * dispute path closed for good on frozen money.
 */
describe('who may move a dispute', () => {
  const TRANSITIONS = { open: ['under_review', 'resolved'] } as const

  function svc(repo: ReturnType<typeof makeRepo>) {
    return new DisputeService(repo, vi.fn(), balance(0))
  }

  it('refuses a signed-in user who is not a party to it', async () => {
    const repo = makeRepo()
    await expect(
      svc(repo).changeStatus('d1', { id: 'stranger', role: 'owner' }, 'resolved', TRANSITIONS),
    ).rejects.toThrow(/not a party/i)
    expect(repo.updateStatus).not.toHaveBeenCalled()
  })

  it('refuses a stranger before telling them what state it is in', async () => {
    const repo = makeRepo()
    await expect(
      svc(repo).changeStatus('d1', { id: 'stranger', role: 'talent' }, 'mediation', TRANSITIONS),
    ).rejects.toThrow(/not a party/i)
  })

  // The party check admits them; what stops them is the admin-only rule below.
  it('takes the talent it was raised against past the party check', async () => {
    const repo = makeRepo()
    await expect(
      svc(repo).changeStatus('d1', { id: 'talent-1', role: 'talent' }, 'resolved', TRANSITIONS),
    ).rejects.toThrow(/admin/i)
  })

  /**
   * Even a party cannot reach `resolved` here. Settling through this route
   * skips the refund that `resolve` performs, so the money the dispute froze
   * would never move and the dispute could not be resolved again.
   */
  it('refuses a party who tries to settle it themselves', async () => {
    const repo = makeRepo()
    await expect(
      svc(repo).changeStatus('d1', { id: 'owner-1', role: 'owner' }, 'resolved', TRANSITIONS),
    ).rejects.toThrow(/admin/i)
    expect(repo.updateStatus).not.toHaveBeenCalled()
  })
})
