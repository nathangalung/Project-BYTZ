import { AppError, FREE_MILESTONE_REVISIONS } from '@kerjacus/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MilestoneRepository } from '../repositories/milestone.repository'
import type { ProjectRepository } from '../repositories/project.repository'
import { MilestoneService } from './milestone.service'

/**
 * Rejection used to be terminal. `rejected: []` meant an owner who rejected a
 * milestone stranded its escrow: the auto-release sweep compare-and-swaps on
 * 'submitted' so it never saw the row, no transition reached 'approved' so the
 * release path was closed, and dispute refunds are project-scoped and refuse
 * work-package scope outright. The money had no exit and nothing said so.
 */
describe('milestone rejection', () => {
  const milestoneRepo = {
    findById: vi.fn(),
    updateStatus: vi.fn(),
    incrementRevisionCount: vi.fn(),
    consumePaidRevisionCredit: vi.fn(),
  } as unknown as MilestoneRepository
  const projectRepo = {} as ProjectRepository
  const service = new MilestoneService(milestoneRepo, projectRepo)

  const milestone = (over: Record<string, unknown> = {}) => ({
    id: 'm1',
    status: 'submitted',
    revisionCount: 0,
    ...over,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(milestoneRepo.updateStatus).mockResolvedValue({ id: 'm1' } as never)
    vi.mocked(milestoneRepo.incrementRevisionCount).mockResolvedValue({ id: 'm1' } as never)
  })

  it('sends a rejected milestone back to work', async () => {
    vi.mocked(milestoneRepo.findById).mockResolvedValue(milestone({ status: 'rejected' }) as never)

    await service.updateMilestoneStatus('m1', 'in_progress')

    expect(milestoneRepo.updateStatus).toHaveBeenCalledWith('m1', 'in_progress', 'rejected')
  })

  it('spends a revision round on rejection, same as a revision request', async () => {
    vi.mocked(milestoneRepo.findById).mockResolvedValue(milestone() as never)

    await service.updateMilestoneStatus('m1', 'rejected')

    expect(milestoneRepo.incrementRevisionCount).toHaveBeenCalledWith('m1')
    expect(milestoneRepo.updateStatus).toHaveBeenCalledWith('m1', 'rejected', 'submitted')
  })

  it('requires a paid credit to reject past the free rounds', async () => {
    vi.mocked(milestoneRepo.findById).mockResolvedValue(
      milestone({ revisionCount: FREE_MILESTONE_REVISIONS }) as never,
    )
    vi.mocked(milestoneRepo.consumePaidRevisionCredit).mockResolvedValue(false)

    await expect(service.updateMilestoneStatus('m1', 'rejected')).rejects.toThrow(AppError)
    expect(milestoneRepo.updateStatus).not.toHaveBeenCalled()
  })

  it('rejects past the free rounds once a paid credit is available', async () => {
    vi.mocked(milestoneRepo.findById).mockResolvedValue(
      milestone({ revisionCount: FREE_MILESTONE_REVISIONS }) as never,
    )
    vi.mocked(milestoneRepo.consumePaidRevisionCredit).mockResolvedValue(true)

    await service.updateMilestoneStatus('m1', 'rejected')

    expect(milestoneRepo.updateStatus).toHaveBeenCalledWith('m1', 'rejected', 'submitted')
  })

  it('keeps approved terminal', async () => {
    vi.mocked(milestoneRepo.findById).mockResolvedValue(milestone({ status: 'approved' }) as never)

    await expect(service.updateMilestoneStatus('m1', 'in_progress')).rejects.toThrow(AppError)
  })
})
