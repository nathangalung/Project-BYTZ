import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { CheckCircle, Shield, ShieldOff, UserCheck, UserX } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type Column, DataTable } from '@/components/ui/data-table'
import { DetailField, DetailSection } from '@/components/ui/detail-section'
import { FilterBar, SearchInput, SegmentedTabs } from '@/components/ui/filter-bar'
import { PageHeader } from '@/components/ui/page-header'
import { SlideOver } from '@/components/ui/slide-over'
import { StatusBadge } from '@/components/ui/status-badge'
import { useAdminList } from '@/hooks/use-admin-list'
import { apiGet, apiPatch, type ListPage } from '@/lib/api'
import { cn, formatDateShort, initials } from '@/lib/utils'
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

type TalentDetail = {
  profile: TalentProfile | null
  skills: TalentSkillEntry[]
  penalties: TalentPenaltyEntry[]
  projectHistory: TalentProjectHistoryEntry[]
}

const USERS_PATH = '/api/v1/admin/users'

const ROLE_BADGE: Record<string, string> = {
  owner: 'bg-warning-500/20 text-warning-500',
  talent: 'bg-error-500/20 text-error-500',
  admin: 'bg-success-500/20 text-success-500',
}

const ROLE_TABS = ['', 'owner', 'talent'] as const

function suspendUser(input: { userId: string; adminId: string; reason: string }) {
  return apiPatch<AdminUserRow>(`${USERS_PATH}/${input.userId}/suspend`, {
    adminId: input.adminId,
    reason: input.reason,
  })
}

function unsuspendUser(input: { userId: string; adminId: string }) {
  return apiPatch<AdminUserRow>(`${USERS_PATH}/${input.userId}/unsuspend`, {
    adminId: input.adminId,
  })
}

// Tab counts come from the server's total per role. Counting the rendered rows
// counted a single page of one already-filtered result set, so every tab but
// the active one read zero and the active one stopped at the page size.
function useRoleCounts(search: string) {
  const results = useQueries({
    queries: ROLE_TABS.map((role) => ({
      queryKey: ['admin-users-count', role, search],
      queryFn: () =>
        apiGet<ListPage<AdminUserRow>>(USERS_PATH, { role, search, page: 1, pageSize: 1 }),
      staleTime: 30_000,
    })),
  })
  return {
    all: results[0].data?.total ?? 0,
    owner: results[1].data?.total ?? 0,
    talent: results[2].data?.total ?? 0,
  }
}

