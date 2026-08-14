// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useScopingChat } from './use-chat'

/**
 * The scoping chat is three awaited loads followed by an SSE send, all against
 * bare fetch rather than TanStack Query. These stub at the fetch boundary and
 * drive the stream frame by frame, because frame splitting is where the
 * interesting failures live: a token arriving mid-frame, a `data:` line split
 * across two chunks, or a payload that is not JSON at all.
 */

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>

let routes: Record<string, Route>

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status })
}

/** Emit the given chunks as an SSE body. */
function sse(...chunks: string[]) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(stream, { status: 200 })
}

function frame(event: unknown) {
  return `data: ${JSON.stringify(event)}\n\n`
}

beforeEach(() => {
  routes = {
    'scoping-status': () => json({ data: { formFloor: 0, missing: [] } }),
    'chat/conversations': () => json({ data: [] }),
    'chat/stream': () => sse(frame({ type: 'done', message: 'ok', completeness: 50 })),
  }
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    // Fixed order: the messages path contains 'chat/conversations' as a prefix,
    // so a plain substring match would send it to the conversation list stub.
    const key = ['scoping-status', 'chat/stream', 'messages', 'chat/conversations'].find(
      (k) => url.includes(k) && routes[k],
    )
    if (!key) throw new Error(`no stub for ${url}`)
    return routes[key](url, init)
  }) as unknown as typeof fetch
})

async function renderChat(projectId = 'p1') {
  const view = renderHook(({ id }: { id: string }) => useScopingChat(id), {
    initialProps: { id: projectId },
  })
  // Let the initial load settle so later assertions are not racing it.
  await act(async () => {
    await Promise.resolve()
  })
  return view
}

describe('loading the existing scope', () => {
  it('starts empty when the project has no scoping thread yet', async () => {
    const { result } = await renderChat()

    await waitFor(() => expect(result.current.messages).toEqual([]))
    expect(result.current.completeness).toBe(0)
  })

  /**
   * The intake form already answered some of what the chat asks. That floor is
   * ground truth, so the bar must not start at zero and imply nothing is known.
   */
  it('adopts the completeness floor the intake form established', async () => {
    routes['scoping-status'] = () =>
      json({ data: { formFloor: 40, missing: ['target_users', 'integrations'] } })

    const { result } = await renderChat()

    await waitFor(() => expect(result.current.completeness).toBe(40))
    expect(result.current.missing).toEqual(['target_users', 'integrations'])
  })

  it('loads the transcript oldest first regardless of the order returned', async () => {
    routes['chat/conversations'] = () =>
      json({ data: [{ id: 'c1', projectId: 'p1', type: 'ai_scoping' }] })
    routes.messages = () =>
      json({
        data: {
          items: [
            { id: 'm2', senderType: 'ai', content: 'later', createdAt: '2026-01-02T00:00:00Z' },
            { id: 'm1', senderType: 'user', content: 'earlier', createdAt: '2026-01-01T00:00:00Z' },
          ],
        },
      })

    const { result } = await renderChat()

    await waitFor(() => expect(result.current.messages).toHaveLength(2))
    expect(result.current.messages.map((m) => m.content)).toEqual(['earlier', 'later'])
  })

  /** Another project's thread must not be adopted under this project. */
  it('ignores a scoping thread belonging to a different project', async () => {
    routes['chat/conversations'] = () =>
      json({ data: [{ id: 'c9', projectId: 'other', type: 'ai_scoping' }] })
    routes.messages = () => json({ data: { items: [{ id: 'x', content: 'leak' }] } })

    const { result } = await renderChat()

    await waitFor(() => expect(result.current.messages).toEqual([]))
  })

  it('ignores a non-scoping thread on the same project', async () => {
    routes['chat/conversations'] = () =>
      json({ data: [{ id: 'c2', projectId: 'p1', type: 'owner_talent' }] })
    routes.messages = () => json({ data: { items: [{ id: 'x', content: 'leak' }] } })

    const { result } = await renderChat()

    await waitFor(() => expect(result.current.messages).toEqual([]))
  })

  it('carries on with defaults when the status endpoint is unreachable', async () => {
    routes['scoping-status'] = () => {
      throw new TypeError('Failed to fetch')
    }

    const { result } = await renderChat()

    await waitFor(() => expect(result.current.completeness).toBe(0))
    expect(result.current.error).toBeNull()
  })

  it('carries on when the conversation list errors', async () => {
    routes['chat/conversations'] = () => json({ error: 'boom' }, 500)

    const { result } = await renderChat()

    await waitFor(() => expect(result.current.messages).toEqual([]))
    expect(result.current.error).toBeNull()
  })

  it('ignores a status body whose shape is wrong', async () => {
    routes['scoping-status'] = () => json({ data: { formFloor: 'lots', missing: 'none' } })

    const { result } = await renderChat()

    await waitFor(() => expect(result.current.completeness).toBe(0))
    expect(result.current.missing).toEqual([])
  })
})

