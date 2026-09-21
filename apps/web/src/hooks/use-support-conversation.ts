import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ApiError, apiFetch } from '../lib/api'
import { useAuthStore } from '../stores/auth'
import { useToastStore } from '../stores/toast'

type SupportConversation = {
  id: string
  projectId: string
  type: string
  created: boolean
  adminId: string | null
}

/**
 * Open the caller's thread with an admin, creating it only if there is none.
 *
 * The control this backs is persistent, so it will be pressed more than once
 * and pressed by people who are already in the room. The endpoint is
 * get-or-create for that reason: pressing it twice lands in the same thread
 * rather than opening a second one for the support queue to triage.
 *
 * Nothing is sent with the request. The server anchors the thread to the most
 * recent project the caller is party to, because chat_conversations.project_id
 * is NOT NULL and a thread has to hang off something; the route also accepts a
 * projectId for a caller that has one to name, and no caller here does.
 * Somebody party to no project at all gets SUPPORT_NO_PROJECT, whose localized
 * message the toast shows as-is: it says what to do about it, which a disabled
 * button could not.
 */
export function useSupportConversation() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const userId = useAuthStore((s) => s.user?.id)
  const addToast = useToastStore((s) => s.addToast)

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch<{ data: SupportConversation }>(
        '/api/v1/chat/conversations/support',
        { method: 'POST', body: '{}' },
      )
      return res.data
    },
    onSuccess: async (conversation) => {
      // The thread is new to this list whenever it was just created, and the
      // messages page reads the title out of the same query.
      await queryClient.invalidateQueries({ queryKey: ['conversations', userId] })
      await navigate({
        to: '/messages/$conversationId',
        params: { conversationId: conversation.id },
      })
    },
    onError: (error: unknown) => {
      // ApiError carries the localized message; anything else is a transport
      // failure with nothing user-readable in it.
      addToast('error', error instanceof ApiError ? error.message : String(error))
    },
  })

  return {
    openSupport: () => mutation.mutate(),
    isOpening: mutation.isPending,
  }
}
