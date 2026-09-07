import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TeamFormationSweepService } from './team-formation-sweep'

vi.setConfig({ testTimeout: 30_000 })

type Stalled = { id: string }

function makeService(opts: {
  stalled?: Stalled[]
  has?: (projectId: string) => Promise<boolean | null>
  start?: (projectId: string) => Promise<void>
}) {
  const findStalled = vi.fn(async (_limit: number) => opts.stalled ?? [])
  const hasWorkflow = vi.fn(opts.has ?? (async () => false))
  const startWorkflow = vi.fn(opts.start ?? (async () => {}))
  return {
    service: new TeamFormationSweepService(findStalled, hasWorkflow, startWorkflow),
    findStalled,
    hasWorkflow,
    startWorkflow,
  }
}

describe('TeamFormationSweepService', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('starts a workflow for a stalled project that has none', async () => {
    const { service, startWorkflow } = makeService({ stalled: [{ id: 'p1' }] })

    const result = await service.sweep()

    expect(startWorkflow).toHaveBeenCalledWith('p1')
    expect(result).toEqual({ started: 1, skipped: 0, failed: 0 })
  })

  it('skips a project whose workflow already exists', async () => {
    const { service, startWorkflow } = makeService({
      stalled: [{ id: 'p1' }],
      has: async () => true,
    })

    const result = await service.sweep()

    expect(startWorkflow).not.toHaveBeenCalled()
    expect(result).toEqual({ started: 0, skipped: 1, failed: 0 })
  })

  it('skips rather than starts when workflow existence is unknown', async () => {
    // Starting on an unknown would re-run a closed workflow and escalate twice.
    const { service, startWorkflow } = makeService({
      stalled: [{ id: 'p1' }],
      has: async () => null,
    })

    const result = await service.sweep()

    expect(startWorkflow).not.toHaveBeenCalled()
    expect(result).toEqual({ started: 0, skipped: 1, failed: 0 })
  })

  it('keeps sweeping after one project fails to start', async () => {
    const { service, startWorkflow } = makeService({
      stalled: [{ id: 'p1' }, { id: 'p2' }],
      start: async (projectId) => {
        if (projectId === 'p1') throw new Error('temporal unreachable')
      },
    })

    const result = await service.sweep()

    expect(startWorkflow).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ started: 1, skipped: 0, failed: 1 })
  })

  it('does nothing when no project is stalled', async () => {
    const { service, hasWorkflow, startWorkflow } = makeService({ stalled: [] })

    const result = await service.sweep()

    expect(hasWorkflow).not.toHaveBeenCalled()
    expect(startWorkflow).not.toHaveBeenCalled()
    expect(result).toEqual({ started: 0, skipped: 0, failed: 0 })
  })

  it('bounds the batch it asks for', async () => {
    const { service, findStalled } = makeService({ stalled: [] })

    await service.sweep()

    expect(findStalled).toHaveBeenCalledWith(100)
  })
})
