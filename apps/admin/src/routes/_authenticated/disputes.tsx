import { createFileRoute } from '@tanstack/react-router'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  ChevronDown,
  Clock,
  ExternalLink,
  Eye,
  FileText,
  Gavel,
  MessageSquare,
  Scale,
  Send,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn, formatDateShort } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/disputes')({
  component: AdminDisputesPage,
})

type DisputeStatus = 'open' | 'under_review' | 'mediation' | 'resolved' | 'escalated'

type StatusEvent = {
  from: DisputeStatus
  to: DisputeStatus
  changedBy: string
  date: string
}

type ChatMessage = {
  id: string
  sender: string
  role: 'admin' | 'owner' | 'talent'
  content: string
  timestamp: string
}

type Dispute = {
  id: string
  projectTitle: string
  projectId: string
  initiatedBy: string
  initiatedByRole: 'owner' | 'talent'
  againstUser: string
  againstUserRole: 'owner' | 'talent'
  reason: string
  status: DisputeStatus
  amount: number
  evidenceUrls: string[]
  createdAt: string
  updatedAt: string
  resolutionType: 'funds_to_talent' | 'funds_to_owner' | 'split' | null
  resolutionNote: string
  statusHistory: StatusEvent[]
  chatMessages: ChatMessage[]
}

