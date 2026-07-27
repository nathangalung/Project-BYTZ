import type { ApiResponse } from '@kerjacus/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiUrl } from '@/lib/api'
import { localizeErrorCode } from '@/lib/error-messages'
import type { ApiTimeLog, TimeLogEntry, TimeLogSummaryRow } from './shared'

export function useTimeLogs(projectId: string) {
  return useQuery({
    queryKey: ['time-logs', projectId],
    queryFn: async (): Promise<TimeLogEntry[]> => {
      const res = await fetch(apiUrl(`/api/v1/time-logs/project/${projectId}`), {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) throw new Error(`time logs fetch ${res.status}`)
      const json: ApiResponse<ApiTimeLog[]> = await res.json()
      if (!json.success || !json.data) return []

      return json.data.map((log: ApiTimeLog) => ({
        id: log.id,
        taskTitle: log.taskTitle || 'Untitled Task',
        description: log.description ?? '',
        date: log.startedAt.split('T')[0],
        durationMinutes: log.durationMinutes ?? 0,
        isRunning: !log.endedAt,
      }))
    },
    enabled: !!projectId,
    retry: false,
    staleTime: 30000,
  })
}

export function useCreateTimeLog(projectId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: {
      taskId: string
      startedAt: string
      endedAt?: string
      durationMinutes?: number
      description?: string
    }) => {
      const res = await fetch(apiUrl('/api/v1/time-logs'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(localizeErrorCode(err?.error?.code))
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time-logs', projectId] })
      queryClient.invalidateQueries({ queryKey: ['time-logs-summary', projectId] })
    },
  })
}

export function useTimeLogSummary(projectId: string) {
  return useQuery({
    queryKey: ['time-logs-summary', projectId],
    queryFn: async (): Promise<TimeLogSummaryRow[]> => {
      const res = await fetch(apiUrl(`/api/v1/time-logs/project/${projectId}/summary`), {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) return []
      const json: ApiResponse<TimeLogSummaryRow[]> = await res.json()
      if (!json.success || !json.data) return []
      return json.data
    },
    enabled: !!projectId,
    retry: false,
    staleTime: 30000,
  })
}

export function useStopTimer(projectId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (timeLogId: string) => {
      const res = await fetch(apiUrl(`/api/v1/time-logs/${timeLogId}/stop`), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(localizeErrorCode(err?.error?.code))
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time-logs', projectId] })
      queryClient.invalidateQueries({ queryKey: ['time-logs-summary', projectId] })
    },
  })
}
