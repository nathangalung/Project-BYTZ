import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'

type ApiResponse<T> = {
  success: boolean
  data: T
}

/** Unwrap API envelope, falling back to raw response for non-envelope APIs */
async function apiFetchUnwrap<T>(path: string, options?: RequestInit): Promise<T> {
  const raw = await apiFetch<ApiResponse<T> | T>(`/api/v1${path}`, options)
  if (raw && typeof raw === 'object' && 'data' in raw) {
    return (raw as ApiResponse<T>).data
  }
  return raw as T
}

export function useAvailableProjects(filters?: { category?: string; page?: number }) {
  return useQuery({
    queryKey: ['available-projects', filters],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filters?.page) params.set('page', String(filters.page))
      if (filters?.category) params.set('category', filters.category)
      const qs = params.toString()
      const result = await apiFetchUnwrap<{
        items: Array<{
          id: string
          title: string
          category: string
          budgetMin: number
          budgetMax: number
          preferences?: { requiredSkills?: string[] } | null
          createdAt: string
          estimatedTimelineDays: number
        }>
        total: number
      }>(`/projects/available${qs ? `?${qs}` : ''}`)
      return {
        ...result,
        items: (result?.items ?? []).map((p) => ({
          ...p,
          skills: (p.preferences?.requiredSkills as string[]) ?? [],
        })),
      }
    },
  })
}

export function useTalentProfile(userId: string) {
  return useQuery({
    queryKey: ['talent-profile', userId],
    queryFn: () =>
      apiFetchUnwrap<{
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
      }>(`/talent-profiles/user/${userId}`),
    enabled: !!userId,
  })
}

export function useCreateTalentProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiFetchUnwrap('/talent-profiles', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['talent-profile'] }),
  })
}

export function useApplyToProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { projectId: string; talentId: string; coverNote?: string }) =>
      apiFetchUnwrap('/applications', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['talent-applications'] }),
  })
}

export function useTalentApplications(talentId: string) {
  return useQuery({
    queryKey: ['talent-applications', talentId],
    queryFn: () =>
      apiFetchUnwrap<
        Array<{
          id: string
          projectId: string
          status: string
          createdAt: string
        }>
      >(`/applications/talent/${talentId}`),
    enabled: !!talentId,
  })
}

export function useTalentActiveProjects(talentId: string) {
  return useQuery({
    queryKey: ['talent-active-projects', talentId],
    queryFn: () =>
      apiFetchUnwrap<
        Array<{
          id: string
          title: string
          progress: number
          currentMilestone: string
          deadline: string
        }>
      >(`/talent-profiles/${talentId}/active-projects`),
    enabled: !!talentId,
    retry: false,
    placeholderData: [],
  })
}

export function useUpdateAvailability() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ profileId, availability }: { profileId: string; availability: string }) =>
      apiFetchUnwrap(`/talent-profiles/${profileId}/availability`, {
        method: 'PATCH',
        body: JSON.stringify({ availability }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['talent-profile'] }),
  })
}

export function useUploadPresignedUrl() {
  return useMutation({
    mutationFn: (data: { fileName: string; fileType: string; folder: string }) =>
      apiFetchUnwrap<{ url: string; key: string }>('/upload/presigned-url', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  })
}
