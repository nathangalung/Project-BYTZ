/**
 * Every notification the platform sends, in both languages it ships.
 *
 * This is the canonical copy. The Go table in notification-service and the two
 * locale files in apps/web are GENERATED from it by
 * apps/notification-service/scripts/generate-notification-templates.ts, and CI
 * fails when they drift. Two hand-written copies in two languages is the exact
 * arrangement CLAUDE.md already records going wrong for the fee table, the
 * completeness table, and the per-service osv-scanner.toml files.
 *
 * Both renderers are needed because both surfaces are user-facing: the frontend
 * renders in-app notifications from key plus params, and notification-service
 * renders the email body and the stored title/message fallback in the
 * recipient's own locale.
 *
 * Key names come from the Notification Event Catalog in CLAUDE.md and follow
 * the convention written there: NATS subject 'milestone.submitted' becomes
 * 'notification.milestone_submitted'.
 *
 * Interpolation is the i18next subset both renderers implement: {{name}} for a
 * plain value and {{name, currency}} for Rupiah. Nothing else is supported, so
 * a template cannot ask for formatting one side cannot do.
 */

export type NotificationLocale = 'id' | 'en'

export type NotificationTemplate = {
  readonly title: string
  readonly message: string
}

export type NotificationTemplateEntry = {
  readonly [L in NotificationLocale]: NotificationTemplate
}

