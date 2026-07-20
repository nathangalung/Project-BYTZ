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
  isLoading: boolean
  error: string | null
}

export function useScopingChat(projectId: string) {
  const [state, setState] = useState<ScopingChatState>({
    messages: [],
    completeness: 0,
    isLoading: false,
    error: null,
  })
  const messageIdCounter = useRef(0)

  // Load existing messages + form-driven completeness floor from backend
  useEffect(() => {
    async function loadInitialState() {
      // Form-driven completeness floor (ground truth from intake form)
      let formFloor = 0
      try {
        const statusRes = await fetch(apiUrl(`/api/v1/projects/${projectId}/scoping-status`), {
          credentials: 'include',
        })
        if (statusRes.ok) {
          const statusData = await statusRes.json()
          if (typeof statusData?.data?.formFloor === 'number') {
            formFloor = statusData.data.formFloor
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
              { credentials: 'include' },
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

      setState((prev) => ({
        ...prev,
        messages: loaded,
        completeness: Math.max(prev.completeness, formFloor),
      }))
    }
    loadInitialState()
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

      try {
        const res = await fetch(apiUrl(`/api/v1/projects/${projectId}/chat/stream`), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify({ content: content.trim() }),
        })

        if (!res.ok || !res.body) {
          throw new Error(`Chat stream failed: ${res.status}`)
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let accumulated = ''
        let finalCompleteness = state.completeness

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
          isLoading: false,
        }))
      } catch (err) {
        setState((prev) => ({
          ...prev,
          messages: prev.messages.filter((m) => m.id !== aiMessageId),
          isLoading: false,
          error: err instanceof Error ? err.message : 'Failed to send message',
        }))
      }
    },
    [projectId, state.isLoading, state.completeness, generateId],
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
    isLoading: state.isLoading,
    error: state.error,
    sendMessage,
    addSystemMessage,
  }
}
