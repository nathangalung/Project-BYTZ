import { AppError, FREE_MILESTONE_REVISIONS } from '@kerjacus/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MilestoneRepository } from '../repositories/milestone.repository'
import type { ProjectRepository } from '../repositories/project.repository'
import { MilestoneService } from './milestone.service'

/**
 * Refusing a submission used to be two statuses, and one of them was terminal.
 * Terminal 'rejected' stranded the milestone's escrow: the auto-release sweep
 * compare-and-swaps on 'submitted' so it never saw the row, no transition
 * reached 'approved' so the release path was closed, and dispute refunds are
 * project-scoped and refuse work-package scope outright. The money had no exit
 * and nothing said so.
 *
 * One status now, and it sends the work back. What the two used to differ on -
 * whether an admin hears about the round - is decided by the escalation flag
 * this service computes, not by which status the owner picked.
 */
describe('milestone changes requested', () => {
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

  it('sends work that was refused back to the talent', async () => {
    vi.mocked(milestoneRepo.findById).mockResolvedValue(
      milestone({ status: 'changes_requested' }) as never,
    )

    await service.updateMilestoneStatus('m1', 'in_progress')

    expect(milestoneRepo.updateStatus).toHaveBeenCalledWith(
      'm1',
      'in_progress',
      'changes_requested',
    )
  })

  // One write, not two: the status and the spent round leave together, so a
  // crash between them cannot leave a milestone refused with the round unspent.
  it('spends the round and writes the status in one call', async () => {
    vi.mocked(milestoneRepo.findById).mockResolvedValue(milestone() as never)

    await service.updateMilestoneStatus('m1', 'changes_requested')

    expect(milestoneRepo.incrementRevisionCount).toHaveBeenCalledWith('m1', false)
    expect(milestoneRepo.updateStatus).not.toHaveBeenCalled()
  })

  it('requires a paid credit past the free rounds', async () => {
    vi.mocked(milestoneRepo.findById).mockResolvedValue(
      milestone({ revisionCount: FREE_MILESTONE_REVISIONS }) as never,
    )
    vi.mocked(milestoneRepo.consumePaidRevisionCredit).mockResolvedValue(false)

    await expect(service.updateMilestoneStatus('m1', 'changes_requested')).rejects.toThrow(AppError)
    expect(milestoneRepo.incrementRevisionCount).not.toHaveBeenCalled()
  })

  // Past the ceiling the round is still escalated: going quiet there is what
  // the removed reject button was covering for.
  it('escalates a paid round once a credit is available', async () => {
    vi.mocked(milestoneRepo.findById).mockResolvedValue(
      milestone({ revisionCount: FREE_MILESTONE_REVISIONS }) as never,
    )
    vi.mocked(milestoneRepo.consumePaidRevisionCredit).mockResolvedValue(true)

    await service.updateMilestoneStatus('m1', 'changes_requested')

    expect(milestoneRepo.incrementRevisionCount).toHaveBeenCalledWith('m1', true)
  })

  it('keeps approved terminal', async () => {
    vi.mocked(milestoneRepo.findById).mockResolvedValue(milestone({ status: 'approved' }) as never)

    await expect(service.updateMilestoneStatus('m1', 'in_progress')).rejects.toThrow(AppError)
  })
})
