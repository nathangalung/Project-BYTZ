import { ArrowRight, FileCheck, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SelectedPath } from './shared'

export function PathChooser({ onSelect }: { onSelect: (path: SelectedPath) => void }) {
  const { t } = useTranslation('project')

  return (
    <div className="grid gap-5 md:grid-cols-2">
      {/* Path A: Already have specs */}
      <button
        type="button"
        onClick={() => onSelect('A')}
        className="group rounded-3xl border-2 border-outline-dim/20 bg-surface-bright p-7 text-left transition-all hover:border-brand-accent/30 hover:bg-brand-accent/5"
      >
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-accent/10 transition-transform group-hover:scale-110">
          <FileCheck className="h-6 w-6 text-brand-text" />
        </div>
        <h4 className="mb-2 text-base font-extrabold text-on-surface">{t('path_a_title')}</h4>
        <p className="text-xs leading-relaxed text-on-surface-muted">{t('path_a_description')}</p>
        <div className="mt-5 flex items-center gap-1.5 text-xs font-bold text-brand-text">
          {t('path_a_action')}
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
        </div>
      </button>

      {/* Path B: No specs yet — AI helps */}
      <button
        type="button"
        onClick={() => onSelect('B')}
        className="group relative overflow-hidden rounded-3xl border-2 border-transparent bg-brand p-7 text-left shadow-xl transition-all hover:opacity-95"
      >
        <div className="pointer-events-none absolute -bottom-8 -right-8 h-32 w-32 rounded-full bg-accent-coral-500/20 blur-2xl" />
        <div className="relative z-10">
          <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-bright/20 transition-transform group-hover:scale-110">
            <Sparkles className="h-6 w-6 text-accent-coral-500" />
          </div>
          <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-accent-coral-600 px-2 py-0.5 text-[9px] font-black uppercase text-white">
            {t('path_b_badge')}
          </div>
          <h4 className="mb-2 text-base font-extrabold text-white">{t('path_b_title')}</h4>
          <p className="text-xs leading-relaxed text-white/70">{t('path_b_description')}</p>
          <div className="mt-5 flex items-center gap-1.5 text-xs font-bold text-primary-100">
            {t('path_b_action')}
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
          </div>
        </div>
      </button>
    </div>
  )
}

/* ── Path A: 4-step project form ── */
