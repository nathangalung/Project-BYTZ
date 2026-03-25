import { createFileRoute, Link } from '@tanstack/react-router'
import {
  ArrowRight,
  Bot,
  CheckCircle,
  Code,
  FileText,
  Handshake,
  Shield,
  Sparkles,
  Star,
  Target,
  Users,
  Zap,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PublicFooter } from '@/components/layout/public-footer'
import { PublicHeader } from '@/components/layout/public-header'

type PublicReview = {
  id: string
  rating: number
  comment: string | null
  type: string
  createdAt: string
}

type PlatformStats = {
  total: number
  completed: number
  active: number
}

export const Route = createFileRoute('/')({
  component: LandingPage,
})

function LandingPage() {
  const { t } = useTranslation('common')
  const [reviews, setReviews] = useState<PublicReview[]>([])
  const [stats, setStats] = useState<PlatformStats | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    const opts = { signal: ctrl.signal }
    fetch('/api/v1/reviews/public', opts)
      .then((r) => r.json())
      .then((res) => {
        if (res.success && Array.isArray(res.data)) setReviews(res.data.slice(0, 3))
      })
      .catch(() => {})
    fetch('/api/v1/projects/stats', opts)
      .then((r) => r.json())
      .then((res) => {
        if (res.success && res.data) setStats(res.data)
      })
      .catch(() => {})
    return () => ctrl.abort()
  }, [])

  return (
    <div className="min-h-screen bg-surface" lang="id">
      <PublicHeader />
      <main id="main-content">
        {/* Hero */}
        <header className="mesh-bg relative overflow-hidden pt-20 pb-28">
          <div className="relative z-10 mx-auto grid max-w-screen-2xl grid-cols-1 items-center gap-16 px-6 md:px-10 lg:grid-cols-2">
            <div>
              <span className="mb-6 inline-flex items-center gap-2 rounded-full bg-primary-500/10 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-primary-500">
                <Sparkles className="h-3.5 w-3.5" /> {t('hero_badge')}
              </span>
              <h1 className="mb-7 text-5xl font-extrabold leading-[1.08] tracking-tight text-primary-600 lg:text-[4.2rem]">
                {t('hero_title')}{' '}
                <span className="text-accent-coral-600">{t('hero_title_accent')}</span>
              </h1>
              <p className="mb-10 max-w-xl text-lg leading-relaxed text-on-surface-muted">
                {t('hero_description')}
              </p>
              <div className="flex flex-col gap-4 sm:flex-row">
                <Link
                  to="/request-project"
                  className="group flex items-center justify-center gap-2 rounded-2xl bg-primary-600 px-8 py-4 font-bold text-white shadow-xl transition-all hover:-translate-y-0.5 hover:opacity-95"
                >
                  {t('start_project')}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
                <Link
                  to="/browse-projects"
                  className="flex items-center justify-center gap-2 rounded-2xl bg-surface-container px-8 py-4 font-bold text-primary-600 transition-all hover:bg-surface-high"
                >
                  {t('explore_talent')}
                </Link>
              </div>
            </div>

            {/* Hero cards — hidden on mobile */}
            <div className="hidden grid-cols-2 gap-4 lg:grid">
              <div className="space-y-4 pt-10">
                <HeroCard
                  icon={<Bot className="h-7 w-7 text-primary-500" />}
                  title={t('hero_card_ai_title')}
                  desc={t('hero_card_ai')}
                />
                <div className="rounded-2xl bg-primary-600 p-6 text-white">
                  <CheckCircle className="mb-3 h-7 w-7 text-accent-coral-500" />
                  <h3 className="mb-1 font-bold">{t('hero_card_talent_title')}</h3>
                  <p className="text-sm opacity-80">{t('hero_card_talent')}</p>
                </div>
              </div>
              <div className="space-y-4">
                <div className="rounded-2xl border border-outline-dim/20 bg-surface-bright p-6">
                  <Users className="mb-3 h-7 w-7 text-primary-500" />
                  <h3 className="mb-1 font-bold text-on-surface">{t('hero_card_match_title')}</h3>
                  <p className="text-sm text-on-surface-muted">{t('hero_card_match')}</p>
                </div>
                <div className="rounded-2xl bg-primary-500 p-6 text-white">
                  <Shield className="mb-3 h-7 w-7 text-primary-200" />
                  <h3 className="mb-1 font-bold">{t('hero_card_escrow_title')}</h3>
                  <p className="text-sm opacity-80">{t('hero_card_escrow')}</p>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Stats */}
        <section className="border-y border-white/5 bg-primary-600 py-6">
          <div className="mx-auto grid max-w-screen-2xl grid-cols-2 gap-6 px-6 text-white md:grid-cols-4 md:px-10">
            <StatItem value={stats ? `${stats.completed}+` : null} label={t('stat_projects')} />
            <StatItem value={stats ? '4.8/5' : null} label={t('stat_rating')} />
            <StatItem value={stats ? `${stats.total}+` : null} label={t('stat_total_projects')} />
            <StatItem value="72 jam" label={t('stat_matching')} />
          </div>
        </section>

        {/* How it works */}
        <section className="bg-surface-low py-24">
          <div className="mx-auto max-w-screen-2xl px-6 md:px-10">
            <div className="mx-auto mb-20 max-w-3xl text-center">
              <h2 className="mb-5 text-4xl font-extrabold text-primary-600">{t('how_title')}</h2>
              <p className="text-lg text-on-surface-muted">{t('how_subtitle')}</p>
            </div>
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
              {/* Owner */}
              <div>
                <ColumnHeader num="1" label={t('for_client')} />
                <div className="space-y-6 rounded-3xl border border-outline-dim/10 bg-surface-bright p-7">
                  <FlowItem
                    icon={<FileText className="h-5 w-5 text-primary-500" />}
                    title={t('flow_submit')}
                    desc={t('flow_submit_desc')}
                  />
                  <div className="flex gap-4 rounded-2xl bg-primary-500/10 p-4">
                    <Bot className="h-5 w-5 shrink-0 text-primary-500" />
                    <div>
                      <h4 className="font-bold text-primary-600">{t('flow_chat_title')}</h4>
                      <p className="mt-1 text-sm text-on-surface-muted">{t('flow_chat_desc')}</p>
                    </div>
                  </div>
                  <FlowItem
                    icon={<Sparkles className="h-5 w-5 text-accent-coral-600" />}
                    title={t('flow_brd_title')}
                    desc={t('flow_brd_desc')}
                  />
                  <FlowItem
                    icon={<Target className="h-5 w-5 text-primary-500" />}
                    title={t('flow_analysis_title')}
                    desc={t('flow_analysis_desc')}
                  />
                </div>
              </div>
              {/* Talent */}
              <div>
                <ColumnHeader num="2" label={t('for_worker')} />
                <div className="space-y-6 rounded-3xl border border-outline-dim/10 bg-surface-bright p-7">
                  <FlowItem
                    icon={<FileText className="h-5 w-5 text-primary-500" />}
                    title={t('flow_register')}
                    desc={t('flow_register_desc')}
                  />
                  <div className="flex gap-4 rounded-2xl bg-primary-600 p-4 text-white">
                    <Code className="h-5 w-5 shrink-0" />
                    <div>
                      <h4 className="font-bold">{t('flow_cv_title')}</h4>
                      <p className="mt-1 text-sm opacity-70">{t('flow_cv_desc')}</p>
                    </div>
                  </div>
                  <FlowItem
                    icon={<Users className="h-5 w-5 text-primary-500" />}
                    title={t('flow_recommend_title')}
                    desc={t('flow_recommend_desc')}
                  />
                </div>
              </div>
              {/* Shared */}
              <div>
                <ColumnHeader num="3" label={t('shared_process')} primary />
                <div className="relative overflow-hidden rounded-3xl bg-primary-600 p-7 text-white shadow-xl">
                  <div className="pointer-events-none absolute -right-10 -bottom-10 h-48 w-48 rounded-full bg-accent-coral-500/20 blur-2xl" />
                  <div className="relative z-10 space-y-6">
                    <FlowItem
                      icon={<Zap className="h-5 w-5 text-accent-coral-500" />}
                      title={t('flow_apply')}
                      desc={t('flow_apply_desc')}
                      light
                    />
                    <div className="flex gap-4 rounded-2xl border border-white/10 bg-white/10 p-4">
                      <Handshake className="h-5 w-5 shrink-0" />
                      <div>
                        <h4 className="font-bold">{t('flow_matching_title')}</h4>
                        <p className="mt-1 text-sm opacity-80">{t('flow_matching_desc')}</p>
                      </div>
                    </div>
                    <FlowItem
                      icon={<Shield className="h-5 w-5 text-accent-coral-500" />}
                      title={t('flow_deal')}
                      desc={t('flow_deal_desc')}
                      light
                    />
                  </div>
                  <div className="relative z-10 mt-8 border-t border-white/10 pt-6">
                    <Link
                      to="/register"
                      className="block w-full rounded-xl bg-accent-coral-600 py-3 text-center font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-lg"
                    >
                      {t('start_now')}
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Testimonial */}
        <section className="py-24">
          <div className="mx-auto max-w-5xl px-6">
            {reviews.length > 0 ? (
              <div className="grid gap-6 md:grid-cols-3">
                {reviews.map((review) => (
                  <div
                    key={review.id}
                    className="rounded-2xl border border-outline-dim/20 bg-surface-bright p-8 shadow-sm"
                  >
                    <StarRating rating={review.rating} />
                    <p className="mt-4 text-sm font-medium leading-relaxed text-on-surface">
                      {review.comment || t('testimonial_no_comment')}
                    </p>
                    <p className="mt-3 text-xs text-on-surface-muted">
                      {new Date(review.createdAt).toLocaleDateString('id-ID')}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mx-auto max-w-3xl">
                <div className="rounded-2xl border border-outline-dim/20 bg-surface-bright p-10 shadow-sm sm:p-14">
                  <blockquote>
                    <StarRating rating={5} />
                    <p className="mt-6 text-lg font-medium leading-relaxed text-on-surface sm:text-xl">
                      {t('testimonial_quote')}
                    </p>
                    <footer className="mt-8 flex items-center gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-coral-500/20 text-lg font-bold text-accent-coral-600">
                        A
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-on-surface">
                          {t('testimonial_name')}
                        </p>
                        <p className="text-sm text-on-surface-muted">{t('testimonial_role')}</p>
                      </div>
                    </footer>
                  </blockquote>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* CTA */}
        <section className="py-20">
          <div className="mx-auto max-w-screen-2xl px-6 md:px-10">
            <div className="relative overflow-hidden rounded-[2.5rem] bg-primary-500 p-12 text-center lg:p-20">
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-accent-coral-600/20 to-transparent" />
              <div className="relative z-10 mx-auto max-w-3xl">
                <h2 className="mb-7 text-4xl font-extrabold text-white lg:text-5xl">
                  {t('cta_title')}
                </h2>
                <p className="mb-10 text-xl leading-relaxed text-white/80">
                  {t('cta_description')}
                </p>
                <div className="flex flex-col justify-center gap-5 sm:flex-row">
                  <Link
                    to="/request-project"
                    className="rounded-2xl bg-accent-coral-600 px-10 py-4 text-lg font-bold text-white transition-all hover:-translate-y-1 hover:shadow-2xl active:scale-95"
                  >
                    {t('cta_build')}
                  </Link>
                  <Link
                    to="/register"
                    className="rounded-2xl border border-white/20 bg-white/10 px-10 py-4 text-lg font-bold text-white backdrop-blur-md transition-all hover:bg-white/20"
                  >
                    {t('cta_talent')}
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  )
}

/* Helper components */

function HeroCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-2xl border border-outline-dim/20 bg-surface-bright p-6">
      <div className="mb-3">{icon}</div>
      <h3 className="mb-1 font-bold text-on-surface">{title}</h3>
      <p className="text-sm text-on-surface-muted">{desc}</p>
    </div>
  )
}

