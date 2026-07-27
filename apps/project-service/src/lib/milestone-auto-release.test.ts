import { afterEach, describe, expect, it, vi } from 'vitest'
import { triggerTemporalForMilestoneStatus } from './milestone-auto-release'
import { getTemporalClient } from './temporal-client'

vi.mock('../workflows/milestoneAutoRelease', () => ({
  milestoneAutoReleaseWorkflow: 'milestoneAutoReleaseWorkflow',
  milestoneApprovedSignal: 'milestoneApproved',
}))
vi.mock('./temporal-client', () => ({
  getTemporalClient: vi.fn(),
  milestoneAutoReleaseWorkflowId: (id: string) => `auto-release-${id}`,
  TEMPORAL_TASK_QUEUE: 'test-queue',
}))

function stubClient() {
  const handle = { signal: vi.fn(), terminate: vi.fn() }
  const client = {
    workflow: { start: vi.fn(), getHandle: vi.fn(() => handle) },
  }
  vi.mocked(getTemporalClient).mockResolvedValue(client as never)
  return { client, handle }
}

describe('triggerTemporalForMilestoneStatus', () => {
  afterEach(() => vi.clearAllMocks())

  it('starts the auto-release timer on submit', async () => {
    const { client } = stubClient()

    await triggerTemporalForMilestoneStatus('ms-1', 'submitted')

    expect(client.workflow.start).toHaveBeenCalledWith(
      'milestoneAutoReleaseWorkflow',
      expect.objectContaining({ workflowId: 'auto-release-ms-1', args: ['ms-1'] }),
    )
  })

  // ALLOW_DUPLICATE only admits a new run once the old one is closed, so without
  // the terminate the resubmission inherits the remainder of the first window.
  it('kills the running timer on revision so the resubmission gets a fresh window', async () => {
    const { client, handle } = stubClient()

    await triggerTemporalForMilestoneStatus('ms-1', 'revision_requested')
    expect(handle.terminate).toHaveBeenCalledOnce()
    expect(handle.signal).not.toHaveBeenCalled()

    await triggerTemporalForMilestoneStatus('ms-1', 'submitted')
    expect(client.workflow.start).toHaveBeenCalledOnce()
  })

  it('ignores a revision on a milestone with no open timer', async () => {
    const { handle } = stubClient()
    handle.terminate.mockRejectedValue(new Error('workflow not found'))

    await expect(
      triggerTemporalForMilestoneStatus('ms-1', 'revision_requested'),
    ).resolves.toBeUndefined()
  })

  it('signals the timer to short-circuit on approval', async () => {
    const { handle } = stubClient()

    await triggerTemporalForMilestoneStatus('ms-1', 'approved')

    expect(handle.signal).toHaveBeenCalledWith('milestoneApproved')
    expect(handle.terminate).not.toHaveBeenCalled()
  })

  it('does nothing for statuses that carry no timer', async () => {
    const { client } = stubClient()

    await triggerTemporalForMilestoneStatus('ms-1', 'in_progress')

    expect(client.workflow.start).not.toHaveBeenCalled()
    expect(client.workflow.getHandle).not.toHaveBeenCalled()
  })

  it('is a no-op when Temporal is unreachable', async () => {
    vi.mocked(getTemporalClient).mockResolvedValue(null)

    await expect(triggerTemporalForMilestoneStatus('ms-1', 'submitted')).resolves.toBeUndefined()
  })
})
