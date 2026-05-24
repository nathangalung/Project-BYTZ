import type {
  ApiResponse,
  BrdDocument,
  CreateProjectInput,
  Milestone,
  PaginatedResponse,
  PrdDocument,
  Project,
} from '@kerjacus/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'

export function useProjects(filters?: {
  status?: string
  page?: number
  pageSize?: number
  ownerId?: string
}) {
  return useQuery({
    queryKey: ['projects', filters],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filters?.status) params.set('status', filters.status)
      if (filters?.page) params.set('page', String(filters.page))
      if (filters?.pageSize) params.set('pageSize', String(filters.pageSize))
      if (filters?.ownerId) params.set('ownerId', filters.ownerId)
      const qs = params.toString()
      const res = await apiFetch<ApiResponse<PaginatedResponse<Project>>>(
        `/api/v1/projects${qs ? `?${qs}` : ''}`,
      )
      return res.data
    },
  })
}

export function useProject(id: string) {
  return useQuery({
    queryKey: ['project', id],
    queryFn: async () => {
      const res = await apiFetch<ApiResponse<Project>>(`/api/v1/projects/${id}`)
      return res.data
    },
    enabled: !!id,
  })
}

export type GanttTask = {
  id: string
  milestoneId: string
  assignedTalentId: string | null
  title: string
  description: string | null
  orderIndex: number
  status: 'pending' | 'in_progress' | 'completed'
  estimatedHours: number | null
  actualHours: number | null
  startDate: string | null
  endDate: string | null
  createdAt: string
  updatedAt: string
}

export type GanttDependency = {
  id: string
  taskId: string
  dependsOnTaskId: string
  type: 'finish_to_start' | 'start_to_start' | 'finish_to_finish'
}

export function useProjectTasks(projectId: string) {
  return useQuery({
    queryKey: ['project-tasks', projectId],
    queryFn: async () => {
      const res = await apiFetch<
        ApiResponse<{ tasks: GanttTask[]; dependencies: GanttDependency[] }>
      >(`/api/v1/projects/${projectId}/tasks`)
      return res.data ?? { tasks: [], dependencies: [] }
    },
    enabled: !!projectId,
    retry: false,
  })
}

export function useProjectMilestones(projectId: string) {
  return useQuery({
    queryKey: ['project-milestones', projectId],
    queryFn: async () => {
      const res = await apiFetch<ApiResponse<Milestone[]>>(
        `/api/v1/projects/${projectId}/milestones`,
      )
      return res.data ?? []
    },
    enabled: !!projectId,
  })
}

export function useProjectBrd(projectId: string) {
  return useQuery({
    queryKey: ['project-brd', projectId],
    queryFn: async () => {
      const res = await apiFetch<ApiResponse<BrdDocument>>(`/api/v1/projects/${projectId}/brd`)
      return res.data
    },
    enabled: !!projectId,
  })
}

export function useProjectPrd(projectId: string) {
  return useQuery({
    queryKey: ['project-prd', projectId],
    queryFn: async () => {
      const res = await apiFetch<ApiResponse<PrdDocument>>(`/api/v1/projects/${projectId}/prd`)
      return res.data
    },
    enabled: !!projectId,
  })
}

export function useCreateProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: CreateProjectInput) => {
      const res = await apiFetch<ApiResponse<Project>>('/api/v1/projects', {
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
    mutationFn: async ({ projectId, status }: { projectId: string; status: string }) => {
      const res = await apiFetch<ApiResponse<Project>>(`/api/v1/projects/${projectId}/transition`, {
        method: 'POST',
        body: JSON.stringify({ status }),
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

export function useUpdateMilestoneStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      milestoneId,
      status,
      reason,
    }: {
      milestoneId: string
      status: string
      projectId: string
      reason?: string
    }) => {
      const res = await apiFetch<ApiResponse<Milestone>>(
        `/api/v1/milestones/${milestoneId}/status`,
        {
          method: 'PATCH',
          body: JSON.stringify({ status, reason }),
        },
      )
      return res.data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['project-milestones', variables.projectId],
      })
      queryClient.invalidateQueries({
        queryKey: ['project', variables.projectId],
      })
    },
  })
}

export function useReleaseEscrow() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      projectId,
      milestoneId,
      amount,
    }: {
      projectId: string
      milestoneId: string
      amount: number
    }) => {
      const res = await apiFetch<ApiResponse<unknown>>('/api/v1/payments/release', {
        method: 'POST',
        body: JSON.stringify({ projectId, milestoneId, amount }),
      })
      return res.data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['project-milestones', variables.projectId],
      })
      queryClient.invalidateQueries({ queryKey: ['payments'] })
      queryClient.invalidateQueries({ queryKey: ['payment-summary'] })
    },
  })
}

export function useProjectReviews(projectId: string) {
  return useQuery({
    queryKey: ['project-reviews', projectId],
    queryFn: async () => {
      const res = await apiFetch<
        ApiResponse<
          Array<{
            id: string
            projectId: string
            reviewerId: string
            revieweeId: string
            rating: number
            comment: string | null
            type: 'owner_to_talent' | 'talent_to_owner'
            createdAt: string
          }>
        >
      >(`/api/v1/reviews/project/${projectId}`)
      return res.data ?? []
    },
    enabled: !!projectId,
  })
}

