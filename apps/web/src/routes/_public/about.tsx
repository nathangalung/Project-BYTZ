import { createFileRoute } from '@tanstack/react-router'
import { Bot, Code, Shield, Target, Users, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/_public/about')({
  component: AboutPage,
})

function AboutPage() {
  const { t } = useTranslation('common')

  return (
    <div className="bg-surface">
      {/* Hero */}
      <section className="py-20">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <h1 className="text-4xl font-extrabold text-primary-600 lg:text-5xl">
            {t('about_hero_title', 'Tentang KerjaCUS!')}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-on-surface-muted">
            {t(
              'about_hero_desc',
              'KerjaCUS! adalah managed marketplace untuk proyek digital di Indonesia. Kami membantu klien dan talenta bekerja sama melalui proses yang terstruktur, mulai dari perencanaan sampai pengerjaan.',
            )}
          </p>
        </div>
      </section>

      {/* What we do */}
      <section className="border-y border-outline-dim/10 bg-surface-low py-20">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="mb-12 text-center text-3xl font-extrabold text-primary-600">
            {t('about_what_title', 'Apa yang Kami Lakukan')}
          </h2>
          <div className="grid gap-8 md:grid-cols-3">
            <AboutCard
              icon={<Bot className="h-7 w-7 text-primary-500" />}
              title={t('about_ai_title', 'Perencanaan dengan AI')}
              desc={t(
                'about_ai_desc',
                'AI membantu menyusun dokumen kebutuhan proyek (BRD/PRD) dari brief singkat, termasuk estimasi biaya dan kebutuhan tim.',
              )}
            />
            <AboutCard
              icon={<Users className="h-7 w-7 text-primary-500" />}
              title={t('about_match_title', 'Pencocokan Talenta')}
              desc={t(
                'about_match_desc',
                'Sistem matching mencocokkan proyek dengan talenta berdasarkan keahlian, pengalaman, dan ketersediaan. Semua talenta sudah melalui proses verifikasi.',
              )}
            />
            <AboutCard
              icon={<Shield className="h-7 w-7 text-primary-500" />}
              title={t('about_secure_title', 'Escrow dan Milestone')}
              desc={t(
                'about_secure_desc',
                'Dana klien aman di escrow dan hanya dicairkan setelah milestone disetujui. Proses pembayaran transparan untuk kedua pihak.',
              )}
            />
          </div>
        </div>
      </section>

      {/* Tech behind */}
      <section className="py-20">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="mb-12 text-center text-3xl font-extrabold text-primary-600">
            {t('about_tech_title', 'Teknologi di Balik Platform')}
          </h2>
          <div className="grid gap-6 md:grid-cols-2">
            <TechItem
              icon={<Code className="h-5 w-5 text-accent-coral-600" />}
              title={t('about_tech_brd', 'BRD/PRD Generator')}
              desc={t(
                'about_tech_brd_desc',
                'AI menganalisis kebutuhan proyek dan menghasilkan dokumen teknis secara otomatis, termasuk arsitektur sistem dan pembagian tugas.',
              )}
            />
            <TechItem
              icon={<Target className="h-5 w-5 text-accent-coral-600" />}
              title={t('about_tech_cv', 'CV Parser')}
              desc={t(
                'about_tech_cv_desc',
                'Dokumen CV diparsing otomatis untuk mengekstrak keahlian dan pengalaman. Data dicocokkan dengan kebutuhan proyek yang tersedia.',
              )}
            />
            <TechItem
              icon={<Zap className="h-5 w-5 text-accent-coral-600" />}
              title={t('about_tech_matching', 'Smart Matching')}
              desc={t(
                'about_tech_matching_desc',
                'Algoritma matching mempertimbangkan kecocokan skill, track record, ketersediaan, dan prinsip pemerataan proyek untuk semua talenta.',
              )}
            />
            <TechItem
              icon={<Shield className="h-5 w-5 text-accent-coral-600" />}
              title={t('about_tech_escrow', 'Escrow Protection')}
              desc={t(
                'about_tech_escrow_desc',
                'Sistem escrow otomatis menahan dana sampai pekerjaan disetujui. Auto-release 14 hari jika klien tidak merespons.',
              )}
            />
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-y border-white/5 bg-primary-600 py-12">
        <div className="mx-auto grid max-w-4xl grid-cols-2 gap-8 px-6 text-white md:grid-cols-4">
          <div className="text-center">
            <p className="text-3xl font-black">2,500+</p>
            <p className="mt-1 text-sm opacity-70">{t('about_stat_talent', 'Talenta Terdaftar')}</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-black">500+</p>
            <p className="mt-1 text-sm opacity-70">{t('stat_projects')}</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-black">98%</p>
            <p className="mt-1 text-sm opacity-70">Match Accuracy</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-black">&lt;72j</p>
            <p className="mt-1 text-sm opacity-70">{t('stat_matching')}</p>
          </div>
        </div>
      </section>

      {/* Footer note */}
      <section className="py-16">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <p className="text-lg font-medium text-on-surface">
            {t(
              'about_footer_note',
              'KerjaCUS! berfokus pada proyek digital seperti pengembangan web, mobile app, UI/UX design, dan solusi data/AI. Arsitektur platform sudah dirancang agar bisa diperluas ke bidang lain di masa depan.',
            )}
          </p>
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
