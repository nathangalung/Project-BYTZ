import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The worker process entry point, which had never been executed.
 *
 * temporal-deployment.test.ts already pins the wiring AROUND this file - that
 * the prod compose runs it, that the image ships src/ and sits on a glibc base,
 * that every registered workflow is started somewhere. Those are properties of
 * files rather than of code, so they are asserted as text and stay that way.
 * What none of them can tell you is whether the module, when it runs, hands
 * Temporal the right namespace, the right task queue, and an activities object
 * that actually contains the activities. A worker that boots against the
 * default namespace or an empty activities map connects cleanly, reports
 * healthy, and silently completes no work at all.
 *
 * @temporalio/worker is mocked because the real one dials a server and loads a
 * native bridge. Everything in this file is executed.
 */

const h = vi.hoisted(() => ({
  connect: vi.fn(),
  create: vi.fn(),
  run: vi.fn(),
}))

vi.mock('@temporalio/worker', () => ({
  NativeConnection: { connect: h.connect },
  Worker: { create: h.create },
}))

type CreateOptions = {
  namespace: string
  taskQueue: string
  workflowsPath: string
  activities: Record<string, unknown>
  connection: unknown
}

describe('temporal worker boot', () => {
  beforeEach(() => {
    vi.resetModules()
    h.connect.mockReset()
    h.create.mockReset()
    h.run.mockReset()
    h.run.mockResolvedValue(undefined)
    h.create.mockResolvedValue({ run: h.run })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('connects to the configured Temporal address', async () => {
    h.connect.mockResolvedValue({ close: vi.fn() })

    await import('./temporal-worker')
    await vi.waitFor(() => expect(h.create).toHaveBeenCalled())

    expect(h.connect).toHaveBeenCalledWith({ address: 'localhost:7233' })
  })

  /**
   * The namespace and task queue are the two values that decide whether this
   * worker picks up any work. Both default in config to something other than
   * Temporal's own defaults, so a worker reading the wrong one is idle rather
   * than broken, which is far harder to notice.
   */
  it('registers on the configured namespace and task queue', async () => {
    h.connect.mockResolvedValue({ close: vi.fn() })

    await import('./temporal-worker')
    await vi.waitFor(() => expect(h.create).toHaveBeenCalled())

    const options = h.create.mock.calls[0][0] as CreateOptions
    expect(options.namespace).toBe('kerjacus')
    expect(options.taskQueue).toBe('project-service')
  })

  /**
   * Workflows are bundled from source at boot, which is why the image ships
   * src/. An absolute path is required; a relative one resolves against the
   * process cwd and breaks in the container but not in dev.
   */
  it('bundles workflows from an absolute source path', async () => {
    h.connect.mockResolvedValue({ close: vi.fn() })

    await import('./temporal-worker')
    await vi.waitFor(() => expect(h.create).toHaveBeenCalled())

    const { workflowsPath } = h.create.mock.calls[0][0] as CreateOptions
    expect(workflowsPath.startsWith('/')).toBe(true)
    expect(workflowsPath.endsWith('/workflows')).toBe(true)
  })

  /**
   * An empty or partial activities object still boots. The workflows would
   * then block on activity tasks nobody can execute, which surfaces as
   * milestones that never auto-release rather than as a crash.
   */
  it('registers every activity the workflows proxy', async () => {
    h.connect.mockResolvedValue({ close: vi.fn() })

    await import('./temporal-worker')
    await vi.waitFor(() => expect(h.create).toHaveBeenCalled())

    const { activities } = h.create.mock.calls[0][0] as CreateOptions
    expect(Object.keys(activities)).toEqual(
      expect.arrayContaining([
        'checkMilestoneReleased',
        'releaseEscrow',
        'notifyAutoRelease',
        'advanceDisputePhase',
        'isDisputeResolved',
        'getTeamStatus',
        'finalizeTeam',
        'escalateTeamFormation',
      ]),
    )
  })

  it('starts polling once the worker is created', async () => {
    h.connect.mockResolvedValue({ close: vi.fn() })

    await import('./temporal-worker')

    await vi.waitFor(() => expect(h.run).toHaveBeenCalledTimes(1))
  })

  /**
   * A worker that cannot reach Temporal must exit non-zero so the container
   * restarts. Staying up would leave a process that looks alive and polls
   * nothing.
   */
  it('exits non-zero when the connection fails', async () => {
    h.connect.mockRejectedValue(new Error('ECONNREFUSED'))
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    await import('./temporal-worker')
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))

    expect(logged).toHaveBeenCalledWith('[temporal-worker] fatal:', expect.any(Error))
    expect(h.run).not.toHaveBeenCalled()
  })

  it('exits non-zero when worker creation fails', async () => {
    h.connect.mockResolvedValue({ close: vi.fn() })
    h.create.mockRejectedValue(new Error('workflow bundle failed to build'))
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    await import('./temporal-worker')

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))
  })
})
