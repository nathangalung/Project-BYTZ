import { useCallback, useRef, useState } from 'react'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:80'

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
        const res = await fetch(`${API_URL}/api/v1/projects/${projectId}/chat`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: content.trim() }),
        })

        if (!res.ok) {
          throw new Error(`Chat request failed: ${res.status}`)
        }

        const data = await res.json()
        const aiContent =
          data?.data?.message ??
          data?.data?.content ??
          'Thank you for the information. Could you provide more details?'
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
      } catch {
        // Simulated AI response for development
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
