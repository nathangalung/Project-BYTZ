import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The Temporal client and the team-formation starter, neither of which has
 * ever executed.
 *
 * Four suites reach these modules and all four `vi.mock` temporal-client
 * wholesale, so the file that decides what happens when Temporal is
 * unreachable was itself never run. That branch is the one that matters:
 * `getTemporalClient` returning null is what lets the platform keep taking
 * milestone approvals while the workflow server is down, and every caller is
 * written against it. If it threw instead, an unreachable Temporal would take
 * out staffing and approvals rather than just the timers.
 *
 * Only `@temporalio/client` is mocked here - a real network client to a server
 * that is not running is exactly the thing under test. Both project modules
 * execute for real.
 */

const h = vi.hoisted(() => ({
  connect: vi.fn(),
  start: vi.fn(),
  getHandle: vi.fn(),
  clientOptions: [] as { namespace?: string }[],
}))

vi.mock('@temporalio/client', () => ({
  Connection: { connect: h.connect },
  Client: class MockClient {
    workflow = { start: h.start, getHandle: h.getHandle }
    constructor(options: { namespace?: string }) {
      h.clientOptions.push(options)
    }
  },
}))

/** cachedClient is module-level, so each case needs a fresh module graph. */
async function freshClientModule() {
  vi.resetModules()
  return await import('./temporal-client')
}

async function freshWorkflowModule() {
  vi.resetModules()
  return await import('./team-formation-workflow')
}

describe('getTemporalClient', () => {
  beforeEach(() => {
    h.connect.mockReset()
    h.start.mockReset()
    h.getHandle.mockReset()
    h.clientOptions.length = 0
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('connects to the configured address and namespace', async () => {
    h.connect.mockResolvedValue({ close: vi.fn() })
    const { getTemporalClient } = await freshClientModule()

    const client = await getTemporalClient()

    expect(client).not.toBeNull()
    expect(h.connect).toHaveBeenCalledWith({ address: 'localhost:7233' })
    expect(h.clientOptions[0]).toMatchObject({ namespace: 'kerjacus' })
  })

  /** One connection per process; the cache is why callers may call freely. */
  it('reuses the connection instead of dialling again', async () => {
    h.connect.mockResolvedValue({ close: vi.fn() })
    const { getTemporalClient } = await freshClientModule()

    const first = await getTemporalClient()
    const second = await getTemporalClient()

    expect(second).toBe(first)
    expect(h.connect).toHaveBeenCalledTimes(1)
  })

  /**
   * The whole reason this returns a nullable. Every caller treats null as
   * "skip the workflow"; throwing here would turn a down Temporal into failed
   * milestone approvals.
   */
  it('returns null rather than throwing when Temporal is unreachable', async () => {
    h.connect.mockRejectedValue(new Error('ECONNREFUSED'))
    const { getTemporalClient } = await freshClientModule()

    await expect(getTemporalClient()).resolves.toBeNull()
  })

  it('names the workflows that will not start when the connection fails', async () => {
    h.connect.mockRejectedValue(new Error('ECONNREFUSED'))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { getTemporalClient } = await freshClientModule()

    await getTemporalClient()

    // An operator reading this line has to learn what silently stopped.
    expect(String(logged.mock.calls[0][0])).toContain(
      'auto-release, dispute and team-formation workflows will NOT be started',
    )
  })

  /** A failed connect must not be cached as a permanent null. */
  it('retries the connection after an earlier failure', async () => {
    h.connect.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    h.connect.mockResolvedValueOnce({ close: vi.fn() })
    const { getTemporalClient } = await freshClientModule()

    expect(await getTemporalClient()).toBeNull()
    expect(await getTemporalClient()).not.toBeNull()
    expect(h.connect).toHaveBeenCalledTimes(2)
  })
})

describe('workflow ids', () => {
  /**
   * These are the deduplication keys Temporal uses. Two callers deriving a
   * different id for the same milestone means two auto-release timers and a
   * double payout attempt, so the shape is pinned rather than merely
   * exercised.
   */
  it('derives one stable id per aggregate', async () => {
    const mod = await freshClientModule()

    expect(mod.milestoneAutoReleaseWorkflowId('m1')).toBe('auto-release-m1')
    expect(mod.disputeResolutionWorkflowId('d1')).toBe('dispute-d1')
    expect(mod.teamFormationWorkflowId('p1')).toBe('team-formation-p1')
    expect(mod.TEMPORAL_TASK_QUEUE).toBe('project-service')
  })
})

describe('startTeamFormationWorkflow', () => {
  beforeEach(() => {
    h.connect.mockReset()
    h.start.mockReset()
    h.getHandle.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts the escalation timer on the project task queue', async () => {
    h.connect.mockResolvedValue({ close: vi.fn() })
    const { startTeamFormationWorkflow } = await freshWorkflowModule()

    await startTeamFormationWorkflow('project-1')

    expect(h.start).toHaveBeenCalledTimes(1)
    expect(h.start.mock.calls[0][1]).toMatchObject({
      taskQueue: 'project-service',
      workflowId: 'team-formation-project-1',
      args: ['project-1'],
      // A caller that cannot cheaply tell first entry from re-entry stays
      // correct only because a duplicate start is allowed.
      workflowIdReusePolicy: 'ALLOW_DUPLICATE',
    })
  })

  /**
   * Fire and forget. Staffing a project must not fail because the timer that
   * chases it 14 days later could not be armed.
   */
  it('does nothing when Temporal is unreachable', async () => {
    h.connect.mockRejectedValue(new Error('ECONNREFUSED'))
    const { startTeamFormationWorkflow } = await freshWorkflowModule()

    await expect(startTeamFormationWorkflow('project-1')).resolves.toBeUndefined()
    expect(h.start).not.toHaveBeenCalled()
  })
})

describe('signalTeamComplete', () => {
  beforeEach(() => {
    h.connect.mockReset()
    h.start.mockReset()
    h.getHandle.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('signals the workflow that owns this project', async () => {
    h.connect.mockResolvedValue({ close: vi.fn() })
    const signal = vi.fn().mockResolvedValue(undefined)
    h.getHandle.mockReturnValue({ signal })
    const { signalTeamComplete } = await freshWorkflowModule()

    await signalTeamComplete('project-1')

    expect(h.getHandle).toHaveBeenCalledWith('team-formation-project-1')
    expect(signal).toHaveBeenCalledTimes(1)
  })

  /**
   * The team can complete without a workflow ever having started - Temporal
   * may have been down at team_forming. Signalling a workflow that does not
   * exist throws, and swallowing it is what keeps the last talent's acceptance
   * from failing.
   */
  it('swallows a signal to a workflow that does not exist', async () => {
    h.connect.mockResolvedValue({ close: vi.fn() })
    h.getHandle.mockReturnValue({
      signal: vi.fn().mockRejectedValue(new Error('workflow not found')),
    })
    const { signalTeamComplete } = await freshWorkflowModule()

    await expect(signalTeamComplete('project-1')).resolves.toBeUndefined()
  })

  it('does nothing when Temporal is unreachable', async () => {
    h.connect.mockRejectedValue(new Error('ECONNREFUSED'))
    const { signalTeamComplete } = await freshWorkflowModule()

    await expect(signalTeamComplete('project-1')).resolves.toBeUndefined()
    expect(h.getHandle).not.toHaveBeenCalled()
  })
})