const MOCK_DISPUTES: Dispute[] = [
  {
    id: 'd1',
    projectTitle: 'E-commerce Platform UMKM',
    projectId: 'p1',
    initiatedBy: 'Ahmad Budiman',
    initiatedByRole: 'owner',
    againstUser: 'Talent #5 (Eko Prasetyo)',
    againstUserRole: 'talent',
    reason: 'Deliverable tidak sesuai spec PRD, fitur payment gateway belum terintegrasi',
    status: 'open',
    amount: 15000000,
    evidenceUrls: [
      'https://storage.bytz.id/evidence/d1-screenshot-1.png',
      'https://storage.bytz.id/evidence/d1-prd-comparison.pdf',
      'https://storage.bytz.id/evidence/d1-chat-log.txt',
    ],
    createdAt: '2026-03-10T09:00:00Z',
    updatedAt: '2026-03-10T09:00:00Z',
    resolutionType: null,
    resolutionNote: '',
    statusHistory: [],
    chatMessages: [
      {
        id: 'm1',
        sender: 'Ahmad Budiman',
        role: 'owner',
        content: 'Payment gateway tidak terintegrasi seperti di PRD',
        timestamp: '2026-03-10T09:05:00Z',
      },
      {
        id: 'm2',
        sender: 'Eko Prasetyo',
        role: 'talent',
        content: 'Integrasi Midtrans sudah dilakukan tapi sandbox mode, belum production',
        timestamp: '2026-03-10T10:30:00Z',
      },
    ],
  },
  {
    id: 'd2',
    projectTitle: 'Mobile Booking App',
    projectId: 'p2',
    initiatedBy: 'Talent #3 (Gunawan H.)',
    initiatedByRole: 'talent',
    againstUser: 'Hana Permata',
    againstUserRole: 'owner',
    reason: 'Owner mengubah requirement secara signifikan tanpa change request formal',
    status: 'mediation',
    amount: 8000000,
    evidenceUrls: [
      'https://storage.bytz.id/evidence/d2-chat-history.pdf',
      'https://storage.bytz.id/evidence/d2-original-prd.pdf',
    ],
    createdAt: '2026-03-08T14:00:00Z',
    updatedAt: '2026-03-11T10:00:00Z',
    resolutionType: null,
    resolutionNote: '',
    statusHistory: [
      { from: 'open', to: 'under_review', changedBy: 'Admin Fitri', date: '2026-03-09T08:00:00Z' },
      {
        from: 'under_review',
        to: 'mediation',
        changedBy: 'Admin Fitri',
        date: '2026-03-10T14:00:00Z',
      },
    ],
    chatMessages: [
      {
        id: 'm3',
        sender: 'Gunawan H.',
        role: 'talent',
        content: 'Owner menambahkan 5 fitur baru yang tidak ada di PRD',
        timestamp: '2026-03-08T14:05:00Z',
      },
      {
        id: 'm4',
        sender: 'Hana Permata',
        role: 'owner',
        content: 'Fitur tersebut sudah didiskusikan saat scoping',
        timestamp: '2026-03-08T16:00:00Z',
      },
      {
        id: 'm5',
        sender: 'Admin Fitri',
        role: 'admin',
        content:
          'Saya sudah review PRD dan chat history. Fitur tersebut memang tidak ada di PRD final.',
        timestamp: '2026-03-10T14:30:00Z',
      },
    ],
  },
  {
    id: 'd3',
    projectTitle: 'Dashboard Analytics',
    projectId: 'p3',
    initiatedBy: 'Joko Widodo',
    initiatedByRole: 'owner',
    againstUser: 'Talent #7 (Irfan M.)',
    againstUserRole: 'talent',
    reason: 'Talent tidak responsif lebih dari 7 hari, milestone terlambat 2 minggu',
    status: 'resolved',
    amount: 12000000,
    evidenceUrls: ['https://storage.bytz.id/evidence/d3-timeline-proof.png'],
    createdAt: '2026-03-01T08:00:00Z',
    updatedAt: '2026-03-07T16:00:00Z',
    resolutionType: 'funds_to_owner',
    resolutionNote:
      'Talent confirmed inactive. Full refund for incomplete milestone issued to client. Talent received rating penalty.',
    statusHistory: [
      { from: 'open', to: 'under_review', changedBy: 'Admin Fitri', date: '2026-03-02T09:00:00Z' },
      {
        from: 'under_review',
        to: 'mediation',
        changedBy: 'Admin Fitri',
        date: '2026-03-04T11:00:00Z',
      },
      { from: 'mediation', to: 'resolved', changedBy: 'Admin Fitri', date: '2026-03-07T16:00:00Z' },
    ],
    chatMessages: [
      {
        id: 'm6',
        sender: 'Joko Widodo',
        role: 'owner',
        content: 'Talent tidak merespons sejak 22 Feb',
        timestamp: '2026-03-01T08:10:00Z',
      },
      {
        id: 'm7',
        sender: 'Admin Fitri',
        role: 'admin',
        content:
          'Kami telah menghubungi worker dan tidak mendapat respons. Dispute diputuskan favor client.',
        timestamp: '2026-03-07T15:50:00Z',
      },
    ],
  },
  {
    id: 'd4',
    projectTitle: 'Chatbot Customer Service',
    projectId: 'p7',
    initiatedBy: 'Ahmad Budiman',
    initiatedByRole: 'owner',
    againstUser: 'Talent #2 (Siti Rahayu)',
    againstUserRole: 'talent',
    reason: 'Kualitas kode tidak memenuhi standar, banyak bug di production',
    status: 'escalated',
    amount: 28000000,
    evidenceUrls: [
      'https://storage.bytz.id/evidence/d4-bug-report.pdf',
      'https://storage.bytz.id/evidence/d4-code-review.md',
      'https://storage.bytz.id/evidence/d4-error-logs.txt',
      'https://storage.bytz.id/evidence/d4-deployment-screenshot.png',
    ],
    createdAt: '2026-02-25T10:00:00Z',
    updatedAt: '2026-03-12T09:00:00Z',
    resolutionType: null,
    resolutionNote: '',
    statusHistory: [
      { from: 'open', to: 'under_review', changedBy: 'Admin Fitri', date: '2026-02-26T08:00:00Z' },
      {
        from: 'under_review',
        to: 'mediation',
        changedBy: 'Admin Fitri',
        date: '2026-03-01T10:00:00Z',
      },
      {
        from: 'mediation',
        to: 'escalated',
        changedBy: 'Admin Fitri',
        date: '2026-03-10T14:00:00Z',
      },
    ],
    chatMessages: [
      {
        id: 'm8',
        sender: 'Ahmad Budiman',
        role: 'owner',
        content: '22 critical bugs ditemukan setelah deploy ke production',
        timestamp: '2026-02-25T10:15:00Z',
      },
      {
        id: 'm9',
        sender: 'Siti Rahayu',
        role: 'talent',
        content:
          'Beberapa bug terjadi karena perubahan API dari pihak ketiga, bukan dari kode saya',
        timestamp: '2026-02-26T14:00:00Z',
      },
      {
        id: 'm10',
        sender: 'Admin Fitri',
        role: 'admin',
        content:
          'Setelah code review independen, 14 dari 22 bugs berasal dari kode worker. Mediasi tidak berhasil, eskalasi ke keputusan binding.',
        timestamp: '2026-03-10T14:00:00Z',
      },
    ],
  },
  {
    id: 'd5',
    projectTitle: 'Sistem Inventori',
    projectId: 'p5',
    initiatedBy: 'Talent #9 (Irfan Maulana)',
    initiatedByRole: 'talent',
    againstUser: 'Dewi Lestari',
    againstUserRole: 'owner',
    reason: 'Owner menolak approve milestone padahal sudah sesuai spec PRD',
    status: 'under_review',
    amount: 5000000,
    evidenceUrls: [
      'https://storage.bytz.id/evidence/d5-milestone-submission.pdf',
      'https://storage.bytz.id/evidence/d5-prd-section.pdf',
    ],
    createdAt: '2026-03-12T11:00:00Z',
    updatedAt: '2026-03-13T08:00:00Z',
    resolutionType: null,
    resolutionNote: '',
    statusHistory: [
      { from: 'open', to: 'under_review', changedBy: 'Admin Fitri', date: '2026-03-13T08:00:00Z' },
    ],
    chatMessages: [
      {
        id: 'm11',
        sender: 'Irfan Maulana',
        role: 'talent',
        content: 'Semua deliverable sudah sesuai checklist di PRD milestone 2',
        timestamp: '2026-03-12T11:10:00Z',
      },
      {
        id: 'm12',
        sender: 'Dewi Lestari',
        role: 'owner',
        content: 'UI tidak sesuai yang saya harapkan',
        timestamp: '2026-03-12T15:00:00Z',
      },
    ],
  },
]

