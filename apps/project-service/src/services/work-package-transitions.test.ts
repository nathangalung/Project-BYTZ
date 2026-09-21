import { readFileSync } from 'node:fs'
import path from 'node:path'
import { AppError, type WorkPackageStatus } from '@kerjacus/shared'
import { describe, expect, it, vi } from 'vitest'
import { WORK_PACKAGE_TRANSITIONS, WorkPackageService } from './work-package.service'

/**
 * PATCH /work-packages/:id/status wrote whatever the zod enum allowed, from
 * any status to any other, and it admits the assigned talent as well as the
 * owner. 'declined' and 'terminated' were the two statuses a package could not
 * be worked in, so one call by either party put the position beyond reach: a
 * project reaches 'matched' only with every package staffed, and nothing moved
 * a package back out of either status.
 *
 * Both are gone - refusing the work and ending the assignment return the
 * package to 'open' - so the dead end has no literal left to sit in. What this
 * map still has to say is that every live position can go back to the pool and
 * only 'completed' is terminal.
 */

function serviceWith(current: WorkPackageStatus) {
  const updateStatus = vi.fn().mockResolvedValue({ id: 'wp-1', status: 'noop' })
  const repo = {
    findById: vi.fn().mockResolvedValue({ id: 'wp-1', projectId: 'p-1', status: current }),
    updateStatus,
  }
  const service = new WorkPackageService(repo as never, {} as never, {} as never)
  return { service, updateStatus }
}

describe('WORK_PACKAGE_TRANSITIONS', () => {
  it('covers every work package status', () => {
    expect(Object.keys(WORK_PACKAGE_TRANSITIONS).sort()).toEqual([
      'completed',
      'in_progress',
      'offered',
      'open',
      'staffed',
    ])
  })

  /**
   * The same lesson as milestone 'changes_requested': refusing the work sends
   * it back, it does not end it. 'declined' and 'terminated' were terminal
   * until they were given an edge home; collapsing them into 'open' is that
   * edge made structural, and every position a talent can leave keeps it.
   */
  it('lets every held package be returned to the pool', () => {
    expect(WORK_PACKAGE_TRANSITIONS.offered).toContain('open')
    expect(WORK_PACKAGE_TRANSITIONS.staffed).toContain('open')
    expect(WORK_PACKAGE_TRANSITIONS.in_progress).toContain('open')
  })

  it('leaves only a completed package with nowhere to go', () => {
    const stranded = Object.entries(WORK_PACKAGE_TRANSITIONS)
      .filter(([, targets]) => targets.length === 0)
      .map(([status]) => status)
    expect(stranded).toEqual(['completed'])
  })

  /** A no-op PATCH would otherwise pass the compare-and-set as a real move. */
  it('declares no self-loop', () => {
    for (const [status, targets] of Object.entries(WORK_PACKAGE_TRANSITIONS)) {
      expect(targets).not.toContain(status)
    }
  })

  /**
   * matching.ts writes these rows directly inside its own transaction - offer
   * sets 'offered', accept sets 'staffed', decline and terminate set 'open' -
   * so the map has to describe the graph those paths already produce or the
   * two disagree.
   */
  it('admits the moves the offer paths already make', () => {
    expect(WORK_PACKAGE_TRANSITIONS.open).toContain('offered')
    expect(WORK_PACKAGE_TRANSITIONS.offered).toContain('staffed')
    expect(WORK_PACKAGE_TRANSITIONS.offered).toContain('open')
    expect(WORK_PACKAGE_TRANSITIONS.staffed).toContain('open')
  })
})

describe('WorkPackageService.updateStatus', () => {
  it('writes a legal move', async () => {
    const { service, updateStatus } = serviceWith('staffed')

    await service.updateStatus('wp-1', 'in_progress')

    expect(updateStatus).toHaveBeenCalledWith('wp-1', 'in_progress', 'staffed')
  })

  it('refuses a move the map does not declare, without writing', async () => {
    const { service, updateStatus } = serviceWith('completed')

    await expect(service.updateStatus('wp-1', 'in_progress')).rejects.toThrow(AppError)
    expect(updateStatus).not.toHaveBeenCalled()
  })

  /** The jump that skips staffing: work started on a package nobody holds. */
  it('refuses to start work on a package nobody was ever assigned', async () => {
    const { service, updateStatus } = serviceWith('open')

    await expect(service.updateStatus('wp-1', 'in_progress')).rejects.toThrow(
      /Cannot transition work package from 'open' to 'in_progress'/,
    )
    expect(updateStatus).not.toHaveBeenCalled()
  })

  it('names the legal targets so the caller knows where it can go', async () => {
    const { service } = serviceWith('staffed')

    await expect(service.updateStatus('wp-1', 'completed')).rejects.toThrow(
      /Valid targets: in_progress, open/,
    )
  })
})

/**
 * Legality is not authorization. Returning a package to the pool is the owner's
 * call: this route writes the package alone, so a talent doing it would leave
 * their assignment row 'active' beside a package nobody holds and skip the
 * completed_at that the abandonment penalty is charged on.
 */
describe('PATCH /work-packages/:id/status authorization', () => {
  const source = readFileSync(path.resolve(__dirname, '../routes/work-packages.ts'), 'utf8')
  const handler = (() => {
    const marker = "workPackageRoute.patch('/:id/status'"
    const start = source.indexOf(marker)
    expect(start, 'status route not found').toBeGreaterThan(-1)
    const next = source.indexOf('workPackageRoute.', start + marker.length)
    return source.slice(start, next === -1 ? source.length : next)
  })()

  it('refuses reopening to anyone but the owner', () => {
    const talentBranch = handler.slice(handler.indexOf('if (!isOwner)'))
    expect(talentBranch).toMatch(/=== 'open'/)
    expect(talentBranch).toMatch(/AppError\(\s*'AUTH_FORBIDDEN'/)
  })

  it('leaves the legality check to the service rather than repeating it', () => {
    expect(handler).toContain('service.updateStatus(')
    expect(handler).not.toContain('WORK_PACKAGE_TRANSITIONS')
  })
})
