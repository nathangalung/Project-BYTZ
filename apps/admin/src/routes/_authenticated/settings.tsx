import {
  AUTO_RELEASE_DAYS,
  EXPLORATION_RATE,
  FREE_MILESTONE_REVISIONS,
  MATCHING_WEIGHTS,
  MAX_TEAM_SIZE,
  PLATFORM_FEE_BRACKETS,
  PLATFORM_FEE_TOP_BRACKET,
} from '@kerjacus/shared'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Clock, Globe, Percent, RefreshCw, Settings, Target, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/_authenticated/settings')({
  component: AdminSettingsPage,
})

type PlatformSetting = {
  id: string
  key: string
  value: unknown
  description: string | null
  updatedBy: string | null
  updatedAt: string | null
}

type SettingsResponse = { success: boolean; data: PlatformSetting[] }

async function fetchSettings(): Promise<SettingsResponse> {
  const res = await fetch('/api/v1/admin/settings', { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch settings')
  return res.json()
}

type FeeBracket = { maxFee: number; talentShare: number; feeRate: number }
type FeeBracketSetting = {
  brackets: FeeBracket[]
  topBracket: { talentShare: number; feeRate: number }
}

// Shown when the setting row is missing. Read off pricing.ts rather than
// retyped, so the published table cannot drift from the engine.
const FALLBACK_FEE_BRACKETS: FeeBracketSetting = {
  brackets: PLATFORM_FEE_BRACKETS.map((b) => ({
    maxFee: b.maxFee,
    talentShare: b.talentShare,
    feeRate: b.feeRate,
  })),
  topBracket: {
    talentShare: PLATFORM_FEE_TOP_BRACKET.talentShare,
    feeRate: PLATFORM_FEE_TOP_BRACKET.feeRate,
  },
}

function readFeeBrackets(setting: PlatformSetting | undefined): FeeBracketSetting {
  const v = setting?.value as Partial<FeeBracketSetting> | undefined
  if (v && Array.isArray(v.brackets) && v.brackets.length > 0 && v.topBracket) {
    return { brackets: v.brackets, topBracket: v.topBracket }
  }
  return FALLBACK_FEE_BRACKETS
}

function formatJt(amount: number): string {
  return `Rp ${Math.round(amount / 1000000)} jt`
}

function indexByKey(settings: PlatformSetting[]): Record<string, PlatformSetting> {
  const out: Record<string, PlatformSetting> = {}
  for (const s of settings) out[s.key] = s
  return out
}

/**
 * Everything on this page except the language toggle is READ-ONLY, and the
 * values come from the compiled constants rather than from platform_settings.
 *
 * Five controls here used to write matching_weights, exploration_rate,
 * auto_release_days, free_revision_rounds and max_team_size to that table, and
 * nothing at runtime ever read it: the engines read packages/shared/constants.
 * The console showed what it had stored and the platform behaved by the code,
 * so an operator could lower the auto-release window, watch it save, and see
 * milestones release on the old number for the rest of the year.
 *
 * Worse than silent: admin-service wrote an admin_audit_logs row of type
 * config.update for each one, so the audit trail recorded policy changes that
 * never took effect.
 *
 * Read-only is the same answer the fee bracket table already got, for the same
 * reason. The alternative - making the engines read the table - needs a cache,
 * a fallback for a missing row and invalidation across replicas, and it is a
 * feature rather than a fix. Until somebody builds it, these five levers are
 * code, and the console now says so.
 */
function AdminSettingsPage() {
  const { t, i18n } = useTranslation('admin')

  const settingsQuery = useQuery({ queryKey: ['admin-settings'], queryFn: fetchSettings })

  const toggleLanguage = () => {
    const next = i18n.language === 'id' ? 'en' : 'id'
    i18n.changeLanguage(next)
  }

  const loading = settingsQuery.isLoading
  const errored = settingsQuery.isError

  const engineValues: { icon: React.ReactNode; label: string; value: string; note: string }[] = [
    {
      icon: <Target className="h-4 w-4 text-warning-500" />,
      label: t('matching_weights', 'Matching Weights'),
      value: [
        `${t('weight_skill', 'Skill match')} ${Math.round(MATCHING_WEIGHTS.SKILL_MATCH * 100)}%`,
        `${t('weight_pemerataan', 'Distribution')} ${Math.round(MATCHING_WEIGHTS.PEMERATAAN * 100)}%`,
        `${t('weight_track', 'Track record')} ${Math.round(MATCHING_WEIGHTS.TRACK_RECORD * 100)}%`,
        `${t('weight_rating', 'Rating')} ${Math.round(MATCHING_WEIGHTS.RATING * 100)}%`,
      ].join(' | '),
      note: t('matching_weights_desc', 'Algorithm weights for talent-project matching'),
    },
    {
      icon: <Percent className="h-4 w-4 text-warning-500" />,
      label: t('exploration_rate', 'Exploration Rate'),
      value: `${Math.round(EXPLORATION_RATE * 100)}%`,
      note: t('exploration_desc', 'Share of slots reserved for new talent'),
    },
    {
      icon: <Clock className="h-4 w-4 text-warning-500" />,
      label: t('auto_release', 'Auto-Release Days'),
      value: String(AUTO_RELEASE_DAYS),
      note: t('auto_release_desc', 'Days before escrow releases without owner action'),
    },
    {
      icon: <RefreshCw className="h-4 w-4 text-warning-500" />,
      label: t('free_revisions', 'Free Revision Rounds'),
      value: String(FREE_MILESTONE_REVISIONS),
      note: t('free_revisions_desc', 'Revisions per milestone before fees'),
    },
    {
      icon: <Users className="h-4 w-4 text-warning-500" />,
      label: t('max_team_size', 'Max Team Size'),
      value: String(MAX_TEAM_SIZE),
      note: t('max_team_desc', 'Maximum talents per project'),
    },
  ]

  return (
    <div className="min-h-screen bg-primary-600 p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-warning-500">{t('nav_settings', 'Settings')}</h1>
        <p className="mt-1 text-sm text-neutral-300">
          {t('settings_desc', 'Platform configuration and preferences')}
        </p>
        {loading && <p className="mt-2 text-xs text-neutral-300">{t('loading', 'Loading...')}</p>}
        {errored && (
          <p className="mt-2 text-xs text-error-500">{t('load_failed', 'Failed to load data')}</p>
        )}
      </div>

      <div className="max-w-3xl space-y-6">
        <div className="rounded-xl border border-neutral-600/30 bg-neutral-600 p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary-700 p-2.5">
              <Globe className="h-5 w-5 text-warning-500" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-neutral-200">{t('language', 'Language')}</p>
              <p className="text-sm text-neutral-300">
                {i18n.language === 'id' ? 'Bahasa Indonesia' : 'English'}
              </p>
            </div>
            <button
              type="button"
              onClick={toggleLanguage}
              className="rounded-lg border border-neutral-600/50 px-4 py-2 text-sm font-medium text-neutral-300 hover:bg-primary-700"
            >
              {i18n.language === 'id' ? 'Switch to English' : 'Ganti ke Bahasa Indonesia'}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-neutral-600/30 bg-neutral-600 p-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="rounded-lg bg-primary-700 p-2.5">
              <Percent className="h-5 w-5 text-warning-500" />
            </div>
            <div>
              <p className="font-medium text-neutral-200">
                {t('fee_brackets', 'Platform Fee Brackets')}
              </p>
              <p className="text-sm text-neutral-300">
                {t(
                  'fee_brackets_desc',
                  'How each project fee splits between talent and platform, fixed in the pricing engine (read-only)',
                )}
              </p>
            </div>
          </div>
          {(() => {
            const brackets = readFeeBrackets(
              indexByKey(settingsQuery.data?.data ?? []).platform_fee_brackets,
            )
            return (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-600/40 text-left text-xs text-neutral-300">
                    <th className="py-2 font-medium">{t('bracket_fee', 'Project fee')}</th>
                    <th className="py-2 text-right font-medium">{t('bracket_talent', 'Talent')}</th>
                    <th className="py-2 text-right font-medium">{t('bracket_take', 'Platform')}</th>
                  </tr>
                </thead>
                <tbody>
                  {brackets.brackets.map((b) => (
                    <tr key={b.maxFee} className="border-b border-neutral-600/20">
                      <td className="py-2 text-neutral-200">{`<= ${formatJt(b.maxFee)}`}</td>
                      <td className="py-2 text-right text-neutral-200">
                        {(b.talentShare * 100).toFixed(1)}%
                      </td>
                      <td className="py-2 text-right text-warning-500">
                        {(b.feeRate * 100).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="py-2 text-neutral-200">
                      {`> ${formatJt(brackets.brackets[brackets.brackets.length - 1].maxFee)}`}
                    </td>
                    <td className="py-2 text-right text-neutral-200">
                      {(brackets.topBracket.talentShare * 100).toFixed(1)}%
                    </td>
                    <td className="py-2 text-right text-warning-500">
                      {(brackets.topBracket.feeRate * 100).toFixed(1)}%
                    </td>
                  </tr>
                </tbody>
              </table>
            )
          })()}
        </div>

        <div className="rounded-xl border border-neutral-600/30 bg-neutral-600 p-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="rounded-lg bg-primary-700 p-2.5">
              <Settings className="h-5 w-5 text-warning-500" />
            </div>
            <div>
              <p className="font-medium text-neutral-200">
                {t('engine_settings', 'Engine Settings')}
              </p>
              <p className="text-sm text-neutral-300">
                {t(
                  'engine_settings_desc',
                  'The values the platform actually runs on, compiled into the services (read-only)',
                )}
              </p>
            </div>
          </div>

          <dl className="space-y-4">
            {engineValues.map((row) => (
              <div
                key={row.label}
                className="flex items-start justify-between gap-6 border-b border-neutral-600/20 pb-3 last:border-b-0 last:pb-0"
              >
                <div>
                  <dt className="flex items-center gap-2 text-sm text-neutral-200">
                    {row.icon}
                    {row.label}
                  </dt>
                  <p className="mt-1 text-xs text-neutral-300">{row.note}</p>
                </div>
                <dd className="shrink-0 text-right text-sm font-medium text-warning-500">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>

          <p className="mt-5 text-xs text-neutral-300">
            {t(
              'engine_settings_note',
              'Changing these needs a deploy. They were editable here once and nothing read the saved values.',
            )}
          </p>
        </div>
      </div>
    </div>
  )
}