function AdminUsersPage() {
  const { t } = useTranslation('admin')
  const queryClient = useQueryClient()
  const adminId = useAuthStore((s) => s.user?.id ?? '')

  const list = useAdminList<AdminUserRow>({
    queryKey: 'admin-users',
    path: USERS_PATH,
    initialFilters: { role: '' },
  })
  const counts = useRoleCounts(list.debouncedSearch)

  const [selectedUser, setSelectedUser] = useState<AdminUserRow | null>(null)
  const [suspendReason, setSuspendReason] = useState('')
  const [showSuspendDialog, setShowSuspendDialog] = useState(false)

  function invalidateUsers(updated: AdminUserRow) {
    queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    queryClient.invalidateQueries({ queryKey: ['admin-users-count'] })
    setSelectedUser(updated)
  }

  const suspendMutation = useMutation({
    mutationFn: suspendUser,
    onSuccess: (data) => {
      invalidateUsers(data)
      setShowSuspendDialog(false)
      setSuspendReason('')
    },
  })

  const unsuspendMutation = useMutation({
    mutationFn: unsuspendUser,
    onSuccess: invalidateUsers,
  })

  const talentDetailQuery = useQuery({
    queryKey: ['admin-talent-detail', selectedUser?.id],
    queryFn: () => apiGet<TalentDetail>(`${USERS_PATH}/${selectedUser?.id}/talent-detail`),
    enabled: selectedUser?.role === 'talent',
  })
  const talentDetail = talentDetailQuery.data

  function closePanel() {
    setSelectedUser(null)
    setShowSuspendDialog(false)
  }

  function handleSuspend(userId: string) {
    if (!adminId || !suspendReason.trim()) return
    suspendMutation.mutate({ userId, adminId, reason: suspendReason })
  }

  function handleUnsuspend(userId: string) {
    if (!adminId) return
    unsuspendMutation.mutate({ userId, adminId })
  }

  // A new array identity here re-sorts every row on each parent keystroke.
  const columns = useMemo<Column<AdminUserRow>[]>(() => {
    function verificationBadge(user: AdminUserRow) {
      return user.isVerified ? (
        <StatusBadge
          tone="success"
          icon={<UserCheck className="h-3 w-3" />}
          label={t('verified', 'Verified')}
        />
      ) : (
        <StatusBadge
          tone="error"
          icon={<ShieldOff className="h-3 w-3" />}
          label={t('suspended', 'Suspended')}
        />
      )
    }

    return [
      {
        key: 'name',
        header: t('col_name', 'Name'),
        sortValue: (user) => user.name,
        cell: (user) => (
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-700 text-xs font-semibold text-warning-500">
              {initials(user.name)}
            </div>
            <span className="font-medium text-neutral-200">{user.name}</span>
          </div>
        ),
      },
      {
        key: 'email',
        header: t('col_email', 'Email'),
        sortValue: (user) => user.email,
        cellClassName: 'text-neutral-300',
        cell: (user) => user.email,
      },
      {
        key: 'phone',
        header: t('col_phone', 'Phone'),
        cellClassName: 'text-neutral-300',
        cell: (user) => user.phone ?? <span className="text-neutral-600">-</span>,
      },
      {
        key: 'role',
        header: t('col_role', 'Role'),
        cell: (user) => (
          <StatusBadge
            className={ROLE_BADGE[user.role]}
            label={t(`role_${user.role}`, user.role)}
          />
        ),
      },
      {
        key: 'status',
        header: t('col_status', 'Status'),
        cell: verificationBadge,
      },
      {
        key: 'createdAt',
        header: t('col_joined', 'Joined'),
        sortValue: (user) => user.createdAt,
        cellClassName: 'text-neutral-300',
        cell: (user) => formatDateShort(user.createdAt),
      },
    ]
  }, [t])

  return (
    <div className="min-h-screen bg-primary-600 p-6 lg:p-8">
      <PageHeader
        title={t('user_management', 'User Management')}
        description={t('user_management_desc', 'Manage all BYTZ platform users')}
      />

      <SegmentedTabs
        value={list.filters.role}
        onChange={(role) => list.setFilter('role', role)}
        tabs={[
          { id: '', label: t('all_users', 'All Users'), count: counts.all },
          { id: 'owner', label: t('role_owner', 'Owners'), count: counts.owner },
          { id: 'talent', label: t('role_talent', 'Talents'), count: counts.talent },
        ]}
      />

      <FilterBar>
        <SearchInput
          value={list.search}
          onChange={list.setSearch}
          placeholder={t('search_users', 'Search by name or email...')}
        />
      </FilterBar>

      <p className="mb-4 text-sm text-neutral-300">
        {list.query.isLoading
          ? t('loading', 'Loading...')
          : t('showing_users', 'Showing {{count}} users', { count: list.items.length })}
      </p>

      <DataTable
        columns={columns}
        rows={list.items}
        rowKey={(user) => user.id}
        isLoading={list.query.isLoading}
        isError={list.query.isError}
        errorMessage={t('load_failed', 'Failed to load users')}
        emptyMessage={t('no_users_found', 'No users found')}
        onRowSelect={setSelectedUser}
        rowLabel={(user) => user.name}
      />

      <SlideOver
        open={selectedUser !== null}
        onClose={closePanel}
        closeLabel={t('close_panel', 'Close panel')}
        title={selectedUser?.name ?? ''}
        subtitle={selectedUser?.email}
        icon={
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-neutral-600 text-sm font-bold text-warning-500">
            {initials(selectedUser?.name ?? '')}
          </div>
        }
      >
        {selectedUser && (
          <div className="space-y-6">
            <DetailSection title={t('profile', 'Profile')}>
              <div className="grid grid-cols-2 gap-3">
                <DetailField label={t('col_role', 'Role')}>
                  <StatusBadge
                    className={ROLE_BADGE[selectedUser.role]}
                    label={t(`role_${selectedUser.role}`, selectedUser.role)}
                  />
                </DetailField>
                <DetailField label={t('col_phone', 'Phone')}>
                  {selectedUser.phone ?? '-'}
                </DetailField>
                <DetailField label={t('col_joined', 'Joined')}>
                  {formatDateShort(selectedUser.createdAt)}
                </DetailField>
                <DetailField label={t('col_status', 'Status')}>
                  {selectedUser.isVerified ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-success-500">
                      <CheckCircle className="h-3.5 w-3.5" /> {t('verified', 'Verified')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 font-semibold text-error-500">
                      <UserX className="h-3.5 w-3.5" /> {t('suspended', 'Suspended')}
                    </span>
                  )}
                </DetailField>
              </div>
            </DetailSection>

            {selectedUser.role === 'talent' && (
              <TalentSections
                detail={talentDetail}
                isLoading={talentDetailQuery.isLoading}
                isError={talentDetailQuery.isError}
              />
            )}

            <DetailSection title={t('admin_actions', 'Admin Actions')}>
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
            </DetailSection>
          </div>
        )}
      </SlideOver>
    </div>
  )
}