export const NOTIFICATION_TEMPLATES = {
  'notification.project_status_changed': {
    id: {
      title: 'Status proyek berubah',
      message: 'Status proyek Anda sekarang {{status}}.',
    },
    en: {
      title: 'Project status updated',
      message: 'Your project status is now {{status}}.',
    },
  },
  'notification.project_completed': {
    id: {
      title: 'Proyek selesai',
      message: 'Proyek Anda sudah ditandai selesai.',
    },
    en: {
      title: 'Project completed',
      message: 'Your project has been marked as completed.',
    },
  },
  'notification.team_complete': {
    id: {
      title: 'Tim sudah lengkap',
      message: 'Semua posisi di proyek Anda sudah terisi.',
    },
    en: {
      title: 'Team formation complete',
      message: 'All team positions have been filled for your project.',
    },
  },
  'notification.project_start_overdue': {
    id: {
      title: 'Proyek belum dimulai',
      message:
        'Pengerjaan proyek Anda belum dimulai sejak tim terbentuk. Hubungi tim atau minta bantuan admin untuk melepas dana escrow Anda.',
    },
    en: {
      title: 'Project has not started',
      message:
        'Work on your project has not started since it was matched. Contact the team or ask support to release your escrow.',
    },
  },
  'notification.admin_project_start_overdue': {
    id: {
      title: 'Proyek belum dimulai',
      message: 'Proyek {{projectId}} melewati tenggat mulai dan escrow-nya sudah terisi.',
    },
    en: {
      title: 'Project has not started',
      message: 'Project {{projectId}} has held matched past the start deadline with escrow funded.',
    },
  },
  'notification.project_decision_overdue': {
    id: {
      title: 'PRD Anda menunggu keputusan',
      message:
        'PRD Anda sudah disetujui dan proyeknya belum bergerak. Danai proyeknya untuk mulai mencari talenta, atau ambil PRD-nya dan tutup proyek ini.',
    },
    en: {
      title: 'Your PRD is waiting on a decision',
      message:
        'Your PRD is approved and the project has not moved since. Fund the project to start matching, or take the PRD and close it out.',
    },
  },
  'notification.team_escalated': {
    id: {
      title: 'Pembentukan tim perlu perhatian',
      message:
        'Proyek ini belum mengisi semua posisi dalam batas 14 hari. Sesuaikan timeline atau scope-nya, atau terima tim yang sudah terkumpul.',
    },
    en: {
      title: 'Team formation needs attention',
      message:
        'This project has not filled every position within the 14-day window. Adjust the timeline or scope, or accept the team assembled so far.',
    },
  },
  'notification.admin_team_escalated': {
    id: {
      title: 'Pembentukan tim perlu perhatian',
      message: 'Proyek {{projectId}} melewati tenggat pembentukan tim ({{reason}}).',
    },
    en: {
      title: 'Team formation needs attention',
      message: 'Project {{projectId}} passed the team formation deadline ({{reason}}).',
    },
  },
  'notification.assignment_offer': {
    id: {
      title: 'Ada tawaran pekerjaan baru',
      message:
        'Ada tawaran work package yang menunggu Anda. Terima atau tolak dari dashboard Anda.',
    },
    en: {
      title: 'New assignment offer',
      message: 'You have a work package offer waiting. Accept or decline it from your dashboard.',
    },
  },
  'notification.assignment_declined': {
    id: {
      title: 'Seorang talenta menolak tawaran',
      message:
        'Satu posisi di proyek Anda terbuka lagi. Pilih penggantinya dari halaman pencocokan.',
    },
    en: {
      title: 'A talent declined their offer',
      message: 'A position on your project reopened. Pick a replacement from the matching page.',
    },
  },
  'notification.dispute_created': {
    id: {
      title: 'Ada sengketa di proyek Anda',
      message:
        'Pihak lain membuka sengketa. Dana escrow dibekukan selama sengketa berjalan. Anda punya tiga hari kerja untuk menyelesaikannya langsung sebelum admin turun tangan.',
    },
    en: {
      title: 'A dispute was opened on your project',
      message:
        'The other party opened a dispute. Escrow is frozen while it is open. You have three working days to settle it directly before an admin mediates.',
    },
  },
  'notification.admin_new_dispute': {
    id: {
      title: 'Sengketa baru dibuka',
      message: 'Ada sengketa baru yang perlu dimediasi. Escrow proyeknya dibekukan.',
    },
    en: {
      title: 'New dispute opened',
      message: 'A dispute was opened and needs mediation. Escrow on the project is frozen.',
    },
  },
  'notification.dispute_resolved': {
    id: {
      title: 'Sengketa Anda sudah diputuskan',
      message: 'Sengketa di proyek Anda sudah selesai dan dana escrow dilepas sesuai keputusan.',
    },
    en: {
      title: 'Your dispute was resolved',
      message: 'The dispute on your project was resolved and the escrow was released accordingly.',
    },
  },
  'notification.dispute_resolved_funds_to_owner': {
    id: {
      title: 'Sengketa Anda sudah diputuskan',
      message: 'Sengketa diputuskan memenangkan pemilik proyek dan dana yang ditahan dikembalikan.',
    },
    en: {
      title: 'Your dispute was resolved',
      message: "The dispute was resolved in the owner's favour and the held funds were refunded.",
    },
  },
  'notification.dispute_resolved_funds_to_talent': {
    id: {
      title: 'Sengketa Anda sudah diputuskan',
      message: 'Sengketa diputuskan memenangkan talenta dan dana yang ditahan dicairkan.',
    },
    en: {
      title: 'Your dispute was resolved',
      message: "The dispute was resolved in the talent's favour and the held funds were released.",
    },
  },
  'notification.dispute_resolved_split': {
    id: {
      title: 'Sengketa Anda sudah diputuskan',
      message: 'Sengketa diputuskan dengan membagi dana yang ditahan ke kedua pihak.',
    },
    en: {
      title: 'Your dispute was resolved',
      message: 'The dispute was resolved with the held funds split between both sides.',
    },
  },
  'notification.contract_ready': {
    id: {
      title: 'Perjanjian siap ditandatangani',
      message:
        'NDA dan perjanjian pengalihan HKI untuk {{roleLabel}} sudah siap. Pengerjaan belum bisa dimulai sebelum Anda dan talenta sama-sama menandatanganinya.',
    },
    en: {
      title: 'Agreements are ready to sign',
      message:
        'The NDA and IP transfer agreement for {{roleLabel}} are ready. Work cannot start until both you and the talent have signed.',
    },
  },
  'notification.contract_ready_talent': {
    id: {
      title: 'Perjanjian siap ditandatangani',
      message:
        'NDA dan perjanjian pengalihan HKI untuk posisi Anda sudah siap. Pengerjaan belum bisa dimulai sebelum Anda dan pemilik proyek sama-sama menandatanganinya.',
    },
    en: {
      title: 'Agreements are ready to sign',
      message:
        'The NDA and IP transfer agreement for your position are ready. Work cannot start until both you and the owner have signed.',
    },
  },
  'notification.contract_executed': {
    id: {
      title: 'Semua perjanjian sudah ditandatangani',
      message:
        'Seluruh NDA dan perjanjian pengalihan HKI di proyek ini sudah ditandatangani. Pengerjaan bisa dimulai.',
    },
    en: {
      title: 'Every agreement is signed',
      message: 'All NDAs and IP transfer agreements on this project are signed. Work can start.',
    },
  },
  'notification.application_created': {
    id: {
      title: 'Ada talenta melamar proyek Anda',
      message:
        'Seseorang melamar proyek Anda. Tinjau profil anonimnya dan tentukan siapa yang bergabung.',
    },
    en: {
      title: 'A talent applied to your project',
      message:
        'Someone applied to your project. Review the anonymous profile and decide who joins.',
    },
  },
  'notification.application_accepted': {
    id: {
      title: 'Lamaran Anda diterima',
      message: 'Pemilik proyek menerima lamaran Anda. Buka proyeknya untuk melihat pekerjaannya.',
    },
    en: {
      title: 'Your application was accepted',
      message: 'The owner accepted your application. Open the project to see the work.',
    },
  },
  'notification.application_rejected': {
    id: {
      title: 'Lamaran Anda belum dipilih',
      message:
        'Pemilik proyek memilih talenta lain untuk proyek ini. Lamaran Anda yang lain tidak terpengaruh.',
    },
    en: {
      title: 'Your application was not selected',
      message:
        'The owner has chosen another talent for this project. Your other applications are unaffected.',
    },
  },
  'notification.payment_released': {
    id: {
      title: 'Pembayaran dicairkan',
      message: 'Pembayaran {{amount, currency}} sudah dicairkan untuk milestone Anda.',
    },
    en: {
      title: 'Payment released',
      message: 'Payment of {{amount, currency}} has been released for your milestone.',
    },
  },
  'notification.milestone_submitted': {
    id: {
      title: 'Milestone dikirim',
      message: 'Ada milestone yang dikirim dan menunggu tinjauan Anda.',
    },
    en: {
      title: 'Milestone submitted',
      message: 'A milestone has been submitted for your review.',
    },
  },
  'notification.milestone_approved': {
    id: {
      title: 'Milestone disetujui',
      message: 'Milestone Anda disetujui. Pembayaran {{amount, currency}} akan dicairkan.',
    },
    en: {
      title: 'Milestone approved',
      message:
        'Your milestone has been approved. Payment of {{amount, currency}} will be released.',
    },
  },
  'notification.milestone_auto_released': {
    id: {
      title: 'Milestone disetujui otomatis',
      message:
        'Jendela tinjauan 14 hari sudah lewat, jadi milestone ini disetujui otomatis dan {{amount, currency}} dicairkan.',
    },
    en: {
      title: 'Milestone auto-approved',
      message:
        'The 14-day review window closed, so this milestone was approved automatically and {{amount, currency}} released.',
    },
  },
  'notification.milestone_rejected': {
    id: {
      title: 'Milestone ditolak',
      message: 'Kiriman milestone Anda ditolak. Silakan baca catatan dari pemilik proyek.',
    },
    en: {
      title: 'Milestone rejected',
      message: 'Your milestone submission has been rejected. Please review the feedback.',
    },
  },
  'notification.admin_milestone_rejected': {
    id: {
      title: 'Milestone ditolak',
      message:
        'Milestone {{milestoneId}} di proyek {{projectId}} ditolak. Cocokkan dengan scope yang disepakati.',
    },
    en: {
      title: 'Milestone rejected',
      message:
        'Milestone {{milestoneId}} on project {{projectId}} was rejected. Check it against the agreed scope.',
    },
  },
  'notification.revision_requested': {
    id: {
      title: 'Permintaan revisi',
      message: 'Ada permintaan revisi untuk milestone Anda.',
    },
    en: {
      title: 'Revision requested',
      message: 'A revision has been requested for your milestone.',
    },
  },
  'notification.admin_revision_exhausted': {
    id: {
      title: 'Jatah revisi habis',
      message:
        'Milestone {{milestoneId}} di proyek {{projectId}} sudah memakai seluruh revisi gratisnya. Cocokkan dengan scope yang disepakati.',
    },
    en: {
      title: 'Revision rounds exhausted',
      message:
        'Milestone {{milestoneId}} on project {{projectId}} has used every free revision. Check it against the agreed scope.',
    },
  },
  'notification.milestone_overdue': {
    id: {
      title: 'Milestone lewat tenggat',
      message: 'Milestone Anda sudah lewat tenggat. Segera kirimkan hasilnya.',
    },
    en: {
      title: 'Milestone overdue',
      message: 'Your milestone is past due. Please submit as soon as possible.',
    },
  },
  'notification.worker_overdue': {
    id: {
      title: 'Milestone lewat tenggat',
      message: 'Ada milestone di proyek Anda yang sudah lewat tanggal jatuh temponya.',
    },
    en: {
      title: 'Milestone overdue',
      message: 'A milestone on your project is past its due date.',
    },
  },
  'notification.milestone_due_soon': {
    id: {
      title: 'Milestone segera jatuh tempo',
      message: 'Milestone Anda jatuh tempo dalam {{days}} hari ke depan.',
    },
    en: {
      title: 'Milestone due soon',
      message: 'Your milestone is due within the next {{days}} days.',
    },
  },
  'notification.admin_ai_degraded': {
    id: {
      title: 'Layanan AI bermasalah',
      message:
        '{{errors}} dari {{total}} panggilan AI gagal dalam satu jam terakhir. Scoping, pembuatan dokumen, parsing CV, dan embedding semuanya bergantung padanya. Periksa key provider dan log ai-service.',
    },
    en: {
      title: 'AI service is failing',
      message:
        '{{errors}} of {{total}} AI calls failed in the last hour. Scoping, document generation, CV parsing and embeddings all depend on it. Check the provider key and the ai-service logs.',
    },
  },
} as const satisfies Record<string, NotificationTemplateEntry>

