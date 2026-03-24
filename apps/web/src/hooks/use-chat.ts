import { useCallback, useEffect, useRef, useState } from 'react'

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

  // Load existing messages from backend
  useEffect(() => {
    async function loadMessages() {
      try {
        // First find the ai_scoping conversation for this project
        const convRes = await fetch(`/api/v1/chat/conversations`, {
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        })
        if (!convRes.ok) return
        const convData = await convRes.json()
        const conversations = convData?.data ?? []
        const scopingConv = conversations.find(
          (c: { projectId: string; type: string }) =>
            c.projectId === projectId && c.type === 'ai_scoping',
        )
        if (!scopingConv) return

        // Load messages for this conversation
        const msgRes = await fetch(
          `/api/v1/chat/conversations/${scopingConv.id}/messages?pageSize=100`,
          { credentials: 'include' },
        )
        if (!msgRes.ok) return
        const msgData = await msgRes.json()
        const items = msgData?.data?.items ?? []

        if (items.length > 0) {
          const loaded: ChatMessage[] = items
            .sort(
              (a: { createdAt: string }, b: { createdAt: string }) =>
                new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
            )
            .map((m: { id: string; senderType: string; content: string; createdAt: string }) => ({
              id: m.id,
              senderType: m.senderType as 'user' | 'ai' | 'system',
              content: m.content,
              createdAt: m.createdAt,
            }))

          // Calculate completeness from loaded messages
          const userCount = loaded.filter((m) => m.senderType === 'user').length
          const loadedCompleteness = Math.min(100, userCount * 18)

          setState((prev) => ({
            ...prev,
            messages: loaded,
            completeness: loadedCompleteness,
          }))
        }
      } catch {
        // Silently fail - messages will start fresh
      }
    }
    loadMessages()
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

      try {
        const res = await fetch(`/api/v1/projects/${projectId}/chat`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: content.trim() }),
        })

        if (!res.ok) {
          throw new Error(`Chat request failed: ${res.status}`)
        }

        const data = await res.json()
        const aiContent = data?.data?.message ?? 'Terima kasih atas informasinya.'
        const newCompleteness = data?.data?.completeness ?? state.completeness + 5

        const aiMessage: ChatMessage = {
          id: generateId(),
          senderType: 'ai',
          content: aiContent,
          createdAt: new Date().toISOString(),
        }

        setState((prev) => ({
          ...prev,
          messages: [...prev.messages, aiMessage],
          completeness: Math.min(100, newCompleteness),
          isLoading: false,
        }))
      } catch (err) {
        // Only use simulated responses in dev mode when the backend is unreachable.
        // In production, surface the error to the user instead of silently faking AI responses.
        if (import.meta.env.DEV) {
          const simulatedResponses = [
            'Terima kasih atas informasinya. Bisa ceritakan lebih detail tentang target pengguna aplikasi ini?',
            'Bagus! Apakah ada integrasi dengan sistem yang sudah ada? Misalnya payment gateway atau API pihak ketiga?',
            'Dipahami. Untuk fitur utamanya, mana yang menjadi prioritas tertinggi (must-have) dan mana yang bisa ditambahkan nanti (nice-to-have)?',
            "Apakah ada referensi aplikasi sejenis yang bisa dijadikan acuan? Misalnya 'seperti Tokopedia tapi untuk X'.",
            "Baik, informasi sudah cukup lengkap. Saya siap membuatkan BRD untuk proyek Anda. Silakan klik tombol 'Generate BRD' jika sudah siap.",
          ]

          const responseIndex = Math.min(
            Math.floor(state.messages.filter((m) => m.senderType === 'user').length),
            simulatedResponses.length - 1,
          )

          const aiMessage: ChatMessage = {
            id: generateId(),
            senderType: 'ai',
            content: simulatedResponses[responseIndex],
            createdAt: new Date().toISOString(),
          }

          const userMsgCount = state.messages.filter((m) => m.senderType === 'user').length + 1
          const newCompleteness = Math.min(100, userMsgCount * 18)

          setState((prev) => ({
            ...prev,
            messages: [...prev.messages, aiMessage],
            completeness: newCompleteness,
            isLoading: false,
            error: null,
          }))
        } else {
          const message = err instanceof Error ? err.message : 'Failed to send message'
          setState((prev) => ({
            ...prev,
            isLoading: false,
            error: message,
          }))
        }
      }
    },
    [projectId, state.isLoading, state.completeness, state.messages, generateId],
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