function StatItem({ value, label }: { value: string | null; label: string }) {
  return (
    <div className="text-center">
      {value !== null ? (
        <p className="text-3xl font-black">{value}</p>
      ) : (
        <div className="mx-auto h-9 w-20 animate-pulse rounded-lg bg-white/20" />
      )}
      <p className="mt-1 text-sm opacity-70">{label}</p>
    </div>
  )
}

function ColumnHeader({ num, label, primary }: { num: string; label: string; primary?: boolean }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <div
        className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white ${primary ? 'bg-primary-600' : 'bg-accent-coral-600'}`}
      >
        {num}
      </div>
      <h3 className="text-lg font-bold text-primary-600">{label}</h3>
    </div>
  )
}

function FlowItem({
  icon,
  title,
  desc,
  light,
}: {
  icon: React.ReactNode
  title: string
  desc: string
  light?: boolean
}) {
  return (
    <div className="flex gap-4">
      <span className="shrink-0">{icon}</span>
      <div>
        <h4 className={`font-bold ${light ? 'text-white' : 'text-on-surface'}`}>{title}</h4>
        <p className={`mt-1 text-sm ${light ? 'opacity-70' : 'text-on-surface-muted'}`}>{desc}</p>
      </div>
    </div>
  )
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={`star-${String(i)}`}
          className={`h-4 w-4 ${i < rating ? 'fill-accent-cream-600 text-accent-cream-600' : 'text-neutral-300'}`}
        />
      ))}
    </div>
  )
}
