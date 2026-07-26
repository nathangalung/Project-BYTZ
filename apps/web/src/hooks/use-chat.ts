import { useCallback, useEffect, useRef, useState } from 'react'
import { apiUrl } from '@/lib/api'

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
}

export function useScopingChat(projectId: string) {
  const [state, setState] = useState<ScopingChatState>({
    messages: [],
    completeness: 0,
    missing: [],
    isLoading: false,
    error: null,
  })
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
   */
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
      try {
        const convRes = await fetch(apiUrl(`/api/v1/chat/conversations`), {
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
        })
        if (convRes.ok) {
          const convData = await convRes.json()
          const conversations = convData?.data ?? []
          const scopingConv = conversations.find(
            (c: { projectId: string; type: string }) =>
              c.projectId === projectId && c.type === 'ai_scoping',
          )
          if (scopingConv) {
            const msgRes = await fetch(
              apiUrl(`/api/v1/chat/conversations/${scopingConv.id}/messages?pageSize=100`),
              { credentials: 'include', signal: controller.signal },
            )
            if (msgRes.ok) {
              const msgData = await msgRes.json()
              const items = msgData?.data?.items ?? []
              loaded = items
                .sort(
                  (a: { createdAt: string }, b: { createdAt: string }) =>
                    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
                )
                .map(
                  (m: { id: string; senderType: string; content: string; createdAt: string }) => ({
                    id: m.id,
                    senderType: m.senderType as 'user' | 'ai' | 'system',
                    content: m.content,
                    createdAt: m.createdAt,
                  }),
                )
            }
          }
        }
      } catch {
        // Messages stay empty; floor still applies.
      }

      // Both catch arms above swallow failure and carry on with defaults, and
      // an abort rejects through them - so the write needs its own guard, not
      // just the requests.
      if (controller.signal.aborted) return

      setState((prev) => ({
        ...prev,
        messages: loaded,
        completeness: Math.max(prev.completeness, formFloor),
        // Only the form knows the gaps until the first AI turn answers with its own.
        missing: prev.missing.length > 0 ? prev.missing : formMissing,
      }))
    }
    loadInitialState()
    return () => controller.abort()
  }, [projectId])

  const generateId = useCallback(() => {
    messageIdCounter.current += 1
    return `msg-${Date.now()}-${messageIdCounter.current}`
  }, [])

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || state.isLoading) return

      const userMessage: ChatMessage = {
        id: generateId(),
        senderType: 'user',
        content: content.trim(),
        createdAt: new Date().toISOString(),
      }

      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage],
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
          body: JSON.stringify({ content: content.trim() }),
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
                throw new Error(event.message ?? 'stream error')
              }
            } catch (parseErr) {
              if (parseErr instanceof Error && parseErr.message.startsWith('stream error')) {
                throw parseErr
              }
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

  return {
    messages: state.messages,
    completeness: state.completeness,
    missing: state.missing,
    isLoading: state.isLoading,
    error: state.error,
    sendMessage,
    addSystemMessage,
  }
}
