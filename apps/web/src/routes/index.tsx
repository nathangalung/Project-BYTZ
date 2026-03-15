import { createFileRoute, Link } from '@tanstack/react-router'
import {
  ArrowRight,
  CheckCircle,
  Code,
  Globe,
  Quote,
  Shield,
  Sparkles,
  Star,
  Target,
  Users,
  Zap,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '@/lib/i18n'

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
    fetch('/api/v1/reviews/public')
      .then((r) => r.json())
      .then((res) => {
        if (res.success && Array.isArray(res.data)) {
          setReviews(res.data.slice(0, 3))
        }
      })
      .catch(() => {})
    fetch('/api/v1/projects/stats')
      .then((r) => r.json())
      .then((res) => {
        if (res.success && res.data) {
          setStats(res.data)
        }
      })
      .catch(() => {})
  }, [])

  return (
    <div className="min-h-screen bg-primary-600">
      {/* Header */}
      <header className="fixed top-0 right-0 left-0 z-50 border-b border-white/5 bg-primary-600/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link to="/" className="text-2xl font-bold tracking-tight text-warning-500">
            BYTZ
          </Link>
          <nav className="flex items-center gap-6">
            <Link
              to="/browse-projects"
              className="text-sm font-medium text-neutral-500 transition-colors hover:text-warning-500"
            >
              {t('browse_projects', 'Proyek')}
            </Link>
            <Link
              to="/request-project"
              className="text-sm font-medium text-neutral-500 transition-colors hover:text-warning-500"
            >
              {t('how_to_request', 'Cara Mengajukan')}
            </Link>
            <button
              type="button"
              onClick={() => i18n.changeLanguage(i18n.language === 'id' ? 'en' : 'id')}
              className="flex items-center gap-1 text-sm text-neutral-500 hover:text-warning-500"
            >
              <Globe className="h-4 w-4" />
              {i18n.language === 'id' ? 'EN' : 'ID'}
            </button>
            <Link
              to="/login"
              className="text-sm font-medium text-neutral-500 transition-colors hover:text-warning-500"
            >
              {t('login')}
            </Link>
            <Link
              to="/register"
              className="rounded-lg bg-success-500 px-5 py-2 text-sm font-semibold text-primary-600 transition-colors hover:bg-success-600"
            >
              {t('register')}
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden pt-32 pb-20">
        {/* Subtle grid pattern overlay */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(246,243,171,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(246,243,171,0.3) 1px, transparent 1px)',
            backgroundSize: '64px 64px',
          }}
        />
        <div className="relative mx-auto max-w-7xl px-6 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-neutral-600/40 px-4 py-1.5 text-xs font-medium text-neutral-400">
            <Sparkles className="h-3.5 w-3.5 text-warning-500" />
            {t('hero_badge', 'AI-Powered Project Platform')}
          </div>
          <h1 className="mx-auto max-w-4xl text-5xl font-bold leading-[1.1] tracking-tight text-warning-500 sm:text-6xl lg:text-7xl">
            Virtual Software House
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-neutral-500">
            {t(
              'hero_description',
              'Platform managed marketplace untuk proyek digital Indonesia. AI-powered scoping, worker terkurasi, escrow terjamin.',
            )}
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              to="/request-project"
              className="group flex items-center gap-2 rounded-lg bg-success-500 px-7 py-3.5 text-base font-semibold text-primary-600 shadow-lg shadow-success-500/20 transition-all hover:bg-success-600 hover:shadow-success-500/30"
            >
              {t('start_project', 'Mulai Proyek')}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              to="/browse-projects"
              className="flex items-center gap-2 rounded-lg border border-warning-500/30 px-7 py-3.5 text-base font-semibold text-warning-500 transition-all hover:border-warning-500/60 hover:bg-warning-500/5"
            >
              {t('join_as_worker', 'Gabung sebagai Worker')}
            </Link>
          </div>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="border-y border-white/5 bg-neutral-600/30">
        <div className="mx-auto grid max-w-5xl grid-cols-2 gap-px sm:grid-cols-4">
          <StatItem
            value={stats ? `${stats.completed}+` : '500+'}
            label={t('stat_projects', 'Proyek Selesai')}
          />
          <StatItem
            value={stats ? `${stats.total}+` : '1,000+'}
            label={t('stat_total_projects', 'Total Proyek')}
          />
          <StatItem
            value={stats ? `${stats.active}` : '98%'}
            label={t('stat_active', 'Proyek Aktif')}
          />
          <StatItem value="<72j" label={t('stat_matching', 'Waktu Matching')} />
        </div>
      </section>

      {/* Features */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mb-16 text-center">
            <h2 className="text-3xl font-bold tracking-tight text-warning-500 sm:text-4xl">
              {t('features_title', 'Kenapa BYTZ?')}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-neutral-500">
              {t(
                'features_subtitle',
                'Bukan freelancer marketplace biasa. BYTZ adalah virtual software house yang terkurasi.',
              )}
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            <FeatureCard
              icon={<Code className="h-6 w-6 text-success-500" />}
              title={t('feature_ai_title', 'AI-Powered Scoping')}
              description={t(
                'feature_ai_desc',
                'Chatbot AI menganalisis kebutuhan proyek dan menghasilkan BRD/PRD profesional secara otomatis.',
              )}
            />
            <FeatureCard
              icon={<Users className="h-6 w-6 text-success-500" />}
              title={t('feature_workers_title', 'Worker Terkurasi')}
              description={t(
                'feature_workers_desc',
                'Talent pool yang diverifikasi dengan pemerataan proyek yang adil untuk semua worker.',
              )}
            />
            <FeatureCard
              icon={<Shield className="h-6 w-6 text-success-500" />}
              title={t('feature_escrow_title', 'Escrow Terjamin')}
              description={t(
                'feature_escrow_desc',
                'Dana aman di escrow, dicairkan bertahap per milestone. Auto-release setelah 14 hari.',
              )}
            />
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="border-y border-white/5 bg-primary-700/50 py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mb-16 text-center">
            <h2 className="text-3xl font-bold tracking-tight text-warning-500 sm:text-4xl">
              {t('how_it_works_title', 'Bagaimana Cara Kerjanya?')}
            </h2>
          </div>
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <StepCard
              number={1}
              title={t('step_1_title', 'Ajukan Proyek')}
              description={t(
                'step_1_desc',
                'Isi form singkat tentang kebutuhan proyek digital Anda.',
              )}
              icon={<Target className="h-5 w-5" />}
            />
            <StepCard
              number={2}
              title={t('step_2_title', 'AI Scoping')}
              description={t(
                'step_2_desc',
                'Chatbot AI menggali detail dan menghasilkan dokumen BRD/PRD.',
              )}
              icon={<Sparkles className="h-5 w-5" />}
            />
            <StepCard
              number={3}
              title={t('step_3_title', 'Match Worker')}
              description={t(
                'step_3_desc',
                'Platform mencocokkan worker terbaik berdasarkan skill dan ketersediaan.',
              )}
              icon={<Zap className="h-5 w-5" />}
            />
            <StepCard
              number={4}
              title={t('step_4_title', 'Eksekusi & Deliver')}
              description={t(
                'step_4_desc',
                'Worker mengerjakan proyek dengan tracking milestone dan escrow terjamin.',
              )}
              icon={<CheckCircle className="h-5 w-5" />}
            />
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
                  className="relative rounded-2xl border border-white/10 bg-neutral-600/40 p-8"
                >
                  <Quote className="absolute top-6 left-6 h-8 w-8 text-error-500/40" />
                  <div className="relative z-10 pt-4">
                    <StarRating rating={review.rating} />
                    <p className="mt-4 text-sm leading-relaxed font-medium text-warning-500 italic">
                      {review.comment || t('testimonial_no_comment', 'Great experience!')}
                    </p>
                    <p className="mt-4 text-xs text-neutral-500">
                      {new Date(review.createdAt).toLocaleDateString('id-ID')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mx-auto max-w-3xl">
              <div className="relative rounded-2xl border border-white/10 bg-neutral-600/40 p-10 sm:p-14">
                <Quote className="absolute top-8 left-8 h-10 w-10 text-error-500/60 sm:top-10 sm:left-10 sm:h-12 sm:w-12" />
                <blockquote className="relative z-10 pt-6 sm:pt-4">
                  <p className="text-lg leading-relaxed font-medium text-warning-500 italic sm:text-xl">
                    {t(
                      'testimonial_quote',
                      '"BYTZ mengubah cara kami develop produk. Dari scoping sampai delivery, semuanya terstruktur dan transparan. Worker yang di-match sangat kompeten."',
                    )}
                  </p>
                  <footer className="mt-8 flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-error-500/20 text-lg font-bold text-error-500">
                      A
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-neutral-100">
                        {t('testimonial_name', 'Andi Pratama')}
                      </p>
                      <p className="text-sm text-neutral-500">
                        {t('testimonial_role', 'CTO, Startup Fintech')}
                      </p>
                    </div>
                  </footer>
                </blockquote>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* CTA */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="overflow-hidden rounded-2xl bg-success-500 px-8 py-16 text-center sm:px-16">
            <h2 className="text-3xl font-bold tracking-tight text-primary-600 sm:text-4xl">
              {t('cta_title', 'Siap Mulai Proyek Digital Anda?')}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-primary-600/70">
              {t(
                'cta_description',
                'Dari ide ke produk jadi. Gratis konsultasi awal, bayar hanya jika puas dengan dokumen.',
              )}
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link
                to="/register"
                className="rounded-lg bg-primary-600 px-8 py-3.5 text-base font-semibold text-warning-500 transition-colors hover:bg-primary-700"
              >
                {t('cta_button', 'Mulai Sekarang')}
              </Link>
              <Link
                to="/login"
                className="rounded-lg border border-primary-600/30 px-8 py-3.5 text-base font-semibold text-primary-600 transition-colors hover:bg-primary-600/10"
              >
                {t('cta_login', 'Sudah Punya Akun?')}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 bg-primary-800 py-12">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
            <div>
              <span className="text-xl font-bold tracking-tight text-warning-500">BYTZ</span>
              <p className="mt-1 text-sm text-neutral-500">
                {t('footer_tagline', 'Virtual Software House Indonesia')}
              </p>
            </div>
            <nav className="flex items-center gap-6">
              <Link
                to="/browse-projects"
                className="text-sm text-neutral-500 transition-colors hover:text-warning-500"
              >
                {t('browse_projects', 'Proyek')}
              </Link>
              <Link
                to="/request-project"
                className="text-sm text-neutral-500 transition-colors hover:text-warning-500"
              >
                {t('how_to_request', 'Cara Mengajukan')}
              </Link>
              <Link
                to="/login"
                className="text-sm text-neutral-500 transition-colors hover:text-warning-500"
              >
                {t('login')}
              </Link>
              <Link
                to="/register"
                className="text-sm text-neutral-500 transition-colors hover:text-warning-500"
              >
                {t('register')}
              </Link>
            </nav>
          </div>
          <div className="mt-8 border-t border-white/5 pt-8 text-center text-sm text-neutral-500">
            &copy; {new Date().getFullYear()} BYTZ. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  )
}

