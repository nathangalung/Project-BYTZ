import { createFileRoute } from '@tanstack/react-router'
import {
  AlertTriangle,
  Briefcase,
  CheckCircle,
  Code,
  FolderOpen,
  Search,
  Shield,
  ShieldOff,
  Star,
  UserCheck,
  UserX,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn, formatDateShort } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/users')({
  component: AdminUsersPage,
})

type PenaltyRecord = {
  id: string
  type: 'warning' | 'rating_penalty' | 'suspension' | 'ban'
  reason: string
  date: string
  issuedBy: string
}

type ProjectHistory = {
  id: string
  title: string
  role: 'owner' | 'talent'
  status: string
  date: string
}

type TalentDetails = {
  skills: string[]
  tier: 'junior' | 'mid' | 'senior'
  portfolioLinks: { platform: string; url: string }[]
  projectsCompleted: number
  projectsActive: number
  averageRating: number
  totalRatings: number
  yearsOfExperience: number
  verificationStatus: 'unverified' | 'cv_parsing' | 'verified' | 'suspended'
  bio: string
}

type UserRow = {
  id: string
  name: string
  email: string
  phone: string | null
  role: 'owner' | 'talent' | 'admin'
  isVerified: boolean
  isSuspended: boolean
  createdAt: string
  workerDetails: TalentDetails | null
  projectHistory: ProjectHistory[]
  penalties: PenaltyRecord[]
}

