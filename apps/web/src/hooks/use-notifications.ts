import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:80'

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

async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<{ success: boolean; data: T }> {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message ?? `Request failed: ${res.status}`)
  }
  return res.json()
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
      const res = await apiFetch<NotificationsResponse>(`/notifications?${params.toString()}`)
      return res.data
    },
  })
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: async () => {
      const res = await apiFetch<{ count: number }>('/notifications/unread-count')
      return res.data?.count ?? 0
    },
    refetchInterval: 30000,
  })
}

export function useMarkRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`/notifications/${id}/read`, { method: 'PATCH' })
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
      await apiFetch('/notifications/read-all', { method: 'PATCH' })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

export type { Notification, NotificationsResponse }