function StatItem({ value, label }: { value: string; label: string }) {
  return (
    <div className="px-6 py-8 text-center">
      <p className="text-3xl font-bold tracking-tight text-warning-500">{value}</p>
      <p className="mt-1 text-sm text-neutral-500">{label}</p>
    </div>
  )
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className="group rounded-xl border border-white/10 bg-neutral-600/40 p-8 transition-colors hover:border-white/20 hover:bg-neutral-600/60">
      <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg bg-success-500/10">
        {icon}
      </div>
      <h3 className="mb-3 text-lg font-semibold text-warning-500">{title}</h3>
      <p className="text-sm leading-relaxed text-neutral-500">{description}</p>
    </div>
  )
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={`star-${String(i)}`}
          className={`h-4 w-4 ${i < rating ? 'fill-warning-500 text-warning-500' : 'text-neutral-500'}`}
        />
      ))}
    </div>
  )
}

function StepCard({
  number,
  title,
  description,
  icon,
}: {
  number: number
  title: string
  description: string
  icon: React.ReactNode
}) {
  return (
    <div className="relative text-center">
      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full border-2 border-success-500 bg-success-500/10 text-success-500">
        {icon}
      </div>
      <span className="mb-2 inline-block rounded-full bg-success-500/10 px-3 py-0.5 text-xs font-semibold text-success-500">
        {String(number).padStart(2, '0')}
      </span>
      <h3 className="mt-2 text-base font-semibold text-warning-500">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-neutral-500">{description}</p>
    </div>
  )
}
