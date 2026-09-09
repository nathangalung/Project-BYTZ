// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '@/lib/testing/harness'
import { useToastStore } from '@/stores/toast'
import * as scopingRoute from './scoping'

/**
 * The conversation that turns an intake form into a BRD.
 *
 * `scoping-opening.test.ts` next door reads this file as text to check the
 * locale keys resolve; nothing had ever rendered it. Everything that matters
 * is gated on the completeness score - the Generate BRD button, the scope
 * summary the owner confirms, the gap chips - so an unexecuted file meant the
 * whole gate was unverified.
 */

vi.setConfig({ testTimeout: 30_000 })

/**
 * jsdom ships no scrollIntoView, and the page pins the transcript to the
 * bottom from a mount effect - so without this the whole route throws into the
 * error boundary before a single assertion runs.
 */
Element.prototype.scrollIntoView = vi.fn()

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, apiFetch }
})

const PROJECT = {
  id: 'p-1',
  title: 'Toko Online Batik',
  category: 'web_app',
  description: 'Marketplace batik untuk UMKM',
  budgetMin: 5_000_000,
  budgetMax: 15_000_000,
  estimatedTimelineDays: 60,
  status: 'scoping',
}

type ChatTurn = { id: string; senderType: string; content: string; createdAt: string }

type Wiring = {
  formFloor?: number
  missing?: string[]
  transcript?: ChatTurn[]
  /** Frames the chat stream emits, already serialised as SSE `data:` lines. */
  streamFrames?: string[]
  streamStatus?: number
  specParseOk?: boolean
  /** Refuse to hand out a signed URL, so the browser never reaches storage. */
  presignOk?: boolean
  /** Signed URL granted, but storage rejects the body. */
  putOk?: boolean
  /** Parsed, but the service returned no summary line. */
  specMessage?: string | null
  /** The thread exists but its messages will not load. */
  transcriptOk?: boolean
}

/**
 * Everything on this page except the project and the BRD mutation goes through
 * raw fetch: the scoping status, the transcript load and the SSE stream all
 * bypass apiFetch, so stubbing apiFetch alone leaves them hitting the network.
 */