function TalentSections({
  detail,
  isLoading,
  isError,
}: {
  detail: TalentDetail | undefined
  isLoading: boolean
  isError: boolean
}) {
  const { t } = useTranslation('admin')

  if (isLoading) {
    return (
      <div className="rounded-lg border border-neutral-600/30 bg-neutral-600 p-4">
        <div className="h-4 w-32 animate-pulse rounded bg-primary-700/60" />
        <div className="mt-3 h-20 animate-pulse rounded bg-primary-700/40" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-error-500/30 bg-neutral-600 p-4">
        <p className="text-xs text-error-500">{t('load_failed', 'Failed to load data')}</p>
      </div>
    )
  }

  const profile = detail?.profile
  if (!profile || !detail) return null

  return (
    <>
      <DetailSection title={t('talent_profile', 'Talent Profile')}>
        <div className="grid grid-cols-2 gap-3">
          <DetailField label={t('tier', 'Tier (Internal)')}>
            <span className="font-medium uppercase text-neutral-200">{profile.tier}</span>
          </DetailField>
          <DetailField label={t('experience', 'Experience')}>
            <span className="text-neutral-200">
              {profile.yearsOfExperience} {t('years', 'years')}
            </span>
          </DetailField>
          <DetailField label={t('projects_done', 'Completed')}>
            <span className="text-neutral-200">{profile.totalProjectsCompleted}</span>
          </DetailField>
          <DetailField label={t('projects_active', 'Active')}>
            <span className="text-neutral-200">{profile.totalProjectsActive}</span>
          </DetailField>
          <DetailField label={t('avg_rating', 'Average Rating')}>
            <span className="text-neutral-200">
              {profile.averageRating != null ? profile.averageRating.toFixed(2) : '-'}
            </span>
          </DetailField>
          <DetailField label={t('verification_status', 'Verification')}>
            <span className="capitalize text-neutral-200">
              {profile.verificationStatus.replace(/_/g, ' ')}
            </span>
          </DetailField>
          {profile.educationUniversity && (
            <DetailField label={t('education', 'Education')} className="col-span-2">
              <span className="text-neutral-200">
                {profile.educationUniversity}
                {profile.educationMajor ? ` — ${profile.educationMajor}` : ''}
                {profile.educationYear ? ` (${profile.educationYear})` : ''}
              </span>
            </DetailField>
          )}
          {profile.location && (
            <DetailField label={t('location', 'Location')}>
              <span className="text-neutral-200">{profile.location}</span>
            </DetailField>
          )}
        </div>
        {profile.bio && <p className="mt-3 text-sm text-neutral-300">{profile.bio}</p>}
      </DetailSection>

      <DetailSection title={t('skills', 'Skills')}>
        {detail.skills.length === 0 ? (
          <p className="text-xs text-neutral-300">-</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {detail.skills.map((s) => (
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
      </DetailSection>

      <DetailSection title={t('project_history', 'Project History')}>
        {detail.projectHistory.length === 0 ? (
          <p className="text-xs text-neutral-300">-</p>
        ) : (
          <ul className="space-y-2">
            {detail.projectHistory.map((h) => (
              <li
                key={h.assignmentId}
                className="rounded-md border border-primary-700/40 bg-primary-800 px-3 py-2"
              >
                <p className="text-sm font-medium text-neutral-200">{h.projectTitle}</p>
                <p className="mt-0.5 text-xs text-neutral-300">
                  {h.roleLabel ?? h.workPackageTitle ?? '-'} ·{' '}
                  <span className="capitalize">{h.assignmentStatus.replace(/_/g, ' ')}</span> ·{' '}
                  <span className="capitalize">{h.projectStatus.replace(/_/g, ' ')}</span>
                </p>
                <p className="mt-0.5 text-xs text-neutral-400">
                  {formatDateShort(h.startedAt ?? h.createdAt)}
                  {h.completedAt ? ` → ${formatDateShort(h.completedAt)}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </DetailSection>

      {detail.penalties.length > 0 && (
        <DetailSection tone="danger" title={t('penalty_history', 'Penalty History')}>
          <ul className="space-y-2">
            {detail.penalties.map((p) => (
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
        </DetailSection>
      )}
    </>
  )
}
