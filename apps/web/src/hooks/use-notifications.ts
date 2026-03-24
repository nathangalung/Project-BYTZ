import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'

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

/** Silently swallow 404 and network errors to avoid noisy toasts during polling */
function isIgnorableError(error: unknown): boolean {
  if (error instanceof TypeError && error.message === 'Failed to fetch') return true
  if (error instanceof Error && error.message.includes('404')) return true
  return false
}

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
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
    throwOnError: (error) => !isIgnorableError(error),
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
    refetchInterval: 30_000,
    retry: false,
    staleTime: 15000,
    placeholderData: 0,
    throwOnError: (error) => !isIgnorableError(error),
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

export type { Notification, NotificationsResponse }
