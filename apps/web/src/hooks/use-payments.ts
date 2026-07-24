import { useMutation, useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'

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
  talentId: string | null
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

export function usePaymentSummary() {
  return useQuery({
    queryKey: ['payment-summary'],
    queryFn: async () => {
      const res = await apiFetch<ApiResponse<PaymentSummary>>('/api/v1/payments/summary')
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
      const res = await apiFetch<ApiResponse<PaginatedResponse<Transaction>>>(
        `/api/v1/payments/list${qs ? `?${qs}` : ''}`,
      )
      return res.data
    },
  })
}

// What GET /payments/:id actually returns: the transaction row plus its
// audit events and double-entry ledger lines.
export type TransactionDetail = {
  id: string
  projectId: string
  projectTitle: string
  workPackageId: string | null
  milestoneId: string | null
  talentId: string | null
  type: string
  amount: number
  status: string
  paymentMethod: string | null
  paymentGatewayRef: string | null
  idempotencyKey: string
  createdAt: string
  updatedAt: string
  events: {
    id: string
    eventType: string
    previousStatus: string | null
    newStatus: string
    amount: number | null
    createdAt: string
  }[]
  ledgerEntries: {
    id: string
    accountId: string
    entryType: 'debit' | 'credit'
    amount: number
    description: string | null
    createdAt: string
  }[]
}

export function useTransaction(id: string) {
  return useQuery({
    queryKey: ['payment', id],
    queryFn: async () => {
      const res = await apiFetch<ApiResponse<TransactionDetail>>(`/api/v1/payments/${id}`)
      return res.data
    },
    enabled: !!id,
  })
}

export type SnapTokenResult = {
  token: string
  redirectUrl: string
}

export function useCreateSnapToken() {
  return useMutation({
    mutationFn: async (data: {
      projectId: string
      orderId: string
      // Server prices the checkout, not the browser.
      checkoutType: 'brd' | 'prd' | 'escrow'
      itemName: string
      customerName: string
      customerEmail: string
    }) => {
      const res = await apiFetch<ApiResponse<SnapTokenResult>>(
        '/api/v1/payments/create-snap-token',
        {
          method: 'POST',
          body: JSON.stringify(data),
        },
      )
      return res.data
    },
  })
}