export function useSubmitReview() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: {
      projectId: string
      revieweeId: string
      rating: number
      comment?: string
      type: 'owner_to_talent' | 'talent_to_owner'
    }) => {
      const res = await apiFetch<ApiResponse<unknown>>('/api/v1/reviews', {
        method: 'POST',
        body: JSON.stringify(data),
      })
      return res.data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['project-reviews', variables.projectId],
      })
      queryClient.invalidateQueries({
        queryKey: ['project', variables.projectId],
      })
    },
  })
}

export function useGenerateBrd() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (projectId: string) => {
      const res = await apiFetch<ApiResponse<BrdDocument>>(
        `/api/v1/projects/${projectId}/generate-brd`,
        {
          method: 'POST',
        },
      )
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

export function useGeneratePrd() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ projectId }: { projectId: string; brdContent?: unknown }) => {
      const res = await apiFetch<ApiResponse<PrdDocument>>(
        `/api/v1/projects/${projectId}/generate-prd`,
        {
          method: 'POST',
        },
      )
      return res.data
    },
    onSuccess: (_data, { projectId }) => {
      queryClient.invalidateQueries({
        queryKey: ['project', projectId],
      })
      queryClient.invalidateQueries({
        queryKey: ['project-prd', projectId],
      })
    },
  })
}

type ActivityItem = {
  id: string
  projectId: string
  userId: string | null
  type: string
  title: string
  metadata: unknown
  createdAt: string
  projectTitle: string | null
}

export type ContractItem = {
  id: string
  type: 'standard_nda' | 'ip_transfer'
  signedByOwner: boolean
  signedByTalent: boolean
  signedAt: string | null
  createdAt: string
}

export type ProjectTransaction = {
  id: string
  type: string
  amount: number
  status: string
  milestoneId: string | null
  createdAt: string
}

export function useProjectContracts(projectId: string) {
  return useQuery({
    queryKey: ['project-contracts', projectId],
    queryFn: async () => {
      const res = await apiFetch<ApiResponse<ContractItem[]>>(
        `/api/v1/contracts/project/${projectId}`,
      )
      return res.data ?? []
    },
    enabled: !!projectId,
    retry: false,
  })
}

export function useSignContract() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ contractId, projectId }: { contractId: string; projectId: string }) => {
      const res = await apiFetch<ApiResponse<ContractItem>>(
        `/api/v1/contracts/${contractId}/sign`,
        {
          method: 'PATCH',
        },
      )
      return { data: res.data, projectId }
    },
    onSuccess: ({ projectId }) => {
      void queryClient.invalidateQueries({ queryKey: ['project-contracts', projectId] })
    },
  })
}

export function useProjectTransactions(projectId: string) {
  return useQuery({
    queryKey: ['project-transactions', projectId],
    queryFn: async () => {
      const res = await apiFetch<ApiResponse<ProjectTransaction[]>>(
        `/api/v1/payments/project/${projectId}`,
      )
      return res.data ?? []
    },
    enabled: !!projectId,
    retry: false,
  })
}

export function useActivities(limit = 5) {
  return useQuery({
    queryKey: ['activities', limit],
    queryFn: async () => {
      const res = await apiFetch<ApiResponse<{ items: ActivityItem[]; total: number }>>(
        `/api/v1/activities?limit=${limit}`,
      )
      return res.data
    },
  })
}

export function useProjectInvoices(projectId: string) {
  return useQuery({
    queryKey: ['project-invoices', projectId],
    queryFn: async () => {
      const res = await apiFetch<
        ApiResponse<
          Array<{
            invoiceNumber: string
            milestoneId: string
            pdfUrl: string
            isAdminCopy: boolean
            generatedAt: string
          }>
        >
      >(`/api/v1/projects/${projectId}/invoices`)
      return res.data ?? []
    },
    enabled: !!projectId,
  })
}

export type ProjectDispute = {
  id: string
  projectId: string
  workPackageId: string | null
  initiatedBy: string
  againstUserId: string
  reason: string
  evidenceUrls: string[] | null
  status: 'open' | 'under_review' | 'mediation' | 'resolved' | 'escalated'
  resolution: string | null
  resolutionType: 'funds_to_talent' | 'funds_to_owner' | 'split' | null
  resolvedBy: string | null
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
}

export function useProjectDisputes(projectId: string) {
  return useQuery({
    queryKey: ['project-disputes', projectId],
    queryFn: async () => {
      const res = await apiFetch<ApiResponse<ProjectDispute[]>>(
        `/api/v1/disputes/project/${projectId}`,
      )
      return res.data ?? []
    },
    enabled: !!projectId,
    retry: false,
  })
}

export function useConfirmMatching() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      projectId,
      approvedTalentIds,
    }: {
      projectId: string
      approvedTalentIds: string[]
    }) => {
      const res = await apiFetch<ApiResponse<{ projectId: string; matched: number }>>(
        '/api/v1/matching/confirm',
        {
          method: 'POST',
          body: JSON.stringify({ projectId, approvedTalentIds }),
        },
      )
      return res.data
    },
    onSuccess: (_data, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] })
    },
  })
}