function stubNetwork(wiring: Wiring = {}) {
  const {
    formFloor = 20,
    missing = ['budget', 'features'],
    transcript = [],
    streamFrames = [
      'data: {"type":"token","delta":"Baik, "}',
      'data: {"type":"token","delta":"saya mengerti."}',
      'data: {"type":"done","completeness":85,"missing":[]}',
    ],
    streamStatus = 200,
    specParseOk = true,
    presignOk = true,
    putOk = true,
    specMessage = 'Ada 12 fitur terdeteksi',
    transcriptOk = true,
  } = wiring

  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)

    if (url.includes('/scoping-status')) {
      return new Response(JSON.stringify({ data: { formFloor, missing } }), { status: 200 })
    }
    if (url.includes('/chat/conversations') && url.includes('/messages')) {
      if (!transcriptOk) return new Response('{}', { status: 500 })
      return new Response(
        JSON.stringify({ data: { items: transcript, total: transcript.length } }),
        {
          status: 200,
        },
      )
    }
    if (url.endsWith('/chat/conversations')) {
      return new Response(
        JSON.stringify({ data: [{ id: 'conv-1', projectId: 'p-1', type: 'ai_scoping' }] }),
        { status: 200 },
      )
    }
    if (url.includes('/chat/stream')) {
      if (streamStatus !== 200) return new Response('', { status: streamStatus })
      return new Response(`${streamFrames.join('\n\n')}\n\n`, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }
    if (url.includes('presigned-url')) {
      return new Response(JSON.stringify({ data: { url: 'https://storage.test/s.pdf?sig=x' } }), {
        status: presignOk ? 200 : 500,
      })
    }
    // The PUT goes straight to storage, so it is matched on the signed URL.
    if (url.startsWith('https://storage.test/')) {
      return new Response('', { status: putOk ? 200 : 403 })
    }
    if (url.includes('/upload-spec')) {
      return new Response(
        JSON.stringify({ data: specMessage === null ? {} : { message: specMessage } }),
        { status: specParseOk ? 200 : 500 },
      )
    }
    return new Response('', { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function render() {
  return renderRoute(scopingRoute, {
    path: '/projects/$projectId/scoping',
    entry: '/projects/p-1/scoping',
    destinations: ['/projects/$projectId', '/projects/$projectId/brd'],
  })
}

function toastMessages() {
  return useToastStore.getState().toasts.map((toast) => toast.message)
}

beforeEach(() => {
  apiFetch.mockReset()
  apiFetch.mockResolvedValue({ success: true, data: PROJECT })
  stubNetwork()
  useToastStore.setState({ toasts: [] })
})

describe('the project summary beside the chat', () => {
  it('shows what the owner asked for', async () => {
    await render()

    expect(await screen.findByText('Toko Online Batik')).toBeDefined()
    expect(screen.getByText('Web App')).toBeDefined()
    expect(screen.getByText('Rp 5.000.000 - Rp 15.000.000')).toBeDefined()
    expect(screen.getByText('60 days')).toBeDefined()
  })

  it('shows placeholders rather than an empty panel before the project lands', async () => {
    apiFetch.mockImplementation(() => new Promise(() => {}))

    const { container } = await render()

    expect(container.querySelectorAll('.animate-pulse').length).toBe(3)
    expect(screen.queryByText('Toko Online Batik')).toBeNull()
  })
})

/**
 * What the owner saw in production when the AI key expired: their message
 * appeared, the typing dots stopped, and nothing else ever happened. The page
 * read the transcript but never the hook's error, so the chat had no error
 * state at all - three of the four states this codebase requires.
 */
describe('a turn the AI could not answer', () => {
  it('explains the failure and offers a retry', async () => {
    const user = userEvent.setup()
    stubNetwork({
      streamFrames: [`data: ${JSON.stringify({ type: 'error', code: 'AI_SERVICE_UNAVAILABLE' })}`],
    })

    await render()
    const input = await screen.findByPlaceholderText('Send a message...')
    await user.type(input, 'Integrasi payroll')
    await user.keyboard('{Enter}')

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(/AI service is unavailable/i)).toBeDefined()
    expect(within(alert).getByRole('button', { name: /Try Again/i })).toBeDefined()
  })

  /** A rate limit is a wait, not an outage, and reads differently. */
  it('says the limit was hit rather than that the service is down', async () => {
    const user = userEvent.setup()
    stubNetwork({
      streamFrames: [`data: ${JSON.stringify({ type: 'error', code: 'AI_RATE_LIMITED' })}`],
    })

    await render()
    const input = await screen.findByPlaceholderText('Send a message...')
    await user.type(input, 'Integrasi payroll')
    await user.keyboard('{Enter}')

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(/Too many AI requests/i)).toBeDefined()
  })

  /** An unmapped code still has to say something the owner can act on. */
  it('falls back to a general message for a code it does not know', async () => {
    const user = userEvent.setup()
    stubNetwork({
      streamFrames: [`data: ${JSON.stringify({ type: 'error', code: 'SOMETHING_NEW' })}`],
    })

    await render()
    const input = await screen.findByPlaceholderText('Send a message...')
    await user.type(input, 'Integrasi payroll')
    await user.keyboard('{Enter}')

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByRole('button', { name: /Try Again/i })).toBeDefined()
  })

  it('resends the message the failed turn dropped', async () => {
    const user = userEvent.setup()
    stubNetwork({
      streamFrames: [`data: ${JSON.stringify({ type: 'error', code: 'AI_SERVICE_UNAVAILABLE' })}`],
    })

    await render()
    const input = await screen.findByPlaceholderText('Send a message...')
    await user.type(input, 'Integrasi payroll')
    await user.keyboard('{Enter}')

    const alert = await screen.findByRole('alert')
    const streamCalls = () =>
      (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) =>
        String(c[0]).includes('chat/stream'),
      ).length
    const before = streamCalls()

    await user.click(within(alert).getByRole('button', { name: /Try Again/i }))

    await waitFor(() => expect(streamCalls()).toBe(before + 1))
  })

  /** An unknown code must still say something rather than render blank. */
  it('falls back to a generic message for an unrecognised code', async () => {
    const user = userEvent.setup()
    stubNetwork({
      streamFrames: [`data: ${JSON.stringify({ type: 'error', code: 'SOMETHING_NEW' })}`],
    })

    await render()
    const input = await screen.findByPlaceholderText('Send a message...')
    await user.type(input, 'halo')
    await user.keyboard('{Enter}')

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(/An error occurred/i)).toBeDefined()
  })
})

