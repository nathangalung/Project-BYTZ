import { createFileRoute } from '@tanstack/react-router'
import { Bot, Code, Shield, Target, Users, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiUrl } from '@/lib/api'

export const Route = createFileRoute('/_public/about')({
  component: AboutPage,
})

type PlatformStats = { total: number; completed: number; active: number }

function AboutPage() {
  const { t } = useTranslation('common')
  // Real numbers only; the section hides when stats cannot be fetched.
  const [stats, setStats] = useState<PlatformStats | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    fetch(apiUrl('/api/v1/projects/stats'), { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (res?.success && res.data) setStats(res.data as PlatformStats)
      })
      .catch(() => {})
    return () => ctrl.abort()
  }, [])

  return (
    <div className="bg-surface">
      {/* Hero */}
      <section className="py-20">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <h1 className="text-4xl font-extrabold text-primary-600 lg:text-5xl">
            {t('about_hero_title')}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-on-surface-muted">
            {t('about_hero_desc')}
          </p>
        </div>
      </section>

      {/* What we do */}
      <section className="border-y border-outline-dim/10 bg-surface-low py-20">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="mb-12 text-center text-3xl font-extrabold text-primary-600">
            {t('about_what_title')}
          </h2>
          <div className="grid gap-8 md:grid-cols-3">
            <AboutCard
              icon={<Bot className="h-7 w-7 text-primary-500" />}
              title={t('about_ai_title')}
              desc={t('about_ai_desc')}
            />
            <AboutCard
              icon={<Users className="h-7 w-7 text-primary-500" />}
              title={t('about_match_title')}
              desc={t('about_match_desc')}
            />
            <AboutCard
              icon={<Shield className="h-7 w-7 text-primary-500" />}
              title={t('about_secure_title')}
              desc={t('about_secure_desc')}
            />
          </div>
        </div>
      </section>

      {/* Tech behind */}
      <section className="py-20">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="mb-12 text-center text-3xl font-extrabold text-primary-600">
            {t('about_tech_title')}
          </h2>
          <div className="grid gap-6 md:grid-cols-2">
            <TechItem
              icon={<Code className="h-5 w-5 text-accent-coral-600" />}
              title={t('about_tech_brd')}
              desc={t('about_tech_brd_desc')}
            />
            <TechItem
              icon={<Target className="h-5 w-5 text-accent-coral-600" />}
              title={t('about_tech_cv')}
              desc={t('about_tech_cv_desc')}
            />
            <TechItem
              icon={<Zap className="h-5 w-5 text-accent-coral-600" />}
              title={t('about_tech_matching')}
              desc={t('about_tech_matching_desc')}
            />
            <TechItem
              icon={<Shield className="h-5 w-5 text-accent-coral-600" />}
              title={t('about_tech_escrow')}
              desc={t('about_tech_escrow_desc')}
            />
          </div>
        </div>
      </section>

      {/* Stats: real platform numbers; hidden until they load */}
      {stats && (
        <section className="border-y border-white/5 bg-primary-600 py-12">
          <div className="mx-auto grid max-w-4xl grid-cols-2 gap-8 px-6 text-white md:grid-cols-4">
            <div className="text-center">
              <p className="text-3xl font-black">{stats.total}</p>
              <p className="mt-1 text-sm opacity-70">{t('stat_total_projects')}</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-black">{stats.completed}</p>
              <p className="mt-1 text-sm opacity-70">{t('stat_projects')}</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-black">{stats.active}</p>
              <p className="mt-1 text-sm opacity-70">{t('stat_active')}</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-black">&lt;72j</p>
              <p className="mt-1 text-sm opacity-70">{t('stat_matching')}</p>
            </div>
          </div>
        </section>
      )}

      {/* Footer note */}
      <section className="py-16">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <p className="text-lg font-medium text-on-surface">{t('about_footer_note')}</p>
        </div>
      </section>
    </div>
  )
}

function AboutCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-2xl border border-outline-dim/20 bg-surface-bright p-7 shadow-sm">
      <div className="mb-4">{icon}</div>
      <h3 className="mb-2 text-lg font-bold text-on-surface">{title}</h3>
      <p className="text-sm leading-relaxed text-on-surface-muted">{desc}</p>
    </div>
  )
}

function TechItem({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex gap-4 rounded-2xl border border-outline-dim/10 bg-surface-bright p-6">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-coral-500/10">
        {icon}
      </div>
      <div>
        <h4 className="font-bold text-on-surface">{title}</h4>
        <p className="mt-1 text-sm leading-relaxed text-on-surface-muted">{desc}</p>
      </div>
    </div>
  )
}
