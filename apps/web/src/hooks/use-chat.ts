import { useCallback, useEffect, useRef, useState } from 'react'
import { apiUrl } from '@/lib/api'

type RawMessage = { id: string; senderType: string; content: string; createdAt: string }

export type ChatMessage = {
  id: string
  senderType: 'user' | 'ai' | 'system'
  content: string
  createdAt: string
}

type ScopingChatState = {
  messages: ChatMessage[]
  completeness: number
  missing: string[]
  isLoading: boolean
  error: string | null
  historyFailed: boolean
}

/**
 * The transcript is read in pages, newest first, and the read is bounded.
 *
 * One request for the first hundred was not paging, it was a silent cut: an
 * owner who had scoped a large project came back to a thread missing its
 * middle, with nothing saying so. The server orders by `created_at` descending,
 * so page one is the most recent turns and the cap drops the oldest - the right
 * end to lose in a thread you scroll up through, and the end the model's own
 * context window drops too. The cap exists because an unbounded loop over a
 * `total` the client does not control is a request amplifier.
 */
const HISTORY_PAGE_SIZE = 100
const HISTORY_MAX_PAGES = 10

/** Server-sent error frame, told apart from a malformed one. */
class StreamError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StreamError'
  }
}

export function useScopingChat(projectId: string) {
  const [state, setState] = useState<ScopingChatState>({
    messages: [],
    completeness: 0,
    missing: [],
    isLoading: false,
    error: null,
    historyFailed: false,
  })
  const [historyAttempt, setHistoryAttempt] = useState(0)
  const messageIdCounter = useRef(0)
  /**
   * Cancels an in-flight generation when the component goes away.
   *
   * The transcript load has always been cancellable, but the send path was not:
   * navigating away mid-generation left the SSE connection open and let a
   * billed Gemini generation run to completion with nobody reading it.
   */
  const streamAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => streamAbortRef.current?.abort()
  }, [])

  /**
   * Load the transcript, and abandon it if the project changes.
   *
   * Three awaited fetches end in one setState. Without cancellation a project
   * switch left the old chain running to completion, so it wrote the previous
   * project's transcript over the new one while the new load was still in
   * flight - and sending from there appended to someone else's conversation.
   *
   * `historyAttempt` is the retry trigger: nothing reads it, incrementing it
   * re-runs this effect, and the abort controller lives here.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry trigger, see above
  useEffect(() => {
    const controller = new AbortController()

    async function loadInitialState() {
      // Form-driven completeness floor (ground truth from intake form)
      let formFloor = 0
      let formMissing: string[] = []
      try {
        const statusRes = await fetch(apiUrl(`/api/v1/projects/${projectId}/scoping-status`), {
          credentials: 'include',
          signal: controller.signal,
        })
        if (statusRes.ok) {
          const statusData = await statusRes.json()
          if (typeof statusData?.data?.formFloor === 'number') {
            formFloor = statusData.data.formFloor
          }
          if (Array.isArray(statusData?.data?.missing)) {
            formMissing = statusData.data.missing
          }
        }
      } catch {
        // Floor stays 0 if unreachable; AI scores still drive percentage.
      }

      // Existing scoping conversation messages
      let loaded: ChatMessage[] = []
      let historyFailed = false
      try {
        const convRes = await fetch(apiUrl(`/api/v1/chat/conversations`), {
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
        })
        if (!convRes.ok) throw new Error('conversation list failed')

        const convData = await convRes.json()
        const conversations = convData?.data ?? []
        const scopingConv = conversations.find(
          (c: { projectId: string; type: string }) =>
            c.projectId === projectId && c.type === 'ai_scoping',
        )
        // A project that has never been scoped has no thread, and that is not
        // a failure. Only a thread that exists and will not load is.
        if (scopingConv) {
          const raw: RawMessage[] = []
          for (let page = 1; page <= HISTORY_MAX_PAGES; page++) {
            const msgRes = await fetch(
              apiUrl(
                `/api/v1/chat/conversations/${scopingConv.id}/messages?page=${page}&pageSize=${HISTORY_PAGE_SIZE}`,
              ),
              { credentials: 'include', signal: controller.signal },
            )
            if (!msgRes.ok) throw new Error('message page failed')

            const msgData = await msgRes.json()
            const items: RawMessage[] = msgData?.data?.items ?? []
            raw.push(...items)
            const total = msgData?.data?.total
            if (items.length < HISTORY_PAGE_SIZE) break
            if (typeof total === 'number' && raw.length >= total) break
          }
          loaded = raw
            .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
            .map((m) => ({
              id: m.id,
              senderType: m.senderType as 'user' | 'ai' | 'system',
              content: m.content,
              createdAt: m.createdAt,
            }))
        }
      } catch {
        // An abort lands here too, and the guard below drops that write.
        historyFailed = true
      }

      // Both catch arms above swallow failure and carry on with defaults, and
      // an abort rejects through them - so the write needs its own guard, not
      // just the requests.
      if (controller.signal.aborted) return

      setState((prev) => ({
        ...prev,
        messages: loaded,
        historyFailed,
        completeness: Math.max(prev.completeness, formFloor),
        // Only the form knows the gaps until the first AI turn answers with its own.
        missing: prev.missing.length > 0 ? prev.missing : formMissing,
      }))
    }
    loadInitialState()
    return () => controller.abort()
  }, [projectId, historyAttempt])

  const generateId = useCallback(() => {
    messageIdCounter.current += 1
    return `msg-${Date.now()}-${messageIdCounter.current}`
  }, [])

  /**
   * Send a turn, or re-run the one a failed turn already stored.
   *
   * `retry` is not cosmetic. The server writes the owner message before it
   * calls the model, so a failed generation leaves that message stored and in
   * the transcript. Re-sending it as a fresh turn appended a second copy on
   * every press, and both copies then fed the history window and the keyword
   * completeness score.
   */
  const sendMessage = useCallback(
    async (content: string, options?: { retry?: boolean }) => {
      if (!content.trim() || state.isLoading) return
      const isRetry = options?.retry === true

      const userMessage: ChatMessage = {
        id: generateId(),
        senderType: 'user',
        content: content.trim(),
        createdAt: new Date().toISOString(),
      }

      setState((prev) => ({
        ...prev,
        messages: isRetry ? prev.messages : [...prev.messages, userMessage],
        isLoading: true,
        error: null,
      }))

      const aiMessageId = generateId()
      const placeholder: ChatMessage = {
        id: aiMessageId,
        senderType: 'ai',
        content: '',
        createdAt: new Date().toISOString(),
      }
      setState((prev) => ({ ...prev, messages: [...prev.messages, placeholder] }))

      // One generation at a time; a new send supersedes an unfinished one.
      streamAbortRef.current?.abort()
      const controller = new AbortController()
      streamAbortRef.current = controller

      try {
        const res = await fetch(apiUrl(`/api/v1/projects/${projectId}/chat/stream`), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify({ content: content.trim(), retry: isRetry }),
          signal: controller.signal,
        })

        if (!res.ok || !res.body) {
          throw new Error(`Chat stream failed: ${res.status}`)
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let accumulated = ''
        let finalCompleteness = state.completeness
        let finalMissing = state.missing

        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const frames = buffer.split('\n\n')
          buffer = frames.pop() ?? ''
          for (const frame of frames) {
            const line = frame.trim()
            if (!line.startsWith('data:')) continue
            const payload = line.slice(5).trim()
            if (!payload) continue
            try {
              const event = JSON.parse(payload) as {
                type: string
                delta?: string
                code?: string
                message?: string
                completeness?: number
                missing?: string[]
              }
              if (event.type === 'token' && event.delta) {
                accumulated += event.delta
                setState((prev) => ({
                  ...prev,
                  messages: prev.messages.map((m) =>
                    m.id === aiMessageId ? { ...m, content: accumulated } : m,
                  ),
                }))
              } else if (event.type === 'done') {
                if (event.message) accumulated = event.message
                if (typeof event.completeness === 'number') {
                  finalCompleteness = event.completeness
                }
                if (Array.isArray(event.missing)) {
                  finalMissing = event.missing
                }
              } else if (event.type === 'error') {
                throw new StreamError(event.code ?? event.message ?? 'stream error')
              }
            } catch (parseErr) {
              // Only a malformed frame is ignored here. Matching on the message
              // text instead dropped every server error that did not happen to
              // begin with "stream error", which is all of the real ones.
              if (parseErr instanceof StreamError) throw parseErr
            }
          }
        }

        setState((prev) => ({
          ...prev,
          messages: prev.messages.map((m) =>
            m.id === aiMessageId ? { ...m, content: accumulated } : m,
          ),
          completeness: Math.min(100, finalCompleteness),
          missing: finalMissing,
          isLoading: false,
        }))
      } catch (err) {
        // Cancellation is not a failure: it means the user left or superseded
        // this send. Reporting it would surface a spurious chat error, and on
        // unmount the setState would be applied to a component that is gone.
        if (controller.signal.aborted) return
        setState((prev) => ({
          ...prev,
          messages: prev.messages.filter((m) => m.id !== aiMessageId),
          isLoading: false,
          error: err instanceof Error ? err.message : 'Failed to send message',
        }))
      } finally {
        // Only clear if this send is still the current one.
        if (streamAbortRef.current === controller) streamAbortRef.current = null
      }
    },
    [projectId, state.isLoading, state.completeness, state.missing, generateId],
  )

  const addSystemMessage = useCallback(
    (content: string) => {
      const systemMessage: ChatMessage = {
        id: generateId(),
        senderType: 'system',
        content,
        createdAt: new Date().toISOString(),
      }
      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, systemMessage],
      }))
    },
    [generateId],
  )

  /** Re-runs the load effect; the abort semantics stay with the effect. */
  const retryHistory = useCallback(() => setHistoryAttempt((n) => n + 1), [])

  return {
    messages: state.messages,
    completeness: state.completeness,
    missing: state.missing,
    isLoading: state.isLoading,
    error: state.error,
    historyFailed: state.historyFailed,
    retryHistory,
    sendMessage,
    addSystemMessage,
  }
}
