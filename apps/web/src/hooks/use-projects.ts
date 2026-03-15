import type {
  ApiResponse,
  BrdDocument,
  CreateProjectInput,
  Milestone,
  PaginatedResponse,
  PrdDocument,
  Project,
} from '@bytz/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:80'

async function apiFetch<T>(path: string, options?: RequestInit): Promise<ApiResponse<T>> {
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

export function useProjects(filters?: { status?: string; page?: number; pageSize?: number }) {
  return useQuery({
    queryKey: ['projects', filters],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filters?.status) params.set('status', filters.status)
      if (filters?.page) params.set('page', String(filters.page))
      if (filters?.pageSize) params.set('pageSize', String(filters.pageSize))
      const qs = params.toString()
      const res = await apiFetch<PaginatedResponse<Project>>(`/projects${qs ? `?${qs}` : ''}`)
      return res.data
    },
  })
}

export function useProject(id: string) {
  return useQuery({
    queryKey: ['project', id],
    queryFn: async () => {
      const res = await apiFetch<Project>(`/projects/${id}`)
      return res.data
    },
    enabled: !!id,
  })
}

export function useProjectMilestones(projectId: string) {
  return useQuery({
    queryKey: ['project-milestones', projectId],
    queryFn: async () => {
      const res = await apiFetch<Milestone[]>(`/projects/${projectId}/milestones`)
      return res.data ?? []
    },
    enabled: !!projectId,
  })
}

export function useProjectBrd(projectId: string) {
  return useQuery({
    queryKey: ['project-brd', projectId],
    queryFn: async () => {
      const res = await apiFetch<BrdDocument>(`/projects/${projectId}/brd`)
      return res.data
    },
    enabled: !!projectId,
  })
}

export function useProjectPrd(projectId: string) {
  return useQuery({
    queryKey: ['project-prd', projectId],
    queryFn: async () => {
      const res = await apiFetch<PrdDocument>(`/projects/${projectId}/prd`)
      return res.data
    },
    enabled: !!projectId,
  })
}

export function useCreateProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: CreateProjectInput) => {
      const res = await apiFetch<Project>('/projects', {
        method: 'POST',
        body: JSON.stringify(data),
      })
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useTransitionProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ projectId, transition }: { projectId: string; transition: string }) => {
      const res = await apiFetch<Project>(`/projects/${projectId}/transition`, {
        method: 'POST',
        body: JSON.stringify({ transition }),
      })
      return res.data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['project', variables.projectId],
      })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useGenerateBrd() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (projectId: string) => {
      const res = await apiFetch<BrdDocument>(`/projects/${projectId}/generate-brd`, {
        method: 'POST',
      })
      return res.data
    },
    onSuccess: (_data, projectId) => {
      queryClient.invalidateQueries({
        queryKey: ['project', projectId],
      })
      queryClient.invalidateQueries({
        queryKey: ['project-brd', projectId],
      })
    },
  })
}
