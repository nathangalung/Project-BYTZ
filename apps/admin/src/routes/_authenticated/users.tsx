import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { CheckCircle, Search, Shield, ShieldOff, UserCheck, UserX, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn, formatDateShort } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'

export const Route = createFileRoute('/_authenticated/users')({
  component: AdminUsersPage,
})

type AdminUserRow = {
  id: string
  email: string
  name: string
  phone: string | null
  role: 'owner' | 'talent' | 'admin'
  avatarUrl: string | null
  isVerified: boolean
  locale: string
  createdAt: string
  updatedAt: string
}

type ListResponse = {
  success: boolean
  data: {
    items: AdminUserRow[]
    total: number
    page: number
    pageSize: number
  }
}

type MutationResponse = {
  success: boolean
  data: AdminUserRow
}

type TalentProfile = {
  id: string
  userId: string
  bio: string | null
  yearsOfExperience: number
  tier: 'junior' | 'mid' | 'senior'
  educationUniversity: string | null
  educationMajor: string | null
  educationYear: number | null
  location: string | null
  availabilityStatus: string
  verificationStatus: string
  portfolioLinks: unknown
  domainExpertise: unknown
  totalProjectsCompleted: number
  totalProjectsActive: number
  averageRating: number | null
  pemerataanPenalty: number
  createdAt: string
  updatedAt: string
}

type TalentSkillEntry = {
  skillId: string
  skillName: string
  category: string
  proficiencyLevel: string
  isPrimary: boolean
}

type TalentPenaltyEntry = {
  id: string
  type: string
  reason: string
  relatedProjectId: string | null
  issuedById: string
  issuedByName: string | null
  appealStatus: string
  appealNote: string | null
  expiresAt: string | null
  createdAt: string
}

type TalentProjectHistoryEntry = {
  assignmentId: string
  projectId: string
  projectTitle: string
  projectStatus: string
  roleLabel: string | null
  workPackageTitle: string | null
  acceptanceStatus: string
  assignmentStatus: string
  startedAt: string | null
  completedAt: string | null
  createdAt: string
}

type TalentDetailResponse = {
  success: boolean
  data: {
    profile: TalentProfile | null
    skills: TalentSkillEntry[]
    penalties: TalentPenaltyEntry[]
    projectHistory: TalentProjectHistoryEntry[]
  }
}

const ROLE_BADGE: Record<string, string> = {
  owner: 'bg-warning-500/20 text-warning-500',
  talent: 'bg-error-500/20 text-error-500',
  admin: 'bg-success-500/20 text-success-500',
}

async function fetchUsers(params: {
  role: string
  search: string
  page: number
  pageSize: number
}): Promise<ListResponse> {
  const query = new URLSearchParams()
  if (params.role) query.set('role', params.role)
  if (params.search) query.set('search', params.search)
  query.set('page', String(params.page))
  query.set('pageSize', String(params.pageSize))

  const res = await fetch(`/api/v1/admin/users?${query.toString()}`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Failed to load users')
  return res.json()
}

async function suspendUser(input: {
  userId: string
  adminId: string
  reason: string
}): Promise<MutationResponse> {
  const res = await fetch(`/api/v1/admin/users/${input.userId}/suspend`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminId: input.adminId, reason: input.reason }),
  })
  if (!res.ok) throw new Error('Failed to suspend user')
  return res.json()
}

async function fetchTalentDetail(userId: string): Promise<TalentDetailResponse> {
  const res = await fetch(`/api/v1/admin/users/${userId}/talent-detail`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Failed to load talent detail')
  return res.json()
}

async function unsuspendUser(input: {
  userId: string
  adminId: string
}): Promise<MutationResponse> {
  const res = await fetch(`/api/v1/admin/users/${input.userId}/unsuspend`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminId: input.adminId }),
  })
  if (!res.ok) throw new Error('Failed to unsuspend user')
  return res.json()
}

