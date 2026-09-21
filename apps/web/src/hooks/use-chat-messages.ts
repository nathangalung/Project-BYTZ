import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef } from 'react'
import { useAuthStore } from '@/stores/auth'
import { apiFetch } from '../lib/api'
import { subscribeTo } from '../lib/centrifugo'

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
  // Null when the project row is gone; the list falls back to the id then.
  projectTitle?: string | null
  participantCount?: number | null
}

/**
 * Backstop poll for an open conversation's messages.
 *
 * The `chat:<conversationId>` subscription below invalidates
 * ['chat-messages', conversationId] on every new message, so this only covers
 * a Centrifugo disconnect the client has not noticed. Two minutes rather than
 * one halves the idle request floor against project-service; a reader whose
 * socket is down waits at most that long for a message, and sending one
 * invalidates the key directly.
 */
const CHAT_MESSAGES_POLL_MS = 120_000

/**
 * The conversation list, deliberately left at one minute.
 *
 * Nothing pushes it. The `chat:` channel invalidates ['chat-messages'] only,
 * and the sole writer of ['conversations'] is use-support-conversation.ts,
 * which invalidates it after a mutation this tab made itself. A conversation
 * opened by the other side - the case the list exists to show - reaches this
 * tab through this poll and no other path, so raising it would be a visible
 * regression rather than a saving. Raise it once a `conversations#<userId>`
 * channel exists.
 */
const CONVERSATIONS_POLL_MS = 60_000

export function useConversations() {
  const user = useAuthStore((s) => s.user)

  return useQuery({
    queryKey: ['conversations', user?.id],
    queryFn: async () => {
      const res = await apiFetch<ApiResponse<ApiConversation[]>>('/api/v1/chat/conversations')
      return res.data ?? []
    },
    enabled: !!user?.id,
    // No realtime channel covers this key - see CONVERSATIONS_POLL_MS.
    refetchInterval: CONVERSATIONS_POLL_MS,
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
    // The chat: channel below invalidates this key on every new message.
    refetchInterval: CHAT_MESSAGES_POLL_MS,
  })

  // Real-time updates via Centrifugo. Invalidates cache on new messages.
  useEffect(() => {
    if (!conversationId) return
    const unsubscribe = subscribeTo(`chat:${conversationId}`, () => {
      queryClient.invalidateQueries({ queryKey: ['chat-messages', conversationId] })
    })
    return unsubscribe
  }, [conversationId, queryClient])

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
    isError: messagesQuery.isError,
    refetch: messagesQuery.refetch,
    sendMessage,
    messagesEndRef,
  }
}

export { CHAT_MESSAGES_POLL_MS, CONVERSATIONS_POLL_MS }

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