const MOCK_USERS: UserRow[] = [
  {
    id: 'u1',
    name: 'Ahmad Budiman',
    email: 'ahmad.budiman@example.com',
    phone: '+6281234567890',
    role: 'owner',
    isVerified: true,
    isSuspended: false,
    createdAt: '2025-11-15T08:00:00Z',
    workerDetails: null,
    projectHistory: [
      {
        id: 'p1',
        title: 'E-commerce Platform UMKM',
        role: 'owner',
        status: 'in_progress',
        date: '2026-01-15',
      },
      {
        id: 'p3',
        title: 'Dashboard Analytics Internal',
        role: 'owner',
        status: 'completed',
        date: '2025-11-05',
      },
      {
        id: 'p7',
        title: 'Chatbot Customer Service AI',
        role: 'owner',
        status: 'disputed',
        date: '2025-12-15',
      },
    ],
    penalties: [],
  },
  {
    id: 'u2',
    name: 'Siti Rahayu',
    email: 'siti.rahayu@example.com',
    phone: '+6281234567891',
    role: 'talent',
    isVerified: true,
    isSuspended: false,
    createdAt: '2025-10-20T10:30:00Z',
    workerDetails: {
      skills: ['React', 'TypeScript', 'Node.js', 'Python', 'TensorFlow'],
      tier: 'senior',
      portfolioLinks: [
        { platform: 'GitHub', url: 'https://github.com/sitirahayu' },
        { platform: 'LinkedIn', url: 'https://linkedin.com/in/sitirahayu' },
      ],
      projectsCompleted: 8,
      projectsActive: 2,
      averageRating: 4.7,
      totalRatings: 8,
      yearsOfExperience: 6,
      verificationStatus: 'verified',
      bio: 'Full-stack developer specializing in React and Python ML applications. Previously at Tokopedia and GoTo.',
    },
    projectHistory: [
      {
        id: 'p1',
        title: 'E-commerce Platform UMKM',
        role: 'talent',
        status: 'in_progress',
        date: '2026-01-20',
      },
      {
        id: 'p7',
        title: 'Chatbot Customer Service AI',
        role: 'talent',
        status: 'disputed',
        date: '2025-12-20',
      },
      {
        id: 'p8',
        title: 'Aplikasi Mobile Fitness',
        role: 'talent',
        status: 'review',
        date: '2025-10-25',
      },
    ],
    penalties: [],
  },
  {
    id: 'u3',
    name: 'Budi Santoso',
    email: 'budi.santoso@example.com',
    phone: '+6281234567892',
    role: 'talent',
    isVerified: false,
    isSuspended: false,
    createdAt: '2025-12-01T14:00:00Z',
    workerDetails: {
      skills: ['React Native', 'Flutter', 'Swift', 'Kotlin'],
      tier: 'mid',
      portfolioLinks: [{ platform: 'GitHub', url: 'https://github.com/budisantoso' }],
      projectsCompleted: 3,
      projectsActive: 0,
      averageRating: 4.2,
      totalRatings: 3,
      yearsOfExperience: 3,
      verificationStatus: 'cv_parsing',
      bio: 'Mobile developer focused on cross-platform apps using React Native and Flutter.',
    },
    projectHistory: [
      {
        id: 'p8',
        title: 'Aplikasi Mobile Fitness',
        role: 'talent',
        status: 'review',
        date: '2025-10-25',
      },
    ],
    penalties: [],
  },
  {
    id: 'u4',
    name: 'Dewi Lestari',
    email: 'dewi.lestari@example.com',
    phone: '+6281234567893',
    role: 'owner',
    isVerified: true,
    isSuspended: true,
    createdAt: '2025-09-10T09:00:00Z',
    workerDetails: null,
    projectHistory: [
      {
        id: 'p6',
        title: 'Landing Page Produk Baru',
        role: 'owner',
        status: 'cancelled',
        date: '2026-01-08',
      },
    ],
    penalties: [
      {
        id: 'pen1',
        type: 'suspension',
        reason: 'Repeatedly refusing to approve valid milestone submissions without justification',
        date: '2026-03-01',
        issuedBy: 'Admin Fitri',
      },
      {
        id: 'pen2',
        type: 'warning',
        reason: 'Attempting to contact worker directly outside platform',
        date: '2026-02-15',
        issuedBy: 'Admin Fitri',
      },
    ],
  },
  {
    id: 'u5',
    name: 'Eko Prasetyo',
    email: 'eko.prasetyo@example.com',
    phone: null,
    role: 'talent',
    isVerified: true,
    isSuspended: false,
    createdAt: '2026-01-05T11:00:00Z',
    workerDetails: {
      skills: ['Vue.js', 'Nuxt.js', 'Tailwind CSS', 'Figma'],
      tier: 'junior',
      portfolioLinks: [
        { platform: 'GitHub', url: 'https://github.com/ekopras' },
        { platform: 'Dribbble', url: 'https://dribbble.com/ekopras' },
      ],
      projectsCompleted: 1,
      projectsActive: 1,
      averageRating: 4.0,
      totalRatings: 1,
      yearsOfExperience: 1,
      verificationStatus: 'verified',
      bio: 'Junior frontend developer, enthusiastic learner. Recently graduated from Universitas Indonesia.',
    },
    projectHistory: [
      {
        id: 'p1',
        title: 'E-commerce Platform UMKM',
        role: 'talent',
        status: 'in_progress',
        date: '2026-01-20',
      },
    ],
    penalties: [],
  },
  {
    id: 'u6',
    name: 'Fitriani Wulandari',
    email: 'fitri.wulandari@example.com',
    phone: '+6281234567895',
    role: 'admin',
    isVerified: true,
    isSuspended: false,
    createdAt: '2025-08-01T08:00:00Z',
    workerDetails: null,
    projectHistory: [],
    penalties: [],
  },
  {
    id: 'u7',
    name: 'Gunawan Hidayat',
    email: 'gunawan.h@example.com',
    phone: '+6281234567896',
    role: 'talent',
    isVerified: true,
    isSuspended: false,
    createdAt: '2026-02-10T13:00:00Z',
    workerDetails: {
      skills: ['Figma', 'Adobe XD', 'UI Design', 'Prototyping', 'Illustrator'],
      tier: 'mid',
      portfolioLinks: [
        { platform: 'Behance', url: 'https://behance.net/gunawan' },
        { platform: 'Dribbble', url: 'https://dribbble.com/gunawan' },
      ],
      projectsCompleted: 5,
      projectsActive: 1,
      averageRating: 4.8,
      totalRatings: 5,
      yearsOfExperience: 4,
      verificationStatus: 'verified',
      bio: 'UI/UX designer with 4 years of experience in product design. Passionate about clean and intuitive interfaces.',
    },
    projectHistory: [
      {
        id: 'p1',
        title: 'E-commerce Platform UMKM',
        role: 'talent',
        status: 'in_progress',
        date: '2026-01-20',
      },
      {
        id: 'p8',
        title: 'Aplikasi Mobile Fitness',
        role: 'talent',
        status: 'review',
        date: '2025-10-25',
      },
    ],
    penalties: [],
  },
  {
    id: 'u8',
    name: 'Hana Permata',
    email: 'hana.permata@example.com',
    phone: '+6281234567897',
    role: 'owner',
    isVerified: true,
    isSuspended: false,
    createdAt: '2026-01-20T16:00:00Z',
    workerDetails: null,
    projectHistory: [
      {
        id: 'p2',
        title: 'Mobile App Delivery Tracking',
        role: 'owner',
        status: 'matching',
        date: '2026-02-20',
      },
      {
        id: 'p4',
        title: 'Redesign UI/UX Website',
        role: 'owner',
        status: 'brd_generated',
        date: '2026-03-01',
      },
      {
        id: 'p8',
        title: 'Aplikasi Mobile Fitness',
        role: 'owner',
        status: 'review',
        date: '2025-10-22',
      },
    ],
    penalties: [],
  },
  {
    id: 'u9',
    name: 'Irfan Maulana',
    email: 'irfan.maulana@example.com',
    phone: '+6281234567898',
    role: 'talent',
    isVerified: true,
    isSuspended: true,
    createdAt: '2025-07-14T07:30:00Z',
    workerDetails: {
      skills: ['Node.js', 'Express', 'PostgreSQL', 'Docker', 'AWS'],
      tier: 'mid',
      portfolioLinks: [{ platform: 'GitHub', url: 'https://github.com/irfanm' }],
      projectsCompleted: 4,
      projectsActive: 0,
      averageRating: 2.8,
      totalRatings: 4,
      yearsOfExperience: 3,
      verificationStatus: 'suspended',
      bio: 'Backend developer with experience in microservices architecture.',
    },
    projectHistory: [
      {
        id: 'p3',
        title: 'Dashboard Analytics Internal',
        role: 'talent',
        status: 'completed',
        date: '2025-11-10',
      },
    ],
    penalties: [
      {
        id: 'pen3',
        type: 'warning',
        reason: 'Unresponsive for 10 days on Dashboard Analytics project',
        date: '2025-12-10',
        issuedBy: 'Admin Fitri',
      },
      {
        id: 'pen4',
        type: 'rating_penalty',
        reason: 'Multiple missed deadlines, average rating dropped below 3.0',
        date: '2026-01-15',
        issuedBy: 'System',
      },
      {
        id: 'pen5',
        type: 'suspension',
        reason: 'Second abandon incident - project abandoned without notice',
        date: '2026-02-20',
        issuedBy: 'Admin Fitri',
      },
    ],
  },
  {
    id: 'u10',
    name: 'Joko Widodo',
    email: 'joko.w@example.com',
    phone: '+6281234567899',
    role: 'owner',
    isVerified: true,
    isSuspended: false,
    createdAt: '2026-03-01T12:00:00Z',
    workerDetails: null,
    projectHistory: [
      {
        id: 'p5',
        title: 'Sistem Manajemen Inventori',
        role: 'owner',
        status: 'prd_approved',
        date: '2026-02-10',
      },
    ],
    penalties: [],
  },
]

