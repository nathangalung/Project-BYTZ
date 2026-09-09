import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { apiFetch } from '../lib/api'
import { connectCentrifugo, subscribeTo } from '../lib/centrifugo'

type Notification = {
  id: string
  type:
    | 'project_match'
    | 'application_update'
    | 'milestone_update'
    | 'payment'
    | 'dispute'
    | 'team_formation'
    | 'assignment_offer'
    | 'system'
  title: string
  message: string
  // What the reader renders, and what it renders with. Rows written before the
  // catalog existed have neither, and fall back to title and message.
  templateKey: string | null
  templateParams: Record<string, unknown> | null
  link: string | null
  isRead: boolean
  createdAt: string
}

type NotificationsResponse = {
  items: Notification[]
  total: number
  page: number
  pageSize: number
}

/**
 * Nothing here is allowed to reach an error boundary.
 *
 * `throwOnError` used to raise anything that was not a 404, a 401 or an offline
 * fetch, and `useUnreadCount` is mounted in the _authenticated layout - so a
 * 502 from notification-service replaced every signed-in page with "Something
 * went wrong", dashboard included. Measured in a browser against a stack with
 * that one service down: the owner's projects were on the page and none of them
 * rendered, because the bell asked for a count and did not get one.
 *
 * The bell is peripheral. A count that could not be read shows no badge, which
 * is absent rather than wrong, and the notifications page itself says what
 * failed and offers a retry. Neither needs a boundary to make the failure
 * visible, and the list polls every two minutes so a boundary was the wrong
 * answer to one dropped poll even before it took the layout with it.
 */

export function useNotifications(page = 1, filter?: string) {
  return useQuery({
    queryKey: ['notifications', page, filter],
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('pageSize', '20')
      if (filter && filter !== 'all') {
        params.set('type', filter)
      }
      const res = await apiFetch<{ success: boolean; data: NotificationsResponse }>(
        `/api/v1/notifications?${params.toString()}`,
      )
      return res.data
    },
    retry: false,
    staleTime: 15000,
    // useNotificationRealtime invalidates this key; polling is the backstop.
    refetchInterval: 120_000,
    placeholderData: keepPreviousData,
  })
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: async () => {
      const res = await apiFetch<{ success: boolean; data: { count: number } }>(
        '/api/v1/notifications/unread-count',
      )
      return res.data?.count ?? 0
    },
    refetchInterval: 120_000,
    retry: false,
    staleTime: 15000,
    placeholderData: 0,
  })
}

export function useMarkRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`/api/v1/notifications/${id}/read`, { method: 'PATCH' })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

export function useMarkAllRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await apiFetch('/api/v1/notifications/read-all', { method: 'PATCH' })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

/** Subscribe to real-time notification pushes for the current user. */
export function useNotificationRealtime(userId: string | undefined): void {
  const qc = useQueryClient()
  useEffect(() => {
    if (!userId) return
    connectCentrifugo()
    const unsubscribe = subscribeTo(`notifications#${userId}`, () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
    })
    return () => {
      unsubscribe()
    }
  }, [userId, qc])
}

export type { Notification, NotificationsResponse }