const STATUS_CONFIG: Record<
  DisputeStatus,
  { color: string; icon: React.ReactNode; label: string }
> = {
  open: {
    color: 'bg-error-500/20 text-error-500',
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    label: 'Open',
  },
  under_review: {
    color: 'bg-warning-500/20 text-warning-500',
    icon: <Eye className="h-3.5 w-3.5" />,
    label: 'Under Review',
  },
  mediation: {
    color: 'bg-warning-500/25 text-warning-600',
    icon: <MessageSquare className="h-3.5 w-3.5" />,
    label: 'Mediation',
  },
  resolved: {
    color: 'bg-success-500/20 text-success-500',
    icon: <CheckCircle className="h-3.5 w-3.5" />,
    label: 'Resolved',
  },
  escalated: {
    color: 'bg-error-500/30 text-error-500',
    icon: <Gavel className="h-3.5 w-3.5" />,
    label: 'Escalated',
  },
}

function AdminDisputesPage() {
  const { t } = useTranslation('admin')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [chatInput, setChatInput] = useState('')
  const [resolutionNote, setResolutionNote] = useState('')

  const filtered =
    statusFilter === 'all' ? MOCK_DISPUTES : MOCK_DISPUTES.filter((d) => d.status === statusFilter)

  function formatRp(n: number) {
    if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(0)} jt`
    return `Rp ${n.toLocaleString('id-ID')}`
  }

  async function handleSendChat(disputeId: string) {
    if (!chatInput.trim()) return
    try {
      const dispute = MOCK_DISPUTES.find((d) => d.id === disputeId)
      if (!dispute) return
      // Use dispute ID as conversation reference
      await fetch(`/api/v1/chat/conversations/${disputeId}/messages`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: chatInput.trim(), senderType: 'user' }),
      })
      setChatInput('')
    } catch {
      console.error('Failed to send chat message')
    }
  }

  async function handleStatusTransition(disputeId: string, newStatus: string) {
    try {
      const res = await fetch(`/api/v1/disputes/${disputeId}/status`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) throw new Error('Failed')
      window.location.reload()
    } catch {
      console.error('Failed to transition dispute status')
    }
  }

  async function handleResolution(disputeId: string, type: string) {
    if (!resolutionNote.trim()) return
    try {
      const res = await fetch(`/api/v1/disputes/${disputeId}/resolve`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution: resolutionNote, resolutionType: type }),
      })
      if (!res.ok) throw new Error('Failed')
      setResolutionNote('')
      window.location.reload()
    } catch {
      console.error('Failed to resolve dispute')
    }
  }

  return (
    <div className="min-h-screen bg-primary-600 p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-warning-500">
            {t('disputes', 'Dispute Management')}
          </h1>
          <p className="mt-1 text-sm text-neutral-300">
            {t('disputes_desc', 'Manage and resolve platform disputes')}
          </p>
        </div>
        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="appearance-none rounded-lg border border-neutral-600/30 bg-primary-700 py-2.5 pl-3 pr-9 text-sm text-neutral-200 focus:border-success-500/50 focus:outline-none focus:ring-1 focus:ring-success-500/50"
          >
            <option value="all">{t('all_status', 'All Status')}</option>
            <option value="open">{t('status_open', 'Open')}</option>
            <option value="under_review">{t('status_under_review', 'Under Review')}</option>
            <option value="mediation">{t('status_mediation', 'Mediation')}</option>
            <option value="escalated">{t('status_escalated', 'Escalated')}</option>
            <option value="resolved">{t('status_resolved', 'Resolved')}</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-300" />
        </div>
      </div>

      {/* Summary counters */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(
          Object.entries(STATUS_CONFIG) as [DisputeStatus, (typeof STATUS_CONFIG)[DisputeStatus]][]
        ).map(([key, config]) => {
          const count = MOCK_DISPUTES.filter((d) => d.status === key).length
          return (
            <button
              key={key}
              type="button"
              onClick={() => setStatusFilter(key === statusFilter ? 'all' : key)}
              className={cn(
                'rounded-lg border p-3 text-center transition-colors',
                statusFilter === key
                  ? 'border-success-500/50 bg-primary-700'
                  : 'border-neutral-600/30 bg-neutral-600 hover:bg-primary-700/50',
              )}
            >
              <div className="flex items-center justify-center gap-1.5">
                {config.icon}
                <span className="text-lg font-bold text-warning-500">{count}</span>
              </div>
              <p className="mt-1 text-xs text-neutral-300">{t(`status_${key}`, config.label)}</p>
            </button>
          )
        })}
      </div>

      {/* Dispute list */}
      <div className="space-y-4">
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-neutral-600/30 bg-neutral-600 py-12 text-center">
            <CheckCircle className="mx-auto h-10 w-10 text-neutral-300" />
            <p className="mt-3 text-sm text-neutral-300">
              {t('no_disputes', 'No disputes for this filter')}
            </p>
          </div>
        ) : (
          filtered.map((dispute) => {
            const config = STATUS_CONFIG[dispute.status]
            const isExpanded = expandedId === dispute.id
            return (
              <div
                key={dispute.id}
                className="overflow-hidden rounded-xl border border-neutral-600/30 bg-neutral-600"
              >
                {/* Card header */}
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : dispute.id)}
                  className="w-full p-5 text-left transition-colors hover:bg-primary-700/20"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="font-semibold text-warning-500">{dispute.projectTitle}</h3>
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
                            config.color,
                          )}
                        >
                          {config.icon} {t(`status_${dispute.status}`, config.label)}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center gap-1.5 text-sm text-neutral-300">
                        <span
                          className={
                            dispute.initiatedByRole === 'owner'
                              ? 'text-warning-500'
                              : 'text-error-500'
                          }
                        >
                          {dispute.initiatedBy}
                        </span>
                        <ArrowRight className="h-3 w-3 text-neutral-600" />
                        <span
                          className={
                            dispute.againstUserRole === 'owner'
                              ? 'text-warning-500'
                              : 'text-error-500'
                          }
                        >
                          {dispute.againstUser}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-neutral-300">{dispute.reason}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-bold text-warning-500">
                        {formatRp(dispute.amount)}
                      </p>
                      <p className="mt-1 text-xs text-neutral-300">
                        {formatDateShort(dispute.createdAt)}
                      </p>
                      <ChevronDown
                        className={cn(
                          'mx-auto mt-2 h-4 w-4 text-neutral-300 transition-transform',
                          isExpanded && 'rotate-180',
                        )}
                      />
                    </div>
                  </div>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-primary-700/40 bg-primary-700/20">
                    <div className="grid gap-6 p-6 lg:grid-cols-2">
                      {/* Left column */}
                      <div className="space-y-6">
                        {/* Evidence */}
                        <div>
                          <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-warning-500">
                            <FileText className="h-4 w-4" />
                            {t('evidence', 'Evidence')} ({dispute.evidenceUrls.length})
                          </h4>
                          <div className="space-y-2">
                            {dispute.evidenceUrls.map((url) => {
                              const filename = url.split('/').pop() ?? url
                              return (
                                <a
                                  key={url}
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-2 rounded-lg border border-neutral-600/30 bg-primary-700 px-3 py-2 text-sm text-neutral-300 transition-colors hover:border-success-500/50 hover:text-success-500"
                                >
                                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                                  <span className="truncate">{filename}</span>
                                </a>
                              )
                            })}
                          </div>
                        </div>

                        {/* Status timeline */}
                        <div>
                          <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-warning-500">
                            <Clock className="h-4 w-4" />
                            {t('status_timeline', 'Status Timeline')}
                          </h4>
                          <div className="space-y-3">
                            <div className="flex items-center gap-3">
                              <div className="h-2 w-2 rounded-full bg-neutral-500" />
                              <div className="flex-1">
                                <p className="text-xs text-neutral-300">
                                  {t('dispute_created', 'Dispute Created')}
                                </p>
                              </div>
                              <span className="text-xs text-neutral-300">
                                {formatDateShort(dispute.createdAt)}
                              </span>
                            </div>
                            {dispute.statusHistory.map((event) => (
                              <div
                                key={`${event.from}-${event.to}-${event.date}`}
                                className="flex items-center gap-3"
                              >
                                <div className="h-2 w-2 rounded-full bg-success-500" />
                                <div className="flex-1">
                                  <p className="text-xs text-neutral-300">
                                    {t(`status_${event.from}`, event.from)}{' '}
                                    <ArrowRight className="inline h-3 w-3 text-neutral-300" />{' '}
                                    {t(`status_${event.to}`, event.to)}
                                  </p>
                                  <p className="text-xs text-neutral-300">{event.changedBy}</p>
                                </div>
                                <span className="text-xs text-neutral-300">
                                  {formatDateShort(event.date)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Resolution info */}
                        {dispute.resolutionType && (
                          <div className="rounded-lg border border-success-500/30 bg-success-500/10 p-4">
                            <h4 className="mb-2 text-sm font-semibold text-success-500">
                              {t('resolution', 'Resolution')}
                            </h4>
                            <p className="mb-1 text-xs font-medium text-success-500">
                              {dispute.resolutionType === 'funds_to_talent' &&
                                t('funds_to_talent', 'Funds Released to Talent')}
                              {dispute.resolutionType === 'funds_to_owner' &&
                                t('funds_to_owner', 'Funds Refunded to Owner')}
                              {dispute.resolutionType === 'split' &&
                                t('funds_split', 'Funds Split 50/50')}
                            </p>
                            <p className="text-xs text-neutral-300">{dispute.resolutionNote}</p>
                          </div>
                        )}

                        {/* Status transition + resolution */}
                        {dispute.status !== 'resolved' && (
                          <div className="space-y-4">
                            {/* Status transitions */}
                            <div>
                              <h4 className="mb-3 text-sm font-semibold text-warning-500">
                                {t('change_status', 'Change Status')}
                              </h4>
                              <div className="flex flex-wrap gap-2">
                                {dispute.status === 'open' && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleStatusTransition(dispute.id, 'under_review')
                                    }
                                    className="rounded-lg bg-warning-500 px-4 py-1.5 text-xs font-semibold text-primary-800 hover:bg-warning-600"
                                  >
                                    <Eye className="mr-1 inline h-3.5 w-3.5" />
                                    {t('start_review', 'Start Review')}
                                  </button>
                                )}
                                {dispute.status === 'under_review' && (
                                  <button
                                    type="button"
                                    onClick={() => handleStatusTransition(dispute.id, 'mediation')}
                                    className="rounded-lg bg-warning-500 px-4 py-1.5 text-xs font-semibold text-primary-800 hover:bg-warning-600"
                                  >
                                    <MessageSquare className="mr-1 inline h-3.5 w-3.5" />
                                    {t('begin_mediation', 'Begin Mediation')}
                                  </button>
                                )}
                                {(dispute.status === 'mediation' ||
                                  dispute.status === 'under_review') && (
                                  <button
                                    type="button"
                                    onClick={() => handleStatusTransition(dispute.id, 'escalated')}
                                    className="rounded-lg bg-error-500 px-4 py-1.5 text-xs font-semibold text-primary-800 hover:bg-error-600"
                                  >
                                    <Gavel className="mr-1 inline h-3.5 w-3.5" />
                                    {t('escalate', 'Escalate')}
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Resolution actions */}
                            <div>
                              <h4 className="mb-3 text-sm font-semibold text-warning-500">
                                {t('resolve_dispute', 'Resolve Dispute')}
                              </h4>
                              <textarea
                                value={resolutionNote}
                                onChange={(e) => setResolutionNote(e.target.value)}
                                placeholder={t(
                                  'resolution_reasoning',
                                  'Enter resolution reasoning...',
                                )}
                                rows={3}
                                className="mb-3 w-full rounded-lg border border-neutral-600/30 bg-primary-700 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-300 focus:border-success-500/50 focus:outline-none focus:ring-1 focus:ring-success-500/50"
                              />
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleResolution(dispute.id, 'funds_to_talent')}
                                  className="rounded-lg bg-success-500 px-4 py-2 text-xs font-semibold text-primary-800 hover:bg-success-600"
                                >
                                  {t('release_to_worker', 'Release to Talent')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleResolution(dispute.id, 'funds_to_owner')}
                                  className="rounded-lg border border-error-500/50 px-4 py-2 text-xs font-semibold text-error-500 hover:bg-error-500/10"
                                >
                                  {t('refund_to_client', 'Refund to Owner')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleResolution(dispute.id, 'split')}
                                  className="rounded-lg border border-warning-500/50 px-4 py-2 text-xs font-semibold text-warning-500 hover:bg-warning-500/10"
                                >
                                  <Scale className="mr-1 inline h-3.5 w-3.5" />
                                  {t('split_5050', 'Split 50/50')}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Right column: mediation chat */}
                      <div>
                        <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-warning-500">
                          <MessageSquare className="h-4 w-4" />
                          {t('mediation_chat', 'Mediation Chat')}
                        </h4>
                        <div className="flex h-[400px] flex-col rounded-lg border border-neutral-600/30 bg-primary-800">
                          {/* Messages area */}
                          <div className="flex-1 space-y-3 overflow-y-auto p-4">
                            {dispute.chatMessages.map((msg) => (
                              <div
                                key={msg.id}
                                className={cn('max-w-[85%]', msg.role === 'admin' ? 'ml-auto' : '')}
                              >
                                <div
                                  className={cn(
                                    'rounded-lg px-3 py-2 text-sm',
                                    msg.role === 'admin'
                                      ? 'bg-success-500/20 text-success-500'
                                      : msg.role === 'owner'
                                        ? 'bg-warning-500/15 text-neutral-200'
                                        : 'bg-error-500/15 text-neutral-200',
                                  )}
                                >
                                  <p className="mb-1 text-xs font-semibold">
                                    {msg.sender}
                                    <span
                                      className={cn(
                                        'ml-2 rounded-full px-1.5 py-0.5 text-[10px]',
                                        msg.role === 'admin'
                                          ? 'bg-success-500/30 text-success-500'
                                          : msg.role === 'owner'
                                            ? 'bg-warning-500/30 text-warning-500'
                                            : 'bg-error-500/30 text-error-500',
                                      )}
                                    >
                                      {msg.role}
                                    </span>
                                  </p>
                                  <p>{msg.content}</p>
                                </div>
                                <p className="mt-1 text-[10px] text-neutral-600">
                                  {new Date(msg.timestamp).toLocaleString('id-ID', {
                                    day: 'numeric',
                                    month: 'short',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </p>
                              </div>
                            ))}
                          </div>
                          {/* Chat input */}
                          {dispute.status !== 'resolved' && (
                            <div className="border-t border-neutral-600/30 p-3">
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  value={chatInput}
                                  onChange={(e) => setChatInput(e.target.value)}
                                  onKeyDown={(e) => e.key === 'Enter' && handleSendChat(dispute.id)}
                                  placeholder={t('type_message', 'Type a message as admin...')}
                                  className="flex-1 rounded-lg border border-neutral-600/30 bg-primary-700 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-300 focus:border-success-500/50 focus:outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleSendChat(dispute.id)}
                                  className="rounded-lg bg-success-500 px-3 py-2 text-primary-800 hover:bg-success-600"
                                >
                                  <Send className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
