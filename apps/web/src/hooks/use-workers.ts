import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:80'

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
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
  const data = await res.json()
  return data.data ?? data
}

export function useAvailableProjects(filters?: { category?: string; page?: number }) {
  return useQuery({
    queryKey: ['available-projects', filters],
    queryFn: () => {
      const params = new URLSearchParams()
      if (filters?.page) params.set('page', String(filters.page))
      if (filters?.category) params.set('category', filters.category)
      const qs = params.toString()
      return apiFetch<{
        items: Array<{
          id: string
          title: string
          category: string
          budgetMin: number
          budgetMax: number
          skills: string[]
          createdAt: string
          estimatedTimelineDays: number
        }>
        total: number
      }>(`/projects/available${qs ? `?${qs}` : ''}`)
    },
  })
}

export function useWorkerProfile(userId: string) {
  return useQuery({
    queryKey: ['worker-profile', userId],
    queryFn: () =>
      apiFetch<{
        id: string
        userId: string
        bio: string
        yearsOfExperience: number
        tier: 'junior' | 'mid' | 'senior'
        educationUniversity: string | null
        educationMajor: string | null
        educationYear: number | null
        cvFileUrl: string | null
        portfolioLinks: { platform: string; url: string }[]
        availabilityStatus: 'available' | 'busy' | 'unavailable'
        verificationStatus: 'unverified' | 'cv_parsing' | 'verified' | 'suspended'
        domainExpertise: string[]
        totalProjectsCompleted: number
        totalProjectsActive: number
        averageRating: number | null
        skills: {
          name: string
          category: string
          proficiencyLevel: string
          isPrimary: boolean
        }[]
      }>(`/worker-profiles/user/${userId}`),
    enabled: !!userId,
  })
}

export function useCreateWorkerProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiFetch('/worker-profiles', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['worker-profile'] }),
  })
}

export function useApplyToProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { projectId: string; workerId: string; coverNote?: string }) =>
      apiFetch('/applications', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['worker-applications'] }),
  })
}

export function useWorkerApplications(workerId: string) {
  return useQuery({
    queryKey: ['worker-applications', workerId],
    queryFn: () =>
      apiFetch<
        Array<{
          id: string
          projectId: string
          status: string
          createdAt: string
        }>
      >(`/applications/worker/${workerId}`),
    enabled: !!workerId,
  })
}

export function useWorkerActiveProjects(workerId: string) {
  return useQuery({
    queryKey: ['worker-active-projects', workerId],
    queryFn: () =>
      apiFetch<
        Array<{
          id: string
          title: string
          progress: number
          currentMilestone: string
          deadline: string
        }>
      >(`/worker-profiles/${workerId}/active-projects`),
    enabled: !!workerId,
  })
}

export function useUpdateAvailability() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ profileId, availability }: { profileId: string; availability: string }) =>
      apiFetch(`/worker-profiles/${profileId}/availability`, {
        method: 'PATCH',
        body: JSON.stringify({ availability }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['worker-profile'] }),
  })
}

export function useUploadPresignedUrl() {
  return useMutation({
    mutationFn: (data: { fileName: string; fileType: string; folder: string }) =>
      apiFetch<{ url: string; key: string }>('/upload/presigned-url', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  })
}