/**
 * The owner has just finished a long form. An empty chat reads as a broken
 * one, so the assistant opens by naming the gaps the form left.
 */
describe('the opening turn', () => {
  it('names each gap the intake form left', async () => {
    await render()

    expect(await screen.findByText(/Hello! I will help you/)).toBeDefined()
    expect(screen.getAllByText('Budget').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Key features').length).toBeGreaterThan(0)
  })

  it('writes the opening sentence for the owner when a gap is picked', async () => {
    const user = userEvent.setup()
    await render()
    const chips = await screen.findAllByRole('button', { name: 'Budget' })

    await user.click(chips[chips.length - 1])

    const input = screen.getByPlaceholderText('Send a message...') as HTMLInputElement
    await waitFor(() => expect(input.value.length).toBeGreaterThan(0))
  })

  it('says the form is complete when it left no gaps', async () => {
    stubNetwork({ formFloor: 90, missing: [] })

    await render()

    expect(await screen.findByText(/Information is complete enough/)).toBeDefined()
  })

  it('gives way to the transcript once there are messages', async () => {
    stubNetwork({
      transcript: [
        {
          id: 'm-1',
          senderType: 'user',
          content: 'Saya butuh checkout',
          createdAt: '2026-03-01T01:00:00.000Z',
        },
      ],
    })

    await render()

    expect(await screen.findByText('Saya butuh checkout')).toBeDefined()
    expect(screen.queryByText(/Hello! I will help you/)).toBeNull()
  })
})

describe('the completeness gate on generating a BRD', () => {
  /**
   * Disabled rather than absent. Hiding it left the owner with a percentage,
   * a list of gaps and no visible way forward, which reads the same as a
   * feature that does not exist.
   */
  it('disables the generate control below the threshold and says why', async () => {
    stubNetwork({ formFloor: 40 })

    await render()

    expect(await screen.findByText('40%')).toBeDefined()
    const generate = screen.getByRole('button', { name: 'Generate BRD' })
    expect((generate as HTMLButtonElement).disabled).toBe(true)
    expect(generate.getAttribute('aria-describedby')).toBe('scoping-still-needed')
    expect(screen.getByText('Still needed')).toBeDefined()
  })

  it('offers the generate control once the form alone clears the threshold', async () => {
    stubNetwork({ formFloor: 85, missing: [] })

    await render()

    const generate = await screen.findByRole('button', { name: 'Generate BRD' })
    expect((generate as HTMLButtonElement).disabled).toBe(false)
    expect(generate.getAttribute('aria-describedby')).toBeNull()
    expect(screen.getByText(/Information is complete enough/)).toBeDefined()
  })

  it('opens the gate when the conversation raises the score past it', async () => {
    stubNetwork({ formFloor: 30 })
    const user = userEvent.setup()
    await render()
    const generate = screen.getByRole('button', { name: 'Generate BRD' }) as HTMLButtonElement
    expect(generate.disabled).toBe(true)

    await user.type(screen.getByPlaceholderText('Send a message...'), 'Anggaran 10 juta')
    await user.click(screen.getByRole('button', { name: 'Send a message...' }))

    expect(await screen.findByText('85%')).toBeDefined()
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Generate BRD' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    )
  })
})

describe('sending a message', () => {
  it('shows the reply the stream assembled token by token', async () => {
    const user = userEvent.setup()
    await render()

    await user.type(screen.getByPlaceholderText('Send a message...'), 'Halo')
    await user.click(screen.getByRole('button', { name: 'Send a message...' }))

    expect(await screen.findByText('Baik, saya mengerti.')).toBeDefined()
    expect(screen.getByText('Halo')).toBeDefined()
  })

  it('clears the box so the message cannot be sent twice', async () => {
    const user = userEvent.setup()
    await render()
    const input = screen.getByPlaceholderText('Send a message...') as HTMLInputElement

    await user.type(input, 'Halo')
    await user.click(screen.getByRole('button', { name: 'Send a message...' }))

    await waitFor(() => expect(input.value).toBe(''))
  })

  it('sends on Enter as well as from the button', async () => {
    const fetchMock = stubNetwork()
    const user = userEvent.setup()
    await render()

    await user.type(screen.getByPlaceholderText('Send a message...'), 'Halo{Enter}')

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/chat/stream'))).toBe(true),
    )
  })

  it('refuses to send an empty message', async () => {
    const fetchMock = stubNetwork()
    const user = userEvent.setup()
    await render()

    await user.type(screen.getByPlaceholderText('Send a message...'), '   ')
    const send = screen.getByRole('button', { name: 'Send a message...' })

    expect(send.hasAttribute('disabled')).toBe(true)
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/chat/stream'))).toBe(false)
  })

  /**
   * The send button is disabled on whitespace, and Enter does not consult it.
   * The guard in the handler is what actually refuses the turn.
   */
  it('refuses an Enter on whitespace alone', async () => {
    const fetchMock = stubNetwork()
    const user = userEvent.setup()
    await render()

    await user.type(await screen.findByPlaceholderText('Send a message...'), '   ')
    await user.keyboard('{Enter}')

    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/chat/stream'))).toBe(false)
  })

  /** A dropped stream must not leave a blank assistant bubble behind. */
  it('drops the placeholder when the stream fails', async () => {
    stubNetwork({ streamStatus: 502 })
    const user = userEvent.setup()
    await render()

    await user.type(screen.getByPlaceholderText('Send a message...'), 'Halo')
    await user.click(screen.getByRole('button', { name: 'Send a message...' }))

    expect(await screen.findByText('Halo')).toBeDefined()
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Generate BRD' }) as HTMLButtonElement).disabled,
      ).toBe(true),
    )
  })
})