export type NotificationTemplateKey = keyof typeof NOTIFICATION_TEMPLATES

/**
 * Format an integer of Rupiah the way both renderers must agree on.
 *
 * Deliberately not Intl.NumberFormat: the Go renderer has to produce the same
 * bytes for the email body, and grouping by three with a dot is the whole of
 * what the templates ask for.
 */
export function formatNotificationCurrency(value: number): string {
  const rounded = Math.trunc(Math.abs(value))
  const digits = String(rounded)
  let grouped = ''
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) grouped += '.'
    grouped += digits[i]
  }
  return `${value < 0 ? '-' : ''}Rp ${grouped}`
}

/**
 * Render a template string against its params.
 *
 * Kept in shared so the frontend fallback and the generator's own tests read
 * the same implementation the Go side is written against. Unknown placeholders
 * are left standing rather than blanked: a visible '{{amount}}' is a bug report,
 * an empty gap is a sentence that reads as finished and is wrong.
 */
export function renderNotificationTemplate(
  template: string,
  params: Readonly<Record<string, unknown>> = {},
): string {
  return template.replace(
    /\{\{(\w+)(?:,\s*(\w+))?\}\}/g,
    (whole, name: string, format?: string) => {
      if (!(name in params)) return whole
      const value = params[name]
      if (format === 'currency') {
        const numeric = typeof value === 'number' ? value : Number(value)
        return Number.isFinite(numeric) ? formatNotificationCurrency(numeric) : whole
      }
      return String(value)
    },
  )
}
