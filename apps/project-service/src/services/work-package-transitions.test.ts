import { readFileSync } from 'node:fs'
import path from 'node:path'
import { AppError, type WorkPackageStatus } from '@kerjacus/shared'
import { describe, expect, it, vi } from 'vitest'
import { WORK_PACKAGE_TRANSITIONS, WorkPackageService } from './work-package.service'

/**
 * PATCH /work-packages/:id/status wrote whatever the zod enum allowed, from
 * any status to any other, and it admits the assigned talent as well as the
 * owner. 'declined' and 'terminated' are the two statuses a package cannot be
 * worked in, so one call by either party put the position beyond reach: a
 * project reaches 'matched' only with every package staffed, and nothing moved
 * a package back out of either status.
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
      'assigned',
      'completed',
      'declined',
      'in_progress',
      'pending_acceptance',
      'terminated',
      'unassigned',
    ])
  })

  /**
   * The same lesson as milestone 'rejected': refusing the work sends it back,
   * it does not end it. A terminal 'declined' or 'terminated' would reproduce
   * one layer down the dead end this map exists to close.
   */
  it('lets a declined or terminated package be staffed again', () => {
    expect(WORK_PACKAGE_TRANSITIONS.declined).toContain('unassigned')
    expect(WORK_PACKAGE_TRANSITIONS.terminated).toContain('unassigned')
  })

  it('leaves only a completed package with nowhere to go', () => {
    const stranded = Object.entries(WORK_PACKAGE_TRANSITIONS)
      .filter(([, targets]) => targets.length === 0)
      .map(([status]) => status)
    expect(stranded).toEqual(['completed'])
  })

  /**
   * matching.ts writes these rows directly inside its own transaction - accept
   * sets 'assigned', decline and terminate set 'unassigned' - so the map has to
   * describe the graph those paths already produce or the two disagree.
   */
  it('admits the moves the offer paths already make', () => {
    expect(WORK_PACKAGE_TRANSITIONS.pending_acceptance).toContain('assigned')
    expect(WORK_PACKAGE_TRANSITIONS.pending_acceptance).toContain('unassigned')
    expect(WORK_PACKAGE_TRANSITIONS.assigned).toContain('unassigned')
    expect(WORK_PACKAGE_TRANSITIONS.in_progress).toContain('unassigned')
  })
})

describe('WorkPackageService.updateStatus', () => {
  it('writes a legal move', async () => {
    const { service, updateStatus } = serviceWith('assigned')

    await service.updateStatus('wp-1', 'in_progress')

    expect(updateStatus).toHaveBeenCalledWith('wp-1', 'in_progress', 'assigned')
  })

  it('refuses a move the map does not declare, without writing', async () => {
    const { service, updateStatus } = serviceWith('completed')

    await expect(service.updateStatus('wp-1', 'in_progress')).rejects.toThrow(AppError)
    expect(updateStatus).not.toHaveBeenCalled()
  })

  /** The jump that bricked the project: straight from unassigned to declined. */
  it('refuses to decline a package nobody was ever offered', async () => {
    const { service, updateStatus } = serviceWith('unassigned')

    await expect(service.updateStatus('wp-1', 'declined')).rejects.toThrow(
      /Cannot transition work package from 'unassigned' to 'declined'/,
    )
    expect(updateStatus).not.toHaveBeenCalled()
  })

  it('names the legal targets so the caller knows where it can go', async () => {
    const { service } = serviceWith('assigned')

    await expect(service.updateStatus('wp-1', 'completed')).rejects.toThrow(
      /Valid targets: in_progress, terminated, unassigned/,
    )
  })
})

/**
 * Legality is not authorization. Terminating a package is the owner's call:
 * a talent could otherwise end their own package and strand the project, since
 * every other package stays staffed and nothing reopens the position.
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

  it('refuses terminated and declined to anyone but the owner', () => {
    const talentBranch = handler.slice(handler.indexOf('if (!isOwner)'))
    expect(talentBranch).toMatch(/'terminated'/)
    expect(talentBranch).toMatch(/'declined'/)
    expect(talentBranch).toMatch(/AppError\(\s*'AUTH_FORBIDDEN'/)
  })

  it('leaves the legality check to the service rather than repeating it', () => {
    expect(handler).toContain('service.updateStatus(')
    expect(handler).not.toContain('WORK_PACKAGE_TRANSITIONS')
  })
})
