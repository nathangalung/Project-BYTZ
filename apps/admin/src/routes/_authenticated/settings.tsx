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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/settings')({
  component: AdminSettingsPage,
})

function AdminSettingsPage() {
  const { t, i18n } = useTranslation('admin')

  // Margin rates
  const [margins, setMargins] = useState({
    below10m: 27,
    range10to50m: 22,
    range50to100m: 17,
    above100m: 12,
  })

  // Matching weights
  const [weights, setWeights] = useState({
    skillMatch: 30,
    pemerataan: 35,
    trackRecord: 20,
    rating: 15,
  })

  // Platform config
  const [explorationRate, setExplorationRate] = useState(30)
  const [autoReleaseDays, setAutoReleaseDays] = useState(14)
  const [freeRevisions, setFreeRevisions] = useState(2)
  const [maxTeamSize, setMaxTeamSize] = useState(8)

  const toggleLanguage = () => {
    const next = i18n.language === 'id' ? 'en' : 'id'
    i18n.changeLanguage(next)
  }

  function handleSaveMargins() {
    console.log('Save margins:', margins)
  }

  function handleSaveWeights() {
    console.log('Save weights:', weights)
  }

  function handleSavePlatform() {
    console.log('Save platform config:', {
      explorationRate,
      autoReleaseDays,
      freeRevisions,
      maxTeamSize,
    })
  }

  const weightsTotal =
    weights.skillMatch + weights.pemerataan + weights.trackRecord + weights.rating
  const weightsValid = weightsTotal === 100

  return (
    <div className="min-h-screen bg-primary-600 p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-warning-500">{t('nav_settings', 'Settings')}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {t('settings_desc', 'Platform configuration and preferences')}
        </p>
      </div>

      <div className="max-w-3xl space-y-6">
        {/* Language */}
        <div className="rounded-xl border border-neutral-600/30 bg-neutral-600 p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary-700 p-2.5">
              <Globe className="h-5 w-5 text-warning-500" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-neutral-200">{t('language', 'Language')}</p>
              <p className="text-sm text-neutral-500">
                {i18n.language === 'id' ? 'Bahasa Indonesia' : 'English'}
              </p>
            </div>
            <button
              type="button"
              onClick={toggleLanguage}
              className="rounded-lg border border-neutral-600/50 px-4 py-2 text-sm font-medium text-neutral-400 hover:bg-primary-700"
            >
              {i18n.language === 'id' ? 'Switch to English' : 'Ganti ke Bahasa Indonesia'}
            </button>
          </div>
        </div>

        {/* Margin rates */}
        <div className="rounded-xl border border-neutral-600/30 bg-neutral-600 p-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="rounded-lg bg-primary-700 p-2.5">
              <Percent className="h-5 w-5 text-warning-500" />
            </div>
            <div>
              <p className="font-medium text-neutral-200">{t('margin_rates', 'Margin Rates')}</p>
              <p className="text-sm text-neutral-500">
                {t('margin_rates_desc', 'Platform margin per project value tier')}
              </p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs text-neutral-500" htmlFor="margin-below10">
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
                <span className="text-sm text-neutral-500">%</span>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-neutral-500" htmlFor="margin-10to50">
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
                <span className="text-sm text-neutral-500">%</span>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-neutral-500" htmlFor="margin-50to100">
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
                <span className="text-sm text-neutral-500">%</span>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-neutral-500" htmlFor="margin-above100">
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
                <span className="text-sm text-neutral-500">%</span>
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={handleSaveMargins}
              className="inline-flex items-center gap-2 rounded-lg bg-success-500 px-4 py-2 text-sm font-semibold text-primary-800 hover:bg-success-600"
            >
              <Save className="h-4 w-4" />
              {t('save', 'Save')}
            </button>
          </div>
        </div>

        {/* Matching weights */}
        <div className="rounded-xl border border-neutral-600/30 bg-neutral-600 p-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="rounded-lg bg-primary-700 p-2.5">
              <Target className="h-5 w-5 text-warning-500" />
            </div>
            <div>
              <p className="font-medium text-neutral-200">
                {t('matching_weights', 'Matching Weights')}
              </p>
              <p className="text-sm text-neutral-500">
                {t('matching_weights_desc', 'Algorithm weights for worker-project matching')}
              </p>
            </div>
          </div>

          <div className="space-y-5">
            {/* Skill match */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-sm text-neutral-300" htmlFor="weight-skill">
                  {t('skill_match', 'Skill Match')}
                </label>
                <span className="text-sm font-semibold text-warning-500">
                  {weights.skillMatch}%
                </span>
              </div>
              <input
                id="weight-skill"
                type="range"
                min={0}
                max={100}
                value={weights.skillMatch}
                onChange={(e) => setWeights({ ...weights, skillMatch: Number(e.target.value) })}
                className="w-full accent-success-500"
              />
            </div>
            {/* Pemerataan */}
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
            {/* Track record */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-sm text-neutral-300" htmlFor="weight-track">
                  {t('track_record', 'Track Record')}
                </label>
                <span className="text-sm font-semibold text-warning-500">
                  {weights.trackRecord}%
                </span>
              </div>
              <input
                id="weight-track"
                type="range"
                min={0}
                max={100}
                value={weights.trackRecord}
                onChange={(e) => setWeights({ ...weights, trackRecord: Number(e.target.value) })}
                className="w-full accent-success-500"
              />
            </div>
            {/* Rating */}
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

          {/* Total indicator */}
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
                setWeights({ skillMatch: 30, pemerataan: 35, trackRecord: 20, rating: 15 })
              }
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-600/50 px-4 py-2 text-sm font-medium text-neutral-400 hover:bg-primary-700"
            >
              <RotateCcw className="h-4 w-4" />
              {t('reset_defaults', 'Reset Defaults')}
            </button>
            <button
              type="button"
              onClick={handleSaveWeights}
              disabled={!weightsValid}
              className="inline-flex items-center gap-2 rounded-lg bg-success-500 px-4 py-2 text-sm font-semibold text-primary-800 hover:bg-success-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {t('save', 'Save')}
            </button>
          </div>
        </div>

        {/* Platform configuration */}
        <div className="rounded-xl border border-neutral-600/30 bg-neutral-600 p-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="rounded-lg bg-primary-700 p-2.5">
              <Settings className="h-5 w-5 text-warning-500" />
            </div>
            <div>
              <p className="font-medium text-neutral-200">
                {t('platform_config', 'Platform Configuration')}
              </p>
              <p className="text-sm text-neutral-500">
                {t('platform_config_desc', 'Core platform settings')}
              </p>
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            {/* Exploration rate */}
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
              <p className="mt-1 text-xs text-neutral-500">
                {t('exploration_desc', '% of matching slots for new workers')}
              </p>
            </div>

            {/* Auto-release timer */}
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
                <span className="text-sm text-neutral-500">{t('days_unit', 'days')}</span>
              </div>
              <p className="mt-1 text-xs text-neutral-500">
                {t('auto_release_desc', 'Days before auto-releasing escrow')}
              </p>
            </div>

            {/* Free revision rounds */}
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
              <p className="mt-1 text-xs text-neutral-500">
                {t('free_revisions_desc', 'Revisions per milestone before fees')}
              </p>
            </div>

            {/* Max team size */}
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
              <p className="mt-1 text-xs text-neutral-500">
                {t('max_team_desc', 'Maximum workers per project')}
              </p>
            </div>
          </div>

          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={handleSavePlatform}
              className="inline-flex items-center gap-2 rounded-lg bg-success-500 px-4 py-2 text-sm font-semibold text-primary-800 hover:bg-success-600"
            >
              <Save className="h-4 w-4" />
              {t('save', 'Save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