describe('streaming a reply', () => {
  it('shows the user turn immediately and fills the AI turn as tokens arrive', async () => {
    routes['chat/stream'] = () =>
      sse(
        frame({ type: 'token', delta: 'Hal' }),
        frame({ type: 'token', delta: 'o' }),
        frame({ type: 'done', completeness: 60, missing: ['budget'] }),
      )

    const { result } = await renderChat()
    await act(async () => {
      await result.current.sendMessage('what next?')
    })

    expect(result.current.messages.map((m) => [m.senderType, m.content])).toEqual([
      ['user', 'what next?'],
      ['ai', 'Halo'],
    ])
    expect(result.current.completeness).toBe(60)
    expect(result.current.missing).toEqual(['budget'])
    expect(result.current.isLoading).toBe(false)
  })

  /** A chunk boundary is not a frame boundary; the buffer has to bridge it. */
  it('reassembles a frame split across two network chunks', async () => {
    const whole = frame({ type: 'token', delta: 'split ok' })
    routes['chat/stream'] = () =>
      sse(whole.slice(0, 10), whole.slice(10), frame({ type: 'done', completeness: 10 }))

    const { result } = await renderChat()
    await act(async () => {
      await result.current.sendMessage('hi')
    })

    expect(result.current.messages[1].content).toBe('split ok')
  })

  it('prefers the final message on the done event over the accumulated tokens', async () => {
    routes['chat/stream'] = () =>
      sse(frame({ type: 'token', delta: 'partial' }), frame({ type: 'done', message: 'complete' }))

    const { result } = await renderChat()
    await act(async () => {
      await result.current.sendMessage('hi')
    })

    expect(result.current.messages[1].content).toBe('complete')
  })

  it('never reports more than a full score', async () => {
    routes['chat/stream'] = () => sse(frame({ type: 'done', completeness: 140 }))

    const { result } = await renderChat()
    await act(async () => {
      await result.current.sendMessage('hi')
    })

    expect(result.current.completeness).toBe(100)
  })

  it('skips keep-alive comments and blank data lines', async () => {
    routes['chat/stream'] = () =>
      sse(
        ': keep-alive\n\n',
        'data:\n\n',
        frame({ type: 'token', delta: 'real' }),
        frame({ type: 'done' }),
      )

    const { result } = await renderChat()
    await act(async () => {
      await result.current.sendMessage('hi')
    })

    expect(result.current.messages[1].content).toBe('real')
  })

  /** A truncated frame is noise, not a reason to fail the whole turn. */
  it('ignores a frame whose payload is not JSON', async () => {
    routes['chat/stream'] = () =>
      sse('data: {not json\n\n', frame({ type: 'token', delta: 'after' }), frame({ type: 'done' }))

    const { result } = await renderChat()
    await act(async () => {
      await result.current.sendMessage('hi')
    })

    expect(result.current.messages[1].content).toBe('after')
    expect(result.current.error).toBeNull()
  })
})

/**
 * A failed generation must not leave an empty AI bubble sitting in the
 * transcript: the placeholder is removed and the reason surfaced instead.
 */
describe('a generation that fails', () => {
  it('drops the empty placeholder and reports a rejected request', async () => {
    routes['chat/stream'] = () => json({ error: 'upstream' }, 502)

    const { result } = await renderChat()
    await act(async () => {
      await result.current.sendMessage('hi')
    })

    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0].senderType).toBe('user')
    expect(result.current.error).toContain('502')
    expect(result.current.isLoading).toBe(false)
  })

  it('surfaces an error event carried inside the stream', async () => {
    routes['chat/stream'] = () => sse(frame({ type: 'error', message: 'stream error: quota' }))

    const { result } = await renderChat()
    await act(async () => {
      await result.current.sendMessage('hi')
    })

    expect(result.current.error).toBe('stream error: quota')
    expect(result.current.messages).toHaveLength(1)
  })

  it('reports a dropped connection', async () => {
    routes['chat/stream'] = () => {
      throw new TypeError('Failed to fetch')
    }

    const { result } = await renderChat()
    await act(async () => {
      await result.current.sendMessage('hi')
    })

    expect(result.current.error).toBe('Failed to fetch')
  })
})

describe('send guards', () => {
  it('ignores an empty submission', async () => {
    const { result } = await renderChat()
    const before = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length

    await act(async () => {
      await result.current.sendMessage('   ')
    })

    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before)
  })

  /**
   * Leaving the page mid-generation used to leave the SSE connection open and
   * a billed Gemini generation running with nobody reading it.
   */
  it('aborts the in-flight generation when the component unmounts', async () => {
    let signal: AbortSignal | undefined
    routes['chat/stream'] = (_url, init) => {
      signal = init?.signal ?? undefined
      return new Response(new ReadableStream({ start() {} }), { status: 200 })
    }

    const { result, unmount } = await renderChat()
    act(() => {
      void result.current.sendMessage('hi')
    })
    await waitFor(() => expect(signal).toBeDefined())

    unmount()

    expect(signal?.aborted).toBe(true)
  })

  it('appends a system notice without touching the server', async () => {
    const { result } = await renderChat()
    const before = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length

    act(() => {
      result.current.addSystemMessage('BRD generated')
    })

    expect(result.current.messages.at(-1)).toMatchObject({
      senderType: 'system',
      content: 'BRD generated',
    })
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before)
  })
})
