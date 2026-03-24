import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'
import { useAuthStore } from '@/stores/auth'
import { apiFetch } from '../lib/api'

export type ChatMessage = {
  id: string
  conversationId: string
  senderId: string | null
  senderName: string
  senderType: 'user' | 'ai' | 'system'
  content: string
  createdAt: string
  metadata?: Record<string, unknown> | null
}

type ApiResponse<T> = {
  success: boolean
  data: T
}

type PaginatedMessages = {
  items: {
    id: string
    conversationId: string
    senderId: string | null
    senderType: 'user' | 'ai' | 'system'
    content: string
    metadata: Record<string, unknown> | null
    createdAt: string
  }[]
  total: number
  page: number
  pageSize: number
}

type ApiConversation = {
  id: string
  projectId: string
  type: string
  createdAt: string
}

export function useConversations() {
  const user = useAuthStore((s) => s.user)

  return useQuery({
    queryKey: ['conversations', user?.id],
    queryFn: async () => {
      const res = await apiFetch<ApiResponse<ApiConversation[]>>('/api/v1/chat/conversations')
      return res.data ?? []
    },
    enabled: !!user?.id,
    refetchInterval: 15_000,
  })
}

export function useChatMessages(conversationId: string) {
  const user = useAuthStore((s) => s.user)
  const queryClient = useQueryClient()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  // Fetch messages for the conversation
  const messagesQuery = useQuery({
    queryKey: ['chat-messages', conversationId],
    queryFn: async () => {
      const res = await apiFetch<ApiResponse<PaginatedMessages>>(
        `/api/v1/chat/conversations/${conversationId}/messages?pageSize=100`,
      )
      const items = res.data?.items ?? []
      // API returns messages in desc order, reverse to chronological
      const sorted = [...items].reverse()
      return sorted.map(
        (msg): ChatMessage => ({
          id: msg.id,
          conversationId: msg.conversationId,
          senderId: msg.senderId,
          senderName: deriveSenderName(msg.senderId, msg.senderType, user?.id),
          senderType: msg.senderType,
          content: msg.content,
          createdAt: msg.createdAt,
          metadata: msg.metadata,
        }),
      )
    },
    enabled: !!conversationId,
    refetchInterval: 5_000,
  })

  // Send message mutation
  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await apiFetch<ApiResponse<ChatMessage>>(
        `/api/v1/chat/conversations/${conversationId}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({ content, senderType: 'user' }),
        },
      )
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat-messages', conversationId] })
      setTimeout(scrollToBottom, 100)
    },
  })

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim()) return
      await sendMutation.mutateAsync(content.trim())
    },
    [sendMutation],
  )

  return {
    messages: messagesQuery.data ?? [],
    loading: messagesQuery.isLoading,
    sendMessage,
    messagesEndRef,
  }
}

/** Derive a display name from sender info */
function deriveSenderName(
  senderId: string | null,
  senderType: 'user' | 'ai' | 'system',
  currentUserId?: string,
): string {
  if (senderType === 'system') return 'System'
  if (senderType === 'ai') return 'AI Assistant'
  if (senderId && senderId === currentUserId) return 'You'
  return 'Participant'
}