/**
 * The confirmation step between the conversation and a billed generation.
 * Generating from a misread scope is what this modal exists to prevent.
 */
describe('confirming the scope before generating', () => {
  async function openSummary() {
    stubNetwork({ formFloor: 85, missing: [] })
    const user = userEvent.setup()
    const rendered = await render()
    await user.click(await screen.findByRole('button', { name: 'Generate BRD' }))
    return { user, ...rendered, dialog: within(await screen.findByRole('dialog')) }
  }

  it('restates the project before anything is generated', async () => {
    const { dialog } = await openSummary()

    expect(dialog.getByRole('heading', { name: 'Scope Summary' })).toBeDefined()
    expect(dialog.getByText('Toko Online Batik')).toBeDefined()
    expect(dialog.getByText('Web App')).toBeDefined()
  })

  it('lists what the owner said, not what the assistant replied', async () => {
    stubNetwork({
      formFloor: 85,
      missing: [],
      transcript: [
        {
          id: 'm-1',
          senderType: 'user',
          content: 'Butuh pembayaran QRIS',
          createdAt: '2026-03-01T01:00:00.000Z',
        },
        {
          id: 'm-2',
          senderType: 'ai',
          content: 'Baik, saya catat',
          createdAt: '2026-03-01T01:00:01.000Z',
        },
      ],
    })
    const user = userEvent.setup()
    await render()

    await user.click(await screen.findByRole('button', { name: 'Generate BRD' }))

    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByText('Butuh pembayaran QRIS')).toBeDefined()
    expect(dialog.queryByText('Baik, saya catat')).toBeNull()
  })

  it('generates nothing while the modal is only open', async () => {
    await openSummary()

    expect(apiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/generate-brd'),
      expect.anything(),
    )
  })

  it('generates the BRD and shows it once confirmed', async () => {
    const { user, router } = await openSummary()

    await user.click(screen.getByRole('button', { name: 'Confirm & Generate BRD' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/p-1/brd'))
  })

  it('defaults the document to Indonesian', async () => {
    const { user } = await openSummary()

    await user.click(screen.getByRole('button', { name: 'Confirm & Generate BRD' }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/v1/projects/p-1/generate-brd',
        expect.objectContaining({ body: JSON.stringify({ language: 'id' }) }),
      ),
    )
  })

  it('sends English instead once the owner switches the document language', async () => {
    const { user } = await openSummary()

    await user.click(screen.getByRole('button', { name: 'English' }))
    await user.click(screen.getByRole('button', { name: 'Confirm & Generate BRD' }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/v1/projects/p-1/generate-brd',
        expect.objectContaining({ body: JSON.stringify({ language: 'en' }) }),
      ),
    )
  })

  /**
   * A refused generation reopens the modal rather than dropping the owner back
   * on the chat with no explanation - the daily free limit lands here.
   */
  it('reopens the confirmation and states why when generation is refused', async () => {
    apiFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('/generate-brd')) throw new Error('Daily free limit reached')
      return { success: true, data: PROJECT }
    })
    const { user, router } = await openSummary()

    await user.click(screen.getByRole('button', { name: 'Confirm & Generate BRD' }))

    await waitFor(() => expect(toastMessages()).toContain('Daily free limit reached'))
    expect(await screen.findByRole('dialog')).toBeDefined()
    expect(router.state.location.pathname).toBe('/projects/p-1/scoping')
  })

  it('names a refusal that arrives without a message', async () => {
    apiFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('/generate-brd')) throw 'nope'
      return { success: true, data: PROJECT }
    })
    const { user } = await openSummary()

    await user.click(screen.getByRole('button', { name: 'Confirm & Generate BRD' }))

    await waitFor(() => expect(toastMessages()).toContain('Generating BRD...'))
  })

  /**
   * Confirming closes the modal first, so the wait belongs to the header
   * control. Generation runs for tens of seconds; leaving that control idle
   * reads as nothing having happened.
   */
  it('shows the generation in flight on the control that stays on screen', async () => {
    apiFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('/generate-brd')) return new Promise(() => {})
      return { success: true, data: PROJECT }
    })
    const { user } = await openSummary()

    await user.click(screen.getByRole('button', { name: 'Confirm & Generate BRD' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const generating = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Generating BRD...',
    })
    expect(generating.disabled).toBe(true)
  })

  it('closes from the back-to-chat control without generating', async () => {
    const { user } = await openSummary()

    await user.click(screen.getByRole('button', { name: 'Back to Chat' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(apiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/generate-brd'),
      expect.anything(),
    )
  })

  it('closes from the dismiss control too', async () => {
    const { user, dialog } = await openSummary()

    await user.click(dialog.getByRole('button', { name: 'Close dialog' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('uploading a specification instead of typing it', () => {
  const SPEC = new File(['spec'], 'kebutuhan.pdf', { type: 'application/pdf' })

  it('parses the file and reports what it found into the chat', async () => {
    const fetchMock = stubNetwork()
    const user = userEvent.setup()
    const { container } = await render()

    await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, SPEC)

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/upload-spec'))).toBe(true),
    )
    expect(
      await screen.findByText('[Specification uploaded and parsed] Ada 12 fitur terdeteksi'),
    ).toBeDefined()
  })

  it('says so in the chat when the file could not be parsed', async () => {
    stubNetwork({ specParseOk: false })
    const user = userEvent.setup()
    const { container } = await render()

    await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, SPEC)

    expect(await screen.findByText('[Failed to upload specification]')).toBeDefined()
  })

  /**
   * Three separate hops can fail before the parse does, and each one has to
   * end the same way. A silent failure here leaves the owner watching an
   * upload control that went back to idle with nothing in the transcript, and
   * no way to tell whether their document was read.
   */
  it.each([
    ['the signed URL is refused', { presignOk: false }],
    ['storage rejects the body', { putOk: false }],
  ])('says so in the chat when %s', async (_label, wiring) => {
    const fetchMock = stubNetwork(wiring)
    const user = userEvent.setup()
    const { container } = await render()

    await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, SPEC)

    expect(await screen.findByText('[Failed to upload specification]')).toBeDefined()
    // The later hops must not run once an earlier one failed.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/upload-spec'))).toBe(false)
  })

  /**
   * The visible control is disabled while an upload runs, but the file input
   * behind it is not, so a second pick can still reach the handler. One upload
   * at a time, or the transcript gets two summaries for one document.
   */
  it('ignores a second file picked while the first is still uploading', async () => {
    let releasePresign: (() => void) | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('presigned-url')) {
        await new Promise<void>((resolve) => {
          releasePresign = resolve
        })
        return new Response(JSON.stringify({ data: { url: 'https://storage.test/s.pdf?sig=x' } }), {
          status: 200,
        })
      }
      if (url.includes('/scoping-status')) {
        return new Response(JSON.stringify({ data: { formFloor: 20, missing: [] } }), {
          status: 200,
        })
      }
      if (url.endsWith('/chat/conversations')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    const { container } = await render()
    const picker = container.querySelector('input[type="file"]') as HTMLInputElement

    await user.upload(picker, SPEC)
    await waitFor(() => expect(releasePresign).not.toBeNull())
    await user.upload(picker, SPEC)

    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('presigned-url'))).toHaveLength(
      1,
    )
  })

  /** Parsed but wordless still counts as parsed, so it must not read as a failure. */
  it('falls back to its own wording when the parser returns no summary', async () => {
    stubNetwork({ specMessage: null })
    const user = userEvent.setup()
    const { container } = await render()

    await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, SPEC)

    expect(
      await screen.findByText(
        '[Specification uploaded and parsed] Specification uploaded and parsed',
      ),
    ).toBeDefined()
  })

  /** The input is hidden, so the visible control has to forward the click. */
  it('opens the file picker from the upload control', async () => {
    stubNetwork()
    const user = userEvent.setup()
    const { container } = await render()
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const click = vi.spyOn(input, 'click')

    await user.click(screen.getByRole('button', { name: /upload spec/i }))

    expect(click).toHaveBeenCalledOnce()
  })

  it('does nothing when the picker is opened and cancelled', async () => {
    const fetchMock = stubNetwork()
    const { container } = await render()

    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [] },
    })

    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('presigned-url'))).toBe(false)
  })
})