const ROLE_BADGE: Record<string, string> = {
  client: 'bg-warning-500/20 text-warning-500',
  worker: 'bg-error-500/20 text-error-500',
  admin: 'bg-success-500/20 text-success-500',
}

const TIER_BADGE: Record<string, string> = {
  junior: 'bg-neutral-500/20 text-neutral-300',
  mid: 'bg-warning-500/20 text-warning-500',
  senior: 'bg-success-500/20 text-success-500',
}

const PENALTY_BADGE: Record<string, string> = {
  warning: 'bg-warning-500/20 text-warning-500',
  rating_penalty: 'bg-warning-500/25 text-warning-600',
  suspension: 'bg-error-500/20 text-error-500',
  ban: 'bg-error-500/30 text-error-500',
}

function AdminUsersPage() {
  const { t } = useTranslation('admin')
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('')
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null)
  const [suspendReason, setSuspendReason] = useState('')
  const [showSuspendDialog, setShowSuspendDialog] = useState(false)

  const filteredUsers = MOCK_USERS.filter((user) => {
    const matchesSearch =
      !searchQuery ||
      user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesRole = !roleFilter || user.role === roleFilter
    return matchesSearch && matchesRole
  })

  const tabCounts = {
    all: MOCK_USERS.length,
    client: MOCK_USERS.filter((u) => u.role === 'owner').length,
    worker: MOCK_USERS.filter((u) => u.role === 'talent').length,
  }

  function handleSuspend(userId: string) {
    console.log('Suspend user:', userId, 'Reason:', suspendReason)
    setShowSuspendDialog(false)
    setSuspendReason('')
  }

  function handleUnsuspend(userId: string) {
    console.log('Unsuspend user:', userId)
  }

  function handleVerifyTalent(userId: string) {
    console.log('Verify worker:', userId)
  }

  function renderStars(rating: number) {
    return (
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={cn(
              'h-3.5 w-3.5',
              star <= Math.round(rating) ? 'fill-warning-500 text-warning-500' : 'text-neutral-600',
            )}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-primary-600 p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-warning-500">
          {t('user_management', 'User Management')}
        </h1>
        <p className="mt-1 text-sm text-neutral-300">
          {t('user_management_desc', 'Manage all BYTZ platform users')}
        </p>
      </div>

      {/* Role tabs */}
      <div className="mb-6 flex gap-1 rounded-lg bg-primary-700 p-1">
        <button
          type="button"
          onClick={() => setRoleFilter('')}
          className={cn(
            'flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors',
            !roleFilter
              ? 'bg-neutral-600 text-warning-500'
              : 'text-neutral-300 hover:text-neutral-200',
          )}
        >
          {t('all_users', 'All Users')} ({tabCounts.all})
        </button>
        <button
          type="button"
          onClick={() => setRoleFilter('owner')}
          className={cn(
            'flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors',
            roleFilter === 'owner'
              ? 'bg-neutral-600 text-warning-500'
              : 'text-neutral-300 hover:text-neutral-200',
          )}
        >
          {t('role_client', 'Owners')} ({tabCounts.client})
        </button>
        <button
          type="button"
          onClick={() => setRoleFilter('talent')}
          className={cn(
            'flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors',
            roleFilter === 'talent'
              ? 'bg-neutral-600 text-warning-500'
              : 'text-neutral-300 hover:text-neutral-200',
          )}
        >
          {t('role_worker', 'Talents')} ({tabCounts.worker})
        </button>
      </div>

      {/* Search */}
      <div className="mb-6">
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-300" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('search_users', 'Search by name or email...')}
            className="w-full rounded-lg border border-neutral-600/30 bg-primary-700 py-2.5 pl-9 pr-3 text-sm text-neutral-200 placeholder:text-neutral-300 focus:border-success-500/50 focus:outline-none focus:ring-1 focus:ring-success-500/50"
          />
        </div>
      </div>

      <p className="mb-4 text-sm text-neutral-300">
        {t('showing_users', 'Showing {{count}} users', { count: filteredUsers.length })}
      </p>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-neutral-600/30 bg-neutral-600">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-primary-700/60">
                <th className="whitespace-nowrap px-4 py-3.5 font-medium text-warning-500">
                  {t('col_name', 'Name')}
                </th>
                <th className="whitespace-nowrap px-4 py-3.5 font-medium text-warning-500">
                  {t('col_email', 'Email')}
                </th>
                <th className="whitespace-nowrap px-4 py-3.5 font-medium text-warning-500">
                  {t('col_phone', 'Phone')}
                </th>
                <th className="whitespace-nowrap px-4 py-3.5 font-medium text-warning-500">
                  {t('col_role', 'Role')}
                </th>
                <th className="whitespace-nowrap px-4 py-3.5 font-medium text-warning-500">
                  {t('col_status', 'Status')}
                </th>
                <th className="whitespace-nowrap px-4 py-3.5 font-medium text-warning-500">
                  {t('col_joined', 'Joined')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-primary-700/40">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-neutral-300">
                    {t('no_users_found', 'No users found')}
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr
                    key={user.id}
                    onClick={() => setSelectedUser(user)}
                    className="cursor-pointer transition-colors hover:bg-primary-700/30"
                  >
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-700 text-xs font-semibold text-warning-500">
                          {user.name
                            .split(' ')
                            .map((n) => n[0])
                            .join('')
                            .substring(0, 2)
                            .toUpperCase()}
                        </div>
                        <div>
                          <span className="font-medium text-neutral-200">{user.name}</span>
                          {user.penalties.length > 0 && (
                            <span className="ml-2 inline-flex items-center gap-0.5 rounded-full bg-error-500/20 px-1.5 py-0.5 text-[10px] text-error-500">
                              <AlertTriangle className="h-2.5 w-2.5" />
                              {user.penalties.length}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-neutral-300">{user.email}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-neutral-300">
                      {user.phone ?? <span className="text-neutral-600">-</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={cn(
                          'inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold',
                          ROLE_BADGE[user.role],
                        )}
                      >
                        {t(`role_${user.role}`, user.role)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {user.isSuspended ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-error-500/20 px-2.5 py-0.5 text-xs font-semibold text-error-500">
                          <ShieldOff className="h-3 w-3" />
                          {t('suspended', 'Suspended')}
                        </span>
                      ) : user.isVerified ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-success-500/20 px-2.5 py-0.5 text-xs font-semibold text-success-500">
                          <UserCheck className="h-3 w-3" />
                          {t('verified', 'Verified')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-warning-500/20 px-2.5 py-0.5 text-xs font-semibold text-warning-500">
                          <UserX className="h-3 w-3" />
                          {t('unverified', 'Unverified')}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-neutral-300">
                      {formatDateShort(user.createdAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail slide-over */}
      {selectedUser && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-primary-900/60 backdrop-blur-sm"
            onClick={() => {
              setSelectedUser(null)
              setShowSuspendDialog(false)
            }}
            onKeyDown={(e) => e.key === 'Escape' && setSelectedUser(null)}
            tabIndex={-1}
            aria-label="Close panel"
          />
          <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col bg-primary-700 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-primary-600/50 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-600 text-sm font-bold text-warning-500">
                  {selectedUser.name
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .substring(0, 2)
                    .toUpperCase()}
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-warning-500">{selectedUser.name}</h2>
                  <p className="text-xs text-neutral-300">{selectedUser.email}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedUser(null)
                  setShowSuspendDialog(false)
                }}
                className="rounded-lg p-2 text-neutral-300 hover:bg-primary-600 hover:text-neutral-200"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-6">
                {/* Profile info */}
                <div className="rounded-lg border border-neutral-600/30 bg-neutral-600 p-4">
                  <h3 className="mb-3 text-sm font-semibold text-warning-500">
                    {t('profile', 'Profile')}
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-neutral-300">{t('col_role', 'Role')}</p>
                      <span
                        className={cn(
                          'mt-1 inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold',
                          ROLE_BADGE[selectedUser.role],
                        )}
                      >
                        {t(`role_${selectedUser.role}`, selectedUser.role)}
                      </span>
                    </div>
                    <div>
                      <p className="text-xs text-neutral-300">{t('col_phone', 'Phone')}</p>
                      <p className="mt-1 text-sm text-neutral-300">{selectedUser.phone ?? '-'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-neutral-300">{t('col_joined', 'Joined')}</p>
                      <p className="mt-1 text-sm text-neutral-300">
                        {formatDateShort(selectedUser.createdAt)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-neutral-300">{t('col_status', 'Status')}</p>
                      <div className="mt-1">
                        {selectedUser.isSuspended ? (
                          <span className="inline-flex items-center gap-1 text-sm font-semibold text-error-500">
                            <ShieldOff className="h-3.5 w-3.5" /> {t('suspended', 'Suspended')}
                          </span>
                        ) : selectedUser.isVerified ? (
                          <span className="inline-flex items-center gap-1 text-sm font-semibold text-success-500">
                            <CheckCircle className="h-3.5 w-3.5" /> {t('verified', 'Verified')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-sm font-semibold text-warning-500">
                            <UserX className="h-3.5 w-3.5" /> {t('unverified', 'Unverified')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Talent details */}
                {selectedUser.workerDetails && (
                  <div className="rounded-lg border border-neutral-600/30 bg-neutral-600 p-4">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-warning-500">
                      <Code className="h-4 w-4" />
                      {t('worker_profile', 'Talent Profile')}
                    </h3>
                    <p className="mb-3 text-sm text-neutral-300">
                      {selectedUser.workerDetails.bio}
                    </p>
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div>
                        <p className="text-xs text-neutral-300">{t('tier', 'Tier (Internal)')}</p>
                        <span
                          className={cn(
                            'mt-1 inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold',
                            TIER_BADGE[selectedUser.workerDetails.tier],
                          )}
                        >
                          {selectedUser.workerDetails.tier}
                        </span>
                      </div>
                      <div>
                        <p className="text-xs text-neutral-300">{t('experience', 'Experience')}</p>
                        <p className="mt-1 text-sm text-neutral-300">
                          {selectedUser.workerDetails.yearsOfExperience} {t('years', 'years')}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-neutral-300">
                          {t('projects_done', 'Completed')}
                        </p>
                        <p className="mt-1 text-sm text-neutral-300">
                          {selectedUser.workerDetails.projectsCompleted}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-neutral-300">{t('projects_active', 'Active')}</p>
                        <p className="mt-1 text-sm text-neutral-300">
                          {selectedUser.workerDetails.projectsActive}
                        </p>
                      </div>
                    </div>
                    {/* Rating */}
                    <div className="mb-4">
                      <p className="mb-1 text-xs text-neutral-300">
                        {t('avg_rating', 'Average Rating')}
                      </p>
                      <div className="flex items-center gap-2">
                        {renderStars(selectedUser.workerDetails.averageRating)}
                        <span className="text-sm font-semibold text-warning-500">
                          {selectedUser.workerDetails.averageRating.toFixed(1)}
                        </span>
                        <span className="text-xs text-neutral-300">
                          ({selectedUser.workerDetails.totalRatings} {t('reviews', 'reviews')})
                        </span>
                      </div>
                    </div>
                    {/* Skills */}
                    <div className="mb-4">
                      <p className="mb-2 text-xs text-neutral-300">{t('skills', 'Skills')}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedUser.workerDetails.skills.map((skill) => (
                          <span
                            key={skill}
                            className="rounded-full bg-primary-700 px-2.5 py-1 text-xs font-medium text-neutral-300"
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                    {/* Portfolio */}
                    {selectedUser.workerDetails.portfolioLinks.length > 0 && (
                      <div>
                        <p className="mb-2 text-xs text-neutral-300">
                          {t('portfolio', 'Portfolio')}
                        </p>
                        <div className="space-y-1.5">
                          {selectedUser.workerDetails.portfolioLinks.map((link) => (
                            <a
                              key={link.url}
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 text-sm text-success-500 hover:underline"
                            >
                              <Briefcase className="h-3.5 w-3.5" />
                              {link.platform}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Project history */}
                {selectedUser.projectHistory.length > 0 && (
                  <div className="rounded-lg border border-neutral-600/30 bg-neutral-600 p-4">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-warning-500">
                      <FolderOpen className="h-4 w-4" />
                      {t('project_history', 'Project History')} (
                      {selectedUser.projectHistory.length})
                    </h3>
                    <div className="space-y-2">
                      {selectedUser.projectHistory.map((proj) => (
                        <div
                          key={proj.id}
                          className="flex items-center justify-between rounded-lg bg-primary-700 px-3 py-2"
                        >
                          <div>
                            <p className="text-sm font-medium text-neutral-200">{proj.title}</p>
                            <p className="text-xs text-neutral-300">
                              {proj.role} | {proj.date}
                            </p>
                          </div>
                          <span
                            className={cn(
                              'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                              proj.status === 'completed'
                                ? 'bg-success-500/20 text-success-500'
                                : proj.status === 'in_progress' || proj.status === 'review'
                                  ? 'bg-success-500/15 text-success-500'
                                  : proj.status === 'disputed' || proj.status === 'cancelled'
                                    ? 'bg-error-500/20 text-error-500'
                                    : 'bg-warning-500/20 text-warning-500',
                            )}
                          >
                            {proj.status.replace(/_/g, ' ')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Penalties */}
                {selectedUser.penalties.length > 0 && (
                  <div className="rounded-lg border border-error-500/30 bg-error-500/5 p-4">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-error-500">
                      <AlertTriangle className="h-4 w-4" />
                      {t('penalty_history', 'Penalty History')} ({selectedUser.penalties.length})
                    </h3>
                    <div className="space-y-2">
                      {selectedUser.penalties.map((pen) => (
                        <div key={pen.id} className="rounded-lg bg-primary-700 px-3 py-2">
                          <div className="flex items-center justify-between">
                            <span
                              className={cn(
                                'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                                PENALTY_BADGE[pen.type],
                              )}
                            >
                              {pen.type.replace(/_/g, ' ')}
                            </span>
                            <span className="text-xs text-neutral-300">{pen.date}</span>
                          </div>
                          <p className="mt-1 text-sm text-neutral-300">{pen.reason}</p>
                          <p className="mt-0.5 text-xs text-neutral-300">
                            {t('issued_by', 'By')}: {pen.issuedBy}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Admin actions */}
                <div className="rounded-lg border border-neutral-600/30 bg-neutral-600 p-4">
                  <h3 className="mb-3 text-sm font-semibold text-warning-500">
                    {t('admin_actions', 'Admin Actions')}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedUser.isSuspended ? (
                      <button
                        type="button"
                        onClick={() => handleUnsuspend(selectedUser.id)}
                        className="flex items-center gap-2 rounded-lg bg-success-500 px-4 py-2 text-xs font-semibold text-primary-800 hover:bg-success-600"
                      >
                        <Shield className="h-3.5 w-3.5" />
                        {t('unsuspend', 'Reactivate')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowSuspendDialog(true)}
                        className="flex items-center gap-2 rounded-lg border border-error-500/50 px-4 py-2 text-xs font-semibold text-error-500 hover:bg-error-500/10"
                      >
                        <ShieldOff className="h-3.5 w-3.5" />
                        {t('suspend', 'Suspend')}
                      </button>
                    )}
                    {selectedUser.role === 'talent' && !selectedUser.isVerified && (
                      <button
                        type="button"
                        onClick={() => handleVerifyTalent(selectedUser.id)}
                        className="flex items-center gap-2 rounded-lg bg-success-500 px-4 py-2 text-xs font-semibold text-primary-800 hover:bg-success-600"
                      >
                        <UserCheck className="h-3.5 w-3.5" />
                        {t('verify_manual', 'Verify Manually')}
                      </button>
                    )}
                  </div>

                  {/* Suspend dialog */}
                  {showSuspendDialog && (
                    <div className="mt-4 rounded-lg border border-error-500/30 bg-primary-800 p-4">
                      <p className="mb-2 text-sm font-medium text-error-500">
                        {t('suspend_reason_label', 'Suspension Reason')}
                      </p>
                      <textarea
                        value={suspendReason}
                        onChange={(e) => setSuspendReason(e.target.value)}
                        placeholder={t('enter_reason', 'Enter reason for suspension...')}
                        rows={3}
                        className="mb-3 w-full rounded-lg border border-neutral-600/30 bg-primary-700 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-300 focus:border-error-500/50 focus:outline-none"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleSuspend(selectedUser.id)}
                          disabled={!suspendReason.trim()}
                          className="rounded-lg bg-error-500 px-4 py-1.5 text-xs font-semibold text-primary-800 hover:bg-error-600 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {t('confirm_suspend', 'Confirm Suspend')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowSuspendDialog(false)
                            setSuspendReason('')
                          }}
                          className="rounded-lg border border-neutral-600/50 px-4 py-1.5 text-xs font-medium text-neutral-300 hover:bg-primary-700"
                        >
                          {t('cancel', 'Cancel')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
