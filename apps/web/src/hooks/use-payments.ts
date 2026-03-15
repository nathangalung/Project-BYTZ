import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:80'

type ApiResponse<T> = {
  success: boolean
  data: T
  error?: { code: string; message: string }
}

type PaginatedResponse<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export type Transaction = {
  id: string
  projectId: string
  projectTitle: string
  workPackageId: string | null
  milestoneId: string | null
  workerId: string | null
  type:
    | 'escrow_in'
    | 'escrow_release'
    | 'brd_payment'
    | 'prd_payment'
    | 'refund'
    | 'partial_refund'
    | 'revision_fee'
    | 'talent_placement_fee'
  amount: number
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'refunded'
  paymentMethod: string | null
  paymentGatewayRef: string | null
  createdAt: string
  updatedAt: string
}

export type PaymentSummary = {
  totalSpent: number
  totalEarned: number
  pending: number
  thisMonth: number
}

export type InvoiceDetail = {
  id: string
  invoiceNumber: string
  date: string
  from: { name: string; address: string; email: string }
  to: { name: string; address: string; email: string }
  items: { description: string; quantity: number; amount: number }[]
  subtotal: number
  platformFee: number | null
  total: number
  status: string
  projectTitle: string
  paymentMethod: string | null
}

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

export function usePaymentSummary() {
  return useQuery({
    queryKey: ['payment-summary'],
    queryFn: async () => {
      const res = await apiFetch<PaymentSummary>('/payments/summary')
      return res.data
    },
  })
}

export function usePaymentHistory(filters?: { type?: string; page?: number; pageSize?: number }) {
  return useQuery({
    queryKey: ['payments', filters],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filters?.type) params.set('type', filters.type)
      if (filters?.page) params.set('page', String(filters.page))
      if (filters?.pageSize) params.set('pageSize', String(filters.pageSize))
      const qs = params.toString()
      const res = await apiFetch<PaginatedResponse<Transaction>>(`/payments${qs ? `?${qs}` : ''}`)
      return res.data
    },
  })
}

export function useTransaction(id: string) {
  return useQuery({
    queryKey: ['payment', id],
    queryFn: async () => {
      const res = await apiFetch<InvoiceDetail>(`/payments/${id}`)
      return res.data
    },
    enabled: !!id,
  })
}

export function useCreatePayment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: {
      projectId: string
      type: string
      amount: number
      paymentMethod: string
    }) => {
      const res = await apiFetch<Transaction>('/payments/checkout', {
        method: 'POST',
        body: JSON.stringify(data),
      })
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payments'] })
      qc.invalidateQueries({ queryKey: ['payment-summary'] })
    },
  })
}
