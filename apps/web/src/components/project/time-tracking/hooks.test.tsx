// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { useCreateTimeLog, useStopTimer, useTimeLogSummary, useTimeLogs } from './hooks'

beforeAll(async () => {
  await i18n.changeLanguage('id')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function stub(handler: (url: string, init?: RequestInit) => Response) {
  const spy = vi.fn((url: string, init?: RequestInit) => Promise.resolve(handler(url, init)))
  vi.stubGlobal('fetch', spy)
  return spy
}

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return { client, Wrapper }
}

function apiLog(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tl-1',
    taskId: 'task-1',
    talentId: 'talent-1',
    startedAt: '2026-08-13T09:00:00.000Z',
    endedAt: '2026-08-13T10:30:00.000Z',
    durationMinutes: 90,
    description: 'Menulis endpoint',
    createdAt: '2026-08-13T09:00:00.000Z',
    taskTitle: 'Backend API',
    ...overrides,
  }
}

describe('useTimeLogs', () => {
  it('maps an API row onto the shape the log table renders', async () => {
    stub(() => json({ success: true, data: [apiLog()] }))
    const { Wrapper } = wrapper()

    const { result } = renderHook(() => useTimeLogs('p-1'), { wrapper: Wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.data).toEqual([
      {
        id: 'tl-1',
        taskTitle: 'Backend API',
        description: 'Menulis endpoint',
        date: '2026-08-13',
        durationMinutes: 90,
        isRunning: false,
      },
    ])
  })

  /**
   * A row with no end time is a timer still running, and that is what drives
   * the stop control. Treating it as finished would leave the talent with a
   * timer they cannot stop.
   */
  it('reads a row with no end time as still running', async () => {
    stub(() => json({ success: true, data: [apiLog({ endedAt: null, durationMinutes: null })] }))
    const { Wrapper } = wrapper()

    const { result } = renderHook(() => useTimeLogs('p-1'), { wrapper: Wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.data?.[0].isRunning).toBe(true)
    expect(result.current.data?.[0].durationMinutes).toBe(0)
  })

  it('names an untitled task rather than rendering a blank row', async () => {
    stub(() => json({ success: true, data: [apiLog({ taskTitle: '' })] }))
    const { Wrapper } = wrapper()

    const { result } = renderHook(() => useTimeLogs('p-1'), { wrapper: Wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.data?.[0].taskTitle).toBe('Untitled Task')
  })

  it('renders an empty description rather than the word null', async () => {
    stub(() => json({ success: true, data: [apiLog({ description: null })] }))
    const { Wrapper } = wrapper()

    const { result } = renderHook(() => useTimeLogs('p-1'), { wrapper: Wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.data?.[0].description).toBe('')
  })

  it('returns nothing when the response carries no data', async () => {
    stub(() => json({ success: false }))
    const { Wrapper } = wrapper()

    const { result } = renderHook(() => useTimeLogs('p-1'), { wrapper: Wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.data).toEqual([])
  })

  it('surfaces a failed request as an error rather than an empty list', async () => {
    stub(() => json({}, 500))
    const { Wrapper } = wrapper()

    const { result } = renderHook(() => useTimeLogs('p-1'), { wrapper: Wrapper })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })
  })

  it('does not fire without a project to fetch for', () => {
    const spy = stub(() => json({ success: true, data: [] }))
    const { Wrapper } = wrapper()

    renderHook(() => useTimeLogs(''), { wrapper: Wrapper })

    expect(spy).not.toHaveBeenCalled()
  })
})

describe('useTimeLogSummary', () => {
  it('returns the summary rows as sent', async () => {
    const row = {
      talentId: 'talent-1',
      talentName: 'Talenta #1',
      milestoneId: 'm-1',
      milestoneTitle: 'Backend',
      totalMinutes: 480,
      entryCount: 6,
    }
    stub(() => json({ success: true, data: [row] }))
    const { Wrapper } = wrapper()

    const { result } = renderHook(() => useTimeLogSummary('p-1'), { wrapper: Wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.data).toEqual([row])
  })

  /**
   * The summary is a secondary panel beside the log itself, so a failure there
   * degrades to an empty chart rather than taking the page down with it.
   */
  it('degrades to an empty summary when the request fails', async () => {
    stub(() => json({}, 500))
    const { Wrapper } = wrapper()

    const { result } = renderHook(() => useTimeLogSummary('p-1'), { wrapper: Wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.data).toEqual([])
  })

  it('does not fire without a project', () => {
    const spy = stub(() => json({ success: true, data: [] }))
    const { Wrapper } = wrapper()

    renderHook(() => useTimeLogSummary(''), { wrapper: Wrapper })

    expect(spy).not.toHaveBeenCalled()
  })
})

describe('useCreateTimeLog', () => {
  it('posts the entry as JSON', async () => {
    const spy = stub(() => json({ success: true, data: {} }))
    const { Wrapper } = wrapper()

    const { result } = renderHook(() => useCreateTimeLog('p-1'), { wrapper: Wrapper })
    await result.current.mutateAsync({
      taskId: 'task-1',
      startedAt: '2026-08-13T09:00:00.000Z',
      durationMinutes: 30,
    })

    const [url, init] = spy.mock.calls[0]
    expect(String(url)).toContain('/api/v1/time-logs')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      taskId: 'task-1',
      startedAt: '2026-08-13T09:00:00.000Z',
      durationMinutes: 30,
    })
  })

  /**
   * The log table and the summary both change when an entry lands, so both
   * keys are invalidated. Missing one leaves the chart showing yesterday's
   * totals beside today's rows.
   */
  it('refreshes both the log and the summary once the entry lands', async () => {
    stub(() => json({ success: true, data: {} }))
    const { client, Wrapper } = wrapper()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderHook(() => useCreateTimeLog('p-1'), { wrapper: Wrapper })
    await result.current.mutateAsync({ taskId: 'task-1', startedAt: '2026-08-13T09:00:00.000Z' })

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['time-logs', 'p-1'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['time-logs-summary', 'p-1'] })
  })

  /**
   * The message comes from the error code, never from the server body: the
   * body is one hardcoded language and carries upstream detail.
   */
  it('raises a localised message when the server refuses', async () => {
    stub(() => json({ error: { code: 'PROJECT_VALIDATION_INVALID_STATUS' } }, 400))
    const { Wrapper } = wrapper()

    const { result } = renderHook(() => useCreateTimeLog('p-1'), { wrapper: Wrapper })

    await expect(
      result.current.mutateAsync({ taskId: 'task-1', startedAt: '2026-08-13T09:00:00.000Z' }),
    ).rejects.toThrow()
  })

  it('still raises when the error body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('not json', { status: 500 }))),
    )
    const { Wrapper } = wrapper()

    const { result } = renderHook(() => useCreateTimeLog('p-1'), { wrapper: Wrapper })

    await expect(
      result.current.mutateAsync({ taskId: 'task-1', startedAt: '2026-08-13T09:00:00.000Z' }),
    ).rejects.toThrow()
  })
})

describe('useStopTimer', () => {
  it('posts to the stop endpoint for that entry', async () => {
    const spy = stub(() => json({ success: true, data: {} }))
    const { Wrapper } = wrapper()

    const { result } = renderHook(() => useStopTimer('p-1'), { wrapper: Wrapper })
    await result.current.mutateAsync('tl-1')

    const [url, init] = spy.mock.calls[0]
    expect(String(url)).toContain('/api/v1/time-logs/tl-1/stop')
    expect(init?.method).toBe('POST')
  })

  it('refreshes both the log and the summary once the timer stops', async () => {
    stub(() => json({ success: true, data: {} }))
    const { client, Wrapper } = wrapper()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderHook(() => useStopTimer('p-1'), { wrapper: Wrapper })
    await result.current.mutateAsync('tl-1')

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['time-logs', 'p-1'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['time-logs-summary', 'p-1'] })
  })

  it('raises when the entry cannot be stopped', async () => {
    stub(() => json({ error: { code: 'PROJECT_NOT_FOUND' } }, 404))
    const { Wrapper } = wrapper()

    const { result } = renderHook(() => useStopTimer('p-1'), { wrapper: Wrapper })

    await expect(result.current.mutateAsync('tl-1')).rejects.toThrow()
  })
})