function AdminUsersPage() {
  const { t } = useTranslation('admin')
  const queryClient = useQueryClient()
  const adminId = useAuthStore((s) => s.user?.id ?? '')

  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('')
  const [selectedUser, setSelectedUser] = useState<AdminUserRow | null>(null)
  const [suspendReason, setSuspendReason] = useState('')
  const [showSuspendDialog, setShowSuspendDialog] = useState(false)

  const usersQuery = useQuery({
    queryKey: ['admin-users', roleFilter, searchQuery],
    queryFn: () =>
      fetchUsers({
        role: roleFilter,
        search: searchQuery,
        page: 1,
        pageSize: 100,
      }),
  })

  const suspendMutation = useMutation({
    mutationFn: suspendUser,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setSelectedUser(data.data)
      setShowSuspendDialog(false)
      setSuspendReason('')
    },
  })

  const unsuspendMutation = useMutation({
    mutationFn: unsuspendUser,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setSelectedUser(data.data)
    },
  })

  const talentDetailQuery = useQuery({
    queryKey: ['admin-talent-detail', selectedUser?.id],
    queryFn: () => fetchTalentDetail(selectedUser?.id ?? ''),
    enabled: selectedUser?.role === 'talent',
  })
  const talentDetail = talentDetailQuery.data?.data

  const users = usersQuery.data?.data.items ?? []
  const tabCounts = {
    all: users.length,
    owner: users.filter((u) => u.role === 'owner').length,
    talent: users.filter((u) => u.role === 'talent').length,
  }

  function handleSuspend(userId: string) {
    if (!adminId || !suspendReason.trim()) return
    suspendMutation.mutate({ userId, adminId, reason: suspendReason })
  }

  function handleUnsuspend(userId: string) {
    if (!adminId) return
    unsuspendMutation.mutate({ userId, adminId })
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
          {t('role_owner', 'Owners')} ({tabCounts.owner})
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
          {t('role_talent', 'Talents')} ({tabCounts.talent})
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
        {usersQuery.isLoading
          ? t('loading', 'Loading...')
          : t('showing_users', 'Showing {{count}} users', { count: users.length })}
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
              {usersQuery.isError ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-error-500">
                    {t('load_failed', 'Failed to load users')}
                  </td>
                </tr>
              ) : usersQuery.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholder
                  <tr key={`skeleton-${i}`}>
                    <td colSpan={6} className="px-4 py-4">
                      <div className="h-6 animate-pulse rounded bg-primary-700/60" />
                    </td>
                  </tr>
                ))
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-neutral-300">
                    {t('no_users_found', 'No users found')}
                  </td>
                </tr>
              ) : (
                users.map((user) => (
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
                        <span className="font-medium text-neutral-200">{user.name}</span>
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
                      {user.isVerified ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-success-500/20 px-2.5 py-0.5 text-xs font-semibold text-success-500">
                          <UserCheck className="h-3 w-3" />
                          {t('verified', 'Verified')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-error-500/20 px-2.5 py-0.5 text-xs font-semibold text-error-500">
                          <ShieldOff className="h-3 w-3" />
                          {t('suspended', 'Suspended')}
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
                        {selectedUser.isVerified ? (
                          <span className="inline-flex items-center gap-1 text-sm font-semibold text-success-500">
                            <CheckCircle className="h-3.5 w-3.5" /> {t('verified', 'Verified')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-sm font-semibold text-error-500">
                            <UserX className="h-3.5 w-3.5" /> {t('suspended', 'Suspended')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Talent-specific sections */}
                {selectedUser.role === 'talent' &&
                  (talentDetailQuery.isLoading ? (
                    <div className="rounded-lg border border-neutral-600/30 bg-neutral-600 p-4">
                      <div className="h-4 w-32 animate-pulse rounded bg-primary-700/60" />
                      <div className="mt-3 h-20 animate-pulse rounded bg-primary-700/40" />
                    </div>
                  ) : talentDetailQuery.isError ? (
                    <div className="rounded-lg border border-error-500/30 bg-neutral-600 p-4">
                      <p className="text-xs text-error-500">
                        {t('load_failed', 'Failed to load data')}
                      </p>
                    </div>
                  ) : talentDetail?.profile ? (
                    <>
                      <div className="rounded-lg border border-neutral-600/30 bg-neutral-600 p-4">
                        <h3 className="mb-3 text-sm font-semibold text-warning-500">
                          {t('talent_profile', 'Talent Profile')}
                        </h3>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-xs text-neutral-300">
                              {t('tier', 'Tier (Internal)')}
                            </p>
                            <p className="mt-1 text-sm font-medium uppercase text-neutral-200">
                              {talentDetail.profile.tier}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-neutral-300">
                              {t('experience', 'Experience')}
                            </p>
                            <p className="mt-1 text-sm text-neutral-200">
                              {talentDetail.profile.yearsOfExperience} {t('years', 'years')}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-neutral-300">
                              {t('projects_done', 'Completed')}
                            </p>
                            <p className="mt-1 text-sm text-neutral-200">
                              {talentDetail.profile.totalProjectsCompleted}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-neutral-300">
                              {t('projects_active', 'Active')}
                            </p>
                            <p className="mt-1 text-sm text-neutral-200">
                              {talentDetail.profile.totalProjectsActive}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-neutral-300">
                              {t('avg_rating', 'Average Rating')}
                            </p>
                            <p className="mt-1 text-sm text-neutral-200">
                              {talentDetail.profile.averageRating != null
                                ? talentDetail.profile.averageRating.toFixed(2)
                                : '-'}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-neutral-300">
                              {t('verification_status', 'Verification')}
                            </p>
                            <p className="mt-1 text-sm capitalize text-neutral-200">
                              {talentDetail.profile.verificationStatus.replace(/_/g, ' ')}
                            </p>
                          </div>
                          {talentDetail.profile.educationUniversity && (
                            <div className="col-span-2">
                              <p className="text-xs text-neutral-300">
                                {t('education', 'Education')}
                              </p>
                              <p className="mt-1 text-sm text-neutral-200">
                                {talentDetail.profile.educationUniversity}
                                {talentDetail.profile.educationMajor
                                  ? ` — ${talentDetail.profile.educationMajor}`
                                  : ''}
                                {talentDetail.profile.educationYear
                                  ? ` (${talentDetail.profile.educationYear})`
                                  : ''}
                              </p>
                            </div>
                          )}
                          {talentDetail.profile.location && (
                            <div>
                              <p className="text-xs text-neutral-300">
                                {t('location', 'Location')}
                              </p>
                              <p className="mt-1 text-sm text-neutral-200">
                                {talentDetail.profile.location}
                              </p>
                            </div>
                          )}
                        </div>
                        {talentDetail.profile.bio && (
                          <p className="mt-3 text-sm text-neutral-300">
                            {talentDetail.profile.bio}
                          </p>
                        )}
                      </div>

                      <div className="rounded-lg border border-neutral-600/30 bg-neutral-600 p-4">
                        <h3 className="mb-3 text-sm font-semibold text-warning-500">
                          {t('skills', 'Skills')}
                        </h3>
                        {talentDetail.skills.length === 0 ? (
                          <p className="text-xs text-neutral-300">-</p>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {talentDetail.skills.map((s) => (
                              <span
                                key={s.skillId}
                                className={cn(
                                  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs',
                                  s.isPrimary
                                    ? 'bg-success-500/20 text-success-500'
                                    : 'bg-primary-800 text-neutral-300',
                                )}
                                title={`${s.category} · ${s.proficiencyLevel}`}
                              >
                                {s.skillName}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="rounded-lg border border-neutral-600/30 bg-neutral-600 p-4">
                        <h3 className="mb-3 text-sm font-semibold text-warning-500">
                          {t('project_history', 'Project History')}
                        </h3>
                        {talentDetail.projectHistory.length === 0 ? (
                          <p className="text-xs text-neutral-300">-</p>
                        ) : (
                          <ul className="space-y-2">
                            {talentDetail.projectHistory.map((h) => (
                              <li
                                key={h.assignmentId}
                                className="rounded-md border border-primary-700/40 bg-primary-800 px-3 py-2"
                              >
                                <p className="text-sm font-medium text-neutral-200">
                                  {h.projectTitle}
                                </p>
                                <p className="mt-0.5 text-xs text-neutral-300">
                                  {h.roleLabel ?? h.workPackageTitle ?? '-'} ·{' '}
                                  <span className="capitalize">
                                    {h.assignmentStatus.replace(/_/g, ' ')}
                                  </span>{' '}
                                  ·{' '}
                                  <span className="capitalize">
                                    {h.projectStatus.replace(/_/g, ' ')}
                                  </span>
                                </p>
                                <p className="mt-0.5 text-xs text-neutral-400">
                                  {formatDateShort(h.startedAt ?? h.createdAt)}
                                  {h.completedAt ? ` → ${formatDateShort(h.completedAt)}` : ''}
                                </p>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      {talentDetail.penalties.length > 0 && (
                        <div className="rounded-lg border border-error-500/30 bg-neutral-600 p-4">
                          <h3 className="mb-3 text-sm font-semibold text-error-500">
                            {t('penalty_history', 'Penalty History')}
                          </h3>
                          <ul className="space-y-2">
                            {talentDetail.penalties.map((p) => (
                              <li
                                key={p.id}
                                className="rounded-md border border-error-500/20 bg-primary-800 px-3 py-2"
                              >
                                <p className="text-sm font-medium capitalize text-error-500">
                                  {p.type.replace(/_/g, ' ')}
                                </p>
                                <p className="mt-0.5 text-xs text-neutral-200">{p.reason}</p>
                                <p className="mt-0.5 text-xs text-neutral-300">
                                  {t('issued_by', 'By')}: {p.issuedByName ?? p.issuedById} ·{' '}
                                  {formatDateShort(p.createdAt)}
                                  {p.appealStatus !== 'none' && (
                                    <span className="ml-1 capitalize">· {p.appealStatus}</span>
                                  )}
                                </p>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  ) : null)}

                {/* Admin actions */}
                <div className="rounded-lg border border-neutral-600/30 bg-neutral-600 p-4">
                  <h3 className="mb-3 text-sm font-semibold text-warning-500">
                    {t('admin_actions', 'Admin Actions')}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedUser.isVerified ? (
                      <button
                        type="button"
                        onClick={() => setShowSuspendDialog(true)}
                        disabled={suspendMutation.isPending}
                        className="flex items-center gap-2 rounded-lg border border-error-500/50 px-4 py-2 text-xs font-semibold text-error-500 hover:bg-error-500/10 disabled:opacity-50"
                      >
                        <ShieldOff className="h-3.5 w-3.5" />
                        {t('suspend', 'Suspend')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleUnsuspend(selectedUser.id)}
                        disabled={unsuspendMutation.isPending}
                        className="flex items-center gap-2 rounded-lg bg-success-500 px-4 py-2 text-xs font-semibold text-primary-800 hover:bg-success-600 disabled:opacity-50"
                      >
                        <Shield className="h-3.5 w-3.5" />
                        {t('unsuspend', 'Reactivate')}
                      </button>
                    )}
                  </div>

                  {(suspendMutation.isError || unsuspendMutation.isError) && (
                    <p className="mt-2 text-xs text-error-500">
                      {t('action_failed', 'Action failed. Try again.')}
                    </p>
                  )}

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
                          disabled={!suspendReason.trim() || suspendMutation.isPending}
                          className="rounded-lg bg-error-500 px-4 py-1.5 text-xs font-semibold text-primary-800 hover:bg-error-600 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {suspendMutation.isPending
                            ? t('processing', 'Processing...')
                            : t('confirm_suspend', 'Confirm Suspend')}
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