/**
 * System turns are the platform talking, not the assistant: the spec-upload
 * result and the BRD-ready notice both arrive this way. They are centred and
 * unattributed rather than rendered as a bubble from someone.
 */
describe('a system turn in the transcript', () => {
  it('renders centred without a sender', async () => {
    stubNetwork({
      transcript: [
        {
          id: 'm-sys',
          senderType: 'system',
          content: 'BRD sudah dibuat',
          createdAt: new Date().toISOString(),
        },
      ],
    })

    await render()

    const notice = await screen.findByText('BRD sudah dibuat')
    expect(notice.parentElement?.className).toContain('justify-center')
  })
})

/**
 * The transcript failed but the thread exists. The page used to render the
 * opening prompts, which read as a fresh conversation - so the owner typed
 * into what looked like a new scope and appended to a thread they could not
 * see, on the page whose whole purpose is that transcript.
 */
describe('when the conversation history will not load', () => {
  it('says so instead of showing the opening prompts', async () => {
    stubNetwork({ transcriptOk: false })

    await render()

    const alerts = await screen.findAllByRole('alert')
    expect(alerts.map((a) => a.textContent).join(' ')).toContain(
      'Could not load the conversation history',
    )
  })

  it('offers a retry that asks for the transcript again', async () => {
    const fetchMock = stubNetwork({ transcriptOk: false })

    await render()

    const alert = (await screen.findAllByRole('alert'))[0]
    const before = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/messages')).length
    within(alert).getByRole('button').click()

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter((c) => String(c[0]).includes('/messages')).length,
      ).toBeGreaterThan(before),
    )
  })

  it('shows the opening prompts when the thread is simply empty', async () => {
    stubNetwork({ transcript: [] })

    await render()

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})
