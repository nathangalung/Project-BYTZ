import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import {
  Clock,
  Globe,
  Percent,
  RefreshCw,
  RotateCcw,
  Save,
  Settings,
  Target,
  Users,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'

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

async function patchSetting(input: { key: string; value: unknown; adminId: string }) {
  const res = await fetch(`/api/v1/admin/settings/${encodeURIComponent(input.key)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: input.value, adminId: input.adminId }),
  })
  if (!res.ok) throw new Error(`Failed to save ${input.key}`)
  return res.json()
}

type MarginRange = { min: number; max: number }
type MatchingWeights = {
  skill_match: number
  pemerataan: number
  track_record: number
  rating: number
}

const MARGIN_KEYS = {
  below10m: 'margin_rate_below_10m',
  range10to50m: 'margin_rate_10m_50m',
  range50to100m: 'margin_rate_50m_100m',
  above100m: 'margin_rate_above_100m',
} as const

function readMarginPercent(setting: PlatformSetting | undefined, fallback: number): number {
  if (!setting) return fallback
  const v = setting.value as MarginRange | number
  if (typeof v === 'number') return Math.round(v * 100)
  if (typeof v === 'object' && v !== null && 'min' in v) return Math.round(v.min * 100)
  return fallback
}

function readNumber(setting: PlatformSetting | undefined, fallback: number): number {
  if (!setting) return fallback
  return typeof setting.value === 'number' ? setting.value : fallback
}

function readWeights(setting: PlatformSetting | undefined): MatchingWeights {
  const fallback: MatchingWeights = {
    skill_match: 30,
    pemerataan: 35,
    track_record: 20,
    rating: 15,
  }
  if (!setting) return fallback
  const v = setting.value as Partial<MatchingWeights>
  return {
    skill_match: v.skill_match ?? fallback.skill_match,
    pemerataan: v.pemerataan ?? fallback.pemerataan,
    track_record: v.track_record ?? fallback.track_record,
    rating: v.rating ?? fallback.rating,
  }
}

function indexByKey(settings: PlatformSetting[]): Record<string, PlatformSetting> {
  const out: Record<string, PlatformSetting> = {}
  for (const s of settings) out[s.key] = s
  return out
}

function AdminSettingsPage() {
  const { t, i18n } = useTranslation('admin')
  const queryClient = useQueryClient()
  const adminId = useAuthStore((s) => s.user?.id ?? '')

  const settingsQuery = useQuery({ queryKey: ['admin-settings'], queryFn: fetchSettings })

  const [margins, setMargins] = useState({
    below10m: 27,
    range10to50m: 22,
    range50to100m: 17,
    above100m: 12,
  })
  const [weights, setWeights] = useState<MatchingWeights>({
    skill_match: 30,
    pemerataan: 35,
    track_record: 20,
    rating: 15,
  })
  const [explorationRate, setExplorationRate] = useState(30)
  const [autoReleaseDays, setAutoReleaseDays] = useState(14)
  const [freeRevisions, setFreeRevisions] = useState(2)
  const [maxTeamSize, setMaxTeamSize] = useState(8)

  useEffect(() => {
    const data = settingsQuery.data?.data
    if (!data) return
    const byKey = indexByKey(data)
    setMargins({
      below10m: readMarginPercent(byKey[MARGIN_KEYS.below10m], 27),
      range10to50m: readMarginPercent(byKey[MARGIN_KEYS.range10to50m], 22),
      range50to100m: readMarginPercent(byKey[MARGIN_KEYS.range50to100m], 17),
      above100m: readMarginPercent(byKey[MARGIN_KEYS.above100m], 12),
    })
    setWeights(readWeights(byKey.matching_weights))
    setExplorationRate(Math.round(readNumber(byKey.exploration_rate, 0.3) * 100))
    setAutoReleaseDays(readNumber(byKey.auto_release_days, 14))
    setFreeRevisions(readNumber(byKey.free_revision_rounds, 2))
    setMaxTeamSize(readNumber(byKey.max_team_size, 8))
  }, [settingsQuery.data])

  const saveMutation = useMutation({
    mutationFn: patchSetting,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-settings'] })
    },
  })

  const toggleLanguage = () => {
    const next = i18n.language === 'id' ? 'en' : 'id'
    i18n.changeLanguage(next)
  }

  async function handleSaveMargins() {
    if (!adminId) return
    const writes: Array<{ key: string; value: unknown }> = [
      {
        key: MARGIN_KEYS.below10m,
        value: { min: margins.below10m / 100, max: margins.below10m / 100 },
      },
      {
        key: MARGIN_KEYS.range10to50m,
        value: { min: margins.range10to50m / 100, max: margins.range10to50m / 100 },
      },
      {
        key: MARGIN_KEYS.range50to100m,
        value: { min: margins.range50to100m / 100, max: margins.range50to100m / 100 },
      },
      {
        key: MARGIN_KEYS.above100m,
        value: { min: margins.above100m / 100, max: margins.above100m / 100 },
      },
    ]
    for (const w of writes) await saveMutation.mutateAsync({ ...w, adminId })
  }

  async function handleSaveWeights() {
    if (!adminId) return
    await saveMutation.mutateAsync({ key: 'matching_weights', value: weights, adminId })
  }

  async function handleSavePlatform() {
    if (!adminId) return
    const writes: Array<{ key: string; value: unknown }> = [
      { key: 'exploration_rate', value: explorationRate / 100 },
      { key: 'auto_release_days', value: autoReleaseDays },
      { key: 'free_revision_rounds', value: freeRevisions },
      { key: 'max_team_size', value: maxTeamSize },
    ]
    for (const w of writes) await saveMutation.mutateAsync({ ...w, adminId })
  }

  const weightsTotal =
    weights.skill_match + weights.pemerataan + weights.track_record + weights.rating
  const weightsValid = weightsTotal === 100
  const saving = saveMutation.isPending
  const loading = settingsQuery.isLoading
  const errored = settingsQuery.isError

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
        {saveMutation.isError && (
          <p className="mt-2 text-xs text-error-500">
            {t('action_failed', 'Action failed. Try again.')}
          </p>
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
              <p className="font-medium text-neutral-200">{t('margin_rates', 'Margin Rates')}</p>
              <p className="text-sm text-neutral-300">
                {t('margin_rates_desc', 'Platform margin per project value tier')}
              </p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs text-neutral-300" htmlFor="margin-below10">
                {t('below_10m', 'Below Rp 10 jt')} (25-30%)
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="margin-below10"
                  type="number"
                  value={margins.below10m}
                  onChange={(e) => setMargins({ ...margins, below10m: Number(e.target.value) })}
                  min={0}
                  max={50}
                  className="w-full rounded-lg border border-neutral-600/30 bg-primary-700 px-3 py-2 text-sm text-neutral-200 focus:border-success-500/50 focus:outline-none"
                />
                <span className="text-sm text-neutral-300">%</span>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-neutral-300" htmlFor="margin-10to50">
                {t('range_10_50m', 'Rp 10 - 50 jt')} (20-25%)
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="margin-10to50"
                  type="number"
                  value={margins.range10to50m}
                  onChange={(e) => setMargins({ ...margins, range10to50m: Number(e.target.value) })}
                  min={0}
                  max={50}
                  className="w-full rounded-lg border border-neutral-600/30 bg-primary-700 px-3 py-2 text-sm text-neutral-200 focus:border-success-500/50 focus:outline-none"
                />
                <span className="text-sm text-neutral-300">%</span>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-neutral-300" htmlFor="margin-50to100">
                {t('range_50_100m', 'Rp 50 - 100 jt')} (15-20%)
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="margin-50to100"
                  type="number"
                  value={margins.range50to100m}
                  onChange={(e) =>
                    setMargins({ ...margins, range50to100m: Number(e.target.value) })
                  }
                  min={0}
                  max={50}
                  className="w-full rounded-lg border border-neutral-600/30 bg-primary-700 px-3 py-2 text-sm text-neutral-200 focus:border-success-500/50 focus:outline-none"
                />
                <span className="text-sm text-neutral-300">%</span>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-neutral-300" htmlFor="margin-above100">
                {t('above_100m', 'Above Rp 100 jt')} (10-15%)
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="margin-above100"
                  type="number"
                  value={margins.above100m}
                  onChange={(e) => setMargins({ ...margins, above100m: Number(e.target.value) })}
                  min={0}
                  max={50}
                  className="w-full rounded-lg border border-neutral-600/30 bg-primary-700 px-3 py-2 text-sm text-neutral-200 focus:border-success-500/50 focus:outline-none"
                />
                <span className="text-sm text-neutral-300">%</span>
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={handleSaveMargins}
              disabled={saving || !adminId}
              className="inline-flex items-center gap-2 rounded-lg bg-success-500 px-4 py-2 text-sm font-semibold text-primary-800 hover:bg-success-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? t('processing', 'Processing...') : t('save', 'Save')}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-neutral-600/30 bg-neutral-600 p-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="rounded-lg bg-primary-700 p-2.5">
              <Target className="h-5 w-5 text-warning-500" />
            </div>
            <div>
              <p className="font-medium text-neutral-200">
                {t('matching_weights', 'Matching Weights')}
              </p>
              <p className="text-sm text-neutral-300">
                {t('matching_weights_desc', 'Algorithm weights for talent-project matching')}
              </p>
            </div>
          </div>

          <div className="space-y-5">
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-sm text-neutral-300" htmlFor="weight-skill">
                  {t('skill_match', 'Skill Match')}
                </label>
                <span className="text-sm font-semibold text-warning-500">
                  {weights.skill_match}%
                </span>
              </div>
              <input
                id="weight-skill"
                type="range"
                min={0}
                max={100}
                value={weights.skill_match}
                onChange={(e) => setWeights({ ...weights, skill_match: Number(e.target.value) })}
                className="w-full accent-success-500"
              />
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-sm text-neutral-300" htmlFor="weight-pemerataan">
                  {t('pemerataan', 'Pemerataan (Fairness)')}
                </label>
                <span className="text-sm font-semibold text-warning-500">
                  {weights.pemerataan}%
                </span>
              </div>
              <input
                id="weight-pemerataan"
                type="range"
                min={0}
                max={100}
                value={weights.pemerataan}
                onChange={(e) => setWeights({ ...weights, pemerataan: Number(e.target.value) })}
                className="w-full accent-success-500"
              />
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-sm text-neutral-300" htmlFor="weight-track">
                  {t('track_record', 'Track Record')}
                </label>
                <span className="text-sm font-semibold text-warning-500">
                  {weights.track_record}%
                </span>
              </div>
              <input
                id="weight-track"
                type="range"
                min={0}
                max={100}
                value={weights.track_record}
                onChange={(e) => setWeights({ ...weights, track_record: Number(e.target.value) })}
                className="w-full accent-success-500"
              />
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-sm text-neutral-300" htmlFor="weight-rating">
                  {t('rating_weight', 'Rating')}
                </label>
                <span className="text-sm font-semibold text-warning-500">{weights.rating}%</span>
              </div>
              <input
                id="weight-rating"
                type="range"
                min={0}
                max={100}
                value={weights.rating}
                onChange={(e) => setWeights({ ...weights, rating: Number(e.target.value) })}
                className="w-full accent-success-500"
              />
            </div>
          </div>

          <div
            className={cn(
              'mt-4 rounded-lg px-4 py-2 text-center text-sm font-semibold',
              weightsValid
                ? 'bg-success-500/10 text-success-500'
                : 'bg-error-500/10 text-error-500',
            )}
          >
            {t('total_weights', 'Total')}: {weightsTotal}%{' '}
            {weightsValid ? '' : `(${t('must_equal_100', 'must equal 100%')})`}
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() =>
                setWeights({ skill_match: 30, pemerataan: 35, track_record: 20, rating: 15 })
              }
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-600/50 px-4 py-2 text-sm font-medium text-neutral-300 hover:bg-primary-700"
            >
              <RotateCcw className="h-4 w-4" />
              {t('reset_defaults', 'Reset Defaults')}
            </button>
            <button
              type="button"
              onClick={handleSaveWeights}
              disabled={!weightsValid || saving || !adminId}
              className="inline-flex items-center gap-2 rounded-lg bg-success-500 px-4 py-2 text-sm font-semibold text-primary-800 hover:bg-success-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? t('processing', 'Processing...') : t('save', 'Save')}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-neutral-600/30 bg-neutral-600 p-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="rounded-lg bg-primary-700 p-2.5">
              <Settings className="h-5 w-5 text-warning-500" />
            </div>
            <div>
              <p className="font-medium text-neutral-200">
                {t('platform_config', 'Platform Configuration')}
              </p>
              <p className="text-sm text-neutral-300">
                {t('platform_config_desc', 'Core platform settings')}
              </p>
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-sm text-neutral-300" htmlFor="exploration-rate">
                  {t('exploration_rate', 'Exploration Rate')}
                </label>
                <span className="text-sm font-semibold text-warning-500">{explorationRate}%</span>
              </div>
              <input
                id="exploration-rate"
                type="range"
                min={0}
                max={100}
                value={explorationRate}
                onChange={(e) => setExplorationRate(Number(e.target.value))}
                className="w-full accent-success-500"
              />
              <p className="mt-1 text-xs text-neutral-300">
                {t('exploration_desc', '% of matching slots for new talents')}
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm text-neutral-300" htmlFor="auto-release">
                <Clock className="mr-1.5 inline h-3.5 w-3.5" />
                {t('auto_release_days', 'Auto-Release Timer')}
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="auto-release"
                  type="number"
                  value={autoReleaseDays}
                  onChange={(e) => setAutoReleaseDays(Number(e.target.value))}
                  min={1}
                  max={30}
                  className="w-full rounded-lg border border-neutral-600/30 bg-primary-700 px-3 py-2 text-sm text-neutral-200 focus:border-success-500/50 focus:outline-none"
                />
                <span className="text-sm text-neutral-300">{t('days_unit', 'days')}</span>
              </div>
              <p className="mt-1 text-xs text-neutral-300">
                {t('auto_release_desc', 'Days before auto-releasing escrow')}
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm text-neutral-300" htmlFor="free-revisions">
                <RefreshCw className="mr-1.5 inline h-3.5 w-3.5" />
                {t('free_revisions', 'Free Revision Rounds')}
              </label>
              <input
                id="free-revisions"
                type="number"
                value={freeRevisions}
                onChange={(e) => setFreeRevisions(Number(e.target.value))}
                min={0}
                max={10}
                className="w-full rounded-lg border border-neutral-600/30 bg-primary-700 px-3 py-2 text-sm text-neutral-200 focus:border-success-500/50 focus:outline-none"
              />
              <p className="mt-1 text-xs text-neutral-300">
                {t('free_revisions_desc', 'Revisions per milestone before fees')}
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm text-neutral-300" htmlFor="max-team">
                <Users className="mr-1.5 inline h-3.5 w-3.5" />
                {t('max_team_size', 'Max Team Size')}
              </label>
              <input
                id="max-team"
                type="number"
                value={maxTeamSize}
                onChange={(e) => setMaxTeamSize(Number(e.target.value))}
                min={1}
                max={20}
                className="w-full rounded-lg border border-neutral-600/30 bg-primary-700 px-3 py-2 text-sm text-neutral-200 focus:border-success-500/50 focus:outline-none"
              />
              <p className="mt-1 text-xs text-neutral-300">
                {t('max_team_desc', 'Maximum talents per project')}
              </p>
            </div>
          </div>

          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={handleSavePlatform}
              disabled={saving || !adminId}
              className="inline-flex items-center gap-2 rounded-lg bg-success-500 px-4 py-2 text-sm font-semibold text-primary-800 hover:bg-success-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? t('processing', 'Processing...') : t('save', 'Save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
